"""Agent message workflow metadata schema tests."""

from types import SimpleNamespace

from app.models.agent_message import AgentMessage
from app.schemas.agent.response import AgentMessageItem


def test_agent_message_model_contains_workflow_metadata_columns() -> None:
    """AgentMessage ORM 必须包含 workflow_type 与 run_id 元数据列。"""
    column_names = set(AgentMessage.__table__.columns.keys())
    index_names = {index.name for index in AgentMessage.__table__.indexes}

    assert "workflow_type" in column_names
    assert "run_id" in column_names
    assert "idx_agent_message_workflow_run" in index_names


def test_agent_message_response_exposes_workflow_metadata() -> None:
    """AgentMessageItem 响应必须透出 workflow_type 与 run_id。"""
    item = AgentMessageItem.model_validate(
        SimpleNamespace(
            id=1,
            session_id=2,
            parent_message_id=None,
            role="agent",
            message_type="workflow_result",
            workflow_type="interview_questions",
            run_id="run-1",
            content={"blocks": []},
            model_name="test-model",
            token_count=None,
            sort_order=1,
            create_time=None,
        )
    )

    assert item.workflow_type == "interview_questions"
    assert item.run_id == "run-1"
