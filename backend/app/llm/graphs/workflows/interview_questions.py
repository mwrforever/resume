"""简历问答工作流 LangGraph 构建器。"""

from __future__ import annotations

import uuid
from typing import Any

from langgraph.checkpoint.base import BaseCheckpointSaver
from langgraph.graph import END, START, StateGraph
from langgraph.graph.state import CompiledStateGraph
from langgraph.types import interrupt

from app.utils.cache_utils import AGENT_RESUME_TEXT_KEY, AGENT_RESUME_TEXT_TTL

from app.llm.graphs.workflows._checkpointer import get_default_checkpointer
from app.llm.graphs.workflows.state import InterviewQuestionState
from app.schemas.agent.dto import InterviewQuestionItemDTO, InterviewQuestionPlanDTO, InterviewQuestionPlanItemDTO, LLMRuntimeConfigDTO


def _get_service(state: InterviewQuestionState) -> Any:
    """从 ContextVar 读取面试题业务服务实例（不经过 State 序列化）。"""
    from app.llm.graphs.workflows._ctx import get_service as _ctx_get
    return _ctx_get("interview_question_service")


def _get_context_value(key: str) -> Any:
    """从 ContextVar 读取指定 key 的运行时对象（如 cache_service）。"""
    from app.llm.graphs.workflows._ctx import get_service as _ctx_get
    return _ctx_get(key)


def _runtime_config(state: InterviewQuestionState) -> LLMRuntimeConfigDTO:
    """
    构建 LLM 运行配置 DTO。

    Args:
        state: LangGraph state

    Returns:
        LLMRuntimeConfigDTO: 运行配置
    """
    return LLMRuntimeConfigDTO.model_validate(state.get("runtime_config") or {})


async def _load_resume_node(state: InterviewQuestionState) -> dict[str, Any]:
    """
    加载简历文本。

    Args:
        state: LangGraph state

    Returns:
        dict[str, Any]: state 更新
    """
    # 优先从 Redis 缓存获取已解析的简历文本，避免每次中断恢复后重新加载和解析
    resume_ref = state.get("resume_ref") or {}
    resume_id = int(resume_ref.get("resume_id") or 0)
    cache_svc = _get_context_value("cache_service")
    if cache_svc and resume_id > 0:
        cached_text = await cache_svc.get(AGENT_RESUME_TEXT_KEY.format(resume_id=resume_id))
        if cached_text:
            return {"resume_text": cached_text}

    # 缓存未命中，走正常加载流程
    service = _get_service(state)
    if service is None:
        return {"resume_text": ""}
    resume_text = await service.load_resume_text(employee_id=int(state.get("employee_id") or 0), resume_ref=state.get("resume_ref") or {})

    # 加载成功后写入缓存，后续中断恢复时可直接复用
    if cache_svc and resume_id > 0 and resume_text.strip():
        await cache_svc.set(
            AGENT_RESUME_TEXT_KEY.format(resume_id=resume_id), resume_text, AGENT_RESUME_TEXT_TTL)

    return {"resume_text": resume_text}


async def _suggest_dimensions_node(state: InterviewQuestionState) -> dict[str, Any]:
    """
    提议面试维度。

    Args:
        state: LangGraph state

    Returns:
        dict[str, Any]: state 更新
    """
    service = _get_service(state)
    if service is None:
        return {"suggested_dimensions": []}
    dimensions = await service.suggest_dimensions(resume_text=str(state.get("resume_text") or ""), runtime_config=_runtime_config(state))
    return {"suggested_dimensions": [item.model_dump(mode="json") for item in dimensions]}


