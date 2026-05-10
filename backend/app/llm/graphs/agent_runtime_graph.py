from typing import Any

from langgraph.graph import END, StateGraph

from app.llm.gateway import LLMGatewayError
from app.llm.model_router import LLMModelRouter, get_default_model_router
from app.schemas.agent.dto import AgentGraphStateDTO


class AgentRuntimeGraph:
    def __init__(self, model_router: LLMModelRouter | None = None):
        self.model_router = model_router or get_default_model_router()
        self.graph = self._build_graph()

    async def run(self, graph_state: AgentGraphStateDTO) -> AgentGraphStateDTO:
        result = await self.graph.ainvoke(graph_state.model_dump())
        return AgentGraphStateDTO.model_validate(result)

    def _build_graph(self):
        graph = StateGraph(dict[str, Any])
        graph.add_node("llm", self._llm_node)
        graph.set_entry_point("llm")
        graph.add_edge("llm", END)
        return graph.compile()

    async def _llm_node(self, state: dict[str, Any]) -> dict[str, Any]:
        graph_state = AgentGraphStateDTO.model_validate(state)
        try:
            result = await self.model_router.complete(graph_state.prompt, graph_state.runtime_config)
            return graph_state.model_copy(update={"result": result, "error_message": None}).model_dump()
        except LLMGatewayError as exc:
            return graph_state.model_copy(update={"error_message": str(exc)}).model_dump()
