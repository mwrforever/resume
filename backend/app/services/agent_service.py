import logging
import time
import uuid
from collections.abc import AsyncIterator
from datetime import datetime
from typing import Any

from sqlalchemy.exc import SQLAlchemyError

from app.core.exceptions import ForbiddenError, NotFoundError, ValidationError
from app.llm.gateway import LLMGatewayError
from app.llm.graphs.agent_runtime_graph import AgentRuntimeGraph
from app.repositories.agent_repository import AgentRepository
from app.repositories.application_repository import ApplicationRepository
from app.repositories.evaluation_repository import EvalRepository
from app.repositories.job_repository import JobRepository
from app.schemas.agent.dto import AgentGraphStateDTO, LLMResultDTO, LLMRuntimeConfigDTO
from app.schemas.agent.request import (
    AgentActionReject,
    AgentMessageCreate,
    AgentSessionCreate,
    AgentSessionUpdate,
)
from app.schemas.agent.response import (
    AgentActionItem,
    AgentMessageItem,
    AgentReply,
    AgentRunItem,
    AgentSessionDetail,
    AgentSessionItem,
    AgentStreamEvent,
)
from app.services.agent_context_service import AgentContextService
from app.services.agent_runtime_config_service import AgentRuntimeConfigService
from app.services.llm_config_service import LlmConfigService

logger = logging.getLogger(__name__)


