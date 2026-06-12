"""
Agent 端点请求体 schema（精简版本）。

保留 LLM 配置和精简后的 Agent 请求模型。
删除 AgentActionExecute（action 框架已废弃）。
"""

from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field

MAX_LLM_TIMEOUT_SECONDS = 120
MAX_LLM_MAX_RETRIES = 2
AgentWorkflowType = Literal["interview_questions", "resume_evaluation"]


# ====== LLM 配置 ======

class LlmConfigCreate(BaseModel):
    """创建 LLM 模型配置。"""
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
    """更新 LLM 模型配置。"""
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


# ====== Agent 会话/消息 ======

class AgentSessionCreate(BaseModel):
    """创建 Agent 会话。"""
    title: str = Field(default="新会话", min_length=1, max_length=100)
    selected_model_name: str | None = Field(default=None, max_length=100)


class AgentSessionUpdate(BaseModel):
    """更新 Agent 会话（重命名）。"""
    title: str = Field(min_length=1, max_length=100)


class AgentSessionModelSelect(BaseModel):
    """选择 Agent 会话使用的模型。"""
    model_config = ConfigDict(extra="forbid")
    model_name: str | None = Field(default=None, max_length=100)


class AgentRuntimeOptions(BaseModel):
    """单次消息的运行时覆盖（仅 thinking 开关）。"""
    model_config = ConfigDict(extra="forbid")
    enable_thinking: bool | None = None


class AgentMessageCreate(BaseModel):
    """用户输入文本，触发一次 workflow run。"""
    content: str = Field(min_length=1, max_length=8000)
    workflow_type: AgentWorkflowType = "interview_questions"
    context_refs: list[dict[str, Any]] = Field(default_factory=list)
    runtime_options: AgentRuntimeOptions | None = None


class AgentInteractionSubmit(BaseModel):
    """提交 interaction 卡片的用户填写。"""
    model_config = ConfigDict(extra="forbid")
    values: dict[str, Any] = Field(default_factory=dict)


# ====== 向后兼容别名（旧字段名映射，阶段 7 后可删除） ======

AgentModelSelect = AgentSessionModelSelect
AgentFormSubmit = AgentInteractionSubmit
