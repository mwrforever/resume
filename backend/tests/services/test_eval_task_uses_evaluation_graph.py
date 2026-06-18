"""Celery 评估任务必须复用评估 LangGraph 子图，不能再走 ResumeEvalChain。"""

from unittest.mock import patch

import pytest

from app.llm.graphs.evaluation_graph import (
    EvaluationDimensionResult,
    EvaluationResult,
    EvaluationSkillHit,
    EvaluationState,
)
from app.workers.tasks import eval_task


def _eval_context() -> dict:
    """构造 `_evaluate_application` 所需的最小上下文。"""
    return {
        "application_id": 100,
        "resume_id": 200,
        "job_id": 300,
        "resume": {"id": 200, "file_path": "fake.pdf", "raw_text": "已解析的简历原文"},
        "job": {"name": "后端", "description": "服务端", "template_id": 1},
        "dimensions": [
            {
                "dimension_id": 1,
                "dimension_name": "技术栈",
                "weight": 1.0,
                "prompt_template": "评估 {{ dimension_name }}",
            }
        ],
        "skills": [
            {"skill_id": 11, "skill": "Python", "type": 1},
        ],
    }


def _stub_result() -> EvaluationResult:
    """构造一个稳定的评估子图返回值，用于断言下游字段。"""
    return EvaluationResult(
        application_id=100,
        resume_id=200,
        job_id=300,
        skill_hits=[
            EvaluationSkillHit(skill_id=11, skill="Python", is_hit=True, hit_context="精通 Python")
        ],
        dimensions=[
            EvaluationDimensionResult(
                dimension_id=1,
                dimension_name="技术栈",
                score=88.0,
                advantage="技术栈匹配",
                disadvantage="缺少分布式经验",
                is_completed=True,
            )
        ],
        weighted_score=88.0,
        final_score=88.0,
        final_label="良好",
        advantage_comment="整体优秀",
        disadvantage_comment="需补强分布式",
    )


def test_evaluate_application_invokes_evaluation_graph() -> None:
    """Celery 入口 `_evaluate_application` 必须调用 evaluation_graph.run_sync 并复用其返回值。"""
    with patch.object(eval_task, "run_evaluation_graph_sync", return_value=_stub_result()) as fake:
        output = eval_task._evaluate_application(_eval_context())

    assert fake.call_count == 1
    invocation_state: EvaluationState = fake.call_args.args[0]
    assert isinstance(invocation_state, EvaluationState)
    assert invocation_state.application_id == 100
    assert invocation_state.dimensions[0].dimension_id == 1
    assert invocation_state.skills[0].skill == "Python"

    assert output["final_score"] == 88.0
    assert output["final_label"] == "良好"
    assert output["dimensions"][0]["dimension_name"] == "技术栈"
    assert output["skill_hits"][0]["is_hit"] == 1
    assert output["advantage_comment"] == "整体优秀"


def test_evaluate_application_raises_when_no_completed_dimensions() -> None:
    """子图所有维度都失败时应抛出 `ValidationError`。"""
    from app.core.exceptions import ValidationError

    incomplete = _stub_result().model_copy(
        update={
            "dimensions": [
                EvaluationDimensionResult(
                    dimension_id=1,
                    dimension_name="技术栈",
                    score=0.0,
                    is_completed=False,
                    error_message="AI评估结果缺少该维度",
                )
            ]
        }
    )
    with patch.object(eval_task, "run_evaluation_graph_sync", return_value=incomplete):
        with pytest.raises(ValidationError):
            eval_task._evaluate_application(_eval_context())
