from typing import Any, Literal

from pydantic import BaseModel, Field


MAX_LLM_TIMEOUT_SECONDS = 120
MAX_LLM_MAX_RETRIES = 2


class AgentRuntimeConfigUpdate(BaseModel):
    enable_thinking: bool = False
    enable_tools: bool = True
    enable_prompt_cache: bool = False
    enable_memory: bool = True
    temperature: float = Field(default=0.7, ge=0, le=2)
    top_p: float = Field(default=0.9, ge=0, le=1)
    max_tokens: int = Field(default=2048, ge=1, le=32000)
    presence_penalty: float = Field(default=0, ge=-2, le=2)
    frequency_penalty: float = Field(default=0, ge=-2, le=2)
    extra_body: dict[str, Any] | None = None


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


class AgentActionReject(BaseModel):
    reason: str | None = Field(default=None, max_length=500)
