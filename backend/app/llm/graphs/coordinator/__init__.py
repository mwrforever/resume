"""中心调度协调器（Supervisor + 6 子 Agent）。"""

from app.llm.graphs.coordinator.checkpointer import get_default_checkpointer
from app.llm.graphs.coordinator.state import AgentRuntimeState


def __getattr__(name: str):
    """懒加载 builder/runner，避免 state 被子 Agent 导入时触发循环导入。"""
    if name == "build_coordinator_graph":
        from app.llm.graphs.coordinator.builder import build_coordinator_graph

        return build_coordinator_graph
    if name == "CoordinatorRunner":
        from app.llm.graphs.coordinator.runner import CoordinatorRunner

        return CoordinatorRunner
    raise AttributeError(name)

__all__ = [
    "AgentRuntimeState",
    "CoordinatorRunner",
    "build_coordinator_graph",
    "get_default_checkpointer",
]
