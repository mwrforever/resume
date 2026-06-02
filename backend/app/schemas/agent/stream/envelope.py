"""
Agent 流式协议 v2 - 统一信封。

所有 SSE 事件均通过 `AgentStreamEnvelope` 下发，前端按 `seq` 排序后顺序渲染。
SSE 顶层 event 行恒定为 `agent`，data 中携带本信封 JSON。
"""

from typing import Any

from pydantic import BaseModel, ConfigDict, Field

STREAM_PROTOCOL_VERSION = "2.0"


class AgentStreamEnvelope(BaseModel):
    """
    统一流式事件信封。

    Attributes:
        schema_version: 协议版本（固定 2.0）
        seq: 同一 run 内递增的序号，前端按此排序
        run_id: 本次用户消息触发的运行 ID
        session_id: 会话 ID（与 agent_session.id 一致）
        workflow_type: 本次运行所属业务工作流
        node_id: 触发事件的节点/Agent 标识
        agent_id: 子 Agent 标识（若由子 Agent 触发）
        display_name: 前端展示名称
        event: 事件类型枚举值（见 `AgentStreamEventType`）
        payload: 事件具体载荷，结构因 event 不同而不同
        ts: 服务器时间戳（毫秒）
        extensions: 扩展槽位，保留未来非核心字段
    """

    model_config = ConfigDict(extra="forbid")

    schema_version: str = STREAM_PROTOCOL_VERSION
    seq: int
    run_id: str
    session_id: int
    workflow_type: str | None = None
    node_id: str
    agent_id: str | None = None
    display_name: str | None = None
    event: str
    payload: dict[str, Any] = Field(default_factory=dict)
    ts: int
    extensions: dict[str, Any] | None = None


class AgentStreamEvent(BaseModel):
    """
    SSE 投递载体（endpoint 序列化用）。

    `name` 为 SSE 顶层 event 行（恒为 "agent"），`data` 为信封 dict。
    """

    name: str
    data: dict[str, Any] = Field(default_factory=dict)
