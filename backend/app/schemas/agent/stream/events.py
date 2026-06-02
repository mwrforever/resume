"""
Agent 流式协议 v2 - 事件枚举与各事件 payload 模型。

事件按类别分组：
- lifecycle.*  运行/节点生命周期
- message.*    Agent 文本回复（流式）
- tool.*       工具调用
- form.*       意图表单（缺信息时让用户补全）
- action.*     需用户确认的写操作
- data.*       结构化数据卡片（评估报告、岗位卡片等）
- error        统一错误事件
"""

from enum import StrEnum
from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field


class SseEventName(StrEnum):
    """SSE 顶层 event 行常量。v2 统一只用 `agent` 一个事件名。"""

    AGENT = "agent"
    ERROR = "error"


class AgentNodeId(StrEnum):
    """编排节点 / 子 Agent 标识。"""

    INPUT = "input"
    COORDINATOR = "coordinator"
    SUB_AGENT_RUNNER = "sub_agent_runner"
    FORM_REQUEST = "form_request"
    ACTION_PROPOSER = "action_proposer"
    FINALIZE = "finalize"
    INTERVIEW_QUESTIONS = "interview_questions"
    RESUME_EVALUATION = "resume_evaluation"
    DIMENSION_SELECTION = "dimension_selection"
    PLAN_APPROVAL = "plan_approval"
    JOB_SELECTION = "job_selection"

    # 子 Agent
    JOB_AGENT = "job_agent"
    APPLICATION_AGENT = "application_agent"
    RESUME_AGENT = "resume_agent"
    EVALUATION_AGENT = "evaluation_agent"
    MEMORY_AGENT = "memory_agent"
    GENERIC_AGENT = "generic_agent"


class AgentStreamEventType(StrEnum):
    """v2 协议事件类型枚举。"""

    # lifecycle
    RUN_STARTED = "lifecycle.run.started"
    RUN_FINISHED = "lifecycle.run.finished"
    RUN_FAILED = "lifecycle.run.failed"
    NODE_ENTER = "lifecycle.node.enter"
    NODE_EXIT = "lifecycle.node.exit"
    NODE_ERROR = "lifecycle.node.error"

    # message
    MESSAGE_STARTED = "message.started"
    MESSAGE_DELTA = "message.delta"
    MESSAGE_DONE = "message.done"

    # tool
    TOOL_STARTED = "tool.started"
    TOOL_FINISHED = "tool.finished"

    # form
    FORM_REQUESTED = "form.requested"
    FORM_RESOLVED = "form.resolved"

    # action
    ACTION_REQUESTED = "action.requested"
    ACTION_RESOLVED = "action.resolved"

    # data cards
    DATA_CARD = "data.card"
    DATA_EVALUATION_REPORT = "data.evaluation_report"

    # workflow
    THINKING_STATUS = "thinking_status"
    THINKING_STREAM = "thinking_stream"
    TEXT_STREAM = "text_stream"
    EXECUTION_STATUS = "execution_status"
    PLANNING = "planning"
    INTERACTION_REQUEST = "interaction_request"
    INTERACTION_RESULT = "interaction_result"
    COMPLETED = "completed"

    # error
    ERROR = "error"


# ====== lifecycle payloads ======


class LifecycleRunPayload(BaseModel):
    """`lifecycle.run.*` 事件 payload。"""

    model_config = ConfigDict(extra="forbid")

    session_key: str
    message_id: int | None = None
    error_code: str | None = None
    error_message: str | None = None


class LifecycleNodePayload(BaseModel):
    """`lifecycle.node.*` 事件 payload。"""

    model_config = ConfigDict(extra="forbid")

    node_id: str
    agent_id: str | None = None
    success: bool = True
    error_code: str | None = None
    error_message: str | None = None


# ====== message payloads ======


class MessageDeltaPayload(BaseModel):
    """`message.delta` 事件 payload，承载流式文本增量。"""

    model_config = ConfigDict(extra="forbid")

    message_id: str
    role: Literal["agent"] = "agent"
    delta: str


class MessageStartedPayload(BaseModel):
    """`message.started` 事件 payload，标识用户消息已接收并开始处理。"""

    model_config = ConfigDict(extra="forbid")

    message_id: int
    role: Literal["user"] = "user"
    content: str
    context_refs: list[dict[str, Any]] = Field(default_factory=list)


class MessageDonePayload(BaseModel):
    """`message.done` 事件 payload，标记流式文本结束。"""

    model_config = ConfigDict(extra="forbid")

    message_id: str
    role: Literal["agent"] = "agent"
    content: str
    persisted_message_id: int | None = None
    token_count: int | None = None


# ====== tool payloads ======


class ToolStartedPayload(BaseModel):
    """`tool.started` 事件 payload。"""

    model_config = ConfigDict(extra="forbid")

    call_id: str
    tool_name: str
    display_name: str
    input_payload: dict[str, Any] = Field(default_factory=dict)


class ToolFinishedPayload(BaseModel):
    """`tool.finished` 事件 payload。"""

    model_config = ConfigDict(extra="forbid")

    call_id: str
    tool_name: str
    display_name: str
    success: bool
    output_payload: dict[str, Any] = Field(default_factory=dict)
    error_message: str | None = None


# ====== form payloads ======


class FormFieldOption(BaseModel):
    """表单字段下拉/单选选项。"""

    model_config = ConfigDict(extra="forbid")

    value: Any
    label: str


