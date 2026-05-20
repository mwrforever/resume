"""调度节点：当前版本在计划批准后直接进入遗留执行器。"""



import logging



from langgraph.types import Command



from app.schemas.agent.enums import AgentNodeId

from app.schemas.agent.orchestrator_state import OrchestratorState



logger = logging.getLogger(__name__)





async def supervisor_node(state: OrchestratorState) -> Command:

    """

    无工具纯决策节点（首版）。



    完整并行扇出将在后续迭代接入；当前批准计划后串行执行 legacy_executor。

    """

    logger.info(

        "调度节点决策：session_key=%s 进入遗留执行，plan_task_count=%s",

        state.session_key,

        len(state.plan_tasks),

    )

    return Command(goto=AgentNodeId.LEGACY_EXECUTOR.value)


