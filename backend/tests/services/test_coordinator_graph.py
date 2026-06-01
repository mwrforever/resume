"""中心调度 LangGraph：mock 子 Agent，校验事件序列与状态转移。"""

from typing import Any
from unittest.mock import AsyncMock

import pytest

from app.llm.graphs.coordinator_graph import CoordinatorGraph
from app.llm.graphs.coordinator_state import (
    CoordinatorState,
    PendingActionRequest,
    SubAgentInvocationResult,
)
from app.llm.graphs.sub_agents.base import SubAgent, SubAgentRunContext, SubAgentRunResult
from app.llm.graphs.sub_agents.registry import SubAgentRegistry
from app.llm.streaming.emitter import AgentStreamEmitter
from app.schemas.agent.dto import AgentToolContextDTO, LLMRuntimeConfigDTO
from app.schemas.agent.stream import AgentStreamEventType


class _StubSubAgent(SubAgent):
    """可配置返回值的测试子 Agent。"""

    def __init__(self, agent_id: str, result_fn) -> None:
        self.agent_id = agent_id
        self._result_fn = result_fn
        self.calls: list[SubAgentRunContext] = []

    async def arun(self, context: SubAgentRunContext) -> SubAgentRunResult:
        self.calls.append(context)
        return self._result_fn(context)


def _runtime() -> LLMRuntimeConfigDTO:
    return LLMRuntimeConfigDTO(
        model_name="test-model",
        api_key="key",
        base_url="http://example.test",
    )


def _build_state(user_input: str, **overrides: Any) -> CoordinatorState:
    payload = {
        "session_id": 1,
        "session_key": "sess-key-001",
        "employee_id": 7,
        "user_input": user_input,
        "prompt": user_input,
        "runtime_config": _runtime(),
        "tool_context": AgentToolContextDTO(),
    }
    payload.update(overrides)
    return CoordinatorState.model_validate(payload)


def _emitter() -> AgentStreamEmitter:
    return AgentStreamEmitter(session_id=1, session_key="sess-key-001")


def _events_of(chunks: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """从 LangGraph updates 流中收集所有 SSE envelope dict。"""
    collected: list[dict[str, Any]] = []
    for chunk in chunks:
        for _node, update in chunk.items():
            for ev in update.get("pending_events", []) or []:
                # event_envelope.data 即信封 dict
                collected.append(ev.data if hasattr(ev, "data") else ev["data"])
    return collected


@pytest.mark.asyncio
async def test_coordinator_routes_generic_agent_for_freeform_input() -> None:
    """无业务关键词输入应路由到 generic_agent 并最终下发 message.done。"""
    invoked: list[str] = []

    def _generic_result(context: SubAgentRunContext) -> SubAgentRunResult:
        invoked.append(context.request.agent_id)
        return SubAgentRunResult(
            success=True,
            summary="ok",
            result_payload={"content": "你好"},
            final_message="你好",
        )

    registry = SubAgentRegistry({
        "generic_agent": _StubSubAgent("generic_agent", _generic_result),
    })
    graph = CoordinatorGraph(registry=registry)
    emitter = _emitter()

    chunks: list[dict[str, Any]] = []
    async for chunk in graph.astream(_build_state("早上好"), emitter):
        chunks.append(chunk)

    assert "generic_agent" in invoked
    events = _events_of(chunks)
    event_types = [item["event"] for item in events]
    assert AgentStreamEventType.NODE_ENTER.value in event_types
    assert AgentStreamEventType.NODE_EXIT.value in event_types
    # generic_agent 的 final_message 在 finalize 节点会被跳过（避免重复下发）


@pytest.mark.asyncio
async def test_coordinator_requests_form_when_eval_intent_missing_application_id() -> None:
    """评估意图但缺 application_id 时应下发 form.requested 并终止。"""
    registry = SubAgentRegistry()  # 不需要任何子 Agent
    graph = CoordinatorGraph(registry=registry)
    emitter = _emitter()

    chunks = []
    async for chunk in graph.astream(_build_state("帮我评估候选人"), emitter):
        chunks.append(chunk)

    events = _events_of(chunks)
    event_types = [item["event"] for item in events]
    assert AgentStreamEventType.FORM_REQUESTED.value in event_types
    form_payload = next(
        item["payload"] for item in events if item["event"] == AgentStreamEventType.FORM_REQUESTED.value
    )
    assert form_payload["fields"][0]["name"] == "application_id"


@pytest.mark.asyncio
async def test_coordinator_emits_action_requested_when_subagent_proposes_action() -> None:
    """子 Agent 返回 pending_action 时，下一节点应是 action_proposer 并下发 action.requested。"""

    def _app_result(context: SubAgentRunContext) -> SubAgentRunResult:
        return SubAgentRunResult(
            success=True,
            summary="propose status update",
            pending_action=PendingActionRequest(
                action_id="act-1",
                capability_key="application.update_status",
                action_name="把投递更新为面试",
                target_type="application",
                target_id=42,
                input_payload={"application_id": 42, "status": 3},
                preview_payload={"status_label": "面试"},
            ),
        )

    registry = SubAgentRegistry({
        "application_agent": _StubSubAgent("application_agent", _app_result),
    })
    graph = CoordinatorGraph(registry=registry)
    emitter = _emitter()

    chunks = []
    async for chunk in graph.astream(
        _build_state("把投递 application_id=42 标记为面试"), emitter
    ):
        chunks.append(chunk)

    events = _events_of(chunks)
    event_types = [item["event"] for item in events]
    assert AgentStreamEventType.ACTION_REQUESTED.value in event_types
    action_payload = next(
        item["payload"] for item in events if item["event"] == AgentStreamEventType.ACTION_REQUESTED.value
    )
    assert action_payload["capability_key"] == "application.update_status"
    assert action_payload["target_id"] == 42


@pytest.mark.asyncio
async def test_coordinator_finalize_uses_subagent_summary_for_business_agent() -> None:
    """业务子 Agent（非 generic）返回 summary 时，finalize 应下发 message.done。"""

    def _job_result(context: SubAgentRunContext) -> SubAgentRunResult:
        return SubAgentRunResult(
            success=True,
            summary="共找到 3 个岗位",
            result_payload={"jobs": []},
        )

    registry = SubAgentRegistry({
        "job_agent": _StubSubAgent("job_agent", _job_result),
    })
    graph = CoordinatorGraph(registry=registry)
    emitter = _emitter()

    chunks = []
    async for chunk in graph.astream(_build_state("查询我的岗位"), emitter):
        chunks.append(chunk)

    events = _events_of(chunks)
    done_events = [item for item in events if item["event"] == AgentStreamEventType.MESSAGE_DONE.value]
    assert done_events, "业务子 Agent 应触发 finalize 下发 message.done"
    assert done_events[-1]["payload"]["content"] == "共找到 3 个岗位"
