from typing import Any, Literal

from pydantic import BaseModel, Field, model_validator

from app.schemas.agent.enums import AgentInterruptKind, PlanReviewDecision
from app.schemas.agent.orchestrator_state import SubTaskDTO


MAX_LLM_TIMEOUT_SECONDS = 120
MAX_LLM_MAX_RETRIES = 2


class AgentRuntimeOptions(BaseModel):
    """单次 Agent 消息请求的运行时选项，仅影响当前请求行为，不持久化。"""

    enable_thinking: bool | None = None


class LlmConfigCreate(BaseModel):
    biz_type: Literal["employee", "dept"]
    biz_id: int
    config_name: str = Field(min_length=1, max_length=50)
    protocol: Literal["openai"] = "openai"
    base_url: str = Field(min_length=1, max_length=500)
    api_key: str = Field(min_length=1)
    model_name: str = Field(min_length=1, max_length=100)
    fallback_model_name: str | None = Field(default=None, max_length=100)
    extra_body: dict[str, Any] | None = None
    enable_thinking: bool = False
    enable_tools: bool = True
    enable_prompt_cache: bool = False
    enable_memory: bool = True
    temperature: float = Field(default=0.7, ge=0, le=2)
    top_p: float = Field(default=0.9, ge=0, le=1)
    max_tokens: int = Field(default=2048, ge=1, le=32000)
    presence_penalty: float = Field(default=0, ge=-2, le=2)
    frequency_penalty: float = Field(default=0, ge=-2, le=2)
    timeout_seconds: int = Field(default=120, ge=1, le=MAX_LLM_TIMEOUT_SECONDS)
    max_retries: int = Field(default=2, ge=0, le=MAX_LLM_MAX_RETRIES)
    status: int = Field(default=1, ge=0, le=1)


class LlmConfigUpdate(BaseModel):
    config_name: str | None = Field(default=None, min_length=1, max_length=50)
    base_url: str | None = Field(default=None, min_length=1, max_length=500)
    api_key: str | None = Field(default=None, min_length=1)
    model_name: str | None = Field(default=None, min_length=1, max_length=100)
    fallback_model_name: str | None = Field(default=None, max_length=100)
    extra_body: dict[str, Any] | None = None
    enable_thinking: bool | None = None
    enable_tools: bool | None = None
    enable_prompt_cache: bool | None = None
    enable_memory: bool | None = None
    temperature: float | None = Field(default=None, ge=0, le=2)
    top_p: float | None = Field(default=None, ge=0, le=1)
    max_tokens: int | None = Field(default=None, ge=1, le=32000)
    presence_penalty: float | None = Field(default=None, ge=-2, le=2)
    frequency_penalty: float | None = Field(default=None, ge=-2, le=2)
    timeout_seconds: int | None = Field(default=None, ge=1, le=MAX_LLM_TIMEOUT_SECONDS)
    max_retries: int | None = Field(default=None, ge=0, le=MAX_LLM_MAX_RETRIES)
    status: int | None = Field(default=None, ge=0, le=1)


class AgentSessionCreate(BaseModel):
    title: str = Field(default="新会话", min_length=1, max_length=100)
    selected_model_name: str | None = Field(default=None, max_length=100)


class AgentSessionUpdate(BaseModel):
    title: str = Field(min_length=1, max_length=100)


class AgentModelSelect(BaseModel):
    model_name: str | None = Field(default=None, max_length=100)


class AgentMessageCreate(BaseModel):
    content: str = Field(min_length=1, max_length=20000)
    context_refs: list[dict[str, Any]] = Field(default_factory=list)
    runtime_options: AgentRuntimeOptions | None = None


class PlanReviewResumePayload(BaseModel):
    """规划审批恢复载荷（interrupt 之后由前端回传）。"""

    decision: PlanReviewDecision
    tasks: list[SubTaskDTO] | None = None
    feedback: str | None = Field(default=None, max_length=2000)

    @model_validator(mode="after")
    def validate_decision_payload(self) -> "PlanReviewResumePayload":
        if self.decision == PlanReviewDecision.REJECTED and not (self.feedback or "").strip():
            raise ValueError("驳回规划时必须提供 feedback")
        return self


class AgentRunResumeRequest(BaseModel):
    """恢复被 interrupt 暂停的编排运行。"""

    interrupt_kind: AgentInterruptKind
    payload: PlanReviewResumePayload


class AgentTemporaryActionExecute(BaseModel):
    """Agent 临时动作执行请求体，用于前端确认后真正执行业务写操作。

    所有字段由 SSE 中的 action_required 事件携带，用户确认后原样回传。
    """

    capability_key: str = Field(min_length=1, max_length=80)
    action_name: str = Field(min_length=1, max_length=100)
    target_type: str | None = Field(default=None, max_length=50)
    target_id: int | None = None
    input_payload: dict[str, Any] = Field(default_factory=dict)
    preview_payload: dict[str, Any] = Field(default_factory=dict)
