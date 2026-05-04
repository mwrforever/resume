import os
import logging
from pathlib import Path

from fastapi import UploadFile
from app.repositories.resume_repository import ResumeRepository
from app.models.resume import Resume
from app.utils.storage.registry import StorageRegistry
from app.utils.resume_parser import extract_resume_text
from app.core.exceptions import NotFoundError, ValidationError
from app.services.cache_service import CacheService
from app.utils.cache_utils import (
    RESUME_BY_USER_KEY,
    RESUME_BY_USER_TTL,
    RESUME_COUNT_ALL_KEY,
)

logger = logging.getLogger(__name__)


class ResumeService:
    def __init__(self, resume_repo: ResumeRepository, cache: CacheService | None = None):
        self.resume_repo = resume_repo
        self.cache = cache
        self.storage = StorageRegistry.get()

    def _resume_to_dict(self, resume: Resume) -> dict:
        return {
            "id": resume.id,
            "user_id": resume.user_id,
            "file_name": resume.file_name,
            "file_path": resume.file_path,
            "storage_type": resume.storage_type,
            "status": resume.status,
            "create_time": resume.create_time.isoformat() if resume.create_time else None,
        }

    async def upload_resume(self, user_id: int, file: UploadFile) -> Resume:
        allowed_extensions = ['.pdf', '.docx']
        ext = None
        if file.filename:
            ext = os.path.splitext(file.filename)[1].lower()
        if ext not in allowed_extensions:
            raise ValidationError("只支持 PDF 或 DOCX 格式")

        file_path = await self.storage.upload(file)
        raw_text = self._extract_text(file_path)
        if not raw_text:
            await self.storage.delete(file_path)
            raise ValidationError("简历文件未解析到文本内容")

        resume = await self.resume_repo.create(
            user_id=user_id,
            file_name=file.filename or "unknown",
            file_path=file_path,
            storage_type=self.storage.__class__.__name__,
            raw_text=raw_text
        )
        if self.cache:
            await self.cache.delete(RESUME_BY_USER_KEY.format(user_id=user_id))
            await self.cache.delete(RESUME_COUNT_ALL_KEY)
        logger.info(f"用户 {user_id} 上传简历 {resume.id}: {file.filename}")
        return resume

    async def get_user_resumes(self, user_id: int) -> list[Resume]:
        if self.cache:
            cached = await self.cache.get_json(RESUME_BY_USER_KEY.format(user_id=user_id))
            if cached is not None:
                return [Resume(**r) for r in cached]
        resumes = await self.resume_repo.get_by_user(user_id)
        if self.cache and resumes:
            await self.cache.set_json(RESUME_BY_USER_KEY.format(user_id=user_id), [self._resume_to_dict(r) for r in resumes], RESUME_BY_USER_TTL)
        return resumes

    async def get_resume_by_id(self, resume_id: int, user_id: int = None) -> Resume:
        resume = await self.resume_repo.get_by_id(resume_id)
        if not resume:
            raise NotFoundError("简历不存在")
        if user_id and resume.user_id != user_id:
            raise NotFoundError("简历不存在")
        return resume

    async def delete_resume(self, resume_id: int, user_id: int) -> bool:
        resume = await self.get_resume_by_id(resume_id, user_id)
        await self.storage.delete(resume.file_path)
        await self.resume_repo.delete(resume_id)
        if self.cache:
            await self.cache.delete(RESUME_BY_USER_KEY.format(user_id=user_id))
            await self.cache.delete(RESUME_COUNT_ALL_KEY)
        logger.info(f"用户 {user_id} 删除简历 {resume_id}")
        return True

    async def parse_resume_text(self, resume_id: int) -> str:
        resume = await self.resume_repo.get_by_id(resume_id)
        if not resume:
            raise NotFoundError("简历不存在")
        if resume.raw_text:
            return resume.raw_text
        raw_text = self._extract_text(resume.file_path)
        if not raw_text:
            raise ValidationError("简历文件未解析到文本内容")
        await self.resume_repo.update_raw_text(resume_id, raw_text)
        return raw_text

    def _extract_text(self, file_path: str) -> str:
        full_path = Path(self.storage.get_full_path(file_path))
        if not full_path.exists():
            raise NotFoundError("简历文件不存在")
        return extract_resume_text(full_path)
