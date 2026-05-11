import json
import logging

from fastapi import APIRouter, Depends, Query
from sqlalchemy.exc import SQLAlchemyError
from sqlalchemy.ext.asyncio import AsyncSession
from starlette.responses import StreamingResponse

from app.core.exceptions import BizError
from app.deps import get_cache, get_current_user, get_db
from app.repositories.agent_repository import AgentRepository
from app.repositories.agent_memory_repository import AgentMemoryRepository
from app.repositories.application_repository import ApplicationRepository
from app.repositories.dept_repository import DeptRepository
from app.repositories.employee_repository import EmployeeRepository
from app.repositories.evaluation_repository import EvalRepository
from app.repositories.job_repository import JobRepository
from app.repositories.llm_config_repository import LlmConfigRepository
from app.schemas.common import ApiResponse, PageData
from app.schemas.agent.request import AgentActionReject, AgentMessageCreate, AgentModelSelect, AgentSessionCreate, AgentSessionUpdate, LlmConfigCreate, LlmConfigUpdate
from app.schemas.agent.response import AgentActionItem, AgentReply, AgentRunItem, AgentSessionDetail, AgentSessionItem, LlmConfigItem, LlmModelOption
from app.services.agent_context_service import AgentContextService
from app.services.agent_service import AgentService
from app.services.cache_service import CacheService
from app.services.llm_config_service import LlmConfigService

llm_router = APIRouter()
agent_router = APIRouter()
logger = logging.getLogger(__name__)


def get_llm_service(db: AsyncSession = Depends(get_db), cache: CacheService = Depends(get_cache)) -> LlmConfigService:
    return LlmConfigService(LlmConfigRepository(db), EmployeeRepository(db), DeptRepository(db), cache)


def get_agent_service(db: AsyncSession = Depends(get_db), cache: CacheService = Depends(get_cache)) -> AgentService:
    llm_service = LlmConfigService(LlmConfigRepository(db), EmployeeRepository(db), DeptRepository(db), cache)
    context_service = AgentContextService(AgentMemoryRepository(db), cache)
    return AgentService(
        AgentRepository(db),
        llm_service,
        context_service,
        job_repo=JobRepository(db),
        app_repo=ApplicationRepository(db),
        eval_repo=EvalRepository(db),
    )


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


@agent_router.post("/sessions", response_model=ApiResponse[AgentSessionItem])
async def create_session(
    body: AgentSessionCreate,
    service: AgentService = Depends(get_agent_service),
    current_user: dict = Depends(get_current_user),
) -> ApiResponse[AgentSessionItem]:
    return ApiResponse(message="创建成功", data=await service.create_session(body, current_user))


@agent_router.get("/sessions", response_model=ApiResponse[PageData])
async def list_sessions(
    page: int = Query(1, ge=1),
    page_size: int = Query(20, ge=1, le=100),
    keyword: str | None = Query(None, max_length=100),
    service: AgentService = Depends(get_agent_service),
    current_user: dict = Depends(get_current_user),
) -> ApiResponse[PageData]:
    return ApiResponse(data=PageData(**await service.list_sessions(page, page_size, current_user, keyword)))


@agent_router.get("/sessions/{session_id}", response_model=ApiResponse[AgentSessionDetail])
async def get_session_detail(
    session_id: int,
    service: AgentService = Depends(get_agent_service),
    current_user: dict = Depends(get_current_user),
) -> ApiResponse[AgentSessionDetail]:
    return ApiResponse(data=await service.get_session_detail(session_id, current_user))


@agent_router.put("/sessions/{session_id}", response_model=ApiResponse[AgentSessionItem])
async def update_session(
    session_id: int,
    body: AgentSessionUpdate,
    service: AgentService = Depends(get_agent_service),
    current_user: dict = Depends(get_current_user),
) -> ApiResponse[AgentSessionItem]:
    return ApiResponse(message="更新成功", data=await service.update_session(session_id, body, current_user))


@agent_router.delete("/sessions/{session_id}", response_model=ApiResponse)
async def delete_session(
    session_id: int,
    service: AgentService = Depends(get_agent_service),
    current_user: dict = Depends(get_current_user),
) -> ApiResponse:
    await service.delete_session(session_id, current_user)
    return ApiResponse(message="删除成功")


@agent_router.post("/sessions/{session_id}/messages", response_model=ApiResponse[AgentReply])
async def send_message(
    session_id: int,
    body: AgentMessageCreate,
    service: AgentService = Depends(get_agent_service),
    current_user: dict = Depends(get_current_user),
) -> ApiResponse[AgentReply]:
    return ApiResponse(data=await service.send_message(session_id, body, current_user))


@agent_router.post("/sessions/{session_id}/messages/stream")
async def stream_message(
    session_id: int,
    body: AgentMessageCreate,
    service: AgentService = Depends(get_agent_service),
    current_user: dict = Depends(get_current_user),
) -> StreamingResponse:
    async def event_generator():
        try:
            async for event in service.stream_message(session_id, body, current_user):
                payload = json.dumps(event.data, ensure_ascii=False)
                yield f"event: {event.event}\ndata: {payload}\n\n"
        except BizError as exc:
            payload = json.dumps({"message": exc.message, "code": exc.code}, ensure_ascii=False)
            yield f"event: error\ndata: {payload}\n\n"
        except SQLAlchemyError:
            logger.exception("Agent流式接口数据库异常：session_id=%s", session_id)
            payload = json.dumps({"message": "Agent服务暂不可用，请稍后重试", "code": 500}, ensure_ascii=False)
            yield f"event: error\ndata: {payload}\n\n"

    return StreamingResponse(event_generator(), media_type="text/event-stream")


@agent_router.post("/sessions/{session_id}/select-model", response_model=ApiResponse[AgentSessionItem])
async def select_model(
    session_id: int,
    body: AgentModelSelect,
    service: AgentService = Depends(get_agent_service),
    current_user: dict = Depends(get_current_user),
) -> ApiResponse[AgentSessionItem]:
    return ApiResponse(message="选择成功", data=await service.select_model(session_id, body.model_name, current_user))


@agent_router.get("/sessions/{session_id}/runs", response_model=ApiResponse[list[AgentRunItem]])
async def list_runs(
    session_id: int,
    service: AgentService = Depends(get_agent_service),
    current_user: dict = Depends(get_current_user),
) -> ApiResponse[list[AgentRunItem]]:
    return ApiResponse(data=await service.list_runs(session_id, current_user))


@agent_router.get("/sessions/{session_id}/actions", response_model=ApiResponse[list[AgentActionItem]])
async def list_actions(
    session_id: int,
    service: AgentService = Depends(get_agent_service),
    current_user: dict = Depends(get_current_user),
) -> ApiResponse[list[AgentActionItem]]:
    return ApiResponse(data=await service.list_actions(session_id, current_user))


@agent_router.post("/actions/{action_id}/confirm", response_model=ApiResponse[AgentActionItem])
async def confirm_action(
    action_id: int,
    service: AgentService = Depends(get_agent_service),
    current_user: dict = Depends(get_current_user),
) -> ApiResponse[AgentActionItem]:
    return ApiResponse(message="确认成功", data=await service.confirm_action(action_id, current_user))


@agent_router.post("/actions/{action_id}/reject", response_model=ApiResponse[AgentActionItem])
async def reject_action(
    action_id: int,
    body: AgentActionReject,
    service: AgentService = Depends(get_agent_service),
    current_user: dict = Depends(get_current_user),
) -> ApiResponse[AgentActionItem]:
    return ApiResponse(message="已拒绝", data=await service.reject_action(action_id, body, current_user))
