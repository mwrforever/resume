"""WorkflowRuntimeContext 与两个 graph state 的字段约束。"""

from unittest.mock import MagicMock

from pydantic import SecretStr

from app.llm.graphs.workflows.context import WorkflowRuntimeContext
from app.llm.graphs.workflows.state import InterviewQuestionState, ResumeEvaluationState
from app.llm.streaming.emitter import AgentStreamEmitter
from app.schemas.agent.dto import LLMRuntimeConfigDTO


def _cfg() -> LLMRuntimeConfigDTO:
    return LLMRuntimeConfigDTO(
        provider="deepseek", base_url="x", api_key=SecretStr("sk"),
        model_name="m1",
    )


def test_workflow_context_carries_emitter_and_services():
    emitter = AgentStreamEmitter(session_id=1, run_id="r", workflow_type="interview_questions")
    ctx = WorkflowRuntimeContext(
        emitter=emitter, runtime_config=_cfg(),
        interview_service=MagicMock(), evaluation_service=MagicMock(),
        resume_loader=MagicMock(),
        session_id=1, employee_id=2, run_id="r",
    )
    assert ctx.run_id == "r"
    assert ctx.emitter is emitter


def test_interview_state_has_expected_keys():
    state: InterviewQuestionState = {
        "resume_ref": {},
        "resume_text": "",
        "suggested_dimensions": [],
        "selected_dimensions": [],
        "question_plan": {},
        "plan_approved": False,
        "question_set": None,
    }
    assert state["question_set"] is None


def test_resume_evaluation_state_has_validation_attempts():
    state: ResumeEvaluationState = {
        "resume_ref": {},
        "resume_text": "",
        "resume_profile": {},
        "job_candidates": [],
        "selected_job_name": "",
        "job_full": None,
        "validation_attempts": 0,
        "evaluation_result": None,
        "report": None,
    }
    assert state["validation_attempts"] == 0
