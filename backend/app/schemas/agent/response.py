from datetime import datetime
from typing import Any

from pydantic import BaseModel, ConfigDict, Field


class LlmConfigItem(BaseModel):
    id: int
    biz_type: str
    biz_id: int
    config_name: str
    protocol: str
    base_url: str
    api_key_mask: str
    model_name: str
    fallback_model_name: str | None = None
    extra_body: dict[str, Any] | None = None
    enable_thinking: bool = False
    enable_tools: bool = True
    enable_prompt_cache: bool = False
    enable_memory: bool = True
    temperature: float = 0.7
    top_p: float = 0.9
    max_tokens: int = 2048
    presence_penalty: float = 0
    frequency_penalty: float = 0
    timeout_seconds: int
    max_retries: int
    status: int
    last_test_at: datetime | None = None
    last_test_status: int | None = None
    last_test_message: str | None = None
    create_time: datetime | None = None
    update_time: datetime | None = None
    can_manage: bool = False

    model_config = ConfigDict(from_attributes=True)


class LlmModelOption(BaseModel):
    model_name: str
    source: str
    config_id: int | None = None
    biz_type: str | None = None
    biz_id: int | None = None
    config_name: str
    base_url: str


class AgentSessionItem(BaseModel):
    id: int
    session_key: str
    employee_id: int
    title: str
    status: int
    selected_model_name: str | None = None
    selected_model_source: str | None = None
    context_summary: str | None = None
    last_message_time: datetime | None = None
    version: int
    create_time: datetime | None = None
    update_time: datetime | None = None

    model_config = ConfigDict(from_attributes=True)


class AgentResumeAttachmentItem(BaseModel):
    """Agent 会话简历上传结果。"""

    resume_id: int
    file_name: str
    job_id: int | None = None


class AgentMessageItem(BaseModel):
    id: int
    session_id: int
    parent_message_id: int | None = None
    role: str
    message_type: str
    workflow_type: str | None = None
    run_id: str | None = None
    content: dict[str, Any]
    model_name: str | None = None
    token_count: int | None = None
    sort_order: int
    create_time: datetime | None = None

    model_config = ConfigDict(from_attributes=True)


class AgentMemoryItem(BaseModel):
    id: int
    employee_id: int
    memory_type: str
    memory_key: str
    content: str
    importance_score: float
    confidence_score: float
    source_session_id: int | None = None
    last_access_time: datetime | None = None
    create_time: datetime | None = None
    update_time: datetime | None = None

    model_config = ConfigDict(from_attributes=True)


class AgentSessionDetail(BaseModel):
    session: AgentSessionItem
    messages: list[AgentMessageItem]
    memories: list[AgentMemoryItem] = Field(default_factory=list)


# 流式事件统一走 `app.schemas.agent.stream.AgentStreamEvent`；
# 非流式 send_message API 已下线，前端只通过 stream_message 与服务交互。
