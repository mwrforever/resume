"""FastAPI 依赖注入：数据库、缓存、鉴权、Agent 服务工厂。"""

from fastapi import Request

from app.core.security import get_current_user, get_current_user_optional
from app.db.mysql import mysql_manager
from app.services.cache_service import CacheService


async def get_db():
    """获取数据库会话（per-request scope）。"""
    async with mysql_manager.session() as session:
        yield session


async def get_cache(request: Request) -> CacheService:
    """获取 Redis 缓存服务。"""
    return request.app.state.cache


def get_llm_config_service(db, cache: CacheService):
    """构造 LlmConfigService。"""
    from app.repositories.dept_repository import DeptRepository
    from app.repositories.employee_repository import EmployeeRepository
    from app.repositories.llm_config_repository import LlmConfigRepository
    from app.services.llm_config_service import LlmConfigService
    return LlmConfigService(
        LlmConfigRepository(db), EmployeeRepository(db), DeptRepository(db), cache,
    )


__all__ = [
    "get_db",
    "get_cache",
    "get_current_user",
    "get_current_user_optional",
    "get_llm_config_service",
    "CacheService",
]
