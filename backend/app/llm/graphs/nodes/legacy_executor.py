"""遗留执行节点：承载内置工具 + LLM 生成，供 Supervisor 在完整领域 Agent 落地前使用。"""



import logging



from app.llm.model_router import LLMModelRouter

from app.llm.tools.builtin import builtin_agent_tools

from app.schemas.agent.dto import AgentToolCallDTO, AgentToolResultDTO

from app.schemas.agent.enums import AgentNodeId

from app.schemas.agent.orchestrator_state import OrchestratorState



logger = logging.getLogger(__name__)





async def legacy_executor_node(

    state: OrchestratorState,

    *,

    model_router: LLMModelRouter,

) -> dict:

    """

    根据已审批计划或用户输入执行工具并调用 LLM，写入 final_content。

    """

    prompt = state.prompt or state.user_input

    tool_context = state.tool_context_dict()



    if state.plan_tasks:

        plan_lines = [f"- [{task.domain.value}] {task.title}: {task.instruction}" for task in state.plan_tasks]

        prompt = f"{prompt}\n\n已审批执行计划：\n" + "\n".join(plan_lines)



    tool_calls: list[AgentToolCallDTO] = []

    tool_results: list[AgentToolResultDTO] = []

    if state.runtime_config.enable_tools:

        tool_calls = builtin_agent_tools.plan_tools(prompt, tool_context)

        tool_results = [builtin_agent_tools.execute(call, tool_context) for call in tool_calls]



    final_prompt = _build_prompt_with_tool_results(prompt, tool_results)

    logger.info(

        "遗留执行节点开始调用模型：session_key=%s tool_count=%s",

        state.session_key,

        len(tool_calls),

    )

    result = await model_router.complete(final_prompt, state.runtime_config)



    return {

        "final_content": result.content,

        "tool_calls": tool_calls,

        "tool_results": tool_results,

        "error_message": None,

    }





def _build_prompt_with_tool_results(prompt: str, tool_results: list[AgentToolResultDTO]) -> str:

    """将工具观测拼入 Prompt。"""

    if not tool_results:

        return prompt

    tool_lines = [

        f"- {result.display_name}：success={result.success} output={result.output_payload} error={result.error_message or ''}"

        for result in tool_results

    ]

    return f"{prompt}\n\n工具观测结果：\n" + "\n".join(tool_lines)





def legacy_executor_node_id() -> str:

    """返回节点注册名。"""

    return AgentNodeId.LEGACY_EXECUTOR.value


