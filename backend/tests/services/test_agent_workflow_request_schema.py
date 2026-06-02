"""Agent workflow request schema tests."""

import pytest
from pydantic import ValidationError

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