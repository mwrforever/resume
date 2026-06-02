"""
Agent 流式事件发射器（协议 v2）。

负责维护 seq，构造统一信封 `AgentStreamEnvelope` 并产出 `AgentStreamEvent` 供 endpoint 序列化为 SSE。
"""

import time
import uuid

from pydantic import BaseModel

from app.schemas.agent.stream import (
    AgentNodeId,
    AgentStreamEnvelope,
    AgentStreamEvent,
    AgentStreamEventType,
    SseEventName,
    STREAM_PROTOCOL_VERSION,
)


class AgentStreamEmitter:
    """
    单次用户消息对应一个 run_id；session_key 作为 LangGraph thread_id 使用。

    所有事件按生成顺序 seq 递增；前端按 seq 排序后渲染。
    """

    def __init__(self, *, session_id: int, session_key: str, run_id: str | None = None, workflow_type: str | None = None) -> None:
        """
        初始化发射器。

        Args:
            session_id: agent_session.id
            session_key: agent_session.session_key（作为 LangGraph thread_id）
            run_id: 本次运行 ID，未提供时自动生成
            workflow_type: 本次运行所属业务工作流
        """
        self.session_id = session_id
        self.session_key = session_key
        self.run_id = run_id or uuid.uuid4().hex
        self.workflow_type = workflow_type
        self._seq = 0

    def emit(
        self,
        *,
        event: AgentStreamEventType,
        payload: BaseModel | dict | None = None,
        node_id: AgentNodeId | str = AgentNodeId.COORDINATOR,
        agent_id: AgentNodeId | str | None = None,
        display_name: str | None = None,
    ) -> AgentStreamEvent:
        """
        构造一个事件信封并返回 SSE 投递载体。

        Args:
            event: 事件类型
            payload: 事件 payload（BaseModel 自动序列化，dict 透传）
            node_id: 触发节点 ID
            agent_id: 子 Agent ID（可选）
            display_name: 前端展示名称（可选）

        Returns:
            AgentStreamEvent: 待由 endpoint 序列化为 SSE
        """
        self._seq += 1
        data: dict
        if payload is None:
            data = {}
        elif isinstance(payload, BaseModel):
            data = payload.model_dump(mode="json")
        else:
            data = payload

        envelope = AgentStreamEnvelope(
            schema_version=STREAM_PROTOCOL_VERSION,
            seq=self._seq,
            run_id=self.run_id,
            session_id=self.session_id,
            workflow_type=self.workflow_type,
            node_id=str(node_id),
            agent_id=str(agent_id) if agent_id is not None else None,
            display_name=display_name,
            event=str(event),
            payload=data,
            ts=int(time.time() * 1000),
        )
        return AgentStreamEvent(
            name=SseEventName.AGENT.value,
            data=envelope.model_dump(mode="json"),
        )
