"""Agent workflow request schema tests."""

import pytest
from pydantic import ValidationError

from app.schemas.agent.dto import InterviewQuestionItemDTO, ResumeEvaluationReportDTO
from app.schemas.agent.request import AgentMessageCreate


def test_agent_message_defaults_to_interview_questions() -> None:
    """未传 workflow_type 时默认进入简历问答工作流。"""
    body = AgentMessageCreate(content="生成面试题")

    assert body.workflow_type == "interview_questions"


def test_agent_message_accepts_resume_evaluation() -> None:
    """允许消息级选择简历评估工作流。"""
    body = AgentMessageCreate(content="评估简历", workflow_type="resume_evaluation")

    assert body.workflow_type == "resume_evaluation"


def test_agent_message_rejects_invalid_workflow_type() -> None:
    """非法 workflow_type 由 Pydantic 拒绝。"""
    with pytest.raises(ValidationError):
        AgentMessageCreate(content="测试", workflow_type="general_chat")

def test_interview_question_item_dto_requires_core_fields() -> None:
    """面试题 DTO 必须能承载前端结构化卡片字段。"""
    item = InterviewQuestionItemDTO(
        question="请介绍项目中的关键技术决策。",
        dimension="项目深度",
        difficulty="中等",
        evaluation_points=["真实贡献", "技术取舍"],
        follow_up_suggestions=["追问指标和代码实现"],
        excellent_signals=["能说明方案和指标"],
        average_signals=["只描述参与过程"],
        risk_signals=["无法说明本人贡献"],
    )

    assert item.dimension == "项目深度"
    assert item.difficulty == "中等"


def test_resume_evaluation_report_dto_contains_required_sections() -> None:
    """简历评估报告 DTO 必须包含全部前端展示分区。"""
    report = ResumeEvaluationReportDTO(
        final_score=82,
        final_label="良好",
        decision="建议进入面试",
        summary="岗位匹配度较高。",
        match_overview={"advantages": ["后端经验充分"], "risks": []},
        resume_structure={"work_experiences": []},
        experience_timeline=[],
        skill_dimensions=[],
        job_gaps=[],
    )

    assert report.decision == "建议进入面试"
    assert report.match_overview["advantages"] == ["后端经验充分"]