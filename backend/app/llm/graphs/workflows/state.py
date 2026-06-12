"""
两个 workflow graph 的扁平 state 定义。

无共享 state；每图独立一个 TypedDict。运行时上下文（emitter / services / runtime_config）
通过 WorkflowRuntimeContext（context.py）由 config["configurable"]["ctx"] 注入，
不进入 graph state（不参与 checkpoint 持久化）。
"""

from __future__ import annotations

from typing import Any, TypedDict


class InterviewQuestionState(TypedDict, total=False):
    """图一 state：简历问答。"""
    resume_ref: dict[str, Any]
    resume_text: str
    suggested_dimensions: list[dict[str, Any]]
    selected_dimensions: list[dict[str, Any]]
    question_plan: dict[str, Any]
    plan_approved: bool
    question_set: dict[str, Any] | None


class ResumeEvaluationState(TypedDict, total=False):
    """图二 state：简历评估。"""
    resume_ref: dict[str, Any]
    resume_text: str
    resume_profile: dict[str, Any]
    job_candidates: list[dict[str, Any]]
    selected_job_name: str
    job_full: dict[str, Any] | None
    validation_attempts: int
    evaluation_result: dict[str, Any] | None
    report: dict[str, Any] | None
