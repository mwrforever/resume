"""员工 Agent 工作台 + LLM 配置 API。

注意：Agent 相关路由正在重构中（stages 1-7 会恢复），
当前仅保留 LLM 配置路由可用。
"""

import logging

from fastapi import APIRouter, Depends, Query
from sqlalchemy.ext.asyncio import AsyncSession

from app.deps import get_cache, get_current_user, get_db
from app.repositories.dept_repository import DeptRepository
from app.repositories.employee_repository import EmployeeRepository
from app.repositories.llm_config_repository import LlmConfigRepository
from app.schemas.common import ApiResponse, PageData
from app.schemas.agent.request import (
    AgentMessageCreate,
    AgentSessionCreate,
    AgentSessionUpdate,
    LlmConfigCreate,
    LlmConfigUpdate,
)
from app.schemas.agent.response import (
    AgentSessionDetail,
    AgentSessionItem,
    LlmConfigItem,
    LlmModelOption,
)
from app.services.cache_service import CacheService
from app.services.llm_config_service import LlmConfigService

llm_router = APIRouter()
agent_router = APIRouter()
logger = logging.getLogger(__name__)


def get_llm_service(
    db: AsyncSession = Depends(get_db), cache: CacheService = Depends(get_cache)
) -> LlmConfigService:
    """依赖注入：LLM 配置服务。"""
    return LlmConfigService(
        LlmConfigRepository(db), EmployeeRepository(db), DeptRepository(db), cache
    )


# ----------------------------- LLM 配置 -------------------------------------


@llm_router.get("/llm-model-options", response_model=ApiResponse[list[LlmModelOption]])
async def list_model_options(
    service: LlmConfigService = Depends(get_llm_service),
    current_user: dict = Depends(get_current_user),
) -> ApiResponse[list[LlmModelOption]]:
    return ApiResponse(data=await service.list_model_options(current_user))


@llm_router.get("/llm-configs", response_model=ApiResponse[PageData])
async def list_llm_configs(
    page: int = Query(1, ge=1),
    page_size: int = Query(20, ge=1, le=100),
    keyword: str | None = Query(None, max_length=100),
    biz_type: str | None = Query(None, pattern="^(employee|dept)$"),
    status: int | None = Query(None, ge=0, le=1),
    service: LlmConfigService = Depends(get_llm_service),
    current_user: dict = Depends(get_current_user),
) -> ApiResponse[PageData]:
    data = await service.list_configs(current_user, page, page_size, keyword, biz_type, status)
    return ApiResponse(data=PageData(**data))


@llm_router.post("/llm-configs", response_model=ApiResponse[LlmConfigItem])
async def create_llm_config(
    body: LlmConfigCreate,
    service: LlmConfigService = Depends(get_llm_service),
    current_user: dict = Depends(get_current_user),
) -> ApiResponse[LlmConfigItem]:
    return ApiResponse(message="创建成功", data=await service.create_config(body, current_user))


@llm_router.put("/llm-configs/{config_id}", response_model=ApiResponse[LlmConfigItem])
async def update_llm_config(
    config_id: int,
    body: LlmConfigUpdate,
    service: LlmConfigService = Depends(get_llm_service),
    current_user: dict = Depends(get_current_user),
) -> ApiResponse[LlmConfigItem]:
    return ApiResponse(message="更新成功", data=await service.update_config(config_id, body, current_user))


@llm_router.delete("/llm-configs/{config_id}", response_model=ApiResponse)
async def delete_llm_config(
    config_id: int,
    service: LlmConfigService = Depends(get_llm_service),
    current_user: dict = Depends(get_current_user),
) -> ApiResponse:
    await service.delete_config(config_id, current_user)
    return ApiResponse(message="删除成功")


@llm_router.post("/llm-configs/{config_id}/test", response_model=ApiResponse[LlmConfigItem])
async def test_llm_config(
    config_id: int,
    service: LlmConfigService = Depends(get_llm_service),
    current_user: dict = Depends(get_current_user),
) -> ApiResponse[LlmConfigItem]:
    return ApiResponse(message="测试完成", data=await service.test_config(config_id, current_user))


# ----------------------------- Agent 会话（重构中桩住）-----------------------


@agent_router.post("/sessions", response_model=ApiResponse[AgentSessionItem])
async def create_session(
    body: AgentSessionCreate,
    current_user: dict = Depends(get_current_user),
) -> ApiResponse[AgentSessionItem]:
    raise NotImplementedError("Agent runtime 正在重构中，stages 1-7 会恢复此接口")


@agent_router.get("/sessions", response_model=ApiResponse[PageData])
async def list_sessions(
    page: int = Query(1, ge=1),
    page_size: int = Query(20, ge=1, le=100),
    keyword: str | None = Query(None, max_length=100),
    current_user: dict = Depends(get_current_user),
) -> ApiResponse[PageData]:
    raise NotImplementedError("Agent runtime 正在重构中")


@agent_router.get("/sessions/{session_id}", response_model=ApiResponse[AgentSessionDetail])
async def get_session_detail(
    session_id: int,
    current_user: dict = Depends(get_current_user),
) -> ApiResponse[AgentSessionDetail]:
    raise NotImplementedError("Agent runtime 正在重构中")


@agent_router.put("/sessions/{session_id}", response_model=ApiResponse[AgentSessionItem])
async def update_session(
    session_id: int,
    body: AgentSessionUpdate,
    current_user: dict = Depends(get_current_user),
) -> ApiResponse[AgentSessionItem]:
    raise NotImplementedError("Agent runtime 正在重构中")


@agent_router.delete("/sessions/{session_id}", response_model=ApiResponse)
async def delete_session(
    session_id: int,
    current_user: dict = Depends(get_current_user),
) -> ApiResponse:
    raise NotImplementedError("Agent runtime 正在重构中")


@agent_router.post("/sessions/{session_id}/messages/stream")
async def stream_message(
    session_id: int,
    body: AgentMessageCreate,
    current_user: dict = Depends(get_current_user),
):
    raise NotImplementedError("Agent runtime 正在重构中")
