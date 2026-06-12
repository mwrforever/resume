"""Agent 流式协议事件类型枚举与各 data payload 校验。"""

from app.schemas.agent.stream.events import (
    EVENT_TYPES,
    RunStartData, RunFinishData, RunErrorData,
    StepUpdateData,
    BlockStartData, BlockDeltaData, BlockStopData,
    InteractionRequestData, InteractionResolveData,
)


def test_event_types_are_nine():
    """事件类型严格 9 个，无多余无遗漏。"""
    assert set(EVENT_TYPES) == {
        "run.start", "run.finish", "run.error",
        "step.update",
        "block.start", "block.delta", "block.stop",
        "interaction.request", "interaction.resolve",
    }


def test_run_start_data_required_fields():
    """run.start 必带 run_id / workflow_type / enable_thinking。"""
    data = RunStartData(run_id="r1", workflow_type="interview_questions",
                        enable_thinking=True, user_message_id=42)
    assert data.workflow_type == "interview_questions"


def test_run_error_data_default_retriable_false():
    err = RunErrorData(code="job_validation_exhausted", message="超过 3 次")
    assert err.retriable is False


def test_step_update_status_constrained():
    """step.update.status 限定枚举。"""
    import pytest
    with pytest.raises(Exception):
        StepUpdateData(step_id="x", title="t", status="invalid_status")  # type: ignore[arg-type]
    ok = StepUpdateData(step_id="x", title="t", status="running")
    assert ok.status == "running"


def test_block_start_carries_initial_block_dict():
    """block.start 的 block 字段是 dict，包含 type 字段。"""
    data = BlockStartData(index=0, block={"type": "text", "text": ""})
    assert data.block["type"] == "text"


def test_block_delta_data_index_and_payload():
    data = BlockDeltaData(index=0, delta={"text_delta": "hi"})
    assert data.delta == {"text_delta": "hi"}


def test_interaction_request_minimum_fields():
    data = InteractionRequestData(
        request_id="req_x",
        interaction_type="job_selection",
        title="请选择岗位",
        prompt="从候选中选择",
        schema={}, data={"candidates": []},
    )
    assert data.interaction_type == "job_selection"


def test_interaction_resolve_carries_values():
    data = InteractionResolveData(request_id="req_x", values={"job_full_name": "高级算法工程师"})
    assert data.values["job_full_name"] == "高级算法工程师"
