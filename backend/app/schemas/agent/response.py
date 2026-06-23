"""
Agent 响应体 schema（与重构后 DDL 对齐）。

删除 AgentMemoryItem（memory 表已 drop）；
AgentSessionItem 增加 enable_thinking，删除不存在的旧字段；
AgentMessageItem 删除不存在的 message_type，workflow_type/run_id 改为必填。
"""

from datetime import datetime
from typing import Any

from pydantic import BaseModel, ConfigDict


class LlmConfigItem(BaseModel):
    """LLM 模型配置详情（全局可见）。"""

    id: int
    biz_type: str = "global"
    biz_id: int = 0
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
    """LLM 模型选项（用于前端下拉选择）。"""

    model_name: str
    source: str
    config_id: int | None = None
    biz_type: str | None = None
    biz_id: int | None = None
    config_name: str
    base_url: str


class AgentSessionItem(BaseModel):
    """Agent 会话列表项（与新 DDL 对齐）。"""

    id: int
    session_key: str
    # 当前运行任务的 thread_id（模型上下文隔离）；工作流正常 END 时由后端推进
    current_task_id: str = ""
    employee_id: int
    title: str | None = None
    status: int
    selected_model_name: str | None = None
    enable_thinking: bool = False
    # 累积步骤进度（进度栏持久化展示用；None 表示尚无运行记录）
    progress: dict[str, Any] | None = None
    last_message_time: datetime | None = None
    create_time: datetime | None = None
    update_time: datetime | None = None

    model_config = ConfigDict(from_attributes=True)


class AgentResumeAttachmentItem(BaseModel):
    """Agent 会话简历上传结果。"""

    resume_id: int
    file_name: str
    job_id: int | None = None


class AgentMessageItem(BaseModel):
    """Agent 消息项（与新 DDL 对齐）。"""

    id: int
    session_id: int
    parent_message_id: int | None = None
    role: str
    workflow_type: str
    run_id: str | None = None
    content: dict[str, Any]
    model_name: str | None = None
    token_count: int | None = None
    sort_order: int
    create_time: datetime | None = None

    model_config = ConfigDict(from_attributes=True)


class AgentSessionDetail(BaseModel):
    """Agent 会话详情（含消息列表）。"""

    session: AgentSessionItem
    messages: list[AgentMessageItem]


# 流式事件统一走 `app.schemas.agent.stream.AgentStreamEnvelope`；
# 非流式 send_message API 已下线，前端只通过 stream_message 与服务交互。
