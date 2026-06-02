"""Agent stream protocol extension tests."""

from app.llm.streaming.emitter import AgentStreamEmitter
from app.schemas.agent.stream import (
    AgentNodeId,
    AgentStreamEventType,
    InteractionRequestPayload,
    ThinkingStatusPayload,
)


def test_emitter_includes_workflow_metadata_and_display_name() -> None:
    """Emitter 生成的 v2 信封必须包含工作流元数据与展示名称。"""
    emitter = AgentStreamEmitter(
        session_id=1,
        session_key="session-1",
        run_id="run-1",
        workflow_type="interview_questions",
    )

    event = emitter.emit(
        event=AgentStreamEventType.INTERACTION_REQUEST,
        node_id=AgentNodeId.DIMENSION_SELECTION,
        display_name="选择面试维度",
        payload=InteractionRequestPayload(
            request_id="req-1",
            interaction_type="dimension_selection",
            title="选择面试维度",
            prompt="请选择本次面试重点。",
        ),
    )

    assert event.data["workflow_type"] == "interview_questions"
    assert event.data["display_name"] == "选择面试维度"
    assert event.data["event"] == "interaction_request"
    assert event.data["payload"]["interaction_type"] == "dimension_selection"


def test_thinking_status_payload_is_strict() -> None:
    """思考状态 payload 必须支持固定状态值。"""
    payload = ThinkingStatusPayload(status="started", summary="正在分析简历")

    assert payload.status == "started"
    assert payload.summary == "正在分析简历"