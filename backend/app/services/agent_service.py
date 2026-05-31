"""
Agent 服务层 — 中心调度（langgraph-supervisor）入口。

职责：
- Agent 会话生命周期（CRUD）
- 用户消息 → langgraph-supervisor 编译图 → SSE v2 事件流
- 表单提交 → `Command(resume=values)` 恢复中断
- 写操作（ActionCard）确认 → 持久化变更，并通过 `Command(resume=...)` 通知图

LLM/Agent 编排逻辑全部下沉到 `app.llm.graphs.coordinator` + `app.llm.graphs.sub_agents`，
本服务只做：会话权限、运行时配置、业务快照构建、写操作事务、消息落库。
"""

from __future__ import annotations

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
from app.llm.graphs.coordinator import (
    CoordinatorRunner,
    build_coordinator_graph,
    get_default_checkpointer,
)
from app.llm.graphs.coordinator.chat_model import build_chat_model
from app.llm.model_router import LLMModelRouter, get_default_model_router
from app.llm.streaming.emitter import AgentStreamEmitter
from app.repositories.agent_repository import AgentRepository
from app.repositories.application_repository import ApplicationRepository
from app.repositories.evaluation_repository import EvalRepository
from app.repositories.job_repository import JobRepository
from app.repositories.resume_repository import ResumeRepository
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
    FormResolvedPayload,
    LifecycleRunPayload,
    MessageDonePayload,
    MessageStartedPayload,
)
from app.services.agent_context_service import AgentContextService
from app.services.agent_resume_pipeline_service import AgentResumePipelineService
from app.services.llm_config_service import LlmConfigService

logger = logging.getLogger(__name__)


