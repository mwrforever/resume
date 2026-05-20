"""Agent 流式事件发射器：维护 seq，产出 v1 信封与 legacy 兼容事件。"""

import time
import uuid
from collections.abc import Iterator

from app.schemas.agent.enums import (
    AgentEventTypeV1,
    AgentNodeId,
    AgentSseEventName,
    AgentStreamProtocolVersion,
)
from app.schemas.agent.response import AgentStreamEvent
from app.schemas.agent.stream_v1 import AgentStreamEnvelopeV1


class AgentStreamEventEmitter:
    """
    单次用户消息对应一个 run_id；LangGraph thread_id 使用 session_key（与会话一一对应）。
    """

    def __init__(self, *, session_id: int, session_key: str, run_id: str | None = None) -> None:
        self.session_id = session_id
        self.session_key = session_key
        self.run_id = run_id or uuid.uuid4().hex
        self.stream_id = self.run_id
        self._seq = 0

    def emit_v1(
        self,
        *,
        node_id: AgentNodeId,
        event_type: AgentEventTypeV1,
        payload: dict,
        branch_id: str | None = None,
    ) -> AgentStreamEnvelopeV1:
        """构造 v1 信封并递增 seq。"""
        self._seq += 1
        return AgentStreamEnvelopeV1(
            protocol_version=AgentStreamProtocolVersion.V1,
            seq=self._seq,
            run_id=self.run_id,
            stream_id=self.stream_id,
            session_id=self.session_id,
            node_id=node_id,
            event_type=event_type,
            timestamp=int(time.time() * 1000),
            payload=payload,
            branch_id=branch_id,
        )

    def emit_legacy(self, event: str, data: dict) -> AgentStreamEvent:
        """构造旧版 SSE 事件（迁移期双发）。"""
        return AgentStreamEvent(event=event, data=data)

    def dual(
        self,
        *,
        node_id: AgentNodeId,
        event_type: AgentEventTypeV1,
        payload: dict,
        legacy_event: str | None = None,
        legacy_data: dict | None = None,
        branch_id: str | None = None,
    ) -> list[tuple[AgentSseEventName, dict]]:
        """返回 [(sse_event_name, data_dict), ...] 供 endpoint JSON 序列化。"""
        envelopes: list[tuple[AgentSseEventName, dict]] = []
        v1 = self.emit_v1(
            node_id=node_id,
            event_type=event_type,
            payload=payload,
            branch_id=branch_id,
        )
        envelopes.append((AgentSseEventName.V1, v1.model_dump(mode="json")))
        if legacy_event and legacy_data is not None:
            envelopes.append((AgentSseEventName.LEGACY, {"event": legacy_event, "data": legacy_data}))
        return envelopes

    def dual_from_pairs(
        self,
        pairs: list[tuple[AgentNodeId, AgentEventTypeV1, dict, str | None, dict | None]],
    ) -> Iterator[tuple[AgentSseEventName, dict]]:
        """批量双发，legacy 可选。"""
        for node_id, event_type, payload, legacy_event, legacy_data in pairs:
            for sse_name, data in self.dual(
                node_id=node_id,
                event_type=event_type,
                payload=payload,
                legacy_event=legacy_event,
                legacy_data=legacy_data,
            ):
                yield sse_name, data
