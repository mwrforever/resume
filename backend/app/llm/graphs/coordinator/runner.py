"""
协调器运行器：把 LangGraph 流式输出翻译为 v2 协议事件。

核心约定：
- LangGraph supervisor 编译图通过 `astream(..., stream_mode=["updates","messages","custom"])`
  推送三类原生事件，本类逐条转换为 `AgentStreamEvent`：
    * "messages" → `message.delta` / `message.done` / `tool.started` / `tool.finished`
    * "updates"  → `lifecycle.node.enter` / `lifecycle.node.exit`，以及最终 final_message
    * "custom"   → `data.card` / `data.evaluation_report`（工具内部 `get_stream_writer()` 写入）
- LangGraph `interrupt()` 触发的中断由更新流中的 `__interrupt__` 键识别，按 payload kind
  拆分为 `form.requested` / `action.requested`。
- 表单提交 / 动作确认由 service 层调用 `aresume(thread_id, command)` 触发；逻辑同 stream。
"""

from __future__ import annotations

import logging
import uuid
from collections.abc import AsyncIterator
from typing import Any

from langchain_core.messages import AIMessageChunk, BaseMessage, ToolMessage
from langgraph.graph.state import CompiledStateGraph
from langgraph.types import Command, Interrupt

from app.llm.streaming.emitter import AgentStreamEmitter
from app.schemas.agent.stream import (
    ActionRequestedPayload,
    AgentNodeId,
    AgentStreamEvent,
    AgentStreamEventType,
    DataCardPayload,
    DataEvaluationDimension,
    DataEvaluationReportPayload,
    DataEvaluationSkill,
    FormFieldOption,
    FormFieldSchema,
    FormRequestedPayload,
    LifecycleNodePayload,
    MessageDeltaPayload,
    MessageDonePayload,
    ToolFinishedPayload,
    ToolStartedPayload,
)

logger = logging.getLogger(__name__)


