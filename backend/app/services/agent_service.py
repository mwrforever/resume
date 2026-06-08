"""
Agent 服务层 — 工作流模式入口（简历评估 + 简历问答）。

职责：
- Agent 会话生命周期（CRUD）
- 用户消息 → 业务工作流图（interview_questions / resume_evaluation）→ SSE v2 事件流
- 表单提交 → `Command(resume=values)` 恢复中断
- 写操作（ActionCard）确认 → 持久化变更

LLM/Agent 编排逻辑全部下沉到 `app.llm.graphs.workflows`，
本服务只做：会话权限、运行时配置、业务快照构建、写操作事务、消息落库。
"""

from __future__ import annotations

import inspect
import logging
import time
import uuid
from collections.abc import AsyncIterator
from datetime import datetime
from typing import Any

from langchain_core.messages import HumanMessage
from langgraph.types import Command
from sqlalchemy.exc import SQLAlchemyError

from app.core.exceptions import ForbiddenError, NotFoundError, ValidationError
from app.llm.graphs.workflows import AgentWorkflowRunner
from app.llm.model_router import LLMModelRouter, get_default_model_router
from app.llm.streaming.emitter import AgentStreamEmitter
from app.repositories.agent_repository import AgentRepository
from app.repositories.application_repository import ApplicationRepository
from app.repositories.evaluation_repository import EvalRepository
from app.repositories.job_repository import JobRepository
from app.repositories.resume_repository import ResumeRepository
from app.utils.cache_utils import (
    AGENT_RESUME_TEXT_KEY,
    AGENT_RESUME_TEXT_TTL,
    AGENT_SESSION_RESUME_REF_KEY,
    AGENT_SESSION_RESUME_REF_TTL,
)
from app.schemas.agent.dto import LLMRuntimeConfigDTO
from app.schemas.agent.request import (
    AgentActionExecute,
    AgentFormSubmit,
    AgentMessageCreate,
    AgentSessionCreate,
    AgentSessionUpdate,
)
from app.schemas.agent.response import (
    AgentMessageItem,
    AgentSessionDetail,
    AgentSessionItem,
)
from app.schemas.agent.stream import (
    AgentNodeId,
    AgentStreamEvent,
    AgentStreamEventType,
    ErrorPayload,
    InteractionResultPayload,
    LifecycleRunPayload,
    MessageDonePayload,
    MessageStartedPayload,
)
from app.services.agent_context_service import AgentContextService
from app.services.agent_resume_pipeline_service import AgentResumePipelineService
from app.services.agent_stream_buffer_service import AgentStreamBufferService
from app.services.cache_service import CacheService
from app.services.interview_question_service import InterviewQuestionService
from app.services.llm_config_service import LlmConfigService
from app.services.resume_evaluation_workflow_service import ResumeEvaluationWorkflowService

logger = logging.getLogger(__name__)


