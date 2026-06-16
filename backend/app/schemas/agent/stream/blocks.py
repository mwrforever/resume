"""
Agent content blocks - 6 种统一渲染单元。

落库时 `agent_message.content.blocks` 是这些 block 的有序数组；
流式时 `block.start/delta/stop` 围绕这些 block 的生命周期下发。

设计参考 Claude Code Messages SSE 的 content_block 模型，前端只需一套渲染管线。
"""

from __future__ import annotations

from typing import Any, Literal, Union

from pydantic import BaseModel, ConfigDict, Field

BLOCK_TYPES: tuple[str, ...] = (
    "text", "thinking", "tool_use", "interaction",
    "interview_questions", "evaluation_report",
)

BlockStatus = Literal[
    "streaming", "success", "failed",
    "pending", "submitted", "rejected", "expired",
]

InteractionType = Literal["dimension_selection", "plan_approval", "job_selection"]


class _BlockBase(BaseModel):
    """block 公共字段。extra=allow 支持演进。"""
    model_config = ConfigDict(extra="allow")


class TextBlock(_BlockBase):
    """Agent 正文流式文本块。"""
    type: Literal["text"] = "text"
    text: str = ""
    status: BlockStatus = "streaming"


class ThinkingBlock(_BlockBase):
    """思考过程流式文本块（仅 enable_thinking 时下发）。"""
    type: Literal["thinking"] = "thinking"
    text: str = ""
    status: BlockStatus = "streaming"


class ToolUseBlock(_BlockBase):
    """内部工具调用块。HR 视角即"运行步骤"。"""
    type: Literal["tool_use"] = "tool_use"
    tool_name: str
    display_name: str
    input: dict[str, Any] = Field(default_factory=dict)
    output: dict[str, Any] | None = None
    status: BlockStatus = "running"
    error: str | None = None


class InteractionBlock(_BlockBase):
    """内联交互卡片块（graph interrupt 的唯一出口）。"""
    type: Literal["interaction"] = "interaction"
    request_id: str
    interaction_type: InteractionType
    title: str
    prompt: str
    data: dict[str, Any] = Field(default_factory=dict)
    status: BlockStatus = "pending"
    values: dict[str, Any] | None = None


class InterviewQuestionsBlock(_BlockBase):
    """业务卡：面试题清单。一次性写满。"""
    type: Literal["interview_questions"] = "interview_questions"
    question_set: dict[str, Any] = Field(default_factory=dict)
    status: BlockStatus = "success"


class EvaluationReportBlock(_BlockBase):
    """业务卡：简历评估报告。一次性写满。"""
    type: Literal["evaluation_report"] = "evaluation_report"
    report: dict[str, Any] = Field(default_factory=dict)
    status: BlockStatus = "success"


AnyBlock = Union[
    TextBlock, ThinkingBlock, ToolUseBlock, InteractionBlock,
    InterviewQuestionsBlock, EvaluationReportBlock,
]


_BLOCK_CLS_BY_TYPE: dict[str, type[_BlockBase]] = {
    "text": TextBlock,
    "thinking": ThinkingBlock,
    "tool_use": ToolUseBlock,
    "interaction": InteractionBlock,
    "interview_questions": InterviewQuestionsBlock,
    "evaluation_report": EvaluationReportBlock,
}


def coerce_block(raw: dict[str, Any]) -> _BlockBase | None:
    """
    根据 raw['type'] 派发到具体 block 类。未知 type 返回 None。

    Args:
        raw: 包含 'type' 字段的 dict。

    Returns:
        对应的 BlockBase 实例，或 None（未知类型时）。
    """
    cls = _BLOCK_CLS_BY_TYPE.get(str(raw.get("type") or ""))
    if cls is None:
        return None
    return cls.model_validate(raw)
