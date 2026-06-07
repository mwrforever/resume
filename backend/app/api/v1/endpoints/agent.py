"""员工 Agent 工作台 + LLM 配置 API（协议 v2）。"""

import json
import logging

from fastapi import APIRouter, Depends, File, Form, Query, Request, UploadFile
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
from app.repositories.resume_repository import ResumeRepository
from app.repositories.llm_config_repository import LlmConfigRepository
from app.schemas.common import ApiResponse, PageData
from app.schemas.agent.request import (
    AgentActionExecute,
    AgentFormSubmit,
    AgentMessageCreate,
    AgentModelSelect,
    AgentSessionCreate,
    AgentSessionUpdate,
    LlmConfigCreate,
    LlmConfigUpdate,
)
from app.schemas.agent.response import (
    AgentResumeAttachmentItem,
    AgentSessionDetail,
    AgentSessionItem,
    LlmConfigItem,
    LlmModelOption,
)
from app.schemas.agent.stream import SseEventName
from app.services.agent_context_service import AgentContextService
from app.services.agent_service import AgentService
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


def get_agent_service(
    request: Request,
    db: AsyncSession = Depends(get_db),
    cache: CacheService = Depends(get_cache),
) -> AgentService:
    """依赖注入：Agent 服务（含子 Agent 绑定）。"""
    llm_service = LlmConfigService(
        LlmConfigRepository(db), EmployeeRepository(db), DeptRepository(db), cache
    )
    context_service = AgentContextService(AgentMemoryRepository(db), cache)
    return AgentService(
        AgentRepository(db),
        llm_service,
        context_service,
        job_repo=JobRepository(db),
        app_repo=ApplicationRepository(db),
        eval_repo=EvalRepository(db),
        resume_repo=ResumeRepository(db),
        cache=cache,
        workflow_graphs=getattr(request.app.state, "agent_workflow_graphs", {}),
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


# ----------------------------- Agent 会话 -----------------------------------


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


@agent_router.post(
    "/sessions/{session_id}/attachments/resume",
    response_model=ApiResponse[AgentResumeAttachmentItem],
)
async def upload_session_resume(
    session_id: int,
    file: UploadFile = File(...),
    job_id: int | None = Form(None, ge=1),
    service: AgentService = Depends(get_agent_service),
    current_user: dict = Depends(get_current_user),
) -> ApiResponse[AgentResumeAttachmentItem]:
    """上传候选人简历附件，发消息时通过 context_refs 引用。"""
    data = await service.upload_session_resume(session_id, file, job_id, current_user)
    return ApiResponse(message="上传成功", data=AgentResumeAttachmentItem.model_validate(data))


@agent_router.post("/sessions/{session_id}/select-model", response_model=ApiResponse[AgentSessionItem])
async def select_model(
    session_id: int,
    body: AgentModelSelect,
    service: AgentService = Depends(get_agent_service),
    current_user: dict = Depends(get_current_user),
) -> ApiResponse[AgentSessionItem]:
    return ApiResponse(message="选择成功", data=await service.select_model(session_id, body.model_name, current_user))


# ----------------------------- SSE 流式接口 ---------------------------------


def _format_sse(event_name: str, payload: dict) -> str:
    """构造单条 SSE 文本块。"""
    data = json.dumps(payload, ensure_ascii=False)
    return f"event: {event_name}\ndata: {data}\n\n"


def _format_error_event(message: str, code: str = "internal_error") -> str:
    """构造 error 事件 SSE 文本块。"""
    return _format_sse(SseEventName.ERROR.value, {"code": code, "message": message})


@agent_router.post("/sessions/{session_id}/messages/stream")
async def stream_message(
    session_id: int,
    body: AgentMessageCreate,
    service: AgentService = Depends(get_agent_service),
    current_user: dict = Depends(get_current_user),
) -> StreamingResponse:
    """协议 v2 流式发送消息。"""

    async def event_generator():
        try:
            async for event in service.stream_message(session_id, body, current_user):
                yield _format_sse(event.name, event.data)
        except BizError as exc:
            yield _format_error_event(exc.message, code=str(exc.code))
        except SQLAlchemyError:
            logger.exception("Agent 流式接口数据库异常：session_id=%s", session_id)
            yield _format_error_event("Agent 服务暂不可用，请稍后重试")
        except Exception:
            logger.exception("Agent 流式接口未预期异常：session_id=%s", session_id)
            yield _format_error_event("Agent 服务暂不可用，请稍后重试")
            raise

    return StreamingResponse(event_generator(), media_type="text/event-stream")


@agent_router.post("/sessions/{session_id}/forms/submit")
async def submit_form(
    session_id: int,
    body: AgentFormSubmit,
    service: AgentService = Depends(get_agent_service),
    current_user: dict = Depends(get_current_user),
) -> StreamingResponse:
    """前端 FormCard 提交后触发的新 SSE 流式运行。"""

    async def event_generator():
        try:
            async for event in service.submit_form(session_id, body, current_user):
                yield _format_sse(event.name, event.data)
        except BizError as exc:
            yield _format_error_event(exc.message, code=str(exc.code))
        except SQLAlchemyError:
            logger.exception("Agent 表单提交接口数据库异常：session_id=%s", session_id)
            yield _format_error_event("Agent 服务暂不可用，请稍后重试")
        except Exception:
            logger.exception("Agent 表单提交接口未预期异常：session_id=%s", session_id)
            yield _format_error_event("Agent 服务暂不可用，请稍后重试")
            raise

    return StreamingResponse(event_generator(), media_type="text/event-stream")


@agent_router.post("/actions/execute", response_model=ApiResponse[dict])
async def execute_action(
    body: AgentActionExecute,
    service: AgentService = Depends(get_agent_service),
    current_user: dict = Depends(get_current_user),
) -> ApiResponse[dict]:
    """确认 ActionCard 后执行写操作。"""
    return ApiResponse(message="执行成功", data=await service.execute_action(body, current_user))
