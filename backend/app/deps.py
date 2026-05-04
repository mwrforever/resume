from typing import Any, AsyncGenerator

from fastapi import Depends
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.security import get_current_user
from app.db.mysql import mysql_manager
from app.db.redis import redis_manager
from app.services.cache_service import CacheService, get_cache


async def get_db() -> AsyncGenerator[AsyncSession, Any]:
    async with mysql_manager.session() as session:
        yield session


def get_cache_service() -> CacheService:
    return get_cache()


__all__ = [
    "get_db",
    "get_cache_service",
    "get_current_user",
    "CacheService",
]
