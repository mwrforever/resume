import os
import logging
from pathlib import Path

from fastapi import UploadFile
from app.repositories.resume_repo import ResumeRepository
from app.models.resume import Resume
from app.utils.storage.registry import StorageRegistry
from app.utils.resume_parser import extract_resume_text
from app.core.exceptions import NotFoundError, ValidationError

logger = logging.getLogger(__name__)


class ResumeService:
    def __init__(self, resume_repo: ResumeRepository):
        self.resume_repo = resume_repo
        self.storage = StorageRegistry.get()

    async def upload_resume(self, user_id: int, file: UploadFile) -> Resume:
        """上传简历"""
        # 验证文件类型
        allowed_extensions = ['.pdf', '.docx']

        ext = None
        if file.filename:
            ext = os.path.splitext(file.filename)[1].lower()

        if ext not in allowed_extensions:
            raise ValidationError("只支持 PDF 或 DOCX 格式")

        # 上传到存储
        file_path = await self.storage.upload(file)
        raw_text = self._extract_text(file_path)
        if not raw_text:
            await self.storage.delete(file_path)
            raise ValidationError("简历文件未解析到文本内容")

        # 创建记录
        resume = await self.resume_repo.create(
            user_id=user_id,
            file_name=file.filename or "unknown",
            file_path=file_path,
            storage_type=self.storage.__class__.__name__,
            raw_text=raw_text
        )

        logger.info(f"用户 {user_id} 上传简历 {resume.id}: {file.filename}")

        return resume

    async def get_user_resumes(self, user_id: int) -> list[Resume]:
        """获取用户的所有简历"""
        return await self.resume_repo.get_by_user(user_id)

    async def get_resume_by_id(self, resume_id: int, user_id: int = None) -> Resume:
        """获取简历详情"""
        resume = await self.resume_repo.get_by_id(resume_id)
        if not resume:
            raise NotFoundError("简历不存在")
        if user_id and resume.user_id != user_id:
            raise NotFoundError("简历不存在")
        return resume

    async def delete_resume(self, resume_id: int, user_id: int) -> bool:
        """删除简历"""
        resume = await self.get_resume_by_id(resume_id, user_id)

        # 删除文件
        await self.storage.delete(resume.file_path)

        # 删除记录
        await self.resume_repo.delete(resume_id)

        logger.info(f"用户 {user_id} 删除简历 {resume_id}")

        return True

    async def parse_resume_text(self, resume_id: int) -> str:
        """解析简历文本（后续用于AI评估）"""
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