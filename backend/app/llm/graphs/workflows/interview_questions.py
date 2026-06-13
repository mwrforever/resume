"""
图一：简历问答 workflow graph。

节点为薄包装，仅调 ctx.interview_service.*；业务规则全在 Service 内。
"""

from __future__ import annotations

from langgraph.checkpoint.base import BaseCheckpointSaver
from langgraph.graph import END, START, StateGraph
from langgraph.graph.state import CompiledStateGraph
from langgraph.types import Command, interrupt

from app.llm.graphs.workflows.context import WorkflowRuntimeContext
from app.llm.graphs.workflows.state import InterviewQuestionState


# ---------- 节点函数（≤10 行） ----------

async def _load_resume(state: InterviewQuestionState, config) -> dict:
    """读取简历原文。"""
    ctx: WorkflowRuntimeContext = config["configurable"]["ctx"]
    return await ctx.interview_service.load_resume(state, ctx)


async def _suggest_dimensions(state: InterviewQuestionState, config) -> dict:
    """AI 提议面试维度。"""
    ctx: WorkflowRuntimeContext = config["configurable"]["ctx"]
    return await ctx.interview_service.suggest_dimensions(state, ctx)


async def _request_dimension_selection(state: InterviewQuestionState, config) -> Command:
    """请求用户选择维度（interrupt）。

    用户可在卡片中携带 user_feedback 字段表达"补充意见或追加维度"，
    将其透传至 state.dimension_feedback，供后续 build_question_plan 注入 prompt。
    """
    ctx: WorkflowRuntimeContext = config["configurable"]["ctx"]
    payload = ctx.interview_service.build_dimension_interaction(state)
    user_values = interrupt(payload)
    update: dict = {"selected_dimensions": user_values.get("selected_dimensions", [])}
    feedback = str(user_values.get("user_feedback") or "").strip()
    if feedback:
        update["dimension_feedback"] = feedback
    return Command(update=update)


async def _build_question_plan(state: InterviewQuestionState, config) -> dict:
    """生成出题计划。"""
    ctx: WorkflowRuntimeContext = config["configurable"]["ctx"]
    return await ctx.interview_service.build_question_plan(state, ctx)


async def _request_plan_approval(state: InterviewQuestionState, config) -> Command:
    """请求用户审批出题计划（interrupt）。

    支持三种用户回执：
    - {approved: true}                  → 走 fanout 生成
    - {approved: true, edited_plan}     → 用编辑后的计划替换 state.question_plan，再 fanout
    - {approved: false, feedback: ...}  → 携反馈循环回 build_question_plan
    """
    ctx: WorkflowRuntimeContext = config["configurable"]["ctx"]
    payload = ctx.interview_service.build_plan_interaction(state)
    user_values = interrupt(payload)
    if user_values.get("approved"):
        update: dict = {"plan_approved": True}
        edited = user_values.get("edited_plan")
        if isinstance(edited, dict) and edited.get("items"):
            # 用前端编辑后的计划覆盖原 plan，保证 fanout_generate_questions 按编辑值出题
            update["question_plan"] = edited
        return Command(goto="fanout_generate_questions", update=update)
    # 驳回：循环回 build_question_plan，携带 HR 反馈
    return Command(
        goto="build_question_plan",
        update={"question_plan": {**state["question_plan"], "_feedback": user_values.get("feedback", "")}},
    )


async def _fanout_generate_questions(state: InterviewQuestionState, config) -> dict:
    """并发为每个维度生成题目。"""
    ctx: WorkflowRuntimeContext = config["configurable"]["ctx"]
    return await ctx.interview_service.fanout_generate_questions(state, ctx)


async def _reduce_questions(state: InterviewQuestionState, config) -> dict:
    """汇总并裁剪题目到 8-12 题。"""
    ctx: WorkflowRuntimeContext = config["configurable"]["ctx"]
    return await ctx.interview_service.reduce_questions(state, ctx)


async def _finalize_question_set(state: InterviewQuestionState, config) -> dict:
    """最终输出面试题清单 block。"""
    ctx: WorkflowRuntimeContext = config["configurable"]["ctx"]
    return await ctx.interview_service.finalize_question_set(state, ctx)


# ---------- 图构造 ----------

def build_interview_graph(checkpointer: BaseCheckpointSaver) -> CompiledStateGraph:
    """构造并编译图一。"""
    graph = StateGraph(InterviewQuestionState)
    graph.add_node("load_resume", _load_resume)
    graph.add_node("suggest_dimensions", _suggest_dimensions)
    graph.add_node("request_dimension_selection", _request_dimension_selection)
    graph.add_node("build_question_plan", _build_question_plan)
    graph.add_node("request_plan_approval", _request_plan_approval)
    graph.add_node("fanout_generate_questions", _fanout_generate_questions)
    graph.add_node("reduce_questions", _reduce_questions)
    graph.add_node("finalize_question_set", _finalize_question_set)

    graph.add_edge(START, "load_resume")
    graph.add_edge("load_resume", "suggest_dimensions")
    graph.add_edge("suggest_dimensions", "request_dimension_selection")
    graph.add_edge("request_dimension_selection", "build_question_plan")
    graph.add_edge("build_question_plan", "request_plan_approval")
    graph.add_edge("request_plan_approval", "fanout_generate_questions")
    graph.add_edge("fanout_generate_questions", "reduce_questions")
    graph.add_edge("reduce_questions", "finalize_question_set")
    graph.add_edge("finalize_question_set", END)

    return graph.compile(checkpointer=checkpointer)
