"""
LangGraph 工作流薄壳 Runner。

职责：
- 通过 config["configurable"]["ctx"] 注入 WorkflowRuntimeContext 到节点闭包
- 翻译 stream_mode="tasks" 的「节点开始 / 结束 / 失败 / 中断」为 step.update 协议事件
- 翻译节点 interrupt 为 interaction.request 协议事件
- 直接 forward stream_mode="custom" 的 envelope（Service 用 get_stream_writer 已写好）

为什么用 tasks 而非 updates：
- updates 模式仅在节点**完成后**触发一次，无法表达「运行中」态，导致前端步骤条
  里耗时节点（如 LLM 分析维度）整个执行期间无任何反馈，完成瞬间直接跳 success，
  下一节点开始时又无事件 → 视觉上「阶段被跳过 / 无运行中感知」。
- tasks 模式为每个任务发**两条**事件：
  * 开始：{id, name, input, triggers}（无 result/error）→ 翻译为 step.update(running)
  * 结束：{id, name, error, result, interrupts}
      - interrupts 非空 → 该节点触发 interrupt（等用户），翻译为交互事件，不标 success
      - error 非空 → 节点抛异常，翻译为 step.update(failed)（随后 astream 会 raise）
      - 否则 → 节点正常产出，翻译为 step.update(success)

不做：业务规则、block 构造、消息落库（均由 Service / AgentRuntimeService 负责）。
"""

from __future__ import annotations

import logging
from collections.abc import AsyncIterator
from typing import Any

from langgraph.graph.state import CompiledStateGraph

from app.llm.graphs.workflows.context import WorkflowRuntimeContext
from app.llm.graphs.workflows.step_labels import get_step_label
from app.schemas.agent.stream import AgentStreamEnvelope

logger = logging.getLogger(__name__)

# LangGraph 内部/隐藏节点名前缀：tasks 流可能混入 __start__ 等框架节点，
# 这些不对应业务步骤，翻译时跳过（避免步骤条出现无意义条目）。
_HIDDEN_NODE_PREFIX = "__"


