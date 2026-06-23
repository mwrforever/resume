"""
图一：简历问答 workflow graph。

节点为薄包装，仅调 ctx.interview_service.*；业务规则全在 Service 内。
"""

from __future__ import annotations

from langgraph.checkpoint.base import BaseCheckpointSaver
from langgraph.graph import END, START, StateGraph
from langgraph.graph.state import CompiledStateGraph
from langgraph.types import interrupt

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


async def _request_dimension_selection(state: InterviewQuestionState, config) -> dict:
    """请求用户选择维度（interrupt）。

    支持两种用户回执：
    - {selected_dimensions, user_feedback?}    → 确认选择，由条件边进入 build_question_plan
    - {regenerate: true, feedback?}            → 驳回：写入 dimension_rejected=True，
      由条件边回到 suggest_dimensions 重新建议

    不返回 Command(goto)：interrupt resume 场景下 Command(goto) 会被静态边抢先执行
    （先跑下游节点再跳转），改用 add_conditional_edges 显式路由规避此问题。

    None 容忍：中断后用户不发回执而是"发新消息续接"时（Q2），Runner 以 update_state
    注入新意图 + astream(None) 续接，interrupt() 返回 None。此时视作"驳回并用新消息
    作为反馈重新建议维度"，feedback 取自 state.dimension_feedback（由 update_state 写入），
    避免对 None 调 .get 崩溃，同时让新消息驱动维度重算。
    """
    ctx: WorkflowRuntimeContext = config["configurable"]["ctx"]
    payload = ctx.interview_service.build_dimension_interaction(state)
    user_values = interrupt(payload)
    # None 容忍：续接（astream None）场景 → 视作驳回，反馈取自 state（update_state 注入的新消息）
    if not isinstance(user_values, dict):
        user_values = {"regenerate": True}
    feedback = str(
        user_values.get("feedback") or user_values.get("user_feedback")
        or state.get("dimension_feedback") or state.get("user_intent") or ""
    ).strip()
    if user_values.get("regenerate") or not user_values:
        # 驳回：记录标志 + feedback + 用户分类反馈（已采纳保留、已否决替换），
        # 由条件边 _route_after_dimension_selection 决定回 suggest_dimensions
        return {
            "dimension_rejected": True,
            "dimension_feedback": feedback,
            "accepted_dimensions": user_values.get("accepted_dimensions", []),
            "rejected_dimensions": user_values.get("rejected_dimensions", []),
        }
    # 确认：记录所选维度，由条件边进入 build_question_plan
    return {
        "selected_dimensions": user_values.get("selected_dimensions", []),
        "dimension_rejected": False,
        **({"dimension_feedback": feedback} if feedback else {}),
    }


async def _build_question_plan(state: InterviewQuestionState, config) -> dict:
    """生成出题计划。"""
    ctx: WorkflowRuntimeContext = config["configurable"]["ctx"]
    return await ctx.interview_service.build_question_plan(state, ctx)


async def _request_plan_approval(state: InterviewQuestionState, config) -> dict:
    """请求用户审批出题计划（interrupt）。

    支持三种用户回执：
    - {approved: true}                  → 确认，由条件边进入 fanout_generate_questions
    - {approved: true, edited_plan}     → 用编辑后的计划替换 state.question_plan，再 fanout
    - {approved: false, feedback: ...}  → 驳回：写入 plan_rejected=True，
      由条件边回到 build_question_plan 重新规划

    不返回 Command(goto)，原因同 _request_dimension_selection（条件边规避 resume 路由竞态）。

    None 容忍：中断后用户"发新消息续接"时（Q2），interrupt() 返回 None。此时视作
    "驳回并用新消息作为反馈重新规划"，feedback 取自 state.question_plan._feedback
    （由 update_state 注入的新消息），避免对 None 调 .get 崩溃。
    """
    ctx: WorkflowRuntimeContext = config["configurable"]["ctx"]
    payload = ctx.interview_service.build_plan_interaction(state)
    user_values = interrupt(payload)
    # None 容忍：续接场景 → 视作驳回，反馈取自 state（update_state 注入的新消息）
    if not isinstance(user_values, dict):
        user_values = {"approved": False}
    if user_values.get("approved"):
        update: dict = {"plan_approved": True, "plan_rejected": False}
        edited = user_values.get("edited_plan")
        if isinstance(edited, dict) and edited.get("items"):
            # 用前端编辑后的计划覆盖原 plan，保证 fanout 按编辑值出题
            update["question_plan"] = edited
        return update
    # 驳回：携带 HR 反馈，由条件边 _route_after_plan_approval 回 build_question_plan。
    # None 续接场景下反馈取自 state.user_intent（update_state 注入的新消息）
    return {
        "plan_rejected": True,
        "plan_approved": False,
        "question_plan": {**state["question_plan"], "_feedback": user_values.get("feedback") or state.get("user_intent", "")},
    }


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


# ---------- 条件路由 ----------

def _route_after_dimension_selection(state: InterviewQuestionState) -> str:
    """维度选择后的条件路由：驳回 → 回 suggest_dimensions；确认 → build_question_plan。

    用条件边而非节点内 Command(goto)：interrupt resume 场景下 Command(goto) 会被
    静态边抢先执行下游节点（实测先跑 build_question_plan 再跳转），导致驳回失效。
    """
    if state.get("dimension_rejected"):
        return "suggest_dimensions"
    return "build_question_plan"


def _route_after_plan_approval(state: InterviewQuestionState) -> str:
    """计划审批后的条件路由：驳回 → 回 build_question_plan；批准 → fanout_generate_questions。"""
    if state.get("plan_rejected"):
        return "build_question_plan"
    return "fanout_generate_questions"


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
    # 维度选择后用条件边路由（驳回/确认），而非静态边 + Command(goto)
    graph.add_conditional_edges(
        "request_dimension_selection",
        _route_after_dimension_selection,
        {"suggest_dimensions": "suggest_dimensions", "build_question_plan": "build_question_plan"},
    )
    graph.add_edge("build_question_plan", "request_plan_approval")
    # 计划审批后用条件边路由（驳回/批准），而非静态边 + Command(goto)
    graph.add_conditional_edges(
        "request_plan_approval",
        _route_after_plan_approval,
        {"build_question_plan": "build_question_plan", "fanout_generate_questions": "fanout_generate_questions"},
    )
    graph.add_edge("fanout_generate_questions", "reduce_questions")
    graph.add_edge("reduce_questions", "finalize_question_set")
    graph.add_edge("finalize_question_set", END)

    return graph.compile(checkpointer=checkpointer)
