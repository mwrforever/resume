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


class AgentMessageItem(BaseModel):
    id: int
    session_id: int
    parent_message_id: int | None = None
    role: str
    message_type: str
    content: dict[str, Any]
    model_name: str | None = None
    token_count: int | None = None
    sort_order: int
    create_time: datetime | None = None

    model_config = ConfigDict(from_attributes=True)


class AgentRunItem(BaseModel):
    id: int
    trace_id: str
    parent_run_id: int | None = None
    session_id: int
    message_id: int | None = None
    run_type: str
    status: int
    model_name: str | None = None
    prompt_tokens: int
    completion_tokens: int
    total_tokens: int
    latency_ms: int | None = None
    input_payload: dict[str, Any] | None = None
    output_payload: dict[str, Any] | None = None
    error_message: str | None = None
    create_time: datetime | None = None
    update_time: datetime | None = None

    model_config = ConfigDict(from_attributes=True)


class AgentActionItem(BaseModel):
    id: int
    session_id: int
    message_id: int | None = None
    run_id: int | None = None
    employee_id: int
    capability_key: str
    action_name: str
    target_type: str | None = None
    target_id: int | None = None
    input_payload: dict[str, Any]
    preview_payload: dict[str, Any]
    status: int
    idempotency_key: str
    error_message: str | None = None
    create_time: datetime | None = None
    update_time: datetime | None = None
    confirmed_at: datetime | None = None
    rejected_at: datetime | None = None
    executed_at: datetime | None = None

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


class AgentContextSnapshotItem(BaseModel):
    id: int
    session_id: int
    snapshot_version: int
    summary_text: str
    covered_message_start_id: int
    covered_message_end_id: int
    message_count: int
    token_count: int
    model_name: str | None = None
    create_time: datetime | None = None

    model_config = ConfigDict(from_attributes=True)


class AgentSessionWindowItem(BaseModel):
    snapshot: AgentContextSnapshotItem | None = None
    recent_messages: list[AgentMessageItem]
    token_count: int
    prompt_prefix_hash: str | None = None


class AgentSessionDetail(BaseModel):
    session: AgentSessionItem
    messages: list[AgentMessageItem]
    memories: list[AgentMemoryItem] = Field(default_factory=list)
    snapshots: list[AgentContextSnapshotItem] = Field(default_factory=list)
    session_window: AgentSessionWindowItem | None = None


class AgentReply(BaseModel):
    user_message: AgentMessageItem
    agent_message: AgentMessageItem
    run: AgentRunItem
    session: AgentSessionItem | None = None
    snapshot: AgentContextSnapshotItem | None = None
    memories: list[AgentMemoryItem] = Field(default_factory=list)
    session_window: AgentSessionWindowItem | None = None
