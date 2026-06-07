"""AgentService workflow routing tests."""

from types import SimpleNamespace
from typing import Any

import pytest

from app.schemas.agent.dto import LLMRuntimeConfigDTO
from app.schemas.agent.request import AgentMessageCreate
from app.schemas.agent.stream import AgentNodeId, AgentStreamEventType, CompletedPayload
from app.services.agent_service import AgentService


class _Repo:
    """测试用 AgentRepository。"""

    def __init__(self) -> None:
        """初始化状态。"""
        self.created_messages: list[dict[str, Any]] = []

    async def get_session(self, session_id: int, employee_id: int):
        """返回测试会话。"""
        return SimpleNamespace(id=session_id, session_key="session-key", employee_id=employee_id, selected_model_name=None)

    async def next_message_order(self, session_id: int) -> int:
        """返回排序。"""
        return len(self.created_messages) + 1

    async def create_message(self, **kwargs: Any):
        """记录消息。"""
        self.created_messages.append(kwargs)
        return SimpleNamespace(id=len(self.created_messages), **kwargs)

    async def update_session(self, *args: Any, **kwargs: Any) -> None:
        """忽略会话更新。"""
        return None

    async def commit(self) -> None:
        """模拟提交。"""
        return None

    async def rollback(self) -> None:
        """模拟回滚。"""
        return None


class _LlmService:
    """测试用 LLM 配置服务。"""

    async def get_runtime_config(self, current_user, model_name):
        """返回最小运行时配置。"""
        return LLMRuntimeConfigDTO(model_name="m", api_key="k", base_url="http://example.test")


class _WorkflowRunner:
    """测试用工作流 runner。"""

    def __init__(self, compiled_graph: Any) -> None:
        """记录编译图。"""
        self._compiled_graph = compiled_graph
        self._final_blocks = [{"type": "resume_evaluation_report", "report": {"decision": "建议面试"}}]

    async def astream(self, *, thread_id: str, graph_input: dict[str, Any], emitter):
        """模拟工作流完成事件。"""
        self._compiled_graph.thread_id = thread_id
        self._compiled_graph.graph_input = graph_input
        yield emitter.emit(
            event=AgentStreamEventType.COMPLETED,
            node_id=AgentNodeId.FINALIZE,
            payload=CompletedPayload(message="评估完成", blocks=self._final_blocks),
        )

    def get_final_message(self, thread_id: str) -> str:
        """返回最终文本。"""
        return "评估完成"

    def get_final_blocks(self, thread_id: str) -> list[dict[str, Any]]:
        """返回最终业务 blocks。"""
        return self._final_blocks


@pytest.mark.asyncio
async def test_stream_message_routes_to_requested_workflow_and_persists_blocks(monkeypatch: pytest.MonkeyPatch) -> None:
    """消息流必须按 workflow_type 路由并持久化最终业务 blocks。"""
    repo = _Repo()
    graph = SimpleNamespace()
    monkeypatch.setattr("app.services.agent_service.AgentWorkflowRunner", _WorkflowRunner, raising=False)
    service = AgentService(repo, _LlmService(), model_router=object(), workflow_graphs={"resume_evaluation": graph})
    body = AgentMessageCreate(content="评估简历", workflow_type="resume_evaluation")

    events = [event async for event in service.stream_message(1, body, {"user_type": "employee", "sub": "1"})]

    assert graph.graph_input["workflow_type"] == "resume_evaluation"
    assert any(event.data["workflow_type"] == "resume_evaluation" for event in events)
    agent_message = next(item for item in reversed(repo.created_messages) if item["role"] == "agent")
    assert agent_message["workflow_type"] == "resume_evaluation"
    assert agent_message["run_id"]
    block_types = [block["type"] for block in agent_message["content"]["blocks"]]
    assert "stream_events" in block_types
    assert "resume_evaluation_report" in block_types