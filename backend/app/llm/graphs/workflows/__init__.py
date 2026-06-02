"""双业务 Agent 工作流图构建入口。"""

from app.llm.graphs.workflows.interview_questions import build_interview_question_graph
from app.llm.graphs.workflows.resume_evaluation import build_resume_evaluation_graph
from app.llm.graphs.workflows.runner import AgentWorkflowRunner

__all__ = ["AgentWorkflowRunner", "build_interview_question_graph", "build_resume_evaluation_graph"]