"""ResumeEvaluationWorkflowService tests."""

from types import SimpleNamespace

import pytest

from app.core.exceptions import ValidationError
from app.schemas.agent.dto import ResumeEvaluationReportDTO
from app.services.resume_evaluation_workflow_service import ResumeEvaluationWorkflowService


class _JobRepository:
    """测试用岗位仓储。"""

    async def get_by_id(self, job_id: int) -> SimpleNamespace:
        """返回固定岗位。"""
        return SimpleNamespace(id=job_id, name="后端工程师", employee_id=1, description="Python 后端")


@pytest.mark.asyncio
async def test_validate_selected_job_rejects_name_mismatch() -> None:
    """岗位名称必须与用户选择严格一致。"""
    service = ResumeEvaluationWorkflowService(
        model_router=object(),
        resume_pipeline=object(),
        job_repo=_JobRepository(),
    )

    with pytest.raises(ValidationError):
        await service.validate_selected_job(employee_id=1, job_id=1, job_name="前端工程师")


def test_build_report_block_uses_resume_evaluation_report_type() -> None:
    """最终评估报告 block 必须只作为 agent_message JSON 渲染。"""
    service = ResumeEvaluationWorkflowService(model_router=object(), resume_pipeline=object(), job_repo=object())
    report = ResumeEvaluationReportDTO(
        final_score=88,
        final_label="优秀",
        decision="建议进入面试",
        summary="匹配度高。",
    )

    block = service.build_report_block(report)

    assert block["type"] == "resume_evaluation_report"
    assert block["report"]["decision"] == "建议进入面试"