class AgentWorkflowRunner:
    """统一两图执行的薄壳 Runner。"""

    def __init__(self, compiled_graph: CompiledStateGraph) -> None:
        self._graph = compiled_graph

    async def astream(
        self, *, thread_id: str, graph_input: Any, ctx: WorkflowRuntimeContext,
    ) -> AsyncIterator[AgentStreamEnvelope]:
        """运行图并 yield 协议事件。

        注意：tasks 模式下节点抛异常时，结束事件携带 error，本方法会先 yield
        step.update(failed)，随后 graph.astream 会向上抛出该异常 —— 由 Service 层
        （AgentRuntimeService）的 except 捕获并 emit run.error，本 Runner 不吞异常。
        """
        config = {"configurable": {"thread_id": thread_id, "ctx": ctx}}
        async for mode, payload in self._graph.astream(
            graph_input, config=config, stream_mode=["tasks", "custom"],
        ):
            if mode == "tasks":
                for env in self._translate_task(payload, ctx):
                    yield env
            elif mode == "custom":
                # Service 内已构造好 envelope，直接 forward
                if isinstance(payload, AgentStreamEnvelope):
                    yield payload
                else:
                    logger.warning("custom stream 收到非 envelope 载荷，忽略：%r", payload)

    async def astream_resume_with_update(
        self, *, thread_id: str, update_values: dict[str, Any], ctx: WorkflowRuntimeContext,
    ) -> AsyncIterator[AgentStreamEnvelope]:
        """中断后续接同 thread（Q2"先 update，后 None"）。

        场景：用户在 interaction 暂停态点中断后发新消息，期望续在同一 workflow 上下文
        （已加载简历/已选维度等 state 不丢），而非隔离到新 thread 重跑。

        做法：
        1. 先 aupdate_state 把新消息注入对应 state 通道（图一 user_intent、图二 job_feedback）
        2. 后 astream(None) 续接：interrupt 节点收到 None 时由各自的 None 容忍分支
           视作"驳回并用注入的新消息作为反馈"重新推导，复用同 thread 的 checkpoint 上下文。

        @param update_values: 注入到 checkpoint state 的通道更新（由调用方按工作流类型组装）
        """
        config = {"configurable": {"thread_id": thread_id, "ctx": ctx}}
        # 1) 先 update：把新消息写进 state（持久化到 checkpoint，resume 后节点可读）
        await self._graph.aupdate_state(config, update_values)
        # 2) 后 None：从 checkpoint 续接，interrupt 返回 None 由节点容忍处理
        async for mode, payload in self._graph.astream(
            None, config=config, stream_mode=["tasks", "custom"],
        ):
            if mode == "tasks":
                for env in self._translate_task(payload, ctx):
                    yield env
            elif mode == "custom":
                if isinstance(payload, AgentStreamEnvelope):
                    yield payload
                else:
                    logger.warning("custom stream 收到非 envelope 载荷，忽略：%r", payload)

    # ---------- 内部 ----------

    def _translate_task(
        self, payload: dict[str, Any], ctx: WorkflowRuntimeContext,
    ) -> list[AgentStreamEnvelope]:
        """把一个 tasks 事件翻译为 step.update / interaction 事件序列。

        payload 形态（langgraph stream_mode="tasks"）：
        - 开始：{"id", "name", "input", "triggers"}（无 "result"/"error"/"interrupts" 或为 None）
        - 结束：{"id", "name", "error", "result", "interrupts"}

        @param payload 单个 task 事件 dict
        @param ctx 运行时上下文（emitter）
        @return 协议事件列表（可能为空）
        """
        node_name = str(payload.get("name") or "")
        # 跳过框架隐藏节点（__start__ 等）：不对应业务步骤
        if not node_name or node_name.startswith(_HIDDEN_NODE_PREFIX):
            return []

        title, running_detail, success_detail = get_step_label(node_name)

        # 区分「开始」与「结束」：结束事件含 error / result / interrupts 键，开始事件只有 input/triggers
        is_result = "error" in payload or "result" in payload or "interrupts" in payload
        if not is_result:
            # 节点开始 → 运行中
            return [ctx.emitter.emit_step(
                step_id=node_name, title=title, status="running", detail=running_detail,
            )]

        # —— 节点结束：失败优先（失败终态语义强于中断）——
        # 1) 失败：error 非空 → 节点抛异常，标 failed（astream 随后会 raise，Service emit run.error）。
        #    error 优先于 interrupts 判定：LangGraph 实际不会同时产出二者，但若协议层并存，
        #    失败终态应压过"暂停等待"，避免前端只见交互卡却流被切断。
        error = payload.get("error")
        if error is not None:
            return [ctx.emitter.emit_step(
                step_id=node_name, title=title, status="failed",
                detail=f"{title}失败：{error}",
            )]

        # 2) 中断：interrupts 非空 → 该节点触发 interrupt 等待用户，翻译交互事件，不标 success
        interrupts = payload.get("interrupts") or []
        if interrupts:
            events: list[AgentStreamEnvelope] = []
            for item in interrupts:
                events.extend(self._translate_interrupt(item, ctx))
            return events

        # 3) 正常完成 → success
        return [ctx.emitter.emit_step(
            step_id=node_name, title=title, status="success", detail=success_detail,
        )]

    def _translate_interrupt(
        self, interrupt: Any, ctx: WorkflowRuntimeContext,
    ) -> list[AgentStreamEnvelope]:
        """翻译 LangGraph interrupt 为「block.start(interaction) + interaction.request」事件序列。

        发两条事件：
        1. block.start(type=interaction)：前端 reducer 据此插入 interaction block 并渲染卡片
        2. interaction.request：协议事件，保留用于步骤记录/调试日志，前端 reducer 不重复处理

        tasks 流模式下 interrupt 项是 dict：{"value": {...业务载荷...}, "id": "..."}；
        兼容直接传入业务载荷 dict 的形态（防御性）。返回空列表表示载荷无法识别（不阻塞主流程）。
        """
        # tasks 模式：{"value": {...}, "id": ...}；取出 value 作为业务载荷
        if isinstance(interrupt, dict) and "value" in interrupt:
            value = interrupt.get("value")
        else:
            value = interrupt
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