class AgentService:
    """中心调度 Agent 服务（与协议 v2 一一对应）。"""

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
    ) -> None:
        """
        初始化 Agent 服务。

        Args:
            agent_repo: 会话/消息持久化
            llm_service: LLM 运行时配置服务
            context_service: 长期记忆（可选）
            model_router: 兼容路由器，仅供需要直接调用 LLM 的工具使用（默认走全局实例）
            job_repo / app_repo / eval_repo / resume_repo: 业务快照与子 Agent 数据源
        """
        self._agent_repo = agent_repo
        self._llm_service = llm_service
        self._context_service = context_service
        self._model_router = model_router or get_default_model_router()
        self._job_repo = job_repo
        self._app_repo = app_repo
        self._eval_repo = eval_repo
        self._resume_repo = resume_repo

        self._resume_pipeline: AgentResumePipelineService | None = None
        if resume_repo and job_repo:
            self._resume_pipeline = AgentResumePipelineService(resume_repo, job_repo)

        self._checkpointer = get_default_checkpointer()

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
        return uploaded

    # ------------------------------------------------------------------
    # 流式核心：用户消息 → supervisor 图
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

        user_message = await self._create_user_message(session, body)
        resume_ref = self._parse_resume_ref(body.context_refs)
        tool_context = await self._build_tool_context(session.employee_id)

        emitter = AgentStreamEmitter(session_id=session.id, session_key=session.session_key)
        # 立即发射用户消息事件，让前端立刻渲染用户输入内容
        yield emitter.emit(
            event=AgentStreamEventType.MESSAGE_STARTED,
            node_id=AgentNodeId.COORDINATOR,
            payload=MessageStartedPayload(
                message_id=user_message.id,
                role="user",
                content=body.content,
                context_refs=body.context_refs or [],
            ),
        )
        runner = self._build_runner(runtime_config)
        graph_input = {
            "messages": [HumanMessage(content=body.content)],
            "employee_id": session.employee_id,
            "session_id": session.id,
            "session_key": session.session_key,
            "tool_context": tool_context,
            "resume_ref": resume_ref or {},
            "runtime_config": runtime_config.model_dump(mode="python"),
            "final_message": "",
        }

        async for event in self._run_graph_stream(
            runner=runner,
            session=session,
            user_message_id=user_message.id,
            graph_input=graph_input,
            emitter=emitter,
            runtime_config=runtime_config,
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
        emitter = AgentStreamEmitter(session_id=session.id, session_key=session.session_key)
        runner = self._build_runner(runtime_config)
        # 先回执 form.resolved 让前端立即关闭表单
        yield emitter.emit(
            event=AgentStreamEventType.FORM_RESOLVED,
            node_id=AgentNodeId.FORM_REQUEST,
            payload=FormResolvedPayload(request_id=body.request_id, accepted=True, values=body.values),
        )
        # 用 Command(resume=values) 让被 interrupt() 阻塞的工具继续执行
        async for event in self._run_graph_stream(
            runner=runner,
            session=session,
            user_message_id=last_user_message.id,
            graph_input=Command(resume=body.values),
            emitter=emitter,
            runtime_config=runtime_config,
        ):
            yield event

    async def _run_graph_stream(
        self,
        *,
        runner: CoordinatorRunner,
        session,
        user_message_id: int,
        graph_input: dict[str, Any] | Command,
        emitter: AgentStreamEmitter,
        runtime_config: LLMRuntimeConfigDTO,
    ) -> AsyncIterator[AgentStreamEvent]:
        """通用流式包装：lifecycle.run.* + 节点流 + finalize 持久化。"""
        started_at = time.perf_counter()
        yield emitter.emit(
            event=AgentStreamEventType.RUN_STARTED,
            node_id=AgentNodeId.COORDINATOR,
            payload=LifecycleRunPayload(
                session_key=session.session_key,
                message_id=user_message_id,
            ),
        )

        try:
            async for event in runner.astream(
                thread_id=session.session_key,
                graph_input=graph_input,
                emitter=emitter,
            ):
                yield event
        except (SQLAlchemyError, RuntimeError, ValueError) as exc:
            logger.exception("协调器执行异常：session_id=%s", session.id)
            yield emitter.emit(
                event=AgentStreamEventType.RUN_FAILED,
                node_id=AgentNodeId.COORDINATOR,
                payload=LifecycleRunPayload(
                    session_key=session.session_key,
                    message_id=user_message_id,
                    error_code="coordinator_error",
                    error_message=str(exc),
                ),
            )
            yield emitter.emit(
                event=AgentStreamEventType.ERROR,
                node_id=AgentNodeId.COORDINATOR,
                payload=ErrorPayload(code="coordinator_error", message=str(exc)),
            )
            return

        # 取最终回复并落库
        final_message = await runner.get_final_message(session.session_key)
        try:
            await self._persist_agent_message(
                session,
                user_message_id=user_message_id,
                final_message=final_message,
                runtime_config=runtime_config,
            )
        except SQLAlchemyError:
            logger.exception("Agent 消息落库失败：session_id=%s", session.id)
            await self._agent_repo.rollback()

        if final_message:
            yield emitter.emit(
                event=AgentStreamEventType.MESSAGE_DONE,
                node_id=AgentNodeId.FINALIZE,
                payload=MessageDonePayload(
                    message_id=f"final-{user_message_id}",
                    content=final_message,
                ),
            )

        yield emitter.emit(
            event=AgentStreamEventType.RUN_FINISHED,
            node_id=AgentNodeId.FINALIZE,
            payload=LifecycleRunPayload(
                session_key=session.session_key,
                message_id=user_message_id,
            ),
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

    async def _create_user_message(self, session, body: AgentMessageCreate):
        """落库用户消息。"""
        return await self._agent_repo.create_message(
            session_id=session.id,
            role="user",
            message_type="text",
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
    ) -> None:
        """把 supervisor 最终回复落库。"""
        agent_message = await self._agent_repo.create_message(
            session_id=session.id,
            parent_message_id=user_message_id,
            role="agent",
            message_type="text",
            content={
                "context_refs": [],
                "blocks": [{"type": "text", "text": final_message or ""}],
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
    # 协调器图工厂
    # ------------------------------------------------------------------

    def _build_runner(self, runtime_config: LLMRuntimeConfigDTO) -> CoordinatorRunner:
        """根据当前运行时配置实时构造 supervisor 图（共享进程级 checkpointer）。"""
        chat_model = build_chat_model(runtime_config)
        compiled = build_coordinator_graph(
            chat_model=chat_model,
            model_router=self._model_router,
            job_repo=self._job_repo,
            app_repo=self._app_repo,
            eval_repo=self._eval_repo,
            resume_repo=self._resume_repo,
            context_service=self._context_service,
            resume_pipeline=self._resume_pipeline,
            checkpointer=self._checkpointer,
        )
        return CoordinatorRunner(compiled)

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
