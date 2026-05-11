import time
import uuid
from datetime import datetime

from app.core.exceptions import ForbiddenError, NotFoundError, ValidationError
from app.llm.graphs.agent_runtime_graph import AgentRuntimeGraph
from app.repositories.agent_repository import AgentRepository
from app.schemas.agent.dto import AgentGraphStateDTO
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
)
from app.services.agent_context_service import AgentContextService
from app.services.llm_config_service import LlmConfigService


# 负责编排员工 Agent 会话、消息发送、模型调用和动作确认等核心业务流程
class AgentService:
    def __init__(
        self,
        agent_repo: AgentRepository,
        llm_service: LlmConfigService,
        context_service: AgentContextService | None = None,
        runtime_graph: AgentRuntimeGraph | None = None,
    ) -> None:
        self._agent_repo = agent_repo
        self._llm_service = llm_service
        self._context_service = context_service
        self._runtime_graph = runtime_graph or AgentRuntimeGraph()

    # 创建员工 Agent 会话，并在指定模型时记录模型来源
    async def create_session(self, body: AgentSessionCreate, current_user: dict) -> AgentSessionItem:
        employee_id = self._get_employee_id(current_user)
        selected_model_source = None
        if body.selected_model_name:
            runtime_config = await self._llm_service.get_runtime_config(current_user, body.selected_model_name)
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
        runtime_config = await self._llm_service.get_runtime_config(current_user, model_name)
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
        runtime_config = await self._llm_service.get_runtime_config(current_user, session.selected_model_name)
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
            input_payload={"message_id": user_message.id, "content": body.content, "context_refs": body.context_refs},
        )
        prompt, session_title = await self._prepare_prompt(session, body, user_message, run)
        return await self._execute_graph(runtime_config, prompt, user_message, session, run, session_title)

    # 根据用户输入、长期记忆和会话窗口构建最终提交给模型的 Prompt
    async def _prepare_prompt(
        self,
        session,
        body: AgentMessageCreate,
        user_message,
        run,
    ) -> tuple[str, str | None]:
        session_title = self._build_session_title(body.content) if user_message.sort_order == 1 else None
        prompt = body.content
        if self._context_service:
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
            await self._agent_repo.update_run(
                run.id,
                input_payload=self._context_service.build_replay_payload(
                    raw_content=body.content,
                    context_refs=body.context_refs,
                    resolved_prompt=prompt,
                    session_window=session_window,
                    memories=memories,
                    user_message_id=user_message.id,
                ),
            )
        return prompt, session_title

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
                session, user_message, run.id, runtime_config.model_name, latency_ms, str(exc), session_title, failed=True
            )
        if graph_result.error_message or not graph_result.result:
            latency_ms = int((time.perf_counter() - started_at) * 1000)
            return await self._build_reply(
                session, user_message, run.id, runtime_config.model_name, latency_ms, graph_result.error_message or "模型调用失败", session_title, failed=True
            )
        latency_ms = int((time.perf_counter() - started_at) * 1000)
        return await self._build_reply(
            session, user_message, run.id, graph_result.result.model_name, latency_ms, None, session_title, failed=False, llm_result=graph_result.result
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

        memories, session_window, snapshot = await self._build_context_data(session, model_name if not failed else None)

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
        memories: list = []
        session_window = None
        snapshot = None
        if self._context_service:
            messages = await self._agent_repo.list_messages(session.id)
            if model_name:
                snapshot = await self._context_service.maybe_create_snapshot(session.id, messages, model_name)
            session_window = await self._context_service.build_session_window(session.id, messages, session.employee_id, touch_access_time=True)
            memories = await self._context_service.list_memories(session.employee_id)
        return memories, session_window, snapshot

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
        action = await self._agent_repo.get_action(action_id, self._get_employee_id(current_user))
        if not action:
            raise NotFoundError("动作不存在")
        if action.status != 1:
            raise ValidationError("动作状态不允许确认")
        updated = await self._agent_repo.update_action(action.id, status=3, confirmed_at=datetime.now(), executed_at=datetime.now())
        if not updated:
            raise NotFoundError("动作不存在")
        return AgentActionItem.model_validate(updated)

    # 拒绝待执行动作，并保存拒绝原因
    async def reject_action(self, action_id: int, body: AgentActionReject, current_user: dict) -> AgentActionItem:
        action = await self._agent_repo.get_action(action_id, self._get_employee_id(current_user))
        if not action:
            raise NotFoundError("动作不存在")
        if action.status != 1:
            raise ValidationError("动作状态不允许拒绝")
        updated = await self._agent_repo.update_action(action.id, status=4, rejected_at=datetime.now(), error_message=body.reason)
        if not updated:
            raise NotFoundError("动作不存在")
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