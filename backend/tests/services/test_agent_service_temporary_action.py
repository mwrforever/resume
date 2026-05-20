from types import SimpleNamespace

import pytest

from app.schemas.agent.dto import LLMResultDTO, LLMRuntimeConfigDTO, AgentToolContextDTO
from app.schemas.agent.enums import AgentEventTypeV1, AgentNodeId
from app.schemas.agent.orchestrator_state import OrchestratorState
from app.schemas.agent.request import AgentMessageCreate
from app.services.agent_service import AgentService
from app.services.agent_orchestrator_runner import AgentOrchestratorRunner


class FakeAgentRepository:
    def __init__(self):
        self.session = SimpleNamespace(
            id=11,
            session_key="session-key",
            employee_id=7,
            title="新会话",
            status=1,
            selected_model_name="qwen-plus",
            selected_model_source="employee",
            context_summary=None,
            last_message_time=None,
            version=0,
            create_time=None,
            update_time=None,
        )
        self.messages = []
        self.create_run_called = False
        self.create_action_called = False

    async def get_session(self, session_id, employee_id):
        return self.session if session_id == self.session.id and employee_id == self.session.employee_id else None

    async def next_message_order(self, session_id):
        return len(self.messages) + 1

    async def create_message(self, **kwargs):
        message = SimpleNamespace(id=len(self.messages) + 101, create_time=None, **kwargs)
        self.messages.append(message)
        return message

    async def list_messages(self, session_id):
        return list(self.messages)

    async def update_session(self, session_id, **kwargs):
        for key, value in kwargs.items():
            setattr(self.session, key, value)
        return self.session

    async def create_run(self, **kwargs):
        self.create_run_called = True
        raise AssertionError("不应再创建运行持久化记录")

    async def create_action(self, **kwargs):
        self.create_action_called = True
        raise AssertionError("不应再创建动作持久化记录")

    async def rollback(self):
        return None

    async def commit(self):
        """与真实仓储接口对齐，单测中无需真实事务。"""
        return None


class FakeLlmService:
    async def get_runtime_config(self, current_user, model_name):
        return LLMRuntimeConfigDTO(
            model_name=model_name or "qwen-default",
            api_key="secret",
            base_url="https://example.test",
            protocol="openai",
            fallback_model_name=None,
            extra_body=None,
            timeout_seconds=120,
            max_retries=2,
            source="employee" if model_name else "env",
            enable_thinking=False,
            enable_tools=True,
            enable_prompt_cache=False,
            enable_memory=False,
            temperature=0.7,
            top_p=0.9,
            max_tokens=2048,
            presence_penalty=0,
            frequency_penalty=0,
        )


class FakeOrchestratorRunner(AgentOrchestratorRunner):
    """绕过 Planner interrupt，直接模拟遗留执行阶段事件。"""

    def __init__(self):
        self._final_state: OrchestratorState | None = None

    async def stream_run(self, initial_state: OrchestratorState, emitter):
        action_payload = {
            "capability_key": "application.update_status",
            "action_name": "更新投递状态",
            "target_type": "application",
            "target_id": 42,
            "input_payload": {"application_id": 42, "status": 3},
            "preview_payload": {"target_status": 3},
        }
        for item in emitter.dual(
            node_id=AgentNodeId.LEGACY_EXECUTOR,
            event_type=AgentEventTypeV1.TOOL_CALL_END,
            payload={},
            legacy_event="action_required",
            legacy_data={"action": action_payload},
        ):
            yield item
        for item in emitter.dual(
            node_id=AgentNodeId.LEGACY_EXECUTOR,
            event_type=AgentEventTypeV1.TEXT_DELTA,
            payload={"delta": "已生成动作"},
            legacy_event="token",
            legacy_data={"delta": "已生成动作"},
        ):
            yield item
        self._final_state = initial_state.model_copy(update={"final_content": "已生成动作"})

    async def stream_resume(self, **kwargs):
        if False:
            yield  # pragma: no cover

    async def load_state(self, session_key: str) -> OrchestratorState:
        return self._final_state or OrchestratorState(
            session_id=1,
            session_key=session_key,
            employee_id=7,
            user_input="",
            runtime_config=LLMRuntimeConfigDTO(
                model_name="qwen-default",
                api_key="secret",
                base_url="https://example.test",
            ),
            final_content="已生成动作",
        )

    async def get_graph_state(self, session_key: str):
        return SimpleNamespace(interrupts=[])

    def build_final_result(self, session_key: str, state: OrchestratorState) -> LLMResultDTO:
        return LLMResultDTO(content=state.final_content, model_name="qwen-default", total_tokens=5)


@pytest.mark.asyncio
async def test_stream_message_emits_temporary_action_without_persisting_run_or_action():
    repo = FakeAgentRepository()
    service = AgentService(repo, FakeLlmService(), context_service=None, orchestrator_runner=FakeOrchestratorRunner())

    events = [
        event
        async for event in service.stream_message(
            11,
            AgentMessageCreate(content="把投递42标记为面试", runtime_options={"enable_thinking": True}),
            {"user_type": "employee", "sub": "7"},
        )
    ]

    event_names = [event.event for event in events]
    assert "action_required" in event_names
    assert repo.create_run_called is False
    assert repo.create_action_called is False
    action_event = next(event for event in events if event.event == "action_required")
    action = action_event.data["action"]
    assert action["id"].startswith("tmp-")
    assert action["status"] == 1
    assert action["input_payload"] == {"application_id": 42, "status": 3}
