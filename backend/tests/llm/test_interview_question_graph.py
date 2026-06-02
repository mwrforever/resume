"""Interview question graph tests."""

from app.llm.graphs.workflows.interview_questions import build_interview_question_graph


def test_build_interview_question_graph_compiles() -> None:
    """面试题工作流图可以编译。"""
    graph = build_interview_question_graph()

    assert graph is not None