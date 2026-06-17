"""
ResumeLoader：简历原文读取。

- load(resume_id)：旧路径，Redis 缓存 → ResumeRepository（保留供其他调用方）。
- load_by_path(file_path)：新路径，按文件路径解析，无缓存（由 LangGraph checkpoint 管理）。

不做：业务规则、graph 编排、emit 事件。单一职责。
"""

from __future__ import annotations

import logging
from pathlib import Path

from app.repositories.resume_repository import ResumeRepository
from app.services.cache_service import CacheService
from app.utils.resume_parser import extract_resume_text
from app.utils.storage.base import BaseStorage

logger = logging.getLogger(__name__)

CACHE_KEY = "agent:resume_text:{resume_id}"
CACHE_TTL = 1800  # 30 分钟


class ResumeLoader:
    """简历原文读取器。"""

    def __init__(
        self, *,
        cache: CacheService, resume_repo: ResumeRepository, storage: BaseStorage,
    ) -> None:
        self._cache = cache
        self._repo = resume_repo
        self._storage = storage

    async def load(self, *, resume_id: int) -> str:
        """
        旧路径：按 resume_id 读取（Redis 缓存 → DB raw_text）。

        Returns:
            简历的纯文本内容。
        Raises:
            LookupError: 简历不存在。
        """
        key = CACHE_KEY.format(resume_id=resume_id)
        cached = await self._cache.get(key)
        if cached:
            logger.debug("简历缓存命中：resume_id=%s", resume_id)
            return cached
        resume = await self._repo.get_by_id(resume_id)
        if resume is None:
            raise LookupError(f"简历不存在：resume_id={resume_id}")
        # 注意：Resume 模型列名为 raw_text（AI 解析后的纯文本），不是 parsed_text。
        # 早期曾误用 parsed_text 导致 getattr 永远命中默认空串，使所有简历读取返回空。
        text = str(getattr(resume, "raw_text", "") or "")
        if text:
            await self._cache.set(key, text, CACHE_TTL)
        return text

    async def load_by_path(self, *, file_path: str) -> str:
        """
        新路径：按 file_path 解析文件为纯文本，无缓存（checkpoint 管理）。

        Args:
            file_path: 存储层相对路径（如 agent_resumes/{employee_id}/{uuid}.pdf）。
        Returns:
            简历纯文本；文件损坏/空时返回空串（由 graph 兜底处理）。
        """
        full_path = self._storage.get_full_path(file_path)
        # extract_resume_text 期望 Path（内部用 .suffix 判定格式），需包装
        return extract_resume_text(Path(full_path))

