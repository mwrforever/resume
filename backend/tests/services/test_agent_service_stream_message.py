"""Agent 服务流式消息展示回归测试。"""

from types import SimpleNamespace
from typing import Any

import pytest

from app.llm.streaming.emitter import AgentStreamEmitter
from app.schemas.agent.dto import LLMRuntimeConfigDTO
from app.schemas.agent.stream import AgentStreamEventType
from app.services.agent_service import AgentService


class _AgentRepository:
    """测试用 Agent 仓储，记录最终回复落库调用。"""

    def __init__(self) -> None:
        """初始化落库记录。"""
        self.messages: list[dict[str, Any]] = []

    async def next_message_order(self, session_id: int) -> int:
        """返回测试排序号。"""
        return len(self.messages) + 1

    async def create_message(self, **kwargs: Any):
        """记录消息创建参数。"""
        self.messages.append(kwargs)
        return SimpleNamespace(id=len(self.messages), **kwargs)

    async def update_session(self, *args: Any, **kwargs: Any) -> None:
        """记录会话更新，测试无需断言。"""
        return None

    async def commit(self) -> None:
        """模拟事务提交。"""
        return None

    async def rollback(self) -> None:
        """模拟事务回滚。"""
        return None


class _RunnerWithoutMessageDone:
    """测试用 runner：图能产出最终回复，但流中没有 message.done。"""

    async def astream(self, **kwargs: Any):
        """模拟没有文本事件的图执行流。"""
        if False:
            yield None

    async def get_final_message(self, thread_id: str) -> str:
        """返回最终大模型回复。"""
        return "这是最终回复"


@pytest.mark.asyncio
async def test_run_graph_stream_emits_final_message_done_when_runner_has_final_message() -> None:
    """当 LangGraph 最终状态已有回复时，SSE 必须下发 message.done 供前端渲染。"""
    agent_repo = _AgentRepository()
    service = AgentService(agent_repo, llm_service=object(), model_router=object())
    session = SimpleNamespace(id=1, session_key="session-key-1")
    runtime_config = LLMRuntimeConfigDTO(
        model_name="test-model",
        api_key="key",
        base_url="http://example.test",
    )

    events = [
        event async for event in service._run_graph_stream(
            runner=_RunnerWithoutMessageDone(),
            session=session,
            user_message_id=10,
            graph_input={},
            emitter=AgentStreamEmitter(session_id=1, session_key="session-key-1"),
            runtime_config=runtime_config,
        )
    ]

    done_events = [event for event in events if event.data["event"] == AgentStreamEventType.MESSAGE_DONE.value]
    assert done_events
    assert done_events[-1].data["payload"]["content"] == "这是最终回复"
    assert agent_repo.messages[-1]["content"]["blocks"][0]["text"] == "这是最终回复"
