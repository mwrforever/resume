"""兼容层：旧 RuntimeGraph 已迁移至 orchestrator_graph，保留模块路径避免外部引用断裂。"""

from app.llm.graphs.orchestrator_graph import AgentOrchestratorGraph, build_graph_config, get_default_orchestrator_graph

# 历史名称映射，便于渐进迁移 import
AgentRuntimeGraph = AgentOrchestratorGraph
get_default_runtime_graph = get_default_orchestrator_graph

__all__ = [
    "AgentOrchestratorGraph",
    "AgentRuntimeGraph",
    "build_graph_config",
    "get_default_orchestrator_graph",
    "get_default_runtime_graph",
]