class FormFieldSchema(BaseModel):
    """
    单个表单字段的 schema 描述。

    支持的 type：
    - text / textarea / number / select / resume_upload / job_picker
    """

    model_config = ConfigDict(extra="forbid")

    name: str
    label: str
    type: Literal["text", "textarea", "number", "select", "resume_upload", "job_picker"]
    required: bool = True
    help_text: str | None = None
    placeholder: str | None = None
    options: list[FormFieldOption] | None = None
    default: Any = None


class FormRequestedPayload(BaseModel):
    """`form.requested` 事件 payload。"""

    model_config = ConfigDict(extra="forbid")

    request_id: str
    title: str
    prompt: str
    fields: list[FormFieldSchema]
    submit_label: str = "提交"
    cancel_label: str | None = "取消"


class FormResolvedPayload(BaseModel):
    """`form.resolved` 事件 payload（前端提交后服务端 ACK）。"""

    model_config = ConfigDict(extra="forbid")

    request_id: str
    accepted: bool
    values: dict[str, Any] = Field(default_factory=dict)


# ====== action payloads ======


class ActionRequestedPayload(BaseModel):
    """`action.requested` 事件 payload，对应需用户确认的写操作。"""

    model_config = ConfigDict(extra="forbid")

    action_id: str
    capability_key: str
    action_name: str
    description: str | None = None
    target_type: str | None = None
    target_id: int | None = None
    input_payload: dict[str, Any] = Field(default_factory=dict)
    preview_payload: dict[str, Any] = Field(default_factory=dict)


class ActionResolvedPayload(BaseModel):
    """`action.resolved` 事件 payload。"""

    model_config = ConfigDict(extra="forbid")

    action_id: str
    status: Literal["executed", "rejected", "failed"]
    error_message: str | None = None


# ====== data card payloads ======


class DataCardPayload(BaseModel):
    """`data.card` 通用结构化卡片 payload。"""

    model_config = ConfigDict(extra="forbid")

    card_id: str
    card_type: str
    title: str
    summary: str | None = None
    body: dict[str, Any] = Field(default_factory=dict)


class DataEvaluationDimension(BaseModel):
    """评估报告卡的单维度结果。"""

    model_config = ConfigDict(extra="forbid")

    dimension_id: int | None = None
    dimension_name: str
    score: float
    advantage: str = ""
    disadvantage: str = ""
    is_completed: bool = True
    error_message: str | None = None


class DataEvaluationSkill(BaseModel):
    """评估报告卡的单技能命中结果。"""

    model_config = ConfigDict(extra="forbid")

    skill_id: int | None = None
    skill_name: str
    is_hit: bool
    hit_context: str = ""


class DataEvaluationReportPayload(BaseModel):
    """`data.evaluation_report` 事件 payload。"""

    model_config = ConfigDict(extra="forbid")

    card_id: str
    application_id: int | None = None
    resume_id: int | None = None
    job_id: int | None = None
    job_name: str = ""
    final_score: float
    final_label: str = ""
    advantage_comment: str = ""
    disadvantage_comment: str = ""
    dimensions: list[DataEvaluationDimension] = Field(default_factory=list)
    skill_hits: list[DataEvaluationSkill] = Field(default_factory=list)


# ====== workflow payloads ======


class ThinkingStatusPayload(BaseModel):
    """思考过程状态事件 payload。"""

    model_config = ConfigDict(extra="forbid")

    status: Literal["started", "streaming", "completed", "unavailable"]
    summary: str | None = None


class ThinkingStreamPayload(BaseModel):
    """思考过程增量事件 payload。"""

    model_config = ConfigDict(extra="forbid")

    message_id: str
    delta: str


class ExecutionStatusPayload(BaseModel):
    """轻量执行状态事件 payload。"""

    model_config = ConfigDict(extra="forbid")

    status: Literal["running", "success", "failed", "waiting"]
    title: str
    detail: str | None = None


class PlanningPayload(BaseModel):
    """规划事件 payload。"""

    model_config = ConfigDict(extra="forbid")

    plan_id: str
    title: str
    summary: str
    body: dict[str, Any] = Field(default_factory=dict)


class InteractionRequestPayload(BaseModel):
    """内联交互请求 payload。"""

    model_config = ConfigDict(extra="forbid")

    request_id: str
    interaction_type: Literal["dimension_selection", "plan_approval", "job_selection"]
    title: str
    prompt: str
    data: dict[str, Any] = Field(default_factory=dict)
    submit_label: str = "提交"
    cancel_label: str | None = None


class InteractionResultPayload(BaseModel):
    """内联交互完成 payload。"""

    model_config = ConfigDict(extra="forbid")

    request_id: str
    interaction_type: Literal["dimension_selection", "plan_approval", "job_selection"]
    accepted: bool
    values: dict[str, Any] = Field(default_factory=dict)


class CompletedPayload(BaseModel):
    """工作流完成事件 payload。"""

    model_config = ConfigDict(extra="forbid")

    message: str = "已完成"
    blocks: list[dict[str, Any]] = Field(default_factory=list)


# ====== error ======


class ErrorPayload(BaseModel):
    """`error` 事件 payload。"""

    model_config = ConfigDict(extra="forbid")

    code: str = "internal_error"
    message: str
    retriable: bool = False
