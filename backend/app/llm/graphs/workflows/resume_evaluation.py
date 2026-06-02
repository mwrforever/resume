"""简历评估工作流 LangGraph 构建器。"""

from __future__ import annotations

import uuid
from typing import Any

from langgraph.checkpoint.base import BaseCheckpointSaver
from langgraph.graph import END, START, StateGraph
from langgraph.graph.state import CompiledStateGraph
from langgraph.types import interrupt

from app.core.exceptions import BizError, ValidationError
from app.llm.graphs.coordinator.checkpointer import get_default_checkpointer
from app.llm.graphs.workflows.state import ResumeEvaluationState
from app.schemas.agent.dto import LLMRuntimeConfigDTO, ResumeEvaluationReportDTO


def _get_service(state: ResumeEvaluationState) -> Any:
    """
    获取简历评估工作流业务服务。

    Args:
        state: LangGraph state

    Returns:
        Any: 注入的业务服务
    """
    service_context = state.get("service_context") or {}
    if isinstance(service_context, dict):
        return service_context.get("resume_evaluation_service")
    return getattr(service_context, "resume_evaluation_service", None)


def _get_context_value(state: ResumeEvaluationState, key: str) -> Any:
    """
    从 service_context 获取运行时对象。

    Args:
        state: LangGraph state
        key: 字段名

    Returns:
        Any: 上下文对象
    """
    service_context = state.get("service_context") or {}
    if isinstance(service_context, dict):
        return service_context.get(key)
    return getattr(service_context, key, None)


def _runtime_config(state: ResumeEvaluationState) -> LLMRuntimeConfigDTO:
    """
    构建 LLM 运行配置 DTO。

    Args:
        state: LangGraph state

    Returns:
        LLMRuntimeConfigDTO: 运行配置
    """
    return LLMRuntimeConfigDTO.model_validate(state.get("runtime_config") or {})


async def _load_resume_node(state: ResumeEvaluationState) -> dict[str, Any]:
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


async def _analyze_resume_profile_node(state: ResumeEvaluationState) -> dict[str, Any]:
    """
    分析简历画像。

    Args:
        state: LangGraph state

    Returns:
        dict[str, Any]: state 更新
    """
    service = _get_service(state)
    if service is None:
        return {"resume_profile": {}}
    profile = await service.analyze_resume_profile(resume_text=str(state.get("resume_text") or ""), runtime_config=_runtime_config(state))
    return {"resume_profile": profile}


async def _load_job_candidates_node(state: ResumeEvaluationState) -> dict[str, Any]:
    """
    加载候选岗位列表。

    Args:
        state: LangGraph state

    Returns:
        dict[str, Any]: state 更新
    """
    service = _get_service(state)
    if service is not None and hasattr(service, "load_job_candidates"):
        candidates = await service.load_job_candidates(employee_id=int(state.get("employee_id") or 0))
        return {"job_candidates": candidates}
    return {"job_candidates": []}


def _request_job_selection_node(state: ResumeEvaluationState) -> dict[str, Any]:
    """
    中断等待用户选择岗位。

    Args:
        state: LangGraph state

    Returns:
        dict[str, Any]: state 更新
    """
    request_id = f"{state.get('run_id') or uuid.uuid4().hex}:job_selection"
    decision = interrupt(
        {
            "kind": "interaction",
            "request_id": request_id,
            "interaction_type": "job_selection",
            "title": "请选择评估岗位",
            "prompt": "请选择并确认用于简历匹配评估的完整岗位名称。",
            "data": {"jobs": state.get("job_candidates") or [], "validation_error": state.get("validation_error")},
            "submit_label": "确认岗位",
        }
    )
    values = decision if isinstance(decision, dict) else {}
    return {
        "selected_job_id": int(values.get("job_id") or 0),
        "selected_job_name": str(values.get("job_name") or ""),
        "interaction_payload": values,
        "validation_error": "",
    }


async def _validate_job_full_name_node(state: ResumeEvaluationState) -> dict[str, Any]:
    """
    校验岗位 ID 与完整岗位名称。

    Args:
        state: LangGraph state

    Returns:
        dict[str, Any]: state 更新
    """
    service = _get_service(state)
    if service is None:
        return {"selected_job": {}}
    attempts = int(state.get("validation_attempts") or 0)
    try:
        selected_job = await service.validate_selected_job(
            employee_id=int(state.get("employee_id") or 0),
            job_id=int(state.get("selected_job_id") or 0),
            job_name=str(state.get("selected_job_name") or ""),
        )
        return {"selected_job": selected_job, "validation_error": ""}
    except ValidationError as exc:
        attempts += 1
        if attempts >= 3:
            return {"validation_attempts": attempts, "error_message": exc.message, "validation_error": exc.message}
        return {"validation_attempts": attempts, "validation_error": exc.message}
    except BizError as exc:
        return {"error_message": exc.message, "validation_error": exc.message}


