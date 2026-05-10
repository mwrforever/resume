from typing import Any, Literal

from pydantic import BaseModel, Field


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
    timeout_seconds: int = Field(default=120, ge=1, le=600)
    max_retries: int = Field(default=2, ge=0, le=5)
    status: int = Field(default=1, ge=0, le=1)


class LlmConfigUpdate(BaseModel):
    config_name: str | None = Field(default=None, min_length=1, max_length=50)
    base_url: str | None = Field(default=None, min_length=1, max_length=500)
    api_key: str | None = Field(default=None, min_length=1)
    model_name: str | None = Field(default=None, min_length=1, max_length=100)
    fallback_model_name: str | None = Field(default=None, max_length=100)
    extra_body: dict[str, Any] | None = None
    timeout_seconds: int | None = Field(default=None, ge=1, le=600)
    max_retries: int | None = Field(default=None, ge=0, le=5)
    status: int | None = Field(default=None, ge=0, le=1)


class AgentSessionCreate(BaseModel):
    title: str = Field(default="新会话", min_length=1, max_length=100)
    selected_model_name: str | None = Field(default=None, max_length=100)


class AgentModelSelect(BaseModel):
    model_name: str = Field(min_length=1, max_length=100)


class AgentMessageCreate(BaseModel):
    content: str = Field(min_length=1, max_length=20000)
    context_refs: list[dict[str, Any]] = Field(default_factory=list)


class AgentActionReject(BaseModel):
    reason: str | None = Field(default=None, max_length=500)
