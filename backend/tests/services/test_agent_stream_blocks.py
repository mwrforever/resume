"""Agent block 类型与 status 流转单测。"""

import pytest
from app.schemas.agent.stream.blocks import (
    BLOCK_TYPES, BlockStatus,
    TextBlock, ThinkingBlock, ToolUseBlock, InteractionBlock,
    InterviewQuestionsBlock, EvaluationReportBlock,
    coerce_block,
)


def test_block_types_are_six():
    assert set(BLOCK_TYPES) == {
        "text", "thinking", "tool_use", "interaction",
        "interview_questions", "evaluation_report",
    }


def test_text_block_default_status_streaming():
    b = TextBlock(text="hi")
    assert b.type == "text"
    assert b.status == "streaming"


def test_tool_use_block_failed_with_error():
    b = ToolUseBlock(tool_name="load_resume", display_name="读取简历",
                     input={}, status="failed", error="not found")
    assert b.status == "failed"
    assert b.error == "not found"


def test_interaction_block_pending_default():
    b = InteractionBlock(
        request_id="req_1", interaction_type="dimension_selection",
        title="选择维度", prompt="多选", data={"options": []},
    )
    assert b.status == "pending"
    assert b.values is None


def test_interaction_block_submitted_with_values():
    b = InteractionBlock(
        request_id="req_1", interaction_type="dimension_selection",
        title="t", prompt="p", data={}, status="submitted",
        values={"selected": [1, 2]},
    )
    assert b.values == {"selected": [1, 2]}


def test_coerce_block_dispatches_by_type():
    raw = {"type": "thinking", "text": "正在思考"}
    block = coerce_block(raw)
    assert isinstance(block, ThinkingBlock)
    assert block.text == "正在思考"


def test_coerce_block_unknown_type_returns_none():
    """未知 type 返回 None，前后端独立演进。"""
    assert coerce_block({"type": "future_block"}) is None