def _route_after_job_validation(state: ResumeEvaluationState) -> str:
    """
    根据岗位校验结果选择下一节点。

    Args:
        state: LangGraph state

    Returns:
        str: 下一节点名
    """
    if state.get("error_message"):
        return "finalize_evaluation_report"
    if state.get("selected_job"):
        return "run_evaluation_subgraph"
    return "request_job_selection"


async def _run_evaluation_subgraph_node(state: ResumeEvaluationState) -> dict[str, Any]:
    """
    执行评估子图或使用注入评估结果。

    Args:
        state: LangGraph state

    Returns:
        dict[str, Any]: state 更新
    """
    injected_result = _get_context_value(state, "evaluation_result")
    if isinstance(injected_result, dict):
        return {"evaluation_result": injected_result}
    evaluation_graph = _get_context_value(state, "evaluation_graph")
    if evaluation_graph is not None and hasattr(evaluation_graph, "ainvoke"):
        result = await evaluation_graph.ainvoke({"resume_text": state.get("resume_text"), "job": state.get("selected_job")})
        return {"evaluation_result": result if isinstance(result, dict) else {}}
    return {"evaluation_result": {}}


async def _build_visualization_report_node(state: ResumeEvaluationState) -> dict[str, Any]:
    """
    构建可视化报告。

    Args:
        state: LangGraph state

    Returns:
        dict[str, Any]: state 更新
    """
    service = _get_service(state)
    if service is None:
        return {"report": {}}
    report = await service.build_visual_report(
        resume_profile=state.get("resume_profile") or {},
        selected_job=state.get("selected_job") or {},
        evaluation_result=state.get("evaluation_result") or {},
        runtime_config=_runtime_config(state),
    )
    return {"report": report.model_dump(mode="json")}


def _finalize_evaluation_report_node(state: ResumeEvaluationState) -> dict[str, Any]:
    """
    生成最终简历评估报告卡片。

    Args:
        state: LangGraph state

    Returns:
        dict[str, Any]: state 更新
    """
    service = _get_service(state)
    if state.get("error_message"):
        block = {"type": "error", "message": state.get("error_message")}
        return {"final_text": str(state.get("error_message")), "final_blocks": [block]}
    report = ResumeEvaluationReportDTO.model_validate(state.get("report") or {"final_score": 0, "final_label": "待复核", "decision": "建议人工复核", "summary": "报告生成失败。"})
    block = service.build_report_block(report) if service is not None else {"type": "resume_evaluation_report", "report": report.model_dump(mode="json")}
    return {"final_text": "简历评估报告已生成。", "final_blocks": [block]}


def build_resume_evaluation_graph(*, checkpointer: BaseCheckpointSaver | None = None) -> CompiledStateGraph:
    """
    编译简历评估工作流图。

    Args:
        checkpointer: LangGraph checkpoint saver

    Returns:
        CompiledStateGraph: 已编译工作流图
    """
    graph = StateGraph(ResumeEvaluationState)
    graph.add_node("load_resume", _load_resume_node)
    graph.add_node("analyze_resume_profile", _analyze_resume_profile_node)
    graph.add_node("load_job_candidates", _load_job_candidates_node)
    graph.add_node("request_job_selection", _request_job_selection_node)
    graph.add_node("validate_job_full_name", _validate_job_full_name_node)
    graph.add_node("run_evaluation_subgraph", _run_evaluation_subgraph_node)
    graph.add_node("build_visualization_report", _build_visualization_report_node)
    graph.add_node("finalize_evaluation_report", _finalize_evaluation_report_node)
    graph.add_edge(START, "load_resume")
    graph.add_edge("load_resume", "analyze_resume_profile")
    graph.add_edge("analyze_resume_profile", "load_job_candidates")
    graph.add_edge("load_job_candidates", "request_job_selection")
    graph.add_edge("request_job_selection", "validate_job_full_name")
    graph.add_conditional_edges(
        "validate_job_full_name",
        _route_after_job_validation,
        {
            "request_job_selection": "request_job_selection",
            "run_evaluation_subgraph": "run_evaluation_subgraph",
            "finalize_evaluation_report": "finalize_evaluation_report",
        },
    )
    graph.add_edge("run_evaluation_subgraph", "build_visualization_report")
    graph.add_edge("build_visualization_report", "finalize_evaluation_report")
    graph.add_edge("finalize_evaluation_report", END)
    return graph.compile(checkpointer=checkpointer or get_default_checkpointer())