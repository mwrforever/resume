from collections.abc import AsyncIterator
import logging
from typing import Any

from langgraph.graph import END, StateGraph

from app.llm.gateway import LLMGatewayError
from app.llm.model_router import LLMModelRouter, get_default_model_router
from app.llm.tools.builtin import builtin_agent_tools
from app.schemas.agent.dto import AgentGraphStateDTO, LLMRuntimeConfigDTO, LLMStreamChunkDTO

logger = logging.getLogger(__name__)


class AgentRuntimeGraph:
    def __init__(self, model_router: LLMModelRouter | None = None):
        self.model_router = model_router or get_default_model_router()
        self.graph = self._build_graph()

    async def run(self, graph_state: AgentGraphStateDTO) -> AgentGraphStateDTO:
        result = await self.graph.ainvoke(graph_state.model_dump())
        return AgentGraphStateDTO.model_validate(result)

    async def stream(
        self,
        prompt: str,
        runtime_config: LLMRuntimeConfigDTO,
        tool_context: dict[str, Any] | None = None,
    ) -> AsyncIterator[LLMStreamChunkDTO]:
        graph_state = AgentGraphStateDTO(prompt=prompt, runtime_config=runtime_config, tool_context=tool_context or {})
        planned_state = await self._planner_node(graph_state.model_dump())
        tool_state = await self._tool_node(planned_state)
        state_with_tools = AgentGraphStateDTO.model_validate(tool_state)
        for tool_call in state_with_tools.tool_calls:
            yield LLMStreamChunkDTO(tool_call=tool_call)
        for tool_result in state_with_tools.tool_results:
            yield LLMStreamChunkDTO(tool_result=tool_result)
        async for chunk in self.model_router.stream(self._build_prompt_with_tool_results(state_with_tools), runtime_config):
            yield chunk

    def _build_graph(self):
        graph = StateGraph(dict[str, Any])
        graph.add_node("planner", self._planner_node)
        graph.add_node("tools", self._tool_node)
        graph.add_node("llm", self._llm_node)
        graph.set_entry_point("planner")
        graph.add_edge("planner", "tools")
        graph.add_edge("tools", "llm")
        graph.add_edge("llm", END)
        return graph.compile()

    async def _planner_node(self, state: dict[str, Any]) -> dict[str, Any]:
        graph_state = AgentGraphStateDTO.model_validate(state)
        if not graph_state.runtime_config.enable_tools:
            logger.info("Agent规划节点跳过工具调用：model=%s", graph_state.runtime_config.model_name)
            return graph_state.model_copy(update={"tool_calls": []}).model_dump()
        tool_calls = builtin_agent_tools.plan_tools(graph_state.prompt, graph_state.tool_context)
        logger.info("Agent规划节点完成：tool_count=%s prompt_prefix_hash=%s", len(tool_calls), graph_state.tool_context.get("prompt_prefix_hash"))
        return graph_state.model_copy(update={"tool_calls": tool_calls}).model_dump()

    async def _tool_node(self, state: dict[str, Any]) -> dict[str, Any]:
        graph_state = AgentGraphStateDTO.model_validate(state)
        tool_results = [builtin_agent_tools.execute(call, graph_state.tool_context) for call in graph_state.tool_calls]
        logger.info("Agent工具节点完成：result_count=%s", len(tool_results))
        return graph_state.model_copy(update={"tool_results": tool_results}).model_dump()

    async def _llm_node(self, state: dict[str, Any]) -> dict[str, Any]:
        graph_state = AgentGraphStateDTO.model_validate(state)
        try:
            logger.info("Agent模型节点开始调用：tool_result_count=%s model=%s", len(graph_state.tool_results), graph_state.runtime_config.model_name)
            result = await self.model_router.complete(self._build_prompt_with_tool_results(graph_state), graph_state.runtime_config)
            logger.info("Agent模型节点调用成功：model=%s total_tokens=%s", result.model_name, result.total_tokens)
            return graph_state.model_copy(update={"result": result, "error_message": None}).model_dump()
        except LLMGatewayError as exc:
            logger.warning("Agent模型节点调用失败：error=%s", exc)
            return graph_state.model_copy(update={"error_message": str(exc)}).model_dump()

    def _build_prompt_with_tool_results(self, graph_state: AgentGraphStateDTO) -> str:
        if not graph_state.tool_results:
            return graph_state.prompt
        tool_lines = []
        for result in graph_state.tool_results:
            tool_lines.append(
                f"- {result.display_name}：success={result.success} output={result.output_payload} error={result.error_message or ''}"
            )
        return f"{graph_state.prompt}\n\n工具观测结果：\n" + "\n".join(tool_lines)
