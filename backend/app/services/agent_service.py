import time
import uuid
from datetime import datetime

from app.core.exceptions import ForbiddenError, NotFoundError, ValidationError
from app.repositories.agent_repository import AgentRepository
from app.llm.graphs.agent_runtime_graph import AgentRuntimeGraph
from app.schemas.agent.dto import AgentGraphStateDTO
from app.schemas.agent.request import AgentActionReject, AgentMessageCreate, AgentSessionCreate
from app.schemas.agent.response import AgentActionItem, AgentMessageItem, AgentReply, AgentRunItem, AgentSessionDetail, AgentSessionItem
from app.services.agent_context_service import AgentContextService
from app.services.llm_config_service import LlmConfigService


class AgentService:
    def __init__(
        self,
        agent_repo: AgentRepository,
        llm_service: LlmConfigService,
        context_service: AgentContextService | None = None,
        runtime_graph: AgentRuntimeGraph | None = None,
    ):
        self.agent_repo = agent_repo
        self.llm_service = llm_service
        self.context_service = context_service
        self.runtime_graph = runtime_graph or AgentRuntimeGraph()

    async def create_session(self, body: AgentSessionCreate, current_user: dict) -> AgentSessionItem:
        employee_id = self._current_employee_id(current_user)
        selected_model_source = None
        if body.selected_model_name:
            runtime_config = await self.llm_service.get_runtime_config(current_user, body.selected_model_name)
            selected_model_source = runtime_config.source
        session = await self.agent_repo.create_session(
            session_key=uuid.uuid4().hex,
            employee_id=employee_id,
            title=body.title,
            selected_model_name=body.selected_model_name,
            selected_model_source=selected_model_source,
        )
        return AgentSessionItem.model_validate(session)

    async def list_sessions(self, page: int, page_size: int, current_user: dict) -> dict:
        employee_id = self._current_employee_id(current_user)
        skip = (page - 1) * page_size
        total = await self.agent_repo.count_sessions(employee_id)
        items = await self.agent_repo.list_sessions(employee_id, skip, page_size)
        return {"total": total, "items": [AgentSessionItem.model_validate(item) for item in items]}

    async def get_session_detail(self, session_id: int, current_user: dict) -> AgentSessionDetail:
        session = await self._get_session(session_id, current_user)
        messages = await self.agent_repo.list_messages(session.id)
        memories = []
        snapshots = []
        session_window = None
        if self.context_service:
            memories = await self.context_service.list_memories(session.employee_id)
            snapshots = await self.context_service.list_snapshots(session.id)
            session_window = await self.context_service.build_session_window(session.id, messages, session.employee_id)
        return AgentSessionDetail(
            session=AgentSessionItem.model_validate(session),
            messages=[AgentMessageItem.model_validate(message) for message in messages],
            memories=memories,
            snapshots=snapshots,
            session_window=session_window,
        )

    async def select_model(self, session_id: int, model_name: str, current_user: dict) -> AgentSessionItem:
        session = await self._get_session(session_id, current_user)
        runtime_config = await self.llm_service.get_runtime_config(current_user, model_name)
        updated = await self.agent_repo.update_session(
            session.id,
            selected_model_name=model_name,
            selected_model_source=runtime_config.source,
        )
        if not updated:
            raise NotFoundError("会话不存在")
        return AgentSessionItem.model_validate(updated)

    async def send_message(self, session_id: int, body: AgentMessageCreate, current_user: dict) -> AgentReply:
        session = await self._get_session(session_id, current_user)
        runtime_config = await self.llm_service.get_runtime_config(current_user, session.selected_model_name)
        user_message = await self.agent_repo.create_message(
            session_id=session.id,
            role="user",
            message_type="text",
            content={"context_refs": body.context_refs, "blocks": [{"type": "text", "text": body.content}]},
            sort_order=await self.agent_repo.next_message_order(session.id),
        )
        run = await self.agent_repo.create_run(
            trace_id=uuid.uuid4().hex,
            session_id=session.id,
            message_id=user_message.id,
            run_type="llm",
            status=1,
            input_payload={"message_id": user_message.id, "content": body.content, "context_refs": body.context_refs},
        )
        messages_before_run = await self.agent_repo.list_messages(session.id)
        session_window = None
        memories = []
        prompt = body.content
        if self.context_service:
            await self.context_service.upsert_preference_memory(session.employee_id, session.id, body.content)
            memories = await self.context_service.list_memories(session.employee_id, True)
            session_window = await self.context_service.build_session_window(
                session.id,
                messages_before_run,
                session.employee_id,
                exclude_message_id=user_message.id,
                touch_access_time=True,
            )
            prompt = await self.context_service.build_prompt(body.content, session_window, memories)
            await self.agent_repo.update_run(
                run.id,
                input_payload=self.context_service.build_replay_payload(
                    raw_content=body.content,
                    context_refs=body.context_refs,
                    resolved_prompt=prompt,
                    session_window=session_window,
                    memories=memories,
                    user_message_id=user_message.id,
                ),
            )
        started_at = time.perf_counter()
        try:
            graph_result = await self.runtime_graph.run(AgentGraphStateDTO(prompt=prompt, runtime_config=runtime_config))
        except (RuntimeError, ValueError) as exc:
            latency_ms = int((time.perf_counter() - started_at) * 1000)
            return await self._build_failed_reply(session, user_message, run.id, runtime_config.model_name, latency_ms, str(exc))
        if graph_result.error_message or not graph_result.result:
            latency_ms = int((time.perf_counter() - started_at) * 1000)
            return await self._build_failed_reply(
                session,
                user_message,
                run.id,
                runtime_config.model_name,
                latency_ms,
                graph_result.error_message or "模型调用失败",
            )
        llm_result = graph_result.result
        latency_ms = int((time.perf_counter() - started_at) * 1000)
        agent_message = await self.agent_repo.create_message(
            session_id=session.id,
            parent_message_id=user_message.id,
            role="agent",
            message_type="text",
            content={"context_refs": [], "blocks": [{"type": "text", "text": llm_result.content}]},
            model_name=llm_result.model_name,
            token_count=llm_result.total_tokens,
            sort_order=await self.agent_repo.next_message_order(session.id),
        )
        updated_run = await self.agent_repo.update_run(
            run.id,
            status=2,
            model_name=llm_result.model_name,
            prompt_tokens=llm_result.prompt_tokens,
            completion_tokens=llm_result.completion_tokens,
            total_tokens=llm_result.total_tokens,
            latency_ms=latency_ms,
            output_payload={
                "content": llm_result.content,
                "usage_detail": llm_result.usage_detail,
                "raw_response_metadata": llm_result.raw_response_metadata,
            },
        )
        await self.agent_repo.update_session(session.id, status=1, last_message_time=datetime.now())
        snapshot = None
        latest_messages = await self.agent_repo.list_messages(session.id)
        if self.context_service:
            snapshot = await self.context_service.maybe_create_snapshot(session.id, latest_messages, llm_result.model_name)
            session_window = await self.context_service.build_session_window(
                session.id,
                latest_messages,
                session.employee_id,
                touch_access_time=True,
            )
            memories = await self.context_service.list_memories(session.employee_id)
        if not updated_run:
            raise NotFoundError("执行记录不存在")
        return AgentReply(
            user_message=AgentMessageItem.model_validate(user_message),
            agent_message=AgentMessageItem.model_validate(agent_message),
            run=AgentRunItem.model_validate(updated_run),
            snapshot=snapshot,
            memories=memories,
            session_window=session_window,
        )

    async def _build_failed_reply(self, session, user_message, run_id: int, model_name: str, latency_ms: int, error_text: str) -> AgentReply:
        failed_run = await self.agent_repo.update_run(run_id, status=3, latency_ms=latency_ms, error_message=error_text)
        agent_message = await self.agent_repo.create_message(
            session_id=session.id,
            parent_message_id=user_message.id,
            role="agent",
            message_type="text",
            content={"context_refs": [], "blocks": [{"type": "text", "text": "模型调用失败，请检查模型配置后重试。"}]},
            model_name=model_name,
            token_count=0,
            sort_order=await self.agent_repo.next_message_order(session.id),
        )
        await self.agent_repo.update_session(session.id, status=5, last_message_time=datetime.now())
        session_window = None
        memories = []
        if self.context_service:
            failed_messages = await self.agent_repo.list_messages(session.id)
            session_window = await self.context_service.build_session_window(
                session.id,
                failed_messages,
                session.employee_id,
                touch_access_time=True,
            )
            memories = await self.context_service.list_memories(session.employee_id)
        if not failed_run:
            raise NotFoundError("执行记录不存在")
        return AgentReply(
            user_message=AgentMessageItem.model_validate(user_message),
            agent_message=AgentMessageItem.model_validate(agent_message),
            run=AgentRunItem.model_validate(failed_run),
            memories=memories,
            session_window=session_window,
        )

    async def list_runs(self, session_id: int, current_user: dict) -> list[AgentRunItem]:
        session = await self._get_session(session_id, current_user)
        runs = await self.agent_repo.list_runs(session.id)
        return [AgentRunItem.model_validate(run) for run in runs]

    async def list_actions(self, session_id: int, current_user: dict) -> list[AgentActionItem]:
        session = await self._get_session(session_id, current_user)
        actions = await self.agent_repo.list_actions(session.id)
        return [AgentActionItem.model_validate(action) for action in actions]

    async def confirm_action(self, action_id: int, current_user: dict) -> AgentActionItem:
        action = await self.agent_repo.get_action(action_id, self._current_employee_id(current_user))
        if not action:
            raise NotFoundError("动作不存在")
        if action.status != 1:
            raise ValidationError("动作状态不允许确认")
        updated = await self.agent_repo.update_action(action.id, status=3, confirmed_at=datetime.now(), executed_at=datetime.now())
        if not updated:
            raise NotFoundError("动作不存在")
        return AgentActionItem.model_validate(updated)

    async def reject_action(self, action_id: int, body: AgentActionReject, current_user: dict) -> AgentActionItem:
        action = await self.agent_repo.get_action(action_id, self._current_employee_id(current_user))
        if not action:
            raise NotFoundError("动作不存在")
        if action.status != 1:
            raise ValidationError("动作状态不允许拒绝")
        updated = await self.agent_repo.update_action(action.id, status=4, rejected_at=datetime.now(), error_message=body.reason)
        if not updated:
            raise NotFoundError("动作不存在")
        return AgentActionItem.model_validate(updated)

    async def _get_session(self, session_id: int, current_user: dict):
        session = await self.agent_repo.get_session(session_id, self._current_employee_id(current_user))
        if not session:
            raise NotFoundError("会话不存在")
        return session

    def _current_employee_id(self, current_user: dict) -> int:
        if current_user.get("user_type") != "employee":
            raise ForbiddenError("仅员工账号可访问")
        return int(current_user["sub"])
