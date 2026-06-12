"""工作流 state 定义（重构中占位）。

将在 Stage 4 完全重写为两个独立扁平 TypedDict。
"""

from __future__ import annotations

from typing import Any, TypedDict


class InterviewQuestionState(TypedDict, total=False):
    """图一 state 占位。"""
    resume_ref: dict[str, Any]
    resume_text: str


class ResumeEvaluationState(TypedDict, total=False):
    """图二 state 占位。"""
    resume_ref: dict[str, Any]
    resume_text: str
    validation_attempts: int