class AgentService:
    """业务工作流 Agent 服务（简历评估 + 简历问答）。"""

    def __init__(
        self,
        agent_repo: AgentRepository,
        llm_service: LlmConfigService,
        context_service: AgentContextService | None = None,
        *,
        model_router: LLMModelRouter | None = None,
        job_repo: JobRepository | None = None,
        app_repo: ApplicationRepository | None = None,
        eval_repo: EvalRepository | None = None,
        resume_repo: ResumeRepository | None = None,
        cache: CacheService | None = None,
        workflow_graphs: dict[str, Any] | None = None,
    ) -> None:
        """
        初始化 Agent 服务。

        Args:
            agent_repo: 会话/消息持久化
            llm_service: LLM 运行时配置服务
            context_service: 长期记忆（可选）
            model_router: 兼容路由器，仅供需要直接调用 LLM 的工具使用（默认走全局实例）
            job_repo / app_repo / eval_repo / resume_repo: 业务快照数据源
            cache: Redis 缓存服务，用于流事件缓冲
            workflow_graphs: FastAPI lifespan 注册的业务工作流编译图
        """
        self._agent_repo = agent_repo
        self._llm_service = llm_service
        self._context_service = context_service
        self._model_router = model_router or get_default_model_router()
        self._job_repo = job_repo
        self._app_repo = app_repo
        self._eval_repo = eval_repo
        self._resume_repo = resume_repo
        self._cache = cache
        self._stream_buffer = AgentStreamBufferService(cache.client) if cache else None
        self._workflow_graphs = workflow_graphs or {}

        self._resume_pipeline: AgentResumePipelineService | None = None
        if resume_repo and job_repo:
            self._resume_pipeline = AgentResumePipelineService(resume_repo, job_repo)
        self._interview_question_service = (
            InterviewQuestionService(model_router=self._model_router, resume_pipeline=self._resume_pipeline)
            if self._resume_pipeline
            else None
        )
        self._resume_evaluation_service = (
            ResumeEvaluationWorkflowService(
                model_router=self._model_router,
                resume_pipeline=self._resume_pipeline,
                job_repo=job_repo,
            )
            if self._resume_pipeline and job_repo
            else None
        )

    # ------------------------------------------------------------------
    # 会话 CRUD
    # ------------------------------------------------------------------

    async def create_session(self, body: AgentSessionCreate, current_user: dict) -> AgentSessionItem:
        """创建新的 Agent 会话。"""
        employee_id = self._get_employee_id(current_user)
        selected_model_source = None
        if body.selected_model_name:
            runtime_config = await self._build_runtime_config(current_user, body.selected_model_name)
            selected_model_source = runtime_config.source
        session = await self._agent_repo.create_session(
            session_key=uuid.uuid4().hex,
            employee_id=employee_id,
            title=body.title,
            selected_model_name=body.selected_model_name,
            selected_model_source=selected_model_source,
        )
        await self._agent_repo.commit()
        return AgentSessionItem.model_validate(session)

    async def list_sessions(
        self, page: int, page_size: int, current_user: dict, keyword: str | None = None
    ) -> dict:
        """分页列出员工未删除的会话。"""
        employee_id = self._get_employee_id(current_user)
        skip = (page - 1) * page_size
        total = await self._agent_repo.count_sessions(employee_id, keyword)
        items = await self._agent_repo.list_sessions(employee_id, skip, page_size, keyword)
        return {"total": total, "items": [AgentSessionItem.model_validate(item) for item in items]}

    async def get_session_detail(self, session_id: int, current_user: dict) -> AgentSessionDetail:
        """获取会话详情（含消息与长期记忆）。"""
        session = await self._get_session(session_id, current_user)
        messages = await self._agent_repo.list_messages(session.id)
        memories: list = []
        if self._context_service:
            memories = await self._context_service.list_memories(session.employee_id)
        return AgentSessionDetail(
            session=AgentSessionItem.model_validate(session),
            messages=[AgentMessageItem.model_validate(message) for message in messages],
            memories=memories,
        )

    async def select_model(
        self, session_id: int, model_name: str | None, current_user: dict
    ) -> AgentSessionItem:
        """更新会话所选模型。"""
        session = await self._get_session(session_id, current_user)
        runtime_config = await self._build_runtime_config(current_user, model_name)
        updated = await self._agent_repo.update_session(
            session.id,
            selected_model_name=model_name,
            selected_model_source=runtime_config.source,
        )
        if not updated:
            raise NotFoundError("会话不存在")
        await self._agent_repo.commit()
        return AgentSessionItem.model_validate(updated)

    async def update_session(
        self, session_id: int, body: AgentSessionUpdate, current_user: dict
    ) -> AgentSessionItem:
        """重命名会话标题。"""
        session = await self._get_session(session_id, current_user)
        updated = await self._agent_repo.update_session(session.id, title=body.title)
        if not updated:
            raise NotFoundError("会话不存在")
        await self._agent_repo.commit()
        return AgentSessionItem.model_validate(updated)

    async def delete_session(self, session_id: int, current_user: dict) -> None:
        """软删除会话。"""
        session = await self._get_session(session_id, current_user)
        await self._agent_repo.soft_delete_session(session.id)
        await self._agent_repo.commit()

    # ------------------------------------------------------------------
    # 简历附件上传
    # ------------------------------------------------------------------

    async def upload_session_resume(
        self,
        session_id: int,
        file,
        job_id: int | None,
        current_user: dict,
    ) -> dict:
        """会话内上传候选人简历附件，可选绑定岗位 ID。"""
        if not self._resume_pipeline:
            raise ValidationError("简历上传服务未配置")
        session = await self._get_session(session_id, current_user)
        if job_id is not None:
            await self._resume_pipeline.ensure_job_owned_by_employee(job_id, session.employee_id)
        uploaded = await self._resume_pipeline.upload_resume_for_employee(session.employee_id, file)
        uploaded["job_id"] = job_id
        logger.info(
            "Agent 会话简历附件已上传：session_id=%s resume_id=%s job_id=%s",
            session.id,
            uploaded.get("resume_id"),
            job_id,
        )
        # 将简历引用缓存到 Redis，后续消息可自动恢复
        await self._cache_session_resume_ref(session.id, uploaded)

        return uploaded

    # ------------------------------------------------------------------
    # 流式核心：用户消息 → 业务工作流图
    # ------------------------------------------------------------------

    async def stream_message(
        self,
        session_id: int,
        body: AgentMessageCreate,
        current_user: dict,
    ) -> AsyncIterator[AgentStreamEvent]:
        """处理用户文本消息：执行中心调度图，按 v2 协议流式下发事件。"""
        session = await self._get_session(session_id, current_user)
        runtime_config = await self._build_runtime_config(
            current_user, session.selected_model_name, body
        )
        # 把偏好型输入主动写入长期记忆（无副作用，用户感知不到）
        if self._context_service and runtime_config.enable_memory:
            await self._context_service.upsert_preference_memory(
                session.employee_id, session.id, body.content
            )

        workflow_type = body.workflow_type
        emitter = AgentStreamEmitter(session_id=session.id, session_key=session.session_key, workflow_type=workflow_type)
        run_id = emitter.run_id
        user_message = await self._create_user_message(session, body, workflow_type=workflow_type, run_id=run_id)
        resume_ref = self._parse_resume_ref(body.context_refs)
        # 如果当前消息未附带简历附件，从会话级 Redis 缓存恢复
        if resume_ref is None:
            resume_ref = await self._get_session_resume_ref(session.id)
        tool_context = await self._build_tool_context(session.employee_id)

        # 立即发射用户消息事件，让前端立刻渲染用户输入内容
        yield await self._yield_buffered_event(
            event=emitter.emit(
                event=AgentStreamEventType.MESSAGE_STARTED,
                node_id=AgentNodeId.COORDINATOR,
                payload=MessageStartedPayload(
                    message_id=user_message.id,
                    role="user",
                    content=body.content,
                    context_refs=body.context_refs or [],
                ),
            ),
            session_id=session.id,
            run_id=run_id,
        )
        runner = self._build_workflow_runner(workflow_type, runtime_config)
        graph_input = {
            "messages": [HumanMessage(content=body.content)],
            "workflow_type": workflow_type,
            "employee_id": session.employee_id,
            "session_id": session.id,
            "session_key": session.session_key,
            "user_message_id": user_message.id,
            "run_id": run_id,
            "tool_context": tool_context,
            "resume_ref": resume_ref or {},
            "runtime_config": runtime_config.model_dump(mode="python"),
            "final_message": "",
            "final_text": "",
            "final_blocks": [],
        }

        async for event in self._run_graph_stream(
            runner=runner,
            session=session,
            user_message_id=user_message.id,
            graph_input=graph_input,
            emitter=emitter,
            runtime_config=runtime_config,
            workflow_type=workflow_type,
            run_id=run_id,
        ):
            yield event

    async def submit_form(
        self,
        session_id: int,
        body: AgentFormSubmit,
        current_user: dict,
    ) -> AsyncIterator[AgentStreamEvent]:
        """前端 FormCard 提交后恢复 LangGraph 中断。"""
        session = await self._get_session(session_id, current_user)
        messages = await self._agent_repo.list_messages(session.id)
        last_user_message = next((item for item in reversed(messages) if item.role == "user"), None)
        if last_user_message is None:
            raise ValidationError("未找到关联用户消息")

        runtime_config = await self._build_runtime_config(current_user, session.selected_model_name)
        workflow_type = self._resolve_resume_workflow_type(messages)
        emitter = AgentStreamEmitter(session_id=session.id, session_key=session.session_key, workflow_type=workflow_type)
        run_id = emitter.run_id
        runner = self._build_workflow_runner(workflow_type, runtime_config)
        # 先回执 interaction_result 让前端立即关闭表单
        yield await self._yield_buffered_event(
            event=emitter.emit(
                event=AgentStreamEventType.INTERACTION_RESULT,
                node_id=AgentNodeId.FORM_REQUEST,
                payload=InteractionResultPayload(
                    request_id=body.request_id,
                    interaction_type=str(body.values.get("interaction_type") or "dimension_selection"),
                    accepted=True,
                    values=body.values,
                ),
            ),
            session_id=session.id,
            run_id=run_id,
        )
        # 用 Command(resume=values) 让被 interrupt() 阻塞的工具继续执行
        async for event in self._run_graph_stream(
            runner=runner,
            session=session,
            user_message_id=last_user_message.id,
            graph_input=Command(resume=body.values),
            emitter=emitter,
            runtime_config=runtime_config,
            workflow_type=workflow_type,
            run_id=run_id,
        ):
            yield event

    async def _run_graph_stream(
        self,
        *,
        runner: AgentWorkflowRunner,
        session,
        user_message_id: int,
        graph_input: dict[str, Any] | Command,
        emitter: AgentStreamEmitter,
        runtime_config: LLMRuntimeConfigDTO,
        workflow_type: str = "interview_questions",
        run_id: str | None = None,
    ) -> AsyncIterator[AgentStreamEvent]:
        """通用流式包装：lifecycle.run.* + 节点流 + finalize 持久化。"""
        started_at = time.perf_counter()
        active_run_id = run_id or emitter.run_id
        buffered_events: list[dict[str, Any]] = []
        yield await self._yield_buffered_event(
            event=emitter.emit(
                event=AgentStreamEventType.RUN_STARTED,
                node_id=AgentNodeId.COORDINATOR,
                payload=LifecycleRunPayload(
                    session_key=session.session_key,
                    message_id=user_message_id,
                ),
            ),
            session_id=session.id,
            run_id=active_run_id,
            fallback_events=buffered_events,
        )

        try:
            async for event in runner.astream(
                thread_id=session.session_key,
                graph_input=graph_input,
                emitter=emitter,
            ):
                buffered = await self._yield_buffered_event(
                    event=event,
                    session_id=session.id,
                    run_id=active_run_id,
                    fallback_events=buffered_events,
                )
                yield buffered
        except (SQLAlchemyError, RuntimeError, ValueError) as exc:
            logger.exception("协调器执行异常：session_id=%s", session.id)
            yield await self._yield_buffered_event(
                event=emitter.emit(
                    event=AgentStreamEventType.RUN_FAILED,
                    node_id=AgentNodeId.COORDINATOR,
                    payload=LifecycleRunPayload(
                        session_key=session.session_key,
                        message_id=user_message_id,
                        error_code="coordinator_error",
                        error_message=str(exc),
                    ),
                ),
                session_id=session.id,
                run_id=active_run_id,
                fallback_events=buffered_events,
            )
            yield await self._yield_buffered_event(
                event=emitter.emit(
                    event=AgentStreamEventType.ERROR,
                    node_id=AgentNodeId.COORDINATOR,
                    payload=ErrorPayload(code="coordinator_error", message=str(exc)),
                ),
                session_id=session.id,
                run_id=active_run_id,
                fallback_events=buffered_events,
            )
            return

        # 取最终回复并落库
        final_message = await self._resolve_runner_value(runner.get_final_message(session.session_key))
        final_blocks = []
        if hasattr(runner, "get_final_blocks"):
            final_blocks = await self._resolve_runner_value(runner.get_final_blocks(session.session_key))
        stream_events = await self._read_buffered_events(session.id, active_run_id, buffered_events)
        try:
            await self._persist_agent_message(
                session,
                user_message_id=user_message_id,
                final_message=final_message,
                runtime_config=runtime_config,
                workflow_type=workflow_type,
                run_id=active_run_id,
                final_blocks=final_blocks or [],
                stream_events=stream_events,
            )
        except SQLAlchemyError:
            logger.exception("Agent 消息落库失败：session_id=%s", session.id)
            await self._agent_repo.rollback()

        if final_message:
            yield await self._yield_buffered_event(
                event=emitter.emit(
                    event=AgentStreamEventType.MESSAGE_DONE,
                    node_id=AgentNodeId.FINALIZE,
                    payload=MessageDonePayload(
                        message_id=f"final-{user_message_id}",
                        content=final_message,
                    ),
                ),
                session_id=session.id,
                run_id=active_run_id,
                fallback_events=buffered_events,
            )

        yield await self._yield_buffered_event(
            event=emitter.emit(
                event=AgentStreamEventType.RUN_FINISHED,
                node_id=AgentNodeId.FINALIZE,
                payload=LifecycleRunPayload(
                    session_key=session.session_key,
                    message_id=user_message_id,
                ),
            ),
            session_id=session.id,
            run_id=active_run_id,
            fallback_events=buffered_events,
        )
        logger.info(
            "Agent run 结束：session_id=%s elapsed_ms=%s",
            session.id,
            int((time.perf_counter() - started_at) * 1000),
        )

    # ------------------------------------------------------------------
    # 写操作（用户在 ActionCard 上确认后调用）
    # ------------------------------------------------------------------

    async def execute_action(self, body: AgentActionExecute, current_user: dict) -> dict[str, Any]:
        """
        执行用户已确认的写操作。

        当前支持 capability_key:
        - application.update_status: 变更投递状态
        """
        employee_id = self._get_employee_id(current_user)
        if body.capability_key == "application.update_status":
            await self._execute_application_status_action(body, employee_id)
            return {"action_id": body.action_id, "status": "executed"}
        raise ValidationError("尚未启用的写操作")

    async def _execute_application_status_action(
        self,
        action: AgentActionExecute,
        employee_id: int,
    ) -> None:
        """投递状态变更执行。"""
        if not self._app_repo or not self._job_repo:
            raise ValidationError("投递状态更新能力未启用")
        application_id, status = self._parse_application_status_payload(action)
        application = await self._app_repo.get_by_id(application_id)
        if not application:
            raise NotFoundError("投递不存在")
        jobs = await self._job_repo.get_by_employee(employee_id)
        if application.job_id not in {job.id for job in jobs}:
            raise ForbiddenError("无权操作该投递")
        try:
            changed = await self._app_repo.update_status_active_without_commit(application_id, status)
            if not changed:
                await self._agent_repo.rollback()
                raise NotFoundError("投递不存在")
            await self._agent_repo.commit()
            logger.info(
                "Agent 投递状态动作执行成功：application_id=%s status=%s",
                application_id,
                status,
            )
        except SQLAlchemyError:
            await self._agent_repo.rollback()
            logger.exception("Agent 写操作事务失败：application_id=%s", application_id)
            raise

    @staticmethod
    def _parse_application_status_payload(action: AgentActionExecute) -> tuple[int, int]:
        """从 AgentActionExecute 解析并校验投递 ID 与目标状态。"""
        try:
            application_id = int(action.input_payload.get("application_id") or 0)
            status = int(action.input_payload.get("status") or -1)
        except (TypeError, ValueError) as exc:
            raise ValidationError("投递状态更新参数不完整") from exc
        if application_id <= 0:
            raise ValidationError("投递 ID 不合法")
        if status not in {1, 2, 3, 4, 5}:
            raise ValidationError("投递目标状态不合法")
        if action.target_id is not None and action.target_id != application_id:
            raise ValidationError("动作目标与投递参数不一致")
        return application_id, status

    # ------------------------------------------------------------------
    # 持久化辅助
    # ------------------------------------------------------------------

    async def _create_user_message(self, session, body: AgentMessageCreate, *, workflow_type: str, run_id: str):
        """落库用户消息。"""
        return await self._agent_repo.create_message(
            session_id=session.id,
            role="user",
            message_type="text",
            workflow_type=workflow_type,
            run_id=run_id,
            content={
                "context_refs": body.context_refs,
                "blocks": [{"type": "text", "text": body.content}],
            },
            sort_order=await self._agent_repo.next_message_order(session.id),
        )

    async def _persist_agent_message(
        self,
        session,
        *,
        user_message_id: int,
        final_message: str,
        runtime_config: LLMRuntimeConfigDTO,
        workflow_type: str = "interview_questions",
        run_id: str | None = None,
        final_blocks: list[dict[str, Any]] | None = None,
        stream_events: list[dict[str, Any]] | None = None,
    ) -> None:
        """把 Agent 最终回复与结构化 blocks 落库。"""
        blocks = [{"type": "text", "text": final_message or ""}]
        blocks.append({"type": "stream_events", "schema_version": "2.0", "events": stream_events or []})
        blocks.extend(final_blocks or [])
        agent_message = await self._agent_repo.create_message(
            session_id=session.id,
            parent_message_id=user_message_id,
            role="agent",
            message_type="text",
            workflow_type=workflow_type,
            run_id=run_id,
            content={
                "context_refs": [],
                "blocks": blocks,
            },
            model_name=runtime_config.model_name,
            token_count=None,
            sort_order=await self._agent_repo.next_message_order(session.id),
        )
        await self._agent_repo.update_session(
            session.id,
            status=1,
            last_message_time=datetime.now(),
        )
        await self._agent_repo.commit()
        logger.debug("Agent 消息已落库：session_id=%s message_id=%s", session.id, agent_message.id)

    async def _yield_buffered_event(
        self,
        *,
        event: AgentStreamEvent,
        session_id: int,
        run_id: str,
        fallback_events: list[dict[str, Any]] | None = None,
    ) -> AgentStreamEvent:
        """写入 Redis stream buffer 后返回事件。"""
        if fallback_events is not None:
            fallback_events.append(event.data)
        if self._stream_buffer:
            await self._stream_buffer.append_event(session_id=session_id, run_id=run_id, envelope=event.data)
        return event

    async def _read_buffered_events(
        self,
        session_id: int,
        run_id: str,
        fallback_events: list[dict[str, Any]],
    ) -> list[dict[str, Any]]:
        """读取当前 run 已缓冲的事件。"""
        if self._stream_buffer:
            return await self._stream_buffer.read_events(session_id=session_id, run_id=run_id)
        return list(fallback_events)

    async def _resolve_runner_value(self, value):
        """兼容同步和异步 runner 取值。"""
        if inspect.isawaitable(value):
            return await value
        return value

    def _resolve_resume_workflow_type(self, messages: list[Any]) -> str:
        """从历史消息推断中断恢复所属工作流。"""
        for message in reversed(messages):
            workflow_type = getattr(message, "workflow_type", None)
            if workflow_type:
                return str(workflow_type)
        return "interview_questions"

    # ------------------------------------------------------------------
    # 业务快照 / 简历附件解析
    # ------------------------------------------------------------------

    @staticmethod
    def _parse_resume_ref(context_refs: list[dict[str, Any]] | None) -> dict[str, Any] | None:
        """从 context_refs 中识别 resume 引用。"""
        for ref in context_refs or []:
            if str(ref.get("type") or "").lower() != "resume":
                continue
            if ref.get("resume_id") is None:
                raise ValidationError("简历附件缺少 resume_id")
            return {
                "resume_id": int(ref["resume_id"]),
                "job_id": int(ref["job_id"]) if ref.get("job_id") is not None else None,
                "file_name": str(ref.get("file_name") or ""),
            }
        return None

    async def _cache_session_resume_ref(self, session_id: int, resume_data: dict[str, Any]) -> None:
        """将简历引用缓存到 Redis（绑定会话），后续消息可自动恢复，避免重复上传。

        Args:
            session_id: 会话 ID
            resume_data: 上传接口返回的简历数据（含 resume_id、file_name、job_id）
        """
        if not self._cache:
            return
        cache_key = AGENT_SESSION_RESUME_REF_KEY.format(session_id=session_id)
        ref = {
            "resume_id": int(resume_data.get("resume_id") or 0),
            "job_id": resume_data.get("job_id"),
            "file_name": str(resume_data.get("file_name") or ""),
        }
        await self._cache.set_json(cache_key, ref, AGENT_SESSION_RESUME_REF_TTL)
        logger.info("会话简历引用已缓存：session_id=%s resume_id=%s", session_id, ref.get("resume_id"))

    async def _get_session_resume_ref(self, session_id: int) -> dict[str, Any] | None:
        """从 Redis 缓存读取会话的简历引用。

        优先于从历史消息恢复（更快更可靠），避免用户发「继续」时简历丢失。

        Args:
            session_id: 会话 ID

        Returns:
            dict[str, Any] | None: 简历引用字典，未找到时返回 None
        """
        if not self._cache:
            return None
        cache_key = AGENT_SESSION_RESUME_REF_KEY.format(session_id=session_id)
        cached = await self._cache.get_json(cache_key)
        if cached and isinstance(cached, dict) and cached.get("resume_id"):
            logger.info(
                "从缓存恢复简历引用：session_id=%s resume_id=%s",
                session_id,
                cached.get("resume_id"),
            )
            return cached
        return None

    async def _cache_resume_text(self, resume_id: int, resume_text: str) -> None:
        """将已加载的简历文本缓存到 Redis，后续同一简历直接复用。

        Args:
            resume_id: 简历 ID
            resume_text: 已解析的简历文本
        """
        if not self._cache or not resume_text.strip():
            return
        cache_key = AGENT_RESUME_TEXT_KEY.format(resume_id=resume_id)
        await self._cache.set(cache_key, resume_text, AGENT_RESUME_TEXT_TTL)

    async def _get_cached_resume_text(self, resume_id: int) -> str | None:
        """从 Redis 缓存读取已解析的简历文本。

        Args:
            resume_id: 简历 ID

        Returns:
            str | None: 缓存的简历文本，未命中时返回 None
        """
        if not self._cache:
            return None
        cache_key = AGENT_RESUME_TEXT_KEY.format(resume_id=resume_id)
        cached = await self._cache.get(cache_key)
        return cached if cached else None



    async def _build_tool_context(self, employee_id: int) -> dict[str, Any]:
        """构建子 Agent 工具共享的业务快照。"""
        business = await self._build_business_snapshot(employee_id)
        return {"business": business}

    async def _build_business_snapshot(self, employee_id: int) -> dict[str, Any]:
        """构建岗位/投递/评估业务快照（避免子 Agent 工具 N+1 查询）。"""
        if not self._job_repo or not self._app_repo or not self._eval_repo:
            return {"jobs": [], "applications": [], "evaluations": []}
        jobs = await self._job_repo.get_by_employee(employee_id)
        job_ids = [job.id for job in jobs[:20]]
        if not job_ids:
            logger.info(
                "Agent 业务快照：employee_id=%s jobs=0 applications=0 evaluations=0",
                employee_id,
            )
            return {"jobs": [], "applications": [], "evaluations": []}
        application_counts = await self._job_repo.batch_count_applications(job_ids)
        app_rows = await self._app_repo.get_all(0, 20, job_ids=job_ids)
        application_ids = [row[0].id for row in app_rows]
        match_map = await self._eval_repo.get_matches_by_application_ids(application_ids)
        match_ids = [mid for mid in match_map.values() if mid]
        matches = await self._eval_repo.get_matches_by_ids(match_ids) if match_ids else {}

        evaluations = []
        for application, _ in app_rows[:10]:
            match_id = match_map.get(application.id)
            match = matches.get(match_id) if match_id else None
            if match:
                evaluations.append({
                    "match_id": match.id,
                    "application_id": application.id,
                    "job_id": application.job_id,
                    "final_score": float(match.final_score) if match.final_score is not None else None,
                    "final_label": match.final_label,
                    "error_message": match.error_message,
                })

        snapshot = {
            "jobs": [
                {
                    "id": job.id,
                    "name": job.name,
                    "status": job.status,
                    "dept_id": job.dept_id,
                    "template_id": job.template_id,
                    "application_count": application_counts.get(job.id, 0),
                }
                for job in jobs[:20]
            ],
            "applications": [
                {
                    "id": application.id,
                    "job_id": application.job_id,
                    "job_name": (application.job_snapshot or {}).get("job", {}).get("name", ""),
                    "resume_id": application.resume_id,
                    "user_name": user_name,
                    "status": application.status,
                    "match_id": match_map.get(application.id),
                }
                for application, user_name in app_rows
            ],
            "evaluations": evaluations,
        }
        logger.info(
            "Agent 业务快照：employee_id=%s jobs=%s applications=%s evaluations=%s",
            employee_id,
            len(snapshot["jobs"]),
            len(snapshot["applications"]),
            len(snapshot["evaluations"]),
        )
        return snapshot

    # ------------------------------------------------------------------
    # 工作流 Runner 工厂
    # ------------------------------------------------------------------

    def _build_workflow_service_context(self) -> dict[str, Any]:
        """构建业务工作流运行时服务上下文。"""
        return {
            "interview_question_service": self._interview_question_service,
            "resume_evaluation_service": self._resume_evaluation_service,
            "cache_service": self._cache,
        }

    def _build_workflow_runner(
        self,
        workflow_type: str,
        runtime_config: LLMRuntimeConfigDTO,
    ) -> AgentWorkflowRunner:
        """根据 workflow_type 构建业务工作流 runner。

        仅支持 interview_questions（简历问答）和 resume_evaluation（简历评估）两种模式。
        若 workflow_type 无对应编译图，直接抛出校验异常。
        """
        compiled = self._workflow_graphs.get(workflow_type)
        if compiled is None:
            raise ValidationError(f"不支持的工作流类型: {workflow_type}")
        return AgentWorkflowRunner(compiled, service_context=self._build_workflow_service_context())

    # ------------------------------------------------------------------
    # 工具方法
    # ------------------------------------------------------------------

    async def _build_runtime_config(
        self,
        current_user: dict,
        model_name: str | None,
        body: AgentMessageCreate | None = None,
    ) -> LLMRuntimeConfigDTO:
        """构建本次运行的 LLM 运行时配置。"""
        runtime_config = await self._llm_service.get_runtime_config(current_user, model_name)
        if body and body.runtime_options and body.runtime_options.enable_thinking is not None:
            return runtime_config.model_copy(
                update={"enable_thinking": body.runtime_options.enable_thinking}
            )
        return runtime_config

    async def _get_session(self, session_id: int, current_user: dict):
        """校验会话归属并返回 ORM 实体。"""
        employee_id = self._get_employee_id(current_user)
        session = await self._agent_repo.get_session(session_id, employee_id)
        if not session:
            raise NotFoundError("会话不存在")
        return session

    @staticmethod
    def _get_employee_id(current_user: dict) -> int:
        """从登录态提取员工 ID，并校验账号类型。"""
        if current_user.get("user_type") != "employee":
            raise ForbiddenError("仅员工账号可访问")
        return int(current_user["sub"])
