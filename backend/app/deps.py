from fastapi import Request

from app.core.security import get_current_user, get_current_user_optional
from app.db.mysql import mysql_manager
from app.services.cache_service import CacheService


async def get_db():
    async with mysql_manager.session() as session:
        yield session


async def get_cache(request: Request) -> CacheService:
    return request.app.state.cache


__all__ = [
    "get_db",
    "get_cache",
    "get_current_user",
    "get_current_user_optional",
    "CacheService",
]
