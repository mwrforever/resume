"""双业务工作流运行器。"""

from __future__ import annotations

import logging
from collections.abc import AsyncIterator
from typing import Any

from langgraph.graph.state import CompiledStateGraph
from langgraph.types import Command, Interrupt
from app.llm.graphs.workflows._ctx import workflow_service_context

from app.llm.streaming.emitter import AgentStreamEmitter
from app.schemas.agent.stream import (
    AgentNodeId,
    AgentStreamEvent,
    AgentStreamEventType,
    CompletedPayload,
    ExecutionStatusPayload,
    InteractionRequestPayload,
)

logger = logging.getLogger(__name__)

NODE_DISPLAY_NAMES = {
    "load_resume": "读取简历",
    "suggest_dimensions": "提议面试维度",
    "request_dimension_selection": "等待维度选择",
    "build_question_plan": "生成题目计划",
    "request_plan_approval": "等待计划确认",
    "fanout_generate_questions": "生成面试题",
    "reduce_questions": "汇总面试题",
    "finalize_question_set": "完成面试题清单",
    "analyze_resume_profile": "分析简历画像",
    "load_job_candidates": "加载岗位列表",
    "request_job_selection": "等待岗位选择",
    "validate_job_full_name": "校验岗位名称",
    "run_evaluation_subgraph": "运行评估子图",
    "build_visualization_report": "生成可视化报告",
    "finalize_evaluation_report": "完成简历评估报告",
}