class CoordinatorRunner:
    """LangGraph supervisor 流 → v2 协议 envelope 翻译层。"""

    def __init__(self, compiled_graph: CompiledStateGraph) -> None:
        """初始化运行器。

        Args:
            compiled_graph: `build_coordinator_graph(...)` 返回的已编译图
        """
        self._graph = compiled_graph

    async def astream(
        self,
        *,
        thread_id: str,
        graph_input: dict[str, Any] | Command,
        emitter: AgentStreamEmitter,
    ) -> AsyncIterator[AgentStreamEvent]:
        """
        驱动协调器图执行并把原生事件翻译为 v2 envelope。

        Args:
            thread_id: LangGraph thread_id，本系统使用 session.session_key
            graph_input: 首次调用传 `{"messages": [...], "employee_id": ..., ...}`，
                         恢复中断时传 `Command(resume=values)`
            emitter: 事件序号发射器（每次 run 一个实例）

        Yields:
            AgentStreamEvent: 由 endpoint 序列化为 SSE 的事件载体
        """
        config = {"configurable": {"thread_id": thread_id}}
        state_message_buffer: dict[str, list[str]] = {}
        active_tool_calls: dict[str, dict[str, Any]] = {}

        async for mode, payload in self._graph.astream(
            graph_input,
            config=config,
            stream_mode=["updates", "messages", "custom"],
        ):
            if mode == "updates":
                async for event in self._handle_updates(payload, emitter):
                    yield event
            elif mode == "messages":
                async for event in self._handle_messages(
                    payload, emitter, state_message_buffer, active_tool_calls
                ):
                    yield event
            elif mode == "custom":
                async for event in self._handle_custom(payload, emitter):
                    yield event

    # ------------------------------------------------------------------
    # updates 流：lifecycle.node.* + interrupt 识别 + final_message 收集
    # ------------------------------------------------------------------

    async def _handle_updates(
        self,
        payload: dict[str, Any],
        emitter: AgentStreamEmitter,
    ) -> AsyncIterator[AgentStreamEvent]:
        for node_name, update in payload.items():
            # interrupt：LangGraph 把 interrupt() 抛出的载荷放在 "__interrupt__" 键
            if node_name == "__interrupt__":
                interrupts = update if isinstance(update, list | tuple) else [update]
                for interrupt in interrupts:
                    event = self._translate_interrupt(interrupt, emitter)
                    if event is not None:
                        yield event
                continue

            yield emitter.emit(
                event=AgentStreamEventType.NODE_ENTER,
                node_id=self._coerce_node_id(node_name),
                agent_id=node_name if node_name not in {"coordinator"} else None,
                payload=LifecycleNodePayload(
                    node_id=node_name,
                    agent_id=node_name if node_name not in {"coordinator"} else None,
                ),
            )
            # 节点退出标记：updates 一次推送代表节点完成更新
            yield emitter.emit(
                event=AgentStreamEventType.NODE_EXIT,
                node_id=self._coerce_node_id(node_name),
                agent_id=node_name if node_name not in {"coordinator"} else None,
                payload=LifecycleNodePayload(
                    node_id=node_name,
                    agent_id=node_name if node_name not in {"coordinator"} else None,
                ),
            )

    def _translate_interrupt(
        self,
        interrupt: Interrupt | dict[str, Any] | Any,
        emitter: AgentStreamEmitter,
    ) -> AgentStreamEvent | None:
        """把 LangGraph 中断对象翻译为 form / action 事件。"""
        value = interrupt.value if isinstance(interrupt, Interrupt) else interrupt
        if not isinstance(value, dict):
            logger.warning("未识别的中断载荷类型，跳过：%r", interrupt)
            return None
        kind = value.get("kind")
        if kind == "form":
            request_id = str(value.get("request_id") or uuid.uuid4().hex)
            fields = [
                FormFieldSchema(
                    name=str(field.get("name")),
                    label=str(field.get("label") or field.get("name")),
                    type=field.get("type") or "text",
                    required=bool(field.get("required", True)),
                    help_text=field.get("help_text"),
                    placeholder=field.get("placeholder"),
                    options=[
                        FormFieldOption(value=opt.get("value"), label=str(opt.get("label") or ""))
                        for opt in field.get("options") or []
                        if isinstance(opt, dict)
                    ]
                    or None,
                    default=field.get("default"),
                )
                for field in value.get("fields") or []
                if isinstance(field, dict)
            ]
            return emitter.emit(
                event=AgentStreamEventType.FORM_REQUESTED,
                node_id=AgentNodeId.FORM_REQUEST,
                payload=FormRequestedPayload(
                    request_id=request_id,
                    title=str(value.get("title") or "请补充信息"),
                    prompt=str(value.get("prompt") or ""),
                    fields=fields,
                    submit_label=str(value.get("submit_label") or "提交"),
                    cancel_label=value.get("cancel_label"),
                ),
            )
        if kind == "action":
            return emitter.emit(
                event=AgentStreamEventType.ACTION_REQUESTED,
                node_id=AgentNodeId.ACTION_PROPOSER,
                payload=ActionRequestedPayload(
                    action_id=str(value.get("action_id") or uuid.uuid4().hex),
                    capability_key=str(value.get("capability_key") or ""),
                    action_name=str(value.get("action_name") or ""),
                    description=value.get("description"),
                    target_type=value.get("target_type"),
                    target_id=value.get("target_id"),
                    input_payload=dict(value.get("input_payload") or {}),
                    preview_payload=dict(value.get("preview_payload") or {}),
                ),
            )
        logger.warning("未识别的中断 kind：%s", kind)
        return None

    # ------------------------------------------------------------------
    # messages 流：message.delta / message.done / tool.started / tool.finished
    # ------------------------------------------------------------------

    async def _handle_messages(
        self,
        payload: tuple[BaseMessage, dict[str, Any]],
        emitter: AgentStreamEmitter,
        message_buffer: dict[str, list[str]],
        active_tool_calls: dict[str, dict[str, Any]],
    ) -> AsyncIterator[AgentStreamEvent]:
        message, metadata = payload
        node_name = str(metadata.get("langgraph_node") or AgentNodeId.COORDINATOR.value)
        # AIMessageChunk：模型流式增量
        if isinstance(message, AIMessageChunk):
            message_id = str(message.id or "stream")
            content = self._coerce_text(message.content)
            if content:
                message_buffer.setdefault(message_id, []).append(content)
                yield emitter.emit(
                    event=AgentStreamEventType.MESSAGE_DELTA,
                    node_id=self._coerce_node_id(node_name),
                    agent_id=node_name,
                    payload=MessageDeltaPayload(message_id=message_id, delta=content),
                )
            for tool_call in message.tool_call_chunks or []:
                tool_call_id = tool_call.get("id")
                if not tool_call_id:
                    continue
                if tool_call_id in active_tool_calls:
                    continue
                active_tool_calls[tool_call_id] = {
                    "tool_name": str(tool_call.get("name") or ""),
                    "node": node_name,
                }
                yield emitter.emit(
                    event=AgentStreamEventType.TOOL_STARTED,
                    node_id=self._coerce_node_id(node_name),
                    agent_id=node_name,
                    payload=ToolStartedPayload(
                        call_id=str(tool_call_id),
                        tool_name=str(tool_call.get("name") or ""),
                        display_name=str(tool_call.get("name") or ""),
                        input_payload={},
                    ),
                )
            # 当 chunk 携带 finish_reason 时认为本条消息结束（多轮 ReAct 之间会有多次）
            finish_reason = (
                (message.response_metadata or {}).get("finish_reason")
                if hasattr(message, "response_metadata")
                else None
            )
            if finish_reason in {"stop", "end_turn", "end"}:
                content_text = "".join(message_buffer.pop(message_id, []))
                if content_text:
                    yield emitter.emit(
                        event=AgentStreamEventType.MESSAGE_DONE,
                        node_id=self._coerce_node_id(node_name),
                        agent_id=node_name,
                        payload=MessageDonePayload(message_id=message_id, content=content_text),
                    )
            return

        # ToolMessage：工具执行完成
        if isinstance(message, ToolMessage):
            call_id = str(getattr(message, "tool_call_id", "") or "")
            tool_meta = active_tool_calls.pop(call_id, None)
            tool_name = tool_meta["tool_name"] if tool_meta else str(message.name or "")
            yield emitter.emit(
                event=AgentStreamEventType.TOOL_FINISHED,
                node_id=self._coerce_node_id(node_name),
                agent_id=node_name,
                payload=ToolFinishedPayload(
                    call_id=call_id or uuid.uuid4().hex,
                    tool_name=tool_name,
                    display_name=tool_name,
                    success=getattr(message, "status", "success") != "error",
                    output_payload={"content": self._coerce_text(message.content)},
                    error_message=None,
                ),
            )

    # ------------------------------------------------------------------
    # custom 流：工具内部主动写入的结构化卡片
    # ------------------------------------------------------------------

    async def _handle_custom(
        self,
        payload: dict[str, Any],
        emitter: AgentStreamEmitter,
    ) -> AsyncIterator[AgentStreamEvent]:
        if not isinstance(payload, dict):
            return
        kind = payload.get("kind")
        body = payload.get("payload") or {}
        if not isinstance(body, dict):
            return
        if kind == "data_card":
            yield emitter.emit(
                event=AgentStreamEventType.DATA_CARD,
                node_id=AgentNodeId.SUB_AGENT_RUNNER,
                payload=DataCardPayload(
                    card_id=str(body.get("card_id") or uuid.uuid4().hex),
                    card_type=str(body.get("card_type") or "generic"),
                    title=str(body.get("title") or ""),
                    summary=body.get("summary"),
                    body=dict(body.get("body") or {}),
                ),
            )
        elif kind == "evaluation_report":
            dimensions = [
                DataEvaluationDimension.model_validate(item)
                for item in body.get("dimensions") or []
                if isinstance(item, dict)
            ]
            skill_hits = [
                DataEvaluationSkill.model_validate(item)
                for item in body.get("skill_hits") or []
                if isinstance(item, dict)
            ]
            yield emitter.emit(
                event=AgentStreamEventType.DATA_EVALUATION_REPORT,
                node_id=AgentNodeId.EVALUATION_AGENT,
                agent_id=AgentNodeId.EVALUATION_AGENT,
                payload=DataEvaluationReportPayload(
                    card_id=str(body.get("card_id") or uuid.uuid4().hex),
                    application_id=body.get("application_id"),
                    resume_id=body.get("resume_id"),
                    job_id=body.get("job_id"),
                    job_name=str(body.get("job_name") or ""),
                    final_score=float(body.get("final_score") or 0),
                    final_label=str(body.get("final_label") or ""),
                    advantage_comment=str(body.get("advantage_comment") or ""),
                    disadvantage_comment=str(body.get("disadvantage_comment") or ""),
                    dimensions=dimensions,
                    skill_hits=skill_hits,
                ),
            )
        else:
            logger.debug("未识别的 custom 事件 kind=%s", kind)

    # ------------------------------------------------------------------
    # 提取最终回复（finalize 时由 service 层调用）
    # ------------------------------------------------------------------

    async def get_final_message(self, thread_id: str) -> str:
        """从 checkpointer 读取最近一次 supervisor 输出文本。"""
        config = {"configurable": {"thread_id": thread_id}}
        state = await self._graph.aget_state(config)
        if state is None or not getattr(state, "values", None):
            return ""
        messages = state.values.get("messages") or []
        for message in reversed(messages):
            if getattr(message, "type", None) == "ai":
                content = self._coerce_text(getattr(message, "content", ""))
                if content:
                    return content
        return ""

    @staticmethod
    def _coerce_text(content: Any) -> str:
        """LangChain 消息内容可能为 str 或 list[dict]，统一转 str。"""
        if isinstance(content, str):
            return content
        if isinstance(content, list):
            parts: list[str] = []
            for item in content:
                if isinstance(item, str):
                    parts.append(item)
                elif isinstance(item, dict):
                    text = item.get("text")
                    if isinstance(text, str):
                        parts.append(text)
            return "".join(parts)
        return ""

    @staticmethod
    def _coerce_node_id(node_name: str) -> AgentNodeId | str:
        """把 LangGraph 节点名映射为协议 AgentNodeId 枚举（无映射时透传）。"""
        try:
            return AgentNodeId(node_name)
        except ValueError:
            return node_name


__all__ = ["CoordinatorRunner"]
