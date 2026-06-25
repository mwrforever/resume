"""AgentWorkflowRunner：tasks 流模式 → step.update / interaction 协议翻译。

回归点：旧 updates 模式只在节点完成后发一次 success，导致前端步骤条无"运行中"
态、耗时节点像被跳过。新 tasks 模式为每节点发开始/结束事件，runner 据此翻译出
running → success/failed 完整时序，并把 interrupt 翻译为交互事件。
"""

from __future__ import annotations

from typing import TypedDict

import pytest
from langgraph.checkpoint.memory import MemorySaver
from langgraph.graph import END, START, StateGraph
from langgraph.types import Command, interrupt

from app.llm.graphs.workflows.runner import AgentWorkflowRunner
from app.llm.streaming.emitter import AgentStreamEmitter


class _State(TypedDict, total=False):
    """测试用最小图状态。"""
    x: int


def _make_ctx():
    """构造仅含 emitter 的轻量 ctx（runner 只用到 ctx.emitter）。"""
    class _Ctx:
        def __init__(self) -> None:
            self.emitter = AgentStreamEmitter(
                session_id=1, run_id="r1", workflow_type="interview_questions",
            )
    return _Ctx()


def _build_graph(*, boom: bool = False, with_interrupt: bool = False):
    """构造一个最小可执行图：load_resume → [interrupt?] → [boom?] → END。

    节点名复用真实业务节点名，以便命中 step_labels 的中文映射。
    """
    async def _load_resume(state: _State, config) -> dict:
        return {"x": 1}

    async def _request_dimension_selection(state: _State, config) -> dict:
        interrupt({
            "request_id": "dim_1", "interaction_type": "dimension_selection",
            "title": "选择维度", "prompt": "多选", "data": {"candidates": []},
        })
        return {"x": 2}

    async def _build_question_plan(state: _State, config) -> dict:
        if boom:
            raise RuntimeError("LLM 调用失败")
        return {"x": 3}

    graph = StateGraph(_State)
    graph.add_node("load_resume", _load_resume)
    last = "load_resume"
    graph.add_edge(START, "load_resume")
    if with_interrupt:
        graph.add_node("request_dimension_selection", _request_dimension_selection)
        graph.add_edge(last, "request_dimension_selection")
        last = "request_dimension_selection"
    if boom:
        graph.add_node("build_question_plan", _build_question_plan)
        graph.add_edge(last, "build_question_plan")
        last = "build_question_plan"
    graph.add_edge(last, END)
    return graph.compile(checkpointer=MemorySaver())


@pytest.mark.asyncio
async def test_node_emits_running_then_success():
    """正常节点：先发 step.update(running)，再发 step.update(success)。"""
    runner = AgentWorkflowRunner(_build_graph())
    ctx = _make_ctx()
    steps: list[tuple[str, str]] = []
    async for env in runner.astream(thread_id="t1", graph_input={"x": 0}, ctx=ctx):
        if env.type == "step.update":
            steps.append((env.data["step_id"], env.data["status"]))
    # load_resume 应有 running → success 两条
    assert ("load_resume", "running") in steps
    assert ("load_resume", "success") in steps
    # running 必须先于 success（时序正确）
    assert steps.index(("load_resume", "running")) < steps.index(("load_resume", "success"))


@pytest.mark.asyncio
async def test_failed_node_emits_failed_and_raises():
    """节点抛异常：发 step.update(failed) 且 astream 向上抛异常（不吞）。"""
    runner = AgentWorkflowRunner(_build_graph(boom=True))
    ctx = _make_ctx()
    steps: list[tuple[str, str]] = []
    with pytest.raises(RuntimeError, match="LLM 调用失败"):
        async for env in runner.astream(thread_id="t2", graph_input={"x": 0}, ctx=ctx):
            if env.type == "step.update":
                steps.append((env.data["step_id"], env.data["status"]))
    # build_question_plan 应先 running，最终 failed（而非 success）
    assert ("build_question_plan", "running") in steps
    assert ("build_question_plan", "failed") in steps
    assert ("build_question_plan", "success") not in steps


@pytest.mark.asyncio
async def test_interrupt_emits_interaction_not_success():
    """中断节点：翻译为 block.start(interaction) + interaction.request，不标 success。"""
    runner = AgentWorkflowRunner(_build_graph(with_interrupt=True))
    ctx = _make_ctx()
    types: list[str] = []
    step_statuses: list[tuple[str, str]] = []
    async for env in runner.astream(thread_id="t3", graph_input={"x": 0}, ctx=ctx):
        types.append(env.type)
        if env.type == "step.update":
            step_statuses.append((env.data["step_id"], env.data["status"]))
    # 中断节点应产出交互事件
    assert "block.start" in types
    assert "interaction.request" in types
    # 中断节点不应被标记 success（它在等用户，尚未完成）
    assert ("request_dimension_selection", "success") not in step_statuses
    # 但应有 running（节点已开始执行）
    assert ("request_dimension_selection", "running") in step_statuses
