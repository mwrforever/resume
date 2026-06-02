"""Agent 流式事件 Redis 临时缓冲服务。"""

from __future__ import annotations

import json
import logging
from typing import Any

from redis.asyncio import Redis
from redis.exceptions import RedisError

logger = logging.getLogger(__name__)

STREAM_BUFFER_TTL_SECONDS = 1800


class AgentStreamBufferService:
    """使用 Redis APPEND 保存单次 Agent run 的 JSONL 流式事件。"""

    def __init__(self, redis_client: Redis | Any, ttl_seconds: int = STREAM_BUFFER_TTL_SECONDS) -> None:
        """
        初始化流式缓冲服务。

        Args:
            redis_client: redis.asyncio.Redis 兼容客户端
            ttl_seconds: 缓冲 TTL 秒数
        """
        self._redis = redis_client
        self._ttl_seconds = ttl_seconds
        self._memory_events: dict[str, list[dict[str, Any]]] = {}

    def build_key(self, session_id: int, run_id: str) -> str:
        """
        构建 Redis 缓冲 key。

        Args:
            session_id: Agent 会话 ID
            run_id: 本次 Agent run ID

        Returns:
            str: Redis key
        """
        return f"agent:stream_buffer:{session_id}:{run_id}"

    async def append_event(self, *, session_id: int, run_id: str, envelope: dict[str, Any]) -> None:
        """
        追加单条 envelope 到 Redis JSONL，失败时写入内存缓冲。

        Args:
            session_id: Agent 会话 ID
            run_id: 本次 Agent run ID
            envelope: SSE v2 envelope 字典
        """
        key = self.build_key(session_id, run_id)
        self._memory_events.setdefault(key, []).append(envelope)
        line = json.dumps(envelope, ensure_ascii=False, separators=(",", ":")) + "\n"
        try:
            await self._redis.append(key, line)
            await self._redis.expire(key, self._ttl_seconds)
        except (RedisError, RuntimeError, TimeoutError, ConnectionError):
            logger.warning("Agent stream buffer append failed and used memory fallback: key=%s", key, exc_info=True)

    async def read_events(self, *, session_id: int, run_id: str) -> list[dict[str, Any]]:
        """
        读取 Redis JSONL 事件，Redis 不可用时返回内存缓冲。

        Args:
            session_id: Agent 会话 ID
            run_id: 本次 Agent run ID

        Returns:
            list[dict[str, Any]]: 按写入顺序排列的 envelope 列表
        """
        key = self.build_key(session_id, run_id)
        try:
            raw = await self._redis.get(key)
            text = raw.decode("utf-8") if isinstance(raw, bytes) else raw
            if text:
                return [json.loads(line) for line in text.splitlines() if line.strip()]
        except (RedisError, RuntimeError, TimeoutError, ConnectionError, json.JSONDecodeError):
            logger.warning("Agent stream buffer read failed and used memory fallback: key=%s", key, exc_info=True)
        return list(self._memory_events.get(key, []))

    async def clear(self, *, session_id: int, run_id: str) -> None:
        """
        清理 Redis 与内存缓冲。

        Args:
            session_id: Agent 会话 ID
            run_id: 本次 Agent run ID
        """
        key = self.build_key(session_id, run_id)
        self._memory_events.pop(key, None)
        try:
            await self._redis.delete(key)
        except (RedisError, RuntimeError, TimeoutError, ConnectionError):
            logger.warning("Agent stream buffer clear failed: key=%s", key, exc_info=True)