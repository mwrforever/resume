"""
Agent 流式协议 v1 统一信封。

所有 SSE 事件均通过 `AgentStreamEnvelope` 下发。SSE 顶层 event 行恒为 `agent`，
data 中携带本信封 JSON。前端按 `seq` 排序后顺序渲染。

字段说明：
    v: 协议版本，固定 1。出现 v != 1 时前端应忽略并打日志。
    seq: 同一 run 内单调递增序号，前端排序唯一依据。
    ts: 服务器毫秒时间戳，仅用于调试，不参与排序。
    run_id: 本次运行 ID，用户消息触发或 interaction 提交触发各为独立 run。
    session_id: 关联的 agent_session.id。
    type: 事件类型枚举（详见 events.py 的 EVENT_TYPES）。
    data: 事件载荷，结构由 type 决定（详见 events.py）。
"""

from typing import Any

from pydantic import BaseModel, ConfigDict, Field

STREAM_PROTOCOL_VERSION = 1


class AgentStreamEnvelope(BaseModel):
    """Agent 流式事件统一信封。"""

    model_config = ConfigDict(extra="allow")

    v: int = STREAM_PROTOCOL_VERSION
    seq: int
    ts: int
    run_id: str
    session_id: int
    type: str
    data: dict[str, Any] = Field(default_factory=dict)