def _request_dimension_selection_node(state: InterviewQuestionState) -> dict[str, Any]:
    """
    中断等待用户选择面试维度。

    Args:
        state: LangGraph state

    Returns:
        dict[str, Any]: state 更新
    """
    dimensions = state.get("suggested_dimensions") or []
    request_id = f"{state.get('run_id') or uuid.uuid4().hex}:dimension_selection"
    decision = interrupt(
        {
            "kind": "interaction",
            "request_id": request_id,
            "interaction_type": "dimension_selection",
            "title": "请选择面试重点",
            "prompt": "选择本次面试需要重点追问的维度。",
            "data": {"dimensions": dimensions},
            "submit_label": "确认选择",
        }
    )
    selected = []
    if isinstance(decision, dict):
        selected = decision.get("selected_dimensions") or decision.get("dimensions") or []
    if not selected:
        selected = [str(item.get("name")) for item in dimensions if isinstance(item, dict) and item.get("name")]
    return {"selected_dimensions": selected, "interaction_payload": decision if isinstance(decision, dict) else {}}


async def _build_question_plan_node(state: InterviewQuestionState) -> dict[str, Any]:
    """
    构建面试题计划。

    Args:
        state: LangGraph state

    Returns:
        dict[str, Any]: state 更新
    """
    service = _get_service(state)
    if service is None:
        return {"question_plan": {}}
    # 若是从 review 回流的重生成请求，则把上一轮反馈带入题目规划，引导 LLM 调整方向
    review_feedback = str(state.get("review_feedback") or "").strip()
    plan = await service.build_question_plan(
        resume_text=str(state.get("resume_text") or ""),
        selected_dimensions=list(state.get("selected_dimensions") or []),
        runtime_config=_runtime_config(state),
        review_feedback=review_feedback or None,
    )
    # 重生成后清空 review_decision，避免无限循环
    return {"question_plan": plan.model_dump(mode="json"), "review_decision": "", "review_feedback": ""}


def _request_plan_approval_node(state: InterviewQuestionState) -> dict[str, Any]:
    """
    中断等待用户审批面试题计划。

    Args:
        state: LangGraph state

    Returns:
        dict[str, Any]: state 更新
    """
    request_id = f"{state.get('run_id') or uuid.uuid4().hex}:plan_approval"
    decision = interrupt(
        {
            "kind": "interaction",
            "request_id": request_id,
            "interaction_type": "plan_approval",
            "title": "请确认面试题计划",
            "prompt": "确认后将开始生成结构化面试题。",
            "data": {"plan": state.get("question_plan") or {}},
            "submit_label": "批准生成",
        }
    )
    if isinstance(decision, dict) and decision.get("plan"):
        return {"question_plan": decision.get("plan"), "interaction_payload": decision}
    return {"interaction_payload": decision if isinstance(decision, dict) else {}}


async def _fanout_generate_questions_node(state: InterviewQuestionState) -> dict[str, Any]:
    """
    按计划生成面试题。

    Args:
        state: LangGraph state

    Returns:
        dict[str, Any]: state 更新
    """
    service = _get_service(state)
    if service is None:
        return {"question_items": []}
    plan = InterviewQuestionPlanDTO.model_validate(state.get("question_plan") or {"total_questions": 0, "items": [], "summary": ""})
    questions: list[InterviewQuestionItemDTO] = []
    for item in plan.items:
        questions.extend(
            await service.generate_questions_for_dimension(
                resume_text=str(state.get("resume_text") or ""),
                plan_item=InterviewQuestionPlanItemDTO.model_validate(item),
                runtime_config=_runtime_config(state),
            )
        )
    return {"question_items": [item.model_dump(mode="json") for item in questions]}


def _reduce_questions_node(state: InterviewQuestionState) -> dict[str, Any]:
    """
    汇总面试题结果。

    Args:
        state: LangGraph state

    Returns:
        dict[str, Any]: state 更新
    """
    return {"question_items": list(state.get("question_items") or [])}



