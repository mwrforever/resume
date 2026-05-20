"""编排图流式执行与 SSE 事件映射（Service 层调用，不越层访问 Graph 细节）。"""

import logging
from collections.abc import AsyncIterator
from typing import Any

from langgraph.types import Interrupt

from app.llm.graphs.orchestrator_graph import AgentOrchestratorGraph
from app.llm.streaming.event_emitter import AgentStreamEventEmitter
from app.schemas.agent.dto import AgentToolCallDTO, AgentToolResultDTO, LLMResultDTO
from app.schemas.agent.enums import (
    AgentEventTypeV1,
    AgentInterruptKind,
    AgentNodeId,
    AgentPlannerSubStep,
    AgentSseEventName,
    PlanReviewStatus,
    UiComponentKey,
    UiPlacement,
)
from app.schemas.agent.orchestrator_state import OrchestratorState, SubTaskDTO
from app.schemas.agent.request import PlanReviewResumePayload
from app.schemas.agent.response import AgentStreamEvent
from app.schemas.agent.stream_v1 import LifecycleInterruptPayload, UiRenderPayload

logger = logging.getLogger(__name__)


class AgentOrchestratorRunner:
    """将 LangGraph chunk 映射为 AgentStreamEvent / v1 信封。"""

    def __init__(self, orchestrator: AgentOrchestratorGraph | None = None) -> None:
        self._orchestrator = orchestrator or AgentOrchestratorGraph()

    async def stream_run(
        self,
        initial_state: OrchestratorState,
        emitter: AgentStreamEventEmitter,
    ) -> AsyncIterator[tuple[AgentSseEventName, dict]]:
        """执行一次新的编排运行直至结束或 interrupt。"""
        # 发送 lifecycle.run_started 事件
        for sse_name, data in emitter.dual(
            node_id=AgentNodeId.INPUT,
            event_type=AgentEventTypeV1.RUN_STARTED,
            payload={"session_key": initial_state.session_key},
        ):
            yield sse_name, data

        async for chunk in self._orchestrator.astream(
            initial_state,
            session_key=initial_state.session_key,
        ):
            for event in self._map_chunk(chunk, emitter):
                yield event

        # 发送 lifecycle.run_finished 事件（正常结束时）
        for sse_name, data in emitter.dual(
            node_id=AgentNodeId.REPORTER,
            event_type=AgentEventTypeV1.RUN_FINISHED,
            payload={"session_key": initial_state.session_key},
        ):
            yield sse_name, data

        async for event in self._iter_interrupt_events(initial_state.session_key, emitter):
            yield event

    async def stream_resume(
        self,
        *,
        session_key: str,
        resume_payload: PlanReviewResumePayload,
        emitter: AgentStreamEventEmitter,
    ) -> AsyncIterator[tuple[AgentSseEventName, dict]]:
        """恢复 interrupt 后的编排运行。"""
        for sse_name, data in emitter.dual(
            node_id=AgentNodeId.PLANNER,
            event_type=AgentEventTypeV1.RESUME_ACK,
            payload={"interrupt_kind": AgentInterruptKind.PLAN_REVIEW.value},
        ):
            yield sse_name, data

        async for chunk in self._orchestrator.astream_resume(
            resume_payload.model_dump(mode="json"),
            session_key=session_key,
        ):
            for event in self._map_chunk(chunk, emitter):
                yield event

        # 发送 lifecycle.run_finished 事件
        for sse_name, data in emitter.dual(
            node_id=AgentNodeId.PLANNER,
            event_type=AgentEventTypeV1.RUN_FINISHED,
            payload={"session_key": session_key},
        ):
            yield sse_name, data

        async for event in self._iter_interrupt_events(session_key, emitter):
            yield event

    def build_final_result(self, session_key: str, state: OrchestratorState) -> LLMResultDTO | None:
        """从编排 State 构造 LLM 结果 DTO。"""
        if state.error_message and not state.final_content:
            return None
        return LLMResultDTO(
            content=state.final_content or state.error_message or "",
            model_name=state.runtime_config.model_name,
        )

    async def load_state(self, session_key: str) -> OrchestratorState:
        """读取 checkpoint 合并后的 State 实体。"""
        snapshot = await self.get_graph_state(session_key)
        values = snapshot.values if snapshot else {}
        return OrchestratorState.from_checkpoint(values)

    async def get_graph_state(self, session_key: str) -> Any:
        """读取 LangGraph checkpoint 快照。"""
        return await self._orchestrator.get_state(session_key)

    async def _iter_interrupt_events(
        self,
        session_key: str,
        emitter: AgentStreamEventEmitter,
    ) -> AsyncIterator[tuple[AgentSseEventName, dict]]:
        """若图处于 interrupt，推送 lifecycle.interrupt 与 ui.render。"""
        snapshot = await self._orchestrator.get_state(session_key)
        if not snapshot or not snapshot.interrupts:
            return

        events: list[tuple[AgentSseEventName, dict]] = []
        for item in snapshot.interrupts:
            interrupt_value = self._unwrap_interrupt(item)
            kind_raw = interrupt_value.get("interrupt_kind")
            try:
                interrupt_kind = AgentInterruptKind(kind_raw)
            except ValueError:
                continue
            if interrupt_kind != AgentInterruptKind.PLAN_REVIEW:
                continue

            revision = int(interrupt_value.get("revision") or 1)
            tasks_raw = interrupt_value.get("tasks") or []
            tasks = [SubTaskDTO.model_validate(task) for task in tasks_raw]

            interrupt_payload = LifecycleInterruptPayload(
                interrupt_kind=interrupt_kind,
                revision=revision,
            )
            ui_payload = UiRenderPayload(
                component_key=UiComponentKey.PLAN_REVIEW_TREE,
                instance_id=f"ui-plan-{revision}",
                placement=UiPlacement.INLINE_AFTER_USER,
                data={
                    "plan_id": f"plan_{revision}",
                    "revision": revision,
                    "tasks": [task.model_dump(mode="json") for task in tasks],
                    "editable": True,
                },
            )

            events.extend(
                emitter.dual(
                    node_id=AgentNodeId.PLANNER,
                    event_type=AgentEventTypeV1.INTERRUPT,
                    payload=interrupt_payload.model_dump(mode="json"),
                )
            )
            events.extend(
                emitter.dual(
                    node_id=AgentNodeId.PLANNER,
                    event_type=AgentEventTypeV1.UI_RENDER,
                    payload=ui_payload.model_dump(mode="json"),
                )
            )
            events.extend(
                emitter.dual(
                    node_id=AgentNodeId.PLANNER,
                    event_type=AgentEventTypeV1.PLAN_REVISION_STARTED,
                    payload={
                        "revision": revision,
                        "max_revisions": 5,
                        "sub_step": AgentPlannerSubStep.REVIEW_WAIT.value,
                    },
                )
            )
        for event in events:
            yield event

    def _map_chunk(
        self,
        chunk: Any,
        emitter: AgentStreamEventEmitter,
    ) -> list[tuple[AgentSseEventName, dict]]:
        """将 LangGraph updates 映射为 SSE 事件。"""
        if not isinstance(chunk, dict):
            return []

        events: list[tuple[AgentSseEventName, dict]] = []
        for node_name, update in chunk.items():
            if node_name == "__interrupt__":
                continue
            if not isinstance(update, dict):
                continue

            node_id = self._resolve_node_id(node_name)

            # 发送 lifecycle.node_exit 事件（节点完成时）
            events.extend(
                emitter.dual(
                    node_id=node_id,
                    event_type=AgentEventTypeV1.NODE_EXIT,
                    payload={
                        "node_id": node_id.value,
                        "success": True,
                    },
                )
            )

            events.extend(self._map_node_update(node_id, update, emitter))
        return events

    def _map_node_update(
        self,
        node_id: AgentNodeId,
        update: dict[str, Any],
        emitter: AgentStreamEventEmitter,
    ) -> list[tuple[AgentSseEventName, dict]]:
        events: list[tuple[AgentSseEventName, dict]] = []

        if node_id == AgentNodeId.PLANNER:
            if update.get("plan_review_status") in {
                PlanReviewStatus.REJECTED,
                PlanReviewStatus.REJECTED.value,
            }:
                events.extend(
                    emitter.dual(
                        node_id=node_id,
                        event_type=AgentEventTypeV1.PLAN_REVISION_REJECTED,
                        payload={
                            "revision": update.get("plan_revision"),
                            "user_feedback": update.get("plan_review_feedback"),
                        },
                    )
                )
                suggestions = update.get("plan_repair_suggestions") or []
                if suggestions:
                    events.extend(
                        emitter.dual(
                            node_id=node_id,
                            event_type=AgentEventTypeV1.PLAN_REPAIR_SUGGESTIONS,
                            payload={"suggestions": suggestions},
                        )
                    )
                    events.extend(
                        emitter.dual(
                            node_id=node_id,
                            event_type=AgentEventTypeV1.UI_RENDER,
                            payload=UiRenderPayload(
                                component_key=UiComponentKey.PLAN_REPAIR_HINTS,
                                instance_id=f"ui-repair-{update.get('plan_revision')}",
                                data={"suggestions": suggestions},
                            ).model_dump(mode="json"),
                        )
                    )

        if node_id == AgentNodeId.LEGACY_EXECUTOR:
            for tool_call in update.get("tool_calls") or []:
                call = AgentToolCallDTO.model_validate(tool_call)
                events.extend(
                    emitter.dual(
                        node_id=node_id,
                        event_type=AgentEventTypeV1.TOOL_CALL_START,
                        payload=call.model_dump(mode="json"),
                        legacy_event="tool_call",
                        legacy_data={"tool_call": call.model_dump(mode="json")},
                    )
                )
            for tool_result in update.get("tool_results") or []:
                result = AgentToolResultDTO.model_validate(tool_result)
                legacy_tool = {
                    "tool_result": result.model_dump(mode="json"),
                }
                events.extend(
                    emitter.dual(
                        node_id=node_id,
                        event_type=AgentEventTypeV1.TOOL_CALL_END,
                        payload={
                            "status": "success" if result.success else "failed",
                            "summary": result.display_name,
                            **result.model_dump(mode="json"),
                        },
                        legacy_event="tool_result",
                        legacy_data=legacy_tool,
                    )
                )
                action_payload = (result.output_payload or {}).get("action_required")
                if isinstance(action_payload, dict):
                    events.extend(
                        emitter.dual(
                            node_id=node_id,
                            event_type=AgentEventTypeV1.UI_RENDER,
                            payload={
                                "component_key": UiComponentKey.ACTION_CONFIRM_CARD.value,
                                "instance_id": f"ui-action-{result.tool_name}",
                                "data": {"action": action_payload},
                            },
                            legacy_event="action_required",
                            legacy_data={"action": action_payload},
                        )
                    )

        if update.get("final_content"):
            events.extend(
                emitter.dual(
                    node_id=node_id,
                    event_type=AgentEventTypeV1.TEXT_DELTA,
                    payload={"delta": update["final_content"], "finish_reason": None},
                    legacy_event="token",
                    legacy_data={"delta": update["final_content"]},
                )
            )

        if update.get("error_message"):
            events.extend(
                emitter.dual(
                    node_id=node_id,
                    event_type=AgentEventTypeV1.RUN_FAILED,
                    payload={"message": update["error_message"]},
                    legacy_event="error",
                    legacy_data={"message": update["error_message"]},
                )
            )

        return events

    @staticmethod
    def _resolve_node_id(node_name: str) -> AgentNodeId:
        try:
            return AgentNodeId(node_name)
        except ValueError:
            return AgentNodeId.INPUT

    @staticmethod
    def _unwrap_interrupt(item: Any) -> dict[str, Any]:
        if isinstance(item, Interrupt):
            value = item.value
            return value if isinstance(value, dict) else {}
        if isinstance(item, dict):
            return item
        return {}