# 负责编排员工 Agent 会话、消息发送、模型调用和动作确认等核心业务流程
class AgentService:
    def __init__(
        self,
        agent_repo: AgentRepository,
        llm_service: LlmConfigService,
        context_service: AgentContextService | None = None,
        runtime_config_service: AgentRuntimeConfigService | None = None,
        runtime_graph: AgentRuntimeGraph | None = None,
        job_repo: JobRepository | None = None,
        app_repo: ApplicationRepository | None = None,
        eval_repo: EvalRepository | None = None,
    ) -> None:
        self._agent_repo = agent_repo
        self._llm_service = llm_service
        self._context_service = context_service
        self._runtime_config_service = runtime_config_service
        self._runtime_graph = runtime_graph or AgentRuntimeGraph()
        self._job_repo = job_repo
        self._app_repo = app_repo
        self._eval_repo = eval_repo

    # 创建员工 Agent 会话，并在指定模型时记录模型来源
    async def create_session(self, body: AgentSessionCreate, current_user: dict) -> AgentSessionItem:
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
        return AgentSessionItem.model_validate(session)

    # 分页查询当前员工的未删除会话，并支持按会话名称搜索
    async def list_sessions(self, page: int, page_size: int, current_user: dict, keyword: str | None = None) -> dict:
        employee_id = self._get_employee_id(current_user)
        skip = (page - 1) * page_size
        total = await self._agent_repo.count_sessions(employee_id, keyword)
        items = await self._agent_repo.list_sessions(employee_id, skip, page_size, keyword)
        return {"total": total, "items": [AgentSessionItem.model_validate(item) for item in items]}

    # 获取会话详情，组装消息、记忆、快照和上下文窗口
    async def get_session_detail(self, session_id: int, current_user: dict) -> AgentSessionDetail:
        session = await self._get_session(session_id, current_user)
        messages = await self._agent_repo.list_messages(session.id)
        memories: list = []
        snapshots: list = []
        session_window = None
        if self._context_service:
            memories = await self._context_service.list_memories(session.employee_id)
            snapshots = await self._context_service.list_snapshots(session.id)
            session_window = await self._context_service.build_session_window(session.id, messages, session.employee_id)
        return AgentSessionDetail(
            session=AgentSessionItem.model_validate(session),
            messages=[AgentMessageItem.model_validate(m) for m in messages],
            memories=memories,
            snapshots=snapshots,
            session_window=session_window,
        )

    # 更新会话选中的模型；空模型表示使用配置文件默认模型
    async def select_model(self, session_id: int, model_name: str | None, current_user: dict) -> AgentSessionItem:
        session = await self._get_session(session_id, current_user)
        runtime_config = await self._build_runtime_config(current_user, model_name)
        if self._runtime_config_service:
            await self._runtime_config_service.select_model(current_user, model_name)
        updated = await self._agent_repo.update_session(
            session.id,
            selected_model_name=model_name,
            selected_model_source=runtime_config.source,
        )
        if not updated:
            raise NotFoundError("会话不存在")
        return AgentSessionItem.model_validate(updated)

    # 更新会话基础信息，目前用于重命名会话
    async def update_session(self, session_id: int, body: AgentSessionUpdate, current_user: dict) -> AgentSessionItem:
        session = await self._get_session(session_id, current_user)
        updated = await self._agent_repo.update_session(session.id, title=body.title)
        if not updated:
            raise NotFoundError("会话不存在")
        return AgentSessionItem.model_validate(updated)

    # 软删除会话，保留历史数据但从列表和详情中隐藏
    async def delete_session(self, session_id: int, current_user: dict) -> None:
        session = await self._get_session(session_id, current_user)
        await self._agent_repo.soft_delete_session(session.id)

    # 处理用户消息发送，持久化消息、运行记录并调用 Agent Runtime 生成回复
    async def send_message(self, session_id: int, body: AgentMessageCreate, current_user: dict) -> AgentReply:
        session = await self._get_session(session_id, current_user)
        runtime_config = await self._build_runtime_config(current_user, session.selected_model_name)
        runtime_snapshot = self._runtime_config_snapshot(runtime_config)
        user_message, run = await self._create_user_message_run(session, body, runtime_snapshot)
        prompt, session_title, _ = await self._prepare_prompt(session, body, user_message, run, runtime_snapshot)
        return await self._execute_graph(runtime_config, prompt, user_message, session, run, session_title)

    async def stream_message(self, session_id: int, body: AgentMessageCreate, current_user: dict) -> AsyncIterator[AgentStreamEvent]:
        session = await self._get_session(session_id, current_user)
        runtime_config = await self._build_runtime_config(current_user, session.selected_model_name)
        runtime_snapshot = self._runtime_config_snapshot(runtime_config)
        user_message, run = await self._create_user_message_run(session, body, runtime_snapshot)
        prompt, session_title, replay_payload = await self._prepare_prompt(session, body, user_message, run, runtime_snapshot)
        yield AgentStreamEvent(event="user_message", data={"message": AgentMessageItem.model_validate(user_message).model_dump(mode="json")})
        yield AgentStreamEvent(event="run_started", data={"run": AgentRunItem.model_validate(run).model_dump(mode="json")})
        if replay_payload:
            yield AgentStreamEvent(event="context_ready", data={"run_id": run.id, "input_payload": replay_payload})
        started_at = time.perf_counter()
        llm_result = None
        tool_results = []
        try:
            tool_context = await self._build_tool_context(session.employee_id, replay_payload, await self._agent_repo.list_runs(session.id))
            async for chunk in self._runtime_graph.stream(prompt, runtime_config, tool_context):
                if chunk.tool_call:
                    yield AgentStreamEvent(event="tool_call", data={"tool_call": chunk.tool_call.model_dump(mode="json")})
                if chunk.tool_result:
                    tool_result_data = chunk.tool_result.model_dump(mode="json")
                    tool_results.append(tool_result_data)
                    yield AgentStreamEvent(event="tool_result", data={"tool_result": tool_result_data})
                    action_payload = (chunk.tool_result.output_payload or {}).get("action_required")
                    if isinstance(action_payload, dict):
                        action = await self._create_pending_action(session, user_message.id, run.id, action_payload)
                        yield AgentStreamEvent(event="action_required", data={"action": AgentActionItem.model_validate(action).model_dump(mode="json")})
                if chunk.delta:
                    yield AgentStreamEvent(event="token", data={"delta": chunk.delta})
                if chunk.result:
                    llm_result = chunk.result
        except (LLMGatewayError, RuntimeError, ValueError, SQLAlchemyError) as exc:
            if isinstance(exc, SQLAlchemyError):
                await self._agent_repo.rollback()
            logger.exception("Agent流式消息执行失败：session_id=%s run_id=%s", session.id, run.id)
            latency_ms = int((time.perf_counter() - started_at) * 1000)
            reply = await self._build_reply(
                session, user_message, run.id, runtime_config.model_name, latency_ms, str(exc), session_title, failed=True, use_memory=runtime_config.enable_memory
            )
            yield AgentStreamEvent(event="error", data={"message": str(exc), "reply": reply.model_dump(mode="json")})
            return
        latency_ms = int((time.perf_counter() - started_at) * 1000)
        if not llm_result:
            llm_result = LLMResultDTO(content="", model_name=runtime_config.model_name)
        reply = await self._build_reply(
            session,
            user_message,
            run.id,
            llm_result.model_name,
            latency_ms,
            None,
            session_title,
            failed=False,
            llm_result=llm_result,
            tool_results=tool_results,
            use_memory=runtime_config.enable_memory,
        )
        yield AgentStreamEvent(event="final", data={"reply": reply.model_dump(mode="json")})

    # 创建用户消息与运行记录，确保后续 Prompt 构建和 Trace 回放有稳定关联
    async def _create_user_message_run(self, session, body: AgentMessageCreate, runtime_snapshot: dict[str, Any]):
        user_message = await self._agent_repo.create_message(
            session_id=session.id,
            role="user",
            message_type="text",
            content={"context_refs": body.context_refs, "blocks": [{"type": "text", "text": body.content}]},
            sort_order=await self._agent_repo.next_message_order(session.id),
        )
        run = await self._agent_repo.create_run(
            trace_id=uuid.uuid4().hex,
            session_id=session.id,
            message_id=user_message.id,
            run_type="llm",
            status=1,
            input_payload={"message_id": user_message.id, "content": body.content, "context_refs": body.context_refs, "runtime_config": runtime_snapshot},
        )
        return user_message, run

    # 根据用户输入、长期记忆和会话窗口构建最终提交给模型的 Prompt
    async def _prepare_prompt(
        self,
        session,
        body: AgentMessageCreate,
        user_message,
        run,
        runtime_snapshot: dict[str, Any],
    ) -> tuple[str, str | None, dict | None]:
        session_title = self._build_session_title(body.content) if user_message.sort_order == 1 else None
        if not runtime_snapshot.get("enable_memory") or not self._context_service:
            return body.content, session_title, None

        await self._context_service.upsert_preference_memory(session.employee_id, session.id, body.content)
        memories = await self._context_service.list_memories(session.employee_id, True)
        messages_before_run = await self._agent_repo.list_messages(session.id)
        session_window = await self._context_service.build_session_window(
            session.id,
            messages_before_run,
            session.employee_id,
            exclude_message_id=user_message.id,
            touch_access_time=True,
        )
        prompt = await self._context_service.build_prompt(body.content, session_window, memories)
        replay_payload = self._context_service.build_replay_payload(
            raw_content=body.content,
            context_refs=body.context_refs,
            resolved_prompt=prompt,
            session_window=session_window,
            memories=memories,
            user_message_id=user_message.id,
        )
        replay_payload["runtime_config"] = runtime_snapshot
        await self._agent_repo.update_run(
            run.id,
            input_payload=replay_payload,
        )
        return prompt, session_title, replay_payload

    async def _build_tool_context(self, employee_id: int, replay_payload: dict | None, runs: list) -> dict[str, Any]:
        context = replay_payload or {}
        return {
            "prompt_prefix_hash": context.get("prompt_prefix_hash"),
            "snapshot_id": context.get("snapshot_id"),
            "recent_messages": [{"id": message_id} for message_id in context.get("recent_message_ids", [])],
            "memories": [{"id": memory_id} for memory_id in context.get("memory_ids", [])],
            "runs": [AgentRunItem.model_validate(run).model_dump(mode="json") for run in runs[:5]],
            "business": await self._build_business_tool_snapshot(employee_id),
        }

    async def _build_business_tool_snapshot(self, employee_id: int) -> dict[str, Any]:
        if not self._job_repo or not self._app_repo or not self._eval_repo:
            return {"jobs": [], "applications": [], "evaluations": []}
        jobs = await self._job_repo.get_by_employee(employee_id)
        job_ids = [job.id for job in jobs[:20]]
        if not job_ids:
            logger.info("Agent业务工具快照构建完成：employee_id=%s job_count=0 application_count=0 evaluation_count=0", employee_id)
            return {"jobs": [], "applications": [], "evaluations": []}
        application_counts = await self._job_repo.batch_count_applications(job_ids)
        app_rows = await self._app_repo.get_all(0, 20, job_ids=job_ids)
        match_map = await self._eval_repo.get_matches_by_application_ids([row[0].id for row in app_rows])
        evaluations = []
        for application, _ in app_rows[:10]:
            match_id = match_map.get(application.id)
            match = await self._eval_repo.get_match_by_id(match_id) if match_id else None
            if match:
                evaluations.append(
                    {
                        "match_id": match.id,
                        "application_id": application.id,
                        "job_id": application.job_id,
                        "final_score": float(match.final_score) if match.final_score is not None else None,
                        "final_label": match.final_label,
                        "error_message": match.error_message,
                    }
                )
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
            "Agent业务工具快照构建完成：employee_id=%s job_count=%s application_count=%s evaluation_count=%s",
            employee_id,
            len(snapshot["jobs"]),
            len(snapshot["applications"]),
            len(snapshot["evaluations"]),
        )
        return snapshot

    # 创建待确认动作记录，等待人工确认后再执行写操作
    async def _create_pending_action(self, session, message_id: int, run_id: int, action_payload: dict[str, Any]):
        idempotency_key = f"{session.id}:{run_id}:{action_payload.get('capability_key')}:{action_payload.get('target_id')}"
        action = await self._agent_repo.create_action(
            session_id=session.id,
            message_id=message_id,
            run_id=run_id,
            employee_id=session.employee_id,
            capability_key=action_payload.get("capability_key") or "unknown",
            action_name=action_payload.get("action_name") or "待确认动作",
            target_type=action_payload.get("target_type"),
            target_id=action_payload.get("target_id"),
            input_payload=action_payload.get("input_payload") or {},
            preview_payload=action_payload.get("preview_payload") or {},
            status=1,
            idempotency_key=idempotency_key,
        )
        logger.info("Agent待确认动作已创建：action_id=%s capability_key=%s", action.id, action.capability_key)
        return action

    # 执行 LangGraph Runtime，并将成功或失败结果统一转换为回复结构
    async def _execute_graph(
        self,
        runtime_config,
        prompt: str,
        user_message,
        session,
        run,
        session_title: str | None,
    ) -> AgentReply:
        started_at = time.perf_counter()
        latency_ms = 0
        try:
            graph_result = await self._runtime_graph.run(AgentGraphStateDTO(prompt=prompt, runtime_config=runtime_config))
        except (RuntimeError, ValueError) as exc:
            latency_ms = int((time.perf_counter() - started_at) * 1000)
            return await self._build_reply(
                session, user_message, run.id, runtime_config.model_name, latency_ms, str(exc), session_title, failed=True, use_memory=runtime_config.enable_memory
            )
        if graph_result.error_message or not graph_result.result:
            latency_ms = int((time.perf_counter() - started_at) * 1000)
            return await self._build_reply(
                session, user_message, run.id, runtime_config.model_name, latency_ms, graph_result.error_message or "模型调用失败", session_title, failed=True, use_memory=runtime_config.enable_memory
            )
        latency_ms = int((time.perf_counter() - started_at) * 1000)
        return await self._build_reply(
            session, user_message, run.id, graph_result.result.model_name, latency_ms, None, session_title, failed=False, llm_result=graph_result.result, use_memory=runtime_config.enable_memory
        )

    # 构造 Agent 回复，统一更新运行记录、消息记录和会话状态
    async def _build_reply(
        self,
        session,
        user_message,
        run_id: int,
        model_name: str,
        latency_ms: int,
        error_text: str | None,
        session_title: str | None,
        *,
        failed: bool,
        llm_result=None,
        tool_results: list[dict[str, Any]] | None = None,
        use_memory: bool = True,
    ) -> AgentReply:
        status = 3 if failed else 2
        content = error_text or (llm_result.content if llm_result else None)
        token_count = 0 if failed else llm_result.total_tokens

        run_update: dict = {"status": status, "latency_ms": latency_ms}
        if failed:
            run_update["error_message"] = error_text
        else:
            run_update.update(
                {
                    "model_name": llm_result.model_name,
                    "prompt_tokens": llm_result.prompt_tokens,
                    "completion_tokens": llm_result.completion_tokens,
                    "total_tokens": llm_result.total_tokens,
                    "output_payload": {
                        "content": llm_result.content,
                        "usage_detail": llm_result.usage_detail,
                        "raw_response_metadata": llm_result.raw_response_metadata,
                        "tool_results": tool_results or [],
                    },
                }
            )
        updated_run = await self._agent_repo.update_run(run_id, **run_update)

        agent_message = await self._agent_repo.create_message(
            session_id=session.id,
            parent_message_id=user_message.id,
            role="agent",
            message_type="text",
            content={"context_refs": [], "blocks": [{"type": "text", "text": content}]},
            model_name=model_name,
            token_count=token_count,
            sort_order=await self._agent_repo.next_message_order(session.id),
        )

        session_status = 5 if failed else 1
        updated_session = await self._update_session_status(session.id, session_title, session_status)

        memories, session_window, snapshot = await self._build_context_data(session, model_name) if not failed and use_memory else ([], None, None)

        if not updated_run:
            raise NotFoundError("执行记录不存在")

        return AgentReply(
            user_message=AgentMessageItem.model_validate(user_message),
            agent_message=AgentMessageItem.model_validate(agent_message),
            run=AgentRunItem.model_validate(updated_run),
            session=AgentSessionItem.model_validate(updated_session) if updated_session else None,
            snapshot=snapshot,
            memories=memories,
            session_window=session_window,
        )

    # 更新会话状态和最近消息时间，首条消息会同步生成会话标题摘要
    async def _update_session_status(self, session_id: int, session_title: str | None, status: int):
        session_payload: dict = {"status": status, "last_message_time": datetime.now()}
        if session_title:
            session_payload["title"] = session_title
            session_payload["context_summary"] = session_title
        return await self._agent_repo.update_session(session_id, **session_payload)

    # 重新加载当前会话的上下文窗口和长期记忆，供前端即时刷新展示
    async def _build_context_data(self, session, model_name: str | None) -> tuple[list, object | None, object | None]:
        if not self._context_service:
            return [], None, None

        messages = await self._agent_repo.list_messages(session.id)
        snapshot = None
        if model_name:
            snapshot = await self._context_service.maybe_create_snapshot(session.id, messages, model_name)
        session_window = await self._context_service.build_session_window(session.id, messages, session.employee_id, touch_access_time=True)
        memories = await self._context_service.list_memories(session.employee_id)
        return memories, session_window, snapshot

    # 合并模型连接配置和员工个人运行参数，确保 Agent 调用使用用户保存的模型运行设置
    async def _build_runtime_config(self, current_user: dict, model_name: str | None) -> LLMRuntimeConfigDTO:
        runtime_config = await self._llm_service.get_runtime_config(current_user, model_name)
        if not self._runtime_config_service or runtime_config.source == "env":
            return runtime_config
        personal_config = await self._runtime_config_service.get_or_init_model_config(current_user, model_name)
        return runtime_config.model_copy(
            update={
                "enable_thinking": personal_config.enable_thinking,
                "enable_tools": personal_config.enable_tools,
                "enable_prompt_cache": personal_config.enable_prompt_cache,
                "enable_memory": personal_config.enable_memory,
                "temperature": personal_config.temperature,
                "top_p": personal_config.top_p,
                "max_tokens": personal_config.max_tokens,
                "presence_penalty": personal_config.presence_penalty,
                "frequency_penalty": personal_config.frequency_penalty,
                "extra_body": personal_config.extra_body,
            }
        )

    # 记录实际提交给模型的非敏感运行参数快照，便于 Trace 面板排查运行差异
    def _runtime_config_snapshot(self, runtime_config: LLMRuntimeConfigDTO) -> dict[str, Any]:
        return {
            "model_name": runtime_config.model_name,
            "source": runtime_config.source,
            "base_url": runtime_config.base_url,
            "fallback_model_name": runtime_config.fallback_model_name,
            "enable_thinking": runtime_config.enable_thinking,
            "enable_tools": runtime_config.enable_tools,
            "enable_prompt_cache": runtime_config.enable_prompt_cache,
            "enable_memory": runtime_config.enable_memory,
            "temperature": runtime_config.temperature,
            "top_p": runtime_config.top_p,
            "max_tokens": runtime_config.max_tokens,
            "presence_penalty": runtime_config.presence_penalty,
            "frequency_penalty": runtime_config.frequency_penalty,
            "timeout_seconds": runtime_config.timeout_seconds,
            "max_retries": runtime_config.max_retries,
            "extra_body": runtime_config.extra_body,
        }

    # 查询指定会话的运行 Trace 记录
    async def list_runs(self, session_id: int, current_user: dict) -> list[AgentRunItem]:
        session = await self._get_session(session_id, current_user)
        runs = await self._agent_repo.list_runs(session.id)
        return [AgentRunItem.model_validate(run) for run in runs]

    # 查询指定会话产生的待确认动作记录
    async def list_actions(self, session_id: int, current_user: dict) -> list[AgentActionItem]:
        session = await self._get_session(session_id, current_user)
        actions = await self._agent_repo.list_actions(session.id)
        return [AgentActionItem.model_validate(action) for action in actions]

    # 确认待执行动作，并记录确认与执行时间
    async def confirm_action(self, action_id: int, current_user: dict) -> AgentActionItem:
        employee_id = self._get_employee_id(current_user)
        action = await self._agent_repo.get_action(action_id, employee_id)
        if not action:
            raise NotFoundError("动作不存在")
        if action.status != 1:
            raise ValidationError("动作状态不允许确认")
        if action.capability_key == "application.update_status":
            updated = await self._confirm_application_status_action(action, employee_id)
        else:
            updated = await self._agent_repo.update_pending_action(action.id, status=3, confirmed_at=datetime.now(), executed_at=datetime.now())
            if not updated:
                raise ValidationError("动作状态不允许确认")
        return AgentActionItem.model_validate(updated)

    # 确认投递状态变更动作，重新校验数据边界并统一提交投递与动作状态
    async def _confirm_application_status_action(self, action, employee_id: int):
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
            updated = await self._agent_repo.update_pending_action_without_commit(
                action.id,
                status=3,
                confirmed_at=datetime.now(),
                executed_at=datetime.now(),
            )
            if not updated:
                await self._agent_repo.rollback()
                raise ValidationError("动作状态不允许确认")
            await self._agent_repo.commit()
            logger.info("Agent确认动作已执行：action_id=%s application_id=%s status=%s", action.id, application_id, status)
            return updated
        except SQLAlchemyError:
            await self._agent_repo.rollback()
            logger.exception("Agent确认动作事务提交失败：action_id=%s", action.id)
            raise

    # 解析并校验投递状态动作参数，避免 Agent 写入越权目标或非法状态
    def _parse_application_status_payload(self, action) -> tuple[int, int]:
        try:
            application_id = int(action.input_payload.get("application_id") or 0)
            status = int(action.input_payload.get("status") or -1)
        except (TypeError, ValueError) as exc:
            raise ValidationError("投递状态更新参数不完整") from exc
        if application_id <= 0 or status < 0:
            raise ValidationError("投递状态更新参数不完整")
        if status not in {1, 2, 3, 4, 5}:
            raise ValidationError("投递目标状态不合法")
        if action.target_id != application_id:
            raise ValidationError("动作目标与投递参数不一致")
        return application_id, status

    # 拒绝待执行动作，并保存拒绝原因
    async def reject_action(self, action_id: int, body: AgentActionReject, current_user: dict) -> AgentActionItem:
        action = await self._agent_repo.get_action(action_id, self._get_employee_id(current_user))
        if not action:
            raise NotFoundError("动作不存在")
        if action.status != 1:
            raise ValidationError("动作状态不允许拒绝")
        updated = await self._agent_repo.update_pending_action(action.id, status=4, rejected_at=datetime.now(), error_message=body.reason)
        if not updated:
            raise ValidationError("动作状态不允许拒绝")
        return AgentActionItem.model_validate(updated)

    # 校验当前员工是否拥有指定会话，并返回会话实体
    async def _get_session(self, session_id: int, current_user: dict):
        session = await self._agent_repo.get_session(session_id, self._get_employee_id(current_user))
        if not session:
            raise NotFoundError("会话不存在")
        return session

    # 从登录态中提取员工 ID，并限制仅员工账号可访问 Agent 能力
    def _get_employee_id(self, current_user: dict) -> int:
        if current_user.get("user_type") != "employee":
            raise ForbiddenError("仅员工账号可访问")
        return int(current_user["sub"])

    # 根据首条用户消息生成简短会话标题
    def _build_session_title(self, content: str) -> str | None:
        if len(content) <= 30:
            return content
        return content[:30] + "..."