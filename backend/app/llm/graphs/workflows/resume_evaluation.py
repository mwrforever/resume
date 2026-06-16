"""
图二：简历评估 workflow graph。

节点为薄包装，仅调 ctx.evaluation_service.*；业务规则全在 Service 内。
"""

from __future__ import annotations

from typing import Any

from langgraph.checkpoint.base import BaseCheckpointSaver
from langgraph.graph import END, START, StateGraph
from langgraph.graph.state import CompiledStateGraph
from langgraph.types import Command, interrupt

from app.llm.graphs.workflows.context import WorkflowRuntimeContext
from app.llm.graphs.workflows.state import ResumeEvaluationState


# ---------- 节点函数 ----------

async def _load_resume(state: ResumeEvaluationState, config) -> dict:
    """读取简历原文。"""
    ctx: WorkflowRuntimeContext = config["configurable"]["ctx"]
    return await ctx.evaluation_service.load_resume(state, ctx)


async def _analyze_resume_profile(state: ResumeEvaluationState, config) -> dict:
    """AI 分析简历画像。"""
    ctx: WorkflowRuntimeContext = config["configurable"]["ctx"]
    return await ctx.evaluation_service.analyze_resume_profile(state, ctx)


async def _load_job_candidates(state: ResumeEvaluationState, config) -> dict:
    """加载候选岗位列表。"""
    ctx: WorkflowRuntimeContext = config["configurable"]["ctx"]
    return await ctx.evaluation_service.load_job_candidates(state, ctx)


async def _request_job_selection(state: ResumeEvaluationState, config) -> Command:
    """请求用户选择岗位（interrupt）。

    支持两种用户回执：
    - {selected_job_name}            → 确认选岗
    - {regenerate: true, feedback?}  → 驳回：回 load_job_candidates 重新加载候选岗
    """
    ctx: WorkflowRuntimeContext = config["configurable"]["ctx"]
    payload = ctx.evaluation_service.build_job_interaction(state)
    user_values = interrupt(payload)
    if user_values.get("regenerate"):
        return Command(
            goto="load_job_candidates",
            update={
                "selected_job_name": "",
                "validation_attempts": 0,
                "job_feedback": str(user_values.get("feedback") or ""),
            },
        )
    # 字段名严格对齐前端 InteractionBlock JobSelection 提交的 { selected_job_name }
    return Command(update={"selected_job_name": str(user_values.get("selected_job_name") or "")})


async def _validate_job_full_name(state: ResumeEvaluationState, config) -> Command:
    """校验岗位全名与员工归属；失败循环回选岗（最多 3 次）。"""
    ctx: WorkflowRuntimeContext = config["configurable"]["ctx"]
    try:
        job_full = await ctx.evaluation_service.validate_job(state, ctx)
        return Command(update={"job_full": job_full})
    except Exception as exc:
        attempts = int(state.get("validation_attempts", 0)) + 1
        if attempts >= 3:
            raise RuntimeError("job_validation_exhausted") from exc
        return Command(goto="request_job_selection", update={"validation_attempts": attempts})


async def _run_evaluation_subgraph(state: ResumeEvaluationState, config) -> dict:
    """调用评估子图。"""
    ctx: WorkflowRuntimeContext = config["configurable"]["ctx"]
    return await ctx.evaluation_service.run_evaluation_subgraph(state, ctx)


async def _build_visualization_report(state: ResumeEvaluationState, config) -> dict:
    """组装可视化报告数据。"""
    ctx: WorkflowRuntimeContext = config["configurable"]["ctx"]
    return await ctx.evaluation_service.build_visualization_report(state, ctx)


async def _finalize_evaluation_report(state: ResumeEvaluationState, config) -> dict:
    """输出评估报告 block。"""
    ctx: WorkflowRuntimeContext = config["configurable"]["ctx"]
    return await ctx.evaluation_service.finalize_evaluation_report(state, ctx)


# ---------- 图构造 ----------

def _route_after_profile(state: ResumeEvaluationState) -> str:
    """画像分析后的条件路由：简历原文为空时直接短路到 END，不再加载岗位与评估。

    覆盖简历解析失败/未上传场景：画像节点已对空简历跳过 LLM 直接返回 {}，
    这里据此短路，避免后续 load_job_candidates 让用户进入一个注定失败的选岗流程。
    """
    if not str(state.get("resume_text") or "").strip():
        return END
    return "load_job_candidates"


def build_evaluation_graph(checkpointer: BaseCheckpointSaver) -> CompiledStateGraph:
    """构造并编译图二。"""
    graph = StateGraph(ResumeEvaluationState)
    graph.add_node("load_resume", _load_resume)
    graph.add_node("analyze_resume_profile", _analyze_resume_profile)
    graph.add_node("load_job_candidates", _load_job_candidates)
    graph.add_node("request_job_selection", _request_job_selection)
    graph.add_node("validate_job_full_name", _validate_job_full_name)
    graph.add_node("run_evaluation_subgraph", _run_evaluation_subgraph)
    graph.add_node("build_visualization_report", _build_visualization_report)
    graph.add_node("finalize_evaluation_report", _finalize_evaluation_report)

    graph.add_edge(START, "load_resume")
    graph.add_edge("load_resume", "analyze_resume_profile")
    # 简历为空时短路到 END，不再走选岗/评估（空简历兜底）
    graph.add_conditional_edges(
        "analyze_resume_profile",
        _route_after_profile,
        {END: END, "load_job_candidates": "load_job_candidates"},
    )
    graph.add_edge("load_job_candidates", "request_job_selection")
    graph.add_edge("request_job_selection", "validate_job_full_name")
    graph.add_edge("validate_job_full_name", "run_evaluation_subgraph")
    graph.add_edge("run_evaluation_subgraph", "build_visualization_report")
    graph.add_edge("build_visualization_report", "finalize_evaluation_report")
    graph.add_edge("finalize_evaluation_report", END)

    return graph.compile(checkpointer=checkpointer)
