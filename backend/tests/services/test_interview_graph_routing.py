"""图一条件边路由集成测试：驳回/确认的路由正确性。

回归保护：interrupt resume 场景下，Command(goto) 会被静态边抢先执行下游节点，
改用 add_conditional_edges 后必须确保驳回正确回上游、确认正确进下游。
用产品真实路径（runner.astream + Command(resume)）验证。
"""

from __future__ import annotations

from unittest.mock import AsyncMock, MagicMock

import pytest
from langgraph.checkpoint.memory import MemorySaver
from langgraph.types import Command

from app.llm.graphs.workflows.context import WorkflowRuntimeContext
from app.llm.graphs.workflows.interview_questions import build_interview_graph
from app.llm.graphs.workflows.runner import AgentWorkflowRunner
from app.llm.streaming.emitter import AgentStreamEmitter
from app.schemas.agent.dto import LLMRuntimeConfigDTO
from pydantic import SecretStr


def _make_svc(calls: list[str]) -> MagicMock:
    """构造记录节点调用的 mock InterviewQuestionService。"""
    svc = MagicMock()
    svc.load_resume = AsyncMock(return_value={"resume_text": "R"})

    async def _suggest(state, ctx):
        calls.append("suggest_dimensions")
        return {"suggested_dimensions": [{"name": "d1", "reason": "r", "source": "ai"}]}

    async def _build_plan(state, ctx):
        calls.append("build_question_plan")
        return {"question_plan": {
            "total_questions": 1,
            "items": [{"dimension": "d1", "question_count": 1, "difficulty": "中等", "focus": "f"}],
            "summary": "s",
        }}

    async def _fanout(state, ctx):
        calls.append("fanout_generate_questions")
        return {"generated_questions": []}

    svc.suggest_dimensions = _suggest
    svc.build_question_plan = _build_plan
    svc.fanout_generate_questions = _fanout
    svc.reduce_questions = AsyncMock(return_value={"generated_questions": []})
    svc.finalize_question_set = AsyncMock(return_value={"question_set": {}})
    svc.build_dimension_interaction = MagicMock(return_value={
        "request_id": "dim_test", "interaction_type": "dimension_selection",
        "title": "t", "prompt": "p", "data": {"candidates": []},
    })
    svc.build_plan_interaction = MagicMock(return_value={
        "request_id": "plan_test", "interaction_type": "plan_approval",
        "title": "t", "prompt": "p", "data": {"plan": {}},
    })
    return svc


def _make_ctx(svc: MagicMock) -> WorkflowRuntimeContext:
    """构造运行时上下文。"""
    emitter = AgentStreamEmitter(session_id=1, run_id="r", workflow_type="interview_questions")
    runtime_cfg = LLMRuntimeConfigDTO(
        provider="other", base_url="x", api_key=SecretStr("k"), model_name="m",
    )
    return WorkflowRuntimeContext(
        emitter=emitter, runtime_config=runtime_cfg,
        interview_service=svc, evaluation_service=MagicMock(),
        resume_loader=MagicMock(), session_id=1, employee_id=2, run_id="r",
    )


async def _drain(runner: AgentWorkflowRunner, thread_id: str, graph_input, ctx) -> None:
    """消费 runner.astream 直到结束/中断（吞掉 interrupt 引发的异常）。"""
    try:
        async for _env in runner.astream(thread_id=thread_id, graph_input=graph_input, ctx=ctx):
            pass
    except Exception:
        # interrupt 或 mock 序列化异常均视为正常结束（本测试只关心节点调用序列）
        pass


@pytest.mark.asyncio
async def test_dimension_reject_returns_to_suggest_dimensions():
    """驳回维度选择后应回到 suggest_dimensions，不得误入 build_question_plan。

    回归 Bug：Command(goto) 在 interrupt resume 时被静态边抢先执行 build_question_plan。
    """
    calls: list[str] = []
    svc = _make_svc(calls)
    graph = build_interview_graph(MemorySaver())
    runner = AgentWorkflowRunner(graph)
    thread_id = "reject-thread"

    # 第一次：START → dimension interrupt
    await _drain(runner, thread_id,
                 {"resume_ref": {}, "validation_attempts": 0, "user_intent": "hi"}, _make_ctx(svc))
    assert calls == ["suggest_dimensions"]

    # 第二次：驳回
    calls.clear()
    await _drain(runner, thread_id,
                 Command(resume={"regenerate": True, "feedback": "重新建议"}), _make_ctx(svc))
    # 必须只回到 suggest_dimensions，绝不能出现 build_question_plan
    assert "build_question_plan" not in calls, "驳回误入了 build_question_plan（路由失效）"
    assert "suggest_dimensions" in calls, "驳回未回到 suggest_dimensions"


@pytest.mark.asyncio
async def test_dimension_confirm_enters_build_question_plan():
    """确认维度选择后应进入 build_question_plan。"""
    calls: list[str] = []
    svc = _make_svc(calls)
    graph = build_interview_graph(MemorySaver())
    runner = AgentWorkflowRunner(graph)
    thread_id = "confirm-thread"

    await _drain(runner, thread_id,
                 {"resume_ref": {}, "validation_attempts": 0, "user_intent": "hi"}, _make_ctx(svc))
    calls.clear()
    await _drain(runner, thread_id,
                 Command(resume={"selected_dimensions": [{"name": "d1"}]}), _make_ctx(svc))
    assert "build_question_plan" in calls, "确认后未进入 build_question_plan"


@pytest.mark.asyncio
async def test_plan_reject_returns_to_build_question_plan():
    """驳回出题计划后应回到 build_question_plan，不得误入 fanout_generate_questions。"""
    calls: list[str] = []
    svc = _make_svc(calls)
    graph = build_interview_graph(MemorySaver())
    runner = AgentWorkflowRunner(graph)
    thread_id = "plan-reject-thread"

    # 走到 dimension → 确认 → plan interrupt
    await _drain(runner, thread_id,
                 {"resume_ref": {}, "validation_attempts": 0, "user_intent": "hi"}, _make_ctx(svc))
    await _drain(runner, thread_id,
                 Command(resume={"selected_dimensions": [{"name": "d1"}]}), _make_ctx(svc))
    calls.clear()
    # plan 驳回
    await _drain(runner, thread_id,
                 Command(resume={"approved": False, "feedback": "题量太少"}), _make_ctx(svc))
    assert "fanout_generate_questions" not in calls, "plan 驳回误入了 fanout"
    assert "build_question_plan" in calls, "plan 驳回未回到 build_question_plan"


@pytest.mark.asyncio
async def test_plan_approve_enters_fanout():
    """批准出题计划后应进入 fanout_generate_questions。"""
    calls: list[str] = []
    svc = _make_svc(calls)
    graph = build_interview_graph(MemorySaver())
    runner = AgentWorkflowRunner(graph)
    thread_id = "plan-approve-thread"

    await _drain(runner, thread_id,
                 {"resume_ref": {}, "validation_attempts": 0, "user_intent": "hi"}, _make_ctx(svc))
    await _drain(runner, thread_id,
                 Command(resume={"selected_dimensions": [{"name": "d1"}]}), _make_ctx(svc))
    calls.clear()
    await _drain(runner, thread_id,
                 Command(resume={"approved": True}), _make_ctx(svc))
    assert "fanout_generate_questions" in calls, "plan 批准后未进入 fanout"
