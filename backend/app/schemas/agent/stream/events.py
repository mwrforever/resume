"""
Agent 流式协议 v1 - 事件类型枚举与各 data payload 模型。

共 9 种事件类型（EVENT_TYPES）：
    - run.start / run.finish / run.error
    - step.update
    - block.start / block.delta / block.stop
    - interaction.request / interaction.resolve

每种事件的 envelope.data 形状由对应 *Data 类约束。
所有 *Data 均 extra="allow"，支持前后端独立演进未知字段。
"""

from __future__ import annotations

from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field

EVENT_TYPES: tuple[str, ...] = (
    "run.start", "run.finish", "run.error",
    "step.update",
    "block.start", "block.delta", "block.stop",
    "interaction.request", "interaction.resolve",
)

StepStatus = Literal["pending", "running", "success", "failed"]


class _AllowExtra(BaseModel):
    """所有 data payload 基类，允许未知键被静默接受。"""
    model_config = ConfigDict(extra="allow")


# ====== run ======

class RunStartData(_AllowExtra):
    """`run.start` 事件 data。"""
    run_id: str
    workflow_type: Literal["interview_questions", "resume_evaluation"]
    enable_thinking: bool
    user_message_id: int | None = None


class RunFinishData(_AllowExtra):
    """`run.finish` 事件 data，agent_message_id 是本 run 落库消息 ID。"""
    agent_message_id: int


class RunErrorData(_AllowExtra):
    """`run.error` 事件 data。"""
    code: str
    message: str
    retriable: bool = False


# ====== step ======

class StepUpdateData(_AllowExtra):
    """`step.update` 事件 data，仅用于"运行条"轻量展示。"""
    step_id: str
    title: str
    status: StepStatus
    detail: str | None = None


# ====== block ======

class BlockStartData(_AllowExtra):
    """`block.start` 事件 data，block 字段为初始空骨架（带 type）。"""
    index: int
    block: dict[str, Any]


class BlockDeltaData(_AllowExtra):
    """`block.delta` 事件 data，delta 形态按 block 类型分形。"""
    index: int
    delta: dict[str, Any] = Field(default_factory=dict)


class BlockStopData(_AllowExtra):
    """`block.stop` 事件 data。"""
    index: int


# ====== interaction ======

InteractionType = Literal["dimension_selection", "plan_approval", "job_selection"]


class InteractionRequestData(_AllowExtra):
    """`interaction.request` 事件 data，对应 graph interrupt 出口。"""
    # 内部字段叫 form_schema，避免 shadow BaseModel.schema()；
    # 对外仍以 alias="schema" 输出，保持线协议与前端 types 一致。
    model_config = ConfigDict(extra="allow", populate_by_name=True)

    request_id: str
    interaction_type: InteractionType
    title: str
    prompt: str
    form_schema: dict[str, Any] = Field(default_factory=dict, alias="schema")
    data: dict[str, Any] = Field(default_factory=dict)


class InteractionResolveData(_AllowExtra):
    """`interaction.resolve` 事件 data，服务端 ACK 用户提交。"""
    request_id: str
    values: dict[str, Any] = Field(default_factory=dict)
