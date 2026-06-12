"""工作流运行器（重构中占位）。

旧的 AgentWorkflowRunner 已删除，新的薄壳 Runner 将在 Stage 4 实现。
"""


class AgentWorkflowRunner:
    """占位：新 Runner 在 Stage 4 重写。"""

    def __init__(self, compiled_graph=None) -> None:
        self._graph = compiled_graph

    async def astream(self, **kwargs):
        raise NotImplementedError("AgentWorkflowRunner 正在重构中，Stage 4 会恢复")
