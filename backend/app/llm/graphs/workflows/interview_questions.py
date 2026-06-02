"""简历问答工作流 LangGraph 构建器。"""

from __future__ import annotations

import uuid
from typing import Any

from langgraph.checkpoint.base import BaseCheckpointSaver
from langgraph.graph import END, START, StateGraph
from langgraph.graph.state import CompiledStateGraph
from langgraph.types import interrupt

from app.llm.graphs.coordinator.checkpointer import get_default_checkpointer
from app.llm.graphs.workflows.state import InterviewQuestionState
from app.schemas.agent.dto import InterviewQuestionItemDTO, InterviewQuestionPlanDTO, InterviewQuestionPlanItemDTO, LLMRuntimeConfigDTO


def _get_service(state: InterviewQuestionState) -> Any:
    """
    获取面试题工作流业务服务。

    Args:
        state: LangGraph state

    Returns:
        Any: 注入的业务服务
    """
    service_context = state.get("service_context") or {}
    if isinstance(service_context, dict):
        return service_context.get("interview_question_service")
    return getattr(service_context, "interview_question_service", None)


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
    service = _get_service(state)
    if service is None:
        return {"resume_text": ""}
    resume_text = await service.load_resume_text(employee_id=int(state.get("employee_id") or 0), resume_ref=state.get("resume_ref") or {})
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
    plan = await service.build_question_plan(
        resume_text=str(state.get("resume_text") or ""),
        selected_dimensions=list(state.get("selected_dimensions") or []),
        runtime_config=_runtime_config(state),
    )
    return {"question_plan": plan.model_dump(mode="json")}


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
    graph.add_node("finalize_question_set", _finalize_question_set_node)
    graph.add_edge(START, "load_resume")
    graph.add_edge("load_resume", "suggest_dimensions")
    graph.add_edge("suggest_dimensions", "request_dimension_selection")
    graph.add_edge("request_dimension_selection", "build_question_plan")
    graph.add_edge("build_question_plan", "request_plan_approval")
    graph.add_edge("request_plan_approval", "fanout_generate_questions")
    graph.add_edge("fanout_generate_questions", "reduce_questions")
    graph.add_edge("reduce_questions", "finalize_question_set")
    graph.add_edge("finalize_question_set", END)
    return graph.compile(checkpointer=checkpointer or get_default_checkpointer())