class AgentWorkflowRunner:
    """双业务工作流图运行器。"""

    def __init__(self, compiled_graph: CompiledStateGraph, *, service_context: dict[str, Any] | None = None) -> None:
        """
        初始化运行器。

        Args:
            compiled_graph: 已编译工作流图
            service_context: 业务服务实例字典，通过 ContextVar 传递给节点函数
        """
        self._graph = compiled_graph
        self._service_context = service_context or {}
        self._final_messages: dict[str, str] = {}
        self._final_blocks: dict[str, list[dict[str, Any]]] = {}

    async def astream(
        self,
        *,
        thread_id: str,
        graph_input: dict[str, Any] | Command,
        emitter: AgentStreamEmitter,
    ) -> AsyncIterator[AgentStreamEvent]:
        """
        运行图并翻译更新、中断和完成事件。

        Args:
            thread_id: LangGraph thread_id
            graph_input: 首次输入或恢复命令
            emitter: v2 流事件发射器

        Yields:
            AgentStreamEvent: 标准化流事件
        """
        config = {"configurable": {"thread_id": thread_id}}
        with workflow_service_context(self._service_context):
            async for mode, payload in self._graph.astream(graph_input, config=config, stream_mode=["updates"]):
                if mode != "updates":
                    continue
                async for event in self._handle_updates(thread_id=thread_id, payload=payload, emitter=emitter):
                    yield event

    def get_final_message(self, thread_id: str) -> str:
        """
        获取指定线程最终文本。

        Args:
            thread_id: LangGraph thread_id

        Returns:
            str: 最终回复文本
        """
        return self._final_messages.get(thread_id, "")

    def get_final_blocks(self, thread_id: str) -> list[dict[str, Any]]:
        """
        获取指定线程最终结构化 blocks。

        Args:
            thread_id: LangGraph thread_id

        Returns:
            list[dict[str, Any]]: 最终 blocks
        """
        return self._final_blocks.get(thread_id, [])

    async def _handle_updates(
        self,
        *,
        thread_id: str,
        payload: dict[str, Any],
        emitter: AgentStreamEmitter,
    ) -> AsyncIterator[AgentStreamEvent]:
        """
        翻译 LangGraph update 流。

        Args:
            thread_id: LangGraph thread_id
            payload: update 载荷
            emitter: v2 流事件发射器

        Yields:
            AgentStreamEvent: 标准化流事件
        """
        for node_name, update in payload.items():
            if node_name == "__interrupt__":
                interrupts = update if isinstance(update, (list, tuple)) else [update]
                for item in interrupts:
                    event = self._translate_interrupt(item, emitter)
                    if event is not None:
                        yield event
                continue
            display_name = NODE_DISPLAY_NAMES.get(str(node_name), str(node_name))
            yield emitter.emit(
                event=AgentStreamEventType.EXECUTION_STATUS,
                node_id=self._coerce_node_id(str(node_name)),
                display_name=display_name,
                payload=ExecutionStatusPayload(status="running", title=display_name, detail=None),
            )
            if isinstance(update, dict) and (update.get("final_text") or update.get("final_blocks")):
                final_text = str(update.get("final_text") or "")
                final_blocks = list(update.get("final_blocks") or [])
                self._final_messages[thread_id] = final_text
                self._final_blocks[thread_id] = final_blocks
                yield emitter.emit(
                    event=AgentStreamEventType.COMPLETED,
                    node_id=self._coerce_node_id(str(node_name)),
                    display_name=display_name,
                    payload=CompletedPayload(message=final_text, blocks=final_blocks),
                )
            else:
                yield emitter.emit(
                    event=AgentStreamEventType.EXECUTION_STATUS,
                    node_id=self._coerce_node_id(str(node_name)),
                    display_name=display_name,
                    payload=ExecutionStatusPayload(status="success", title=display_name, detail=None),
                )

    def _translate_interrupt(self, interrupt: Interrupt | dict[str, Any] | Any, emitter: AgentStreamEmitter) -> AgentStreamEvent | None:
        """
        翻译 LangGraph interaction interrupt。

        Args:
            interrupt: LangGraph interrupt 对象或 dict
            emitter: v2 流事件发射器

        Returns:
            AgentStreamEvent | None: interaction_request 事件
        """
        value = interrupt.value if isinstance(interrupt, Interrupt) else interrupt
        if not isinstance(value, dict):
            logger.warning("未识别的工作流中断载荷：%r", interrupt)
            return None
        if value.get("kind") != "interaction":
            logger.warning("未识别的工作流中断 kind：%s", value.get("kind"))
            return None
        return emitter.emit(
            event=AgentStreamEventType.INTERACTION_REQUEST,
            node_id=self._interaction_node_id(str(value.get("interaction_type") or "")),
            payload=InteractionRequestPayload(
                request_id=str(value.get("request_id") or ""),
                interaction_type=str(value.get("interaction_type") or ""),
                title=str(value.get("title") or "请确认"),
                prompt=str(value.get("prompt") or ""),
                data=dict(value.get("data") or {}),
                submit_label=str(value.get("submit_label") or "确认"),
                cancel_label=value.get("cancel_label"),
            ),
        )

    @staticmethod
    def _coerce_node_id(node_name: str) -> AgentNodeId:
        """
        将节点名转换为协议节点 ID。

        Args:
            node_name: LangGraph 节点名

        Returns:
            AgentNodeId: 协议节点 ID
        """
        mapping = {
            "load_resume": AgentNodeId.RESUME_AGENT,
            "suggest_dimensions": AgentNodeId.DIMENSION_SELECTION,
            "request_dimension_selection": AgentNodeId.DIMENSION_SELECTION,
            "build_question_plan": AgentNodeId.PLAN_APPROVAL,
            "request_plan_approval": AgentNodeId.PLAN_APPROVAL,
            "fanout_generate_questions": AgentNodeId.INTERVIEW_QUESTIONS,
            "reduce_questions": AgentNodeId.INTERVIEW_QUESTIONS,
            "finalize_question_set": AgentNodeId.FINALIZE,
            "analyze_resume_profile": AgentNodeId.RESUME_AGENT,
            "load_job_candidates": AgentNodeId.JOB_SELECTION,
            "request_job_selection": AgentNodeId.JOB_SELECTION,
            "validate_job_full_name": AgentNodeId.JOB_SELECTION,
            "run_evaluation_subgraph": AgentNodeId.RESUME_EVALUATION,
            "build_visualization_report": AgentNodeId.RESUME_EVALUATION,
            "finalize_evaluation_report": AgentNodeId.FINALIZE,
        }
        return mapping.get(node_name, AgentNodeId.COORDINATOR)

    @staticmethod
    def _interaction_node_id(interaction_type: str) -> AgentNodeId:
        """
        将交互类型转换为协议节点 ID。

        Args:
            interaction_type: LangGraph interrupt 交互类型

        Returns:
            AgentNodeId: 协议节点 ID
        """
        mapping = {
            "dimension_selection": AgentNodeId.DIMENSION_SELECTION,
            "plan_approval": AgentNodeId.PLAN_APPROVAL,
            "job_selection": AgentNodeId.JOB_SELECTION,
        }
        return mapping.get(interaction_type, AgentNodeId.FORM_REQUEST)
