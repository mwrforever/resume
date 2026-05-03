from typing import Awaitable, Optional, cast

import redis.asyncio as redis
from redis.asyncio import Redis

from app.core.config import settings


class RedisManager:
    def __init__(self) -> None:
        self._client: Optional[Redis] = None

    @property
    def client(self) -> Redis:
        if self._client is None:
            raise RuntimeError("Redis client has not been initialized")
        return self._client

    async def init_client(self) -> None:
        """
        初始化 Redis 客户端。

        redis.from_url 内部会创建连接池。
        ping 成功后才把 client 赋值给 self._client。
        """
        if self._client is not None:
            return

        client = redis.from_url(
            settings.redis_url,
            max_connections=settings.REDIS_MAX_CONNECTIONS,
            socket_connect_timeout=settings.REDIS_SOCKET_CONNECT_TIMEOUT,
            socket_timeout=settings.REDIS_SOCKET_TIMEOUT,
            decode_responses=settings.REDIS_DECODE_RESPONSES,
        )

        try:
            pong = await cast(Awaitable[bool], client.ping())

            if pong:
                raise RuntimeError("Redis ping failed")

        except BaseException:
            await client.aclose()
            raise

        self._client = client

    async def close_client(self) -> None:
        """
        关闭 Redis 客户端以及内部连接池。
        """
        if self._client is None:
            return

        client = self._client
        self._client = None

        await client.aclose()


redis_manager = RedisManager()