from typing import Any

from pydantic import BaseModel, Field


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
    enable_thinking: bool = False
    enable_tools: bool = True
    enable_prompt_cache: bool = False
    enable_memory: bool = True
    temperature: float = 0.7
    top_p: float = 0.9
    max_tokens: int = 2048
    presence_penalty: float = 0
    frequency_penalty: float = 0


class LLMResultDTO(BaseModel):
    content: str
    model_name: str
    prompt_tokens: int = 0
    completion_tokens: int = 0
    total_tokens: int = 0
    usage_detail: dict[str, Any] | None = None
    raw_response_metadata: dict[str, Any] | None = None


class AgentToolCallDTO(BaseModel):
    tool_name: str
    display_name: str
    input_payload: dict[str, Any] = Field(default_factory=dict)


class AgentToolResultDTO(BaseModel):
    tool_name: str
    display_name: str
    output_payload: dict[str, Any] = Field(default_factory=dict)
    success: bool = True
    error_message: str | None = None


class LLMStreamChunkDTO(BaseModel):
    delta: str = ""
    result: LLMResultDTO | None = None
    tool_call: AgentToolCallDTO | None = None
    tool_result: AgentToolResultDTO | None = None
    error_message: str | None = None


class AgentGraphStateDTO(BaseModel):
    prompt: str
    runtime_config: LLMRuntimeConfigDTO
    tool_context: dict[str, Any] = Field(default_factory=dict)
    tool_calls: list[AgentToolCallDTO] = Field(default_factory=list)
    tool_results: list[AgentToolResultDTO] = Field(default_factory=list)
    result: LLMResultDTO | None = None
    error_message: str | None = None
