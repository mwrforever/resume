from typing import Any, AsyncGenerator

import redis

from app.infrastructure.config import get_settings
from app.models import async_session_maker

_redis_client: redis.Redis | None = None


async def get_db() -> AsyncGenerator[Any, Any]:
    async with async_session_maker() as session:
        yield session


def get_redis_client() -> redis.Redis:
    global _redis_client
    if _redis_client is None:
        settings = get_settings()
        _redis_client = redis.Redis(
            host=settings.REDIS_HOST,
            port=settings.REDIS_PORT,
            db=settings.REDIS_DB,
            password=settings.redis_password or None,
            decode_responses=True,
        )
    return _redis_client
