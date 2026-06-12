"""
WorkflowRuntimeContext：通过 graph config["configurable"]["ctx"] 注入节点。

替代旧的 ContextVar + asyncio.Queue 机制。节点函数从 config 拿 ctx，
拿到 emitter 和 services 实例后调 service 方法，service 内部用
get_stream_writer() 向 LangGraph custom stream 投递事件。
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import TYPE_CHECKING

from app.llm.streaming.emitter import AgentStreamEmitter
from app.schemas.agent.dto import LLMRuntimeConfigDTO

if TYPE_CHECKING:
    from app.services.interview_question_service import InterviewQuestionService
    from app.services.resume_evaluation_service import ResumeEvaluationService
    from app.services.resume_loader import ResumeLoader


@dataclass
class WorkflowRuntimeContext:
    """单次 graph 执行的运行时上下文。"""
    emitter: AgentStreamEmitter
    runtime_config: LLMRuntimeConfigDTO
    interview_service: "InterviewQuestionService"
    evaluation_service: "ResumeEvaluationService"
    resume_loader: "ResumeLoader"
    session_id: int
    employee_id: int
    run_id: str
