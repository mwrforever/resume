"""图一 graph 结构与节点路由的最小断言（不验证业务）。"""

from langgraph.checkpoint.memory import MemorySaver

from app.llm.graphs.workflows.interview_questions import build_interview_graph


def test_build_interview_graph_compiles_with_memory_saver():
    """build_interview_graph 返回可执行图，节点齐全。"""
    graph = build_interview_graph(MemorySaver())
    g = graph.get_graph()
    node_names = set(g.nodes.keys())
    expected = {
        "load_resume", "suggest_dimensions", "request_dimension_selection",
        "build_question_plan", "request_plan_approval",
        "fanout_generate_questions", "reduce_questions", "finalize_question_set",
    }
    assert expected.issubset(node_names)
