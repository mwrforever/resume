"""
Agent 模块 endpoint（重写版）。

仅四类路由：
- sessions CRUD：POST/GET/PUT/DELETE /employee/agent/sessions
- 流式消息：POST /employee/agent/sessions/{session_id}/messages/stream
- 交互提交：POST /employee/agent/sessions/{session_id}/interactions/{request_id}
- 简历上传：POST /employee/agent/sessions/{session_id}/resumes

不再有 actions/execute / memories。
"""

from __future__ import annotations

import logging

from fastapi import APIRouter, Depends, File, Form, Path, Query, Request, UploadFile
from sqlalchemy.ext.asyncio import AsyncSession
from sse_starlette.sse import EventSourceResponse

from app.deps import get_cache, get_current_user, get_db
from app.repositories.agent_repository import AgentRepository
from app.repositories.dept_repository import DeptRepository
from app.repositories.employee_repository import EmployeeRepository
from app.repositories.evaluation_repository import EvalRepository
from app.repositories.job_repository import JobRepository
from app.repositories.llm_config_repository import LlmConfigRepository
from app.repositories.resume_repository import ResumeRepository
from app.schemas.agent.request import (
    AgentInteractionSubmit,
    AgentMessageCreate,
    AgentSessionCreate,
    AgentSessionModelSelect,
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
from app.schemas.common import ApiResponse, PageData
from app.services.agent_resume_service import AgentResumeService
from app.services.agent_runtime_service import AgentRuntimeService
from app.services.agent_session_service import AgentSessionService
from app.services.cache_service import CacheService
from app.services.interview_question_service import InterviewQuestionService
from app.services.llm_config_service import LlmConfigService
from app.services.resume_evaluation_service import ResumeEvaluationService
from app.services.resume_loader import ResumeLoader
from app.services.resume_service import ResumeService
from app.llm.graphs.workflows.runner import AgentWorkflowRunner
from app.llm.model_router import get_default_model_router

llm_router = APIRouter()
agent_router = APIRouter()
logger = logging.getLogger(__name__)


# ---------- 依赖注入工厂 ----------


def _get_llm_service(
    db: AsyncSession = Depends(get_db), cache: CacheService = Depends(get_cache),
) -> LlmConfigService:
    """LLM 配置服务。"""
    return LlmConfigService(
        LlmConfigRepository(db), EmployeeRepository(db), DeptRepository(db), cache,
    )


def _get_session_service(
    db: AsyncSession = Depends(get_db),
) -> AgentSessionService:
    """Agent 会话 CRUD 服务。"""
    return AgentSessionService(AgentRepository(db))


def _get_resume_service(
    db: AsyncSession = Depends(get_db), cache: CacheService = Depends(get_cache),
) -> AgentResumeService:
    """Agent 简历上传服务。"""
    # 委托底层 ResumeService 完成文件落盘+文本解析+入库，避免 Repository 越层做 I/O
    resume_repo = ResumeRepository(db)
    return AgentResumeService(
        resume_service=ResumeService(resume_repo, cache),
        job_repo=JobRepository(db),
        cache=cache,
    )


def _get_runtime_service(
    request: Request,
    db: AsyncSession = Depends(get_db),
    cache: CacheService = Depends(get_cache),
    agent_resume_service: AgentResumeService = Depends(_get_resume_service),
) -> AgentRuntimeService:
    """Agent SSE 编排服务。"""
    repo = AgentRepository(db)
    model_router = get_default_model_router()
    resume_loader = ResumeLoader(cache=cache, resume_repo=ResumeRepository(db))
    interview_svc = InterviewQuestionService(model_router=model_router, resume_loader=resume_loader)
    evaluation_svc = ResumeEvaluationService(
        model_router=model_router, resume_loader=resume_loader,
        job_repo=JobRepository(db), eval_repo=EvalRepository(db), cache=cache,
    )
    return AgentRuntimeService(
        repo=repo, cache=cache,
        workflow_graphs=request.app.state.agent_workflow_graphs,
        runner_factory=lambda g: AgentWorkflowRunner(g),
        interview_service=interview_svc,
        evaluation_service=evaluation_svc,
        resume_loader=resume_loader,
        agent_resume_service=agent_resume_service,
    )


# ============================= LLM 配置 =============================


@llm_router.get("/llm-model-options", response_model=ApiResponse[list[LlmModelOption]])
async def list_model_options(
    service: LlmConfigService = Depends(_get_llm_service),
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
    service: LlmConfigService = Depends(_get_llm_service),
    current_user: dict = Depends(get_current_user),
) -> ApiResponse[PageData]:
    data = await service.list_configs(current_user, page, page_size, keyword, biz_type, status)
    return ApiResponse(data=PageData(**data))


@llm_router.post("/llm-configs", response_model=ApiResponse[LlmConfigItem])
async def create_llm_config(
    body: LlmConfigCreate,
    service: LlmConfigService = Depends(_get_llm_service),
    current_user: dict = Depends(get_current_user),
) -> ApiResponse[LlmConfigItem]:
    return ApiResponse(message="创建成功", data=await service.create_config(body, current_user))


@llm_router.put("/llm-configs/{config_id}", response_model=ApiResponse[LlmConfigItem])
async def update_llm_config(
    config_id: int,
    body: LlmConfigUpdate,
    service: LlmConfigService = Depends(_get_llm_service),
    current_user: dict = Depends(get_current_user),
) -> ApiResponse[LlmConfigItem]:
    return ApiResponse(message="更新成功", data=await service.update_config(config_id, body, current_user))


@llm_router.delete("/llm-configs/{config_id}", response_model=ApiResponse)
async def delete_llm_config(
    config_id: int,
    service: LlmConfigService = Depends(_get_llm_service),
    current_user: dict = Depends(get_current_user),
) -> ApiResponse:
    await service.delete_config(config_id, current_user)
    return ApiResponse(message="删除成功")


@llm_router.post("/llm-configs/{config_id}/test", response_model=ApiResponse[LlmConfigItem])
async def test_llm_config(
    config_id: int,
    service: LlmConfigService = Depends(_get_llm_service),
    current_user: dict = Depends(get_current_user),
) -> ApiResponse[LlmConfigItem]:
    return ApiResponse(message="测试完成", data=await service.test_config(config_id, current_user))


# ============================= Agent 会话 CRUD =============================


@agent_router.post("/sessions")
async def create_session(
    body: AgentSessionCreate,
    current_user: dict = Depends(get_current_user),
    svc: AgentSessionService = Depends(_get_session_service),
):
    """创建新会话。"""
    item = await svc.create_session(body, current_user)
    return ApiResponse(data=item.model_dump())


@agent_router.get("/sessions")
async def list_sessions(
    page: int = Query(1, ge=1),
    page_size: int = Query(20, ge=1, le=100),
    keyword: str | None = Query(None, max_length=100),
    current_user: dict = Depends(get_current_user),
    svc: AgentSessionService = Depends(_get_session_service),
):
    """分页查询会话列表。"""
    out = await svc.list_sessions(
        page=page, page_size=page_size, current_user=current_user, keyword=keyword,
    )
    return ApiResponse(data={"total": out["total"],
                                 "items": [i.model_dump() for i in out["items"]]})


@agent_router.get("/sessions/{session_id}")
async def get_session(
    session_id: int = Path(..., ge=1),
    current_user: dict = Depends(get_current_user),
    svc: AgentSessionService = Depends(_get_session_service),
):
    """获取会话详情（含消息列表）。"""
    detail = await svc.get_session_detail(session_id=session_id, current_user=current_user)
    return ApiResponse(data=detail.model_dump())


@agent_router.put("/sessions/{session_id}")
async def update_session(
    body: AgentSessionUpdate,
    session_id: int = Path(..., ge=1),
    current_user: dict = Depends(get_current_user),
    svc: AgentSessionService = Depends(_get_session_service),
):
    """更新会话（重命名）。"""
    item = await svc.update_session(session_id=session_id, body=body, current_user=current_user)
    return ApiResponse(data=item.model_dump())


@agent_router.put("/sessions/{session_id}/model")
async def select_model(
    body: AgentSessionModelSelect,
    session_id: int = Path(..., ge=1),
    current_user: dict = Depends(get_current_user),
    svc: AgentSessionService = Depends(_get_session_service),
):
    """切换会话使用的模型。"""
    item = await svc.select_model(session_id=session_id, body=body, current_user=current_user)
    return ApiResponse(data=item.model_dump())


@agent_router.put("/sessions/{session_id}/thinking")
async def set_thinking(
    enable: bool = Query(..., description="开启/关闭思考模式"),
    session_id: int = Path(..., ge=1),
    current_user: dict = Depends(get_current_user),
    svc: AgentSessionService = Depends(_get_session_service),
):
    """持久化 thinking 开关。"""
    item = await svc.set_enable_thinking(
        session_id=session_id, enable_thinking=enable, current_user=current_user,
    )
    return ApiResponse(data=item.model_dump())


@agent_router.delete("/sessions/{session_id}")
async def delete_session(
    session_id: int = Path(..., ge=1),
    current_user: dict = Depends(get_current_user),
    svc: AgentSessionService = Depends(_get_session_service),
):
    """软删除会话。"""
    await svc.delete_session(session_id=session_id, current_user=current_user)
    return ApiResponse()


# ============================= 流式消息 =============================


@agent_router.post("/sessions/{session_id}/messages/stream")
async def stream_message(
    body: AgentMessageCreate,
    session_id: int = Path(..., ge=1),
    current_user: dict = Depends(get_current_user),
    session_svc: AgentSessionService = Depends(_get_session_service),
    runtime_svc: AgentRuntimeService = Depends(_get_runtime_service),
    llm_svc: LlmConfigService = Depends(_get_llm_service),
):
    """流式运行 Agent 工作流，返回 SSE 事件流。"""
    session = await session_svc._require_session(session_id, current_user)
    runtime_config = await llm_svc.get_runtime_config(current_user, session.selected_model_name)
    # thinking 开关：前端 runtime_options 优先，否则取会话持久化值
    if body.runtime_options and body.runtime_options.enable_thinking is not None:
        runtime_config = runtime_config.model_copy(
            update={"enable_thinking": body.runtime_options.enable_thinking},
        )
    else:
        runtime_config = runtime_config.model_copy(
            update={"enable_thinking": bool(session.enable_thinking)},
        )

    async def _generator():
        async for env in runtime_svc.stream_message(
            session=session, body=body, runtime_config=runtime_config,
        ):
            yield {"event": "agent", "data": env.model_dump_json()}

    return EventSourceResponse(_generator())


# ============================= 交互提交 =============================


@agent_router.post("/sessions/{session_id}/interactions/{request_id}")
async def submit_interaction(
    body: AgentInteractionSubmit,
    session_id: int = Path(..., ge=1),
    request_id: str = Path(..., min_length=1),
    current_user: dict = Depends(get_current_user),
    session_svc: AgentSessionService = Depends(_get_session_service),
    runtime_svc: AgentRuntimeService = Depends(_get_runtime_service),
    llm_svc: LlmConfigService = Depends(_get_llm_service),
):
    """提交 interaction 卡片的用户填写，恢复 graph。"""
    session = await session_svc._require_session(session_id, current_user)
    workflow_type = await _infer_workflow_type(session_svc, session, current_user)
    runtime_config = await llm_svc.get_runtime_config(current_user, session.selected_model_name)
    runtime_config = runtime_config.model_copy(
        update={"enable_thinking": bool(session.enable_thinking)},
    )

    async def _generator():
        async for env in runtime_svc.resolve_interaction(
            session=session, request_id=request_id, body=body,
            runtime_config=runtime_config, workflow_type=workflow_type,
        ):
            yield {"event": "agent", "data": env.model_dump_json()}

    return EventSourceResponse(_generator())


async def _infer_workflow_type(svc, session, current_user) -> str:
    """从历史消息推断恢复所属 workflow。"""
    detail = await svc.get_session_detail(session_id=session.id, current_user=current_user)
    for m in reversed(detail.messages):
        wf = getattr(m, "workflow_type", None)
        if wf:
            return str(wf)
    return "interview_questions"


# ============================= 简历上传 =============================


@agent_router.post("/sessions/{session_id}/resumes")
async def upload_resume(
    file: UploadFile = File(...),
    job_id: int | None = Form(None),
    session_id: int = Path(..., ge=1),
    current_user: dict = Depends(get_current_user),
    session_svc: AgentSessionService = Depends(_get_session_service),
    resume_svc: AgentResumeService = Depends(_get_resume_service),
):
    """上传简历到会话。"""
    session = await session_svc._require_session(session_id, current_user)
    out = await resume_svc.upload(
        session_id=session.id, file=file, job_id=job_id, employee_id=session.employee_id,
    )
    return ApiResponse(data=out)
