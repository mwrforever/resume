"""Agent 流式事件协议 v1 信封与载荷模型。"""

from typing import Any

from pydantic import BaseModel, Field

from app.schemas.agent.enums import (
    AgentEventTypeV1,
    AgentInterruptKind,
    AgentNodeId,
    AgentStreamProtocolVersion,
    UiComponentKey,
    UiPlacement,
)


class AgentStreamEnvelopeV1(BaseModel):
    """SSE agent.v1 统一信封。"""

    protocol_version: AgentStreamProtocolVersion = AgentStreamProtocolVersion.V1
    seq: int
    run_id: str
    stream_id: str
    session_id: int
    node_id: AgentNodeId
    event_type: AgentEventTypeV1
    timestamp: int
    payload: dict[str, Any] = Field(default_factory=dict)
    branch_id: str | None = None


class UiRenderPayload(BaseModel):
    """ui.render 事件载荷。"""

    component_key: UiComponentKey
    instance_id: str
    placement: UiPlacement = UiPlacement.INLINE_AFTER_USER
    data: dict[str, Any] = Field(default_factory=dict)


class LifecycleInterruptPayload(BaseModel):
    """lifecycle.interrupt 事件载荷。"""

    interrupt_kind: AgentInterruptKind
    revision: int | None = None


class PlanRevisionStartedPayload(BaseModel):
    """plan.revision_started 事件载荷。"""

    revision: int
    max_revisions: int
    sub_step: str
