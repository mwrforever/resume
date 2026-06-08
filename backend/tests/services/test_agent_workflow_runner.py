"""Agent workflow runner tests."""

from app.llm.graphs.workflows.runner import AgentWorkflowRunner
from app.llm.streaming.emitter import AgentStreamEmitter
from app.schemas.agent.stream import AgentNodeId


def test_workflow_runner_node_mapping_uses_existing_protocol_ids() -> None:
    """业务工作流节点映射必须只返回已定义的协议节点 ID。"""
    node_names = [
        "load_resume",
        "suggest_dimensions",
        "request_dimension_selection",
        "build_question_plan",
        "request_plan_approval",
        "fanout_generate_questions",
        "reduce_questions",
        "finalize_question_set",
        "analyze_resume_profile",
        "load_job_candidates",
        "request_job_selection",
        "validate_job_full_name",
        "run_evaluation_subgraph",
        "build_visualization_report",
        "finalize_evaluation_report",
    ]

    node_ids = [AgentWorkflowRunner._coerce_node_id(node_name) for node_name in node_names]

    assert all(isinstance(node_id, AgentNodeId) for node_id in node_ids)


def test_workflow_runner_translates_interaction_interrupts_to_protocol_nodes() -> None:
    """工作流交互中断必须映射到已定义的协议节点。"""
    runner = AgentWorkflowRunner(object())
    emitter = AgentStreamEmitter(session_id=1, session_key="session-1", run_id="run-1", workflow_type="interview_questions")
    expected_node_ids = {
        "dimension_selection": AgentNodeId.DIMENSION_SELECTION.value,
        "plan_approval": AgentNodeId.PLAN_APPROVAL.value,
        "job_selection": AgentNodeId.JOB_SELECTION.value,
    }

    events = [
        runner._translate_interrupt(
            {
                "kind": "interaction",
                "request_id": f"req-{interaction_type}",
                "interaction_type": interaction_type,
                "title": "请确认",
                "prompt": "请提交选择。",
            },
            emitter,
        )
        for interaction_type in expected_node_ids
    ]

    assert [event.data["node_id"] for event in events if event is not None] == list(expected_node_ids.values())
