"""图二 graph 结构最小断言。"""

from langgraph.checkpoint.memory import MemorySaver

from app.llm.graphs.workflows.resume_evaluation import build_evaluation_graph


def test_build_evaluation_graph_compiles():
    graph = build_evaluation_graph(MemorySaver())
    g = graph.get_graph()
    node_names = set(g.nodes.keys())
    expected = {
        "load_resume", "analyze_resume_profile",
        "load_job_candidates", "request_job_selection", "validate_job_full_name",
        "run_evaluation_subgraph", "build_visualization_report", "finalize_evaluation_report",
    }
    assert expected.issubset(node_names)
