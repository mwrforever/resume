"""双业务 Agent 工作流共享状态定义。

所有字段必须为 msgpack 可序列化类型（dict / list / str / int / float / bool / None），
因为 LangGraph checkpoint 使用 msgpack 编码。
业务服务实例通过 _ctx.py 的 ContextVar 传递，不进入 State。
"""

from __future__ import annotations

from typing import Any, TypedDict


class AgentWorkflowState(TypedDict, total=False):
    """双业务工作流共享 LangGraph state。"""

    workflow_type: str
    employee_id: int
    session_id: int
    session_key: str
    user_message_id: int
    run_id: str
    resume_ref: dict[str, Any]
    runtime_config: dict[str, Any]
    interaction_payload: dict[str, Any]
    final_text: str
    final_blocks: list[dict[str, Any]]
    error_message: str


class InterviewQuestionState(AgentWorkflowState, total=False):
    """简历问答工作流 state。"""

    resume_text: str
    suggested_dimensions: list[dict[str, Any]]
    selected_dimensions: list[str]
    question_plan: dict[str, Any]
    question_items: list[dict[str, Any]]
    user_intent: str
    # 用户对题集的批阅意见：approve | regenerate；regenerate 时会带 feedback 回到规划节点
    review_decision: str
    review_feedback: str


class ResumeEvaluationState(AgentWorkflowState, total=False):
    """简历评估工作流 state。"""

    resume_text: str
    resume_profile: dict[str, Any]
    job_candidates: list[dict[str, Any]]
    selected_job_id: int
    selected_job_name: str
    selected_job: dict[str, Any]
    validation_attempts: int
    evaluation_result: dict[str, Any]
    report: dict[str, Any]
    validation_error: str