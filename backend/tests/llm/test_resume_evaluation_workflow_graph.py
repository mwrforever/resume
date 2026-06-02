"""Resume evaluation workflow graph tests."""

from app.llm.graphs.workflows.resume_evaluation import build_resume_evaluation_graph


def test_build_resume_evaluation_graph_compiles() -> None:
    """简历评估工作流图可以编译。"""
    graph = build_resume_evaluation_graph()

    assert graph is not None