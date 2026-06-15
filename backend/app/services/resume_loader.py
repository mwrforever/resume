"""
ResumeLoader：简历原文读取，Redis 缓存命中优先 → ResumeRepository fallback。

不做：业务规则、graph 编排、emit 事件。单一职责。
"""

from __future__ import annotations

import logging

from app.repositories.resume_repository import ResumeRepository
from app.services.cache_service import CacheService

logger = logging.getLogger(__name__)

CACHE_KEY = "agent:resume_text:{resume_id}"
CACHE_TTL = 1800  # 30 分钟


class ResumeLoader:
    """简历原文读取器。"""

    def __init__(self, *, cache: CacheService, resume_repo: ResumeRepository) -> None:
        self._cache = cache
        self._repo = resume_repo

    async def load(self, *, resume_id: int) -> str:
        """
        读取简历原文。

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
