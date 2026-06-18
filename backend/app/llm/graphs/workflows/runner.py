"""
LangGraph 工作流薄壳 Runner。

职责：
- 通过 config["configurable"]["ctx"] 注入 WorkflowRuntimeContext 到节点闭包
- 翻译 stream_mode="updates" 的节点更新为 step.update 协议事件
- 翻译 LangGraph __interrupt__ 为 interaction.request 协议事件
- 直接 forward stream_mode="custom" 的 envelope（Service 用 get_stream_writer 已写好）

不做：业务规则、block 构造、消息落库（均由 Service / AgentRuntimeService 负责）。
"""

from __future__ import annotations

import logging
from collections.abc import AsyncIterator
from typing import Any

from langgraph.graph.state import CompiledStateGraph
from langgraph.types import Interrupt

from app.llm.graphs.workflows.context import WorkflowRuntimeContext
from app.llm.graphs.workflows.step_labels import get_step_label
from app.schemas.agent.stream import AgentStreamEnvelope

logger = logging.getLogger(__name__)


class AgentWorkflowRunner:
    """统一两图执行的薄壳 Runner。"""

    def __init__(self, compiled_graph: CompiledStateGraph) -> None:
        self._graph = compiled_graph

    async def astream(
        self, *, thread_id: str, graph_input: Any, ctx: WorkflowRuntimeContext,
    ) -> AsyncIterator[AgentStreamEnvelope]:
        """运行图并 yield 协议事件。"""
        config = {"configurable": {"thread_id": thread_id, "ctx": ctx}}
        async for mode, payload in self._graph.astream(
            graph_input, config=config, stream_mode=["updates", "custom"],
        ):
            if mode == "updates":
                for env in self._translate_updates(payload, ctx):
                    yield env
            elif mode == "custom":
                # Service 内已构造好 envelope，直接 forward
                if isinstance(payload, AgentStreamEnvelope):
                    yield payload
                else:
                    logger.warning("custom stream 收到非 envelope 载荷，忽略：%r", payload)

    # ---------- 内部 ----------

    def _translate_updates(
        self, payload: dict[str, Any], ctx: WorkflowRuntimeContext,
    ) -> list[AgentStreamEnvelope]:
        """把一次节点 update 翻译为 step.update / interaction 事件序列。"""
        events: list[AgentStreamEnvelope] = []
        for node_name, update in payload.items():
            if node_name == "__interrupt__":
                items = update if isinstance(update, (list, tuple)) else [update]
                for item in items:
                    # 一次 interrupt 可能产出多条事件：block.start(interaction) + interaction.request
                    events.extend(self._translate_interrupt(item, ctx))
                continue
            # 节点名 → 中文友好提示；status=success 表示该节点已产出，
            # detail 用 running_detail 让前端把「最后一个 step」作为当前活跃步骤高亮
            title, running_detail, _success = get_step_label(node_name)
            events.append(ctx.emitter.emit_step(
                step_id=str(node_name),
                title=title,
                status="success",
                detail=running_detail,
            ))
        return events

    def _translate_interrupt(
        self, interrupt: Any, ctx: WorkflowRuntimeContext,
    ) -> list[AgentStreamEnvelope]:
        """翻译 LangGraph interrupt 为「block.start(interaction) + interaction.request」事件序列。

        发两条事件：
        1. block.start(type=interaction)：前端 reducer 据此插入 interaction block 并渲染卡片
        2. interaction.request：协议事件，保留用于步骤记录/调试日志，前端 reducer 不重复处理

        返回空列表表示载荷无法识别（不阻塞主流程）。
        """
        value = interrupt.value if isinstance(interrupt, Interrupt) else interrupt
        if not isinstance(value, dict):
            logger.warning("未识别的 interrupt 载荷：%r", interrupt)
            return []
        request_id = str(value.get("request_id") or "")
        interaction_type = value.get("interaction_type")
        title = str(value.get("title") or "请确认")
        prompt = str(value.get("prompt") or "")
        block_data = value.get("data") or {}
        # 1) 先发 block.start(interaction) 让前端立即渲染交互卡片骨架
        block_idx = ctx.emitter.next_block_index()
        block_payload = {
            "type": "interaction",
            "request_id": request_id,
            "interaction_type": interaction_type,
            "title": title,
            "prompt": prompt,
            "data": block_data,
            "status": "pending",
        }
        return [
            ctx.emitter.emit_block_start(index=block_idx, block=block_payload),
            # 2) 再发 interaction.request 协议事件（前端 reducer 静默忽略，仅供步骤记录使用）
            ctx.emitter.emit_interaction_request(
                request_id=request_id,
                interaction_type=interaction_type,
                title=title,
                prompt=prompt,
                schema=value.get("schema"),
                data=block_data,
            ),
        ]
