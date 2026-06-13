"""
AgentResumeService：会话内简历上传与 Redis 会话级引用。

职责：
- 调用 ResumeService.upload_resume 落盘+解析+入库（避免 Repository 越层做文件 I/O）
- 校验绑定的 job_id 属于当前员工
- 把简历引用写入 Redis（会话级，30 分钟 TTL）
- 提供从 Redis 读取会话简历引用的能力

不做：业务规则、graph 编排、消息落库、文件存储/解析（委托 ResumeService）。
"""

from __future__ import annotations

import logging
from typing import Any

from app.core.exceptions import ValidationError
from app.repositories.job_repository import JobRepository
from app.services.cache_service import CacheService
from app.services.resume_service import ResumeService

logger = logging.getLogger(__name__)

SESSION_RESUME_REF_KEY = "agent:session_resume_ref:{session_id}"
SESSION_RESUME_REF_TTL = 1800  # 30 分钟


class AgentResumeService:
    """会话内简历上传与引用。"""

    def __init__(
        self,
        *,
        resume_service: ResumeService,
        job_repo: JobRepository,
        cache: CacheService,
    ) -> None:
        # 复用 ResumeService 已有的上传/解析/落库链路，遵循分层不越权
        self._resume_svc = resume_service
        self._job_repo = job_repo
        self._cache = cache

    async def upload(
        self, *, session_id: int, file: Any, job_id: int | None, employee_id: int,
    ) -> dict[str, Any]:
        """上传简历并写入会话级 Redis 引用。

        Args:
            session_id: 会话 ID（用于构建 Redis key）
            file: 上传的文件对象（FastAPI UploadFile）
            job_id: 绑定的岗位 ID（可选；为空表示不绑定岗位）
            employee_id: 当前员工 ID（用于 job_id 归属校验，并作为简历上传者写入）

        Returns:
            上传结果字典，含：
            - resume_id: 简历主键
            - file_name: 原始文件名
            - file_path: 存储路径
            - job_id: 关联岗位 ID（可为空）

        Raises:
            ValidationError: job_id 不属于当前员工
        """
        # 校验 job_id 归属：避免会话级的简历挂到非当前员工的岗位上
        if job_id is not None:
            jobs = await self._job_repo.get_by_employee(employee_id)
            if job_id not in {j.id for j in jobs}:
                raise ValidationError(f"岗位 {job_id} 不属于当前员工")

        # 委托 ResumeService 完成存储+解析+入库（含格式校验、文本提取、缓存失效）
        resume = await self._resume_svc.upload_resume(employee_id, file)

        uploaded: dict[str, Any] = {
            "resume_id": resume.id,
            "file_name": resume.file_name,
            "file_path": resume.file_path,
            "job_id": job_id,
        }

        # 写入 Redis 会话级引用：30 分钟内允许同会话直接引用该简历
        ref = {
            "resume_id": int(resume.id or 0),
            "job_id": job_id,
            "file_name": str(resume.file_name or ""),
        }
        key = SESSION_RESUME_REF_KEY.format(session_id=session_id)
        await self._cache.set_json(key, ref, SESSION_RESUME_REF_TTL)
        logger.info(
            "会话简历附件已上传：session_id=%s resume_id=%s job_id=%s",
            session_id, ref["resume_id"], job_id,
        )
        return uploaded

    async def get_session_ref(self, *, session_id: int) -> dict[str, Any] | None:
        """读取会话级简历引用。

        Args:
            session_id: 会话 ID

        Returns:
            简历引用字典（含 resume_id、job_id、file_name），未命中返回 None
        """
        key = SESSION_RESUME_REF_KEY.format(session_id=session_id)
        cached = await self._cache.get_json(key)
        if cached and isinstance(cached, dict) and cached.get("resume_id"):
            return cached
        return None