def _request_question_review_node(state: InterviewQuestionState) -> dict[str, Any]:
    """
    中断等待用户对生成的题集进行人工批阅。

    交互协议：
        - interaction_type: 'question_review'
        - data.questions: 当前题集（供前端展示）
        - data.plan: 题目计划摘要（供前端展示分布）
        - 用户返回：{ 'decision': 'approve' | 'regenerate', 'feedback': str }

    Args:
        state: LangGraph state

    Returns:
        dict[str, Any]: state 更新，包含 review_decision / review_feedback
    """
    request_id = f"{state.get('run_id') or uuid.uuid4().hex}:question_review"
    decision = interrupt(
        {
            "kind": "interaction",
            "request_id": request_id,
            "interaction_type": "question_review",
            "title": "请批阅生成的面试题",
            "prompt": "通过后题集将作为最终结果交付；不通过将基于您的反馈重新生成。",
            "data": {
                "questions": list(state.get("question_items") or []),
                "plan": state.get("question_plan") or {},
            },
            "submit_label": "提交批阅意见",
        }
    )
    review_decision = "approve"
    feedback = ""
    if isinstance(decision, dict):
        raw_decision = str(decision.get("decision") or "").strip().lower()
        if raw_decision in {"regenerate", "reject", "rework"}:
            review_decision = "regenerate"
        feedback = str(decision.get("feedback") or "").strip()
    return {
        "review_decision": review_decision,
        "review_feedback": feedback,
        "interaction_payload": decision if isinstance(decision, dict) else {},
    }


def _route_after_review(state: InterviewQuestionState) -> str:
    """
    依据用户批阅意见决定下一节点：通过 → finalize；驳回 → 重新规划。

    Args:
        state: LangGraph state

    Returns:
        str: 下一节点名（finalize_question_set / build_question_plan）
    """
    # 用户反馈被驳回时回流到题目规划节点，由其在新一轮 prompt 中纳入反馈
    if str(state.get("review_decision") or "approve") == "regenerate":
        return "build_question_plan"
    return "finalize_question_set"

def _finalize_question_set_node(state: InterviewQuestionState) -> dict[str, Any]:
    """
    生成最终面试题卡片。

    Args:
        state: LangGraph state

    Returns:
        dict[str, Any]: state 更新
    """
    service = _get_service(state)
    question_items = [InterviewQuestionItemDTO.model_validate(item) for item in state.get("question_items") or []]
    block = service.build_question_set_block(question_items) if service is not None else {"type": "interview_question_set", "question_set": {"questions": []}}
    return {"final_text": "面试题清单已生成。", "final_blocks": [block]}


def build_interview_question_graph(*, checkpointer: BaseCheckpointSaver | None = None) -> CompiledStateGraph:
    """
    编译简历问答工作流图。

    Args:
        checkpointer: LangGraph checkpoint saver

    Returns:
        CompiledStateGraph: 已编译工作流图
    """
    graph = StateGraph(InterviewQuestionState)
    graph.add_node("load_resume", _load_resume_node)
    graph.add_node("suggest_dimensions", _suggest_dimensions_node)
    graph.add_node("request_dimension_selection", _request_dimension_selection_node)
    graph.add_node("build_question_plan", _build_question_plan_node)
    graph.add_node("request_plan_approval", _request_plan_approval_node)
    graph.add_node("fanout_generate_questions", _fanout_generate_questions_node)
    graph.add_node("reduce_questions", _reduce_questions_node)
    graph.add_node("request_question_review", _request_question_review_node)
    graph.add_node("finalize_question_set", _finalize_question_set_node)
    graph.add_edge(START, "load_resume")
    graph.add_edge("load_resume", "suggest_dimensions")
    graph.add_edge("suggest_dimensions", "request_dimension_selection")
    graph.add_edge("request_dimension_selection", "build_question_plan")
    graph.add_edge("build_question_plan", "request_plan_approval")
    graph.add_edge("request_plan_approval", "fanout_generate_questions")
    graph.add_edge("fanout_generate_questions", "reduce_questions")
    graph.add_edge("reduce_questions", "request_question_review")
    # 条件路由：审批通过 → 终结；审批驳回 → 回到题目规划节点（携带反馈重生成）
    graph.add_conditional_edges(
        "request_question_review",
        _route_after_review,
        {
            "finalize_question_set": "finalize_question_set",
            "build_question_plan": "build_question_plan",
        },
    )
    graph.add_edge("finalize_question_set", END)
    return graph.compile(checkpointer=checkpointer or get_default_checkpointer())