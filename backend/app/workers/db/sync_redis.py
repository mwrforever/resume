

from typing import Optional

import redis
from redis import Redis

from app.core.config import settings


class RedisManagerSync:
    def __init__(self) -> None:
        self._client: Optional[Redis] = None

    @property
    def client(self) -> Redis:
        if self._client is None:
            raise RuntimeError("Redis client has not been initialized")
        return self._client

    def init_client(self) -> None:
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
            pong = client.ping()
            if not pong:
                raise RuntimeError("Redis ping failed")
        except Exception:
            client.close()
            raise

        self._client = client

    def close_client(self) -> None:
        if self._client is None:
            return

        self._client.close()
        self._client = None


redis_manager_sync = RedisManagerSync()