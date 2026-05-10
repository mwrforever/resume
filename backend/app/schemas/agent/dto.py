from typing import Any

from pydantic import BaseModel


class LLMRuntimeConfigDTO(BaseModel):
    model_name: str
    api_key: str
    base_url: str
    protocol: str = "openai"
    fallback_model_name: str | None = None
    extra_body: dict[str, Any] | None = None
    timeout_seconds: int = 120
    max_retries: int = 2
    source: str = "env"


class LLMResultDTO(BaseModel):
    content: str
    model_name: str
    prompt_tokens: int = 0
    completion_tokens: int = 0
    total_tokens: int = 0
    usage_detail: dict[str, Any] | None = None
    raw_response_metadata: dict[str, Any] | None = None


class AgentGraphStateDTO(BaseModel):
    prompt: str
    runtime_config: LLMRuntimeConfigDTO
    result: LLMResultDTO | None = None
    error_message: str | None = None
