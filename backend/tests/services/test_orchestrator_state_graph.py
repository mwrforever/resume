"""编排图与 Pydantic State 实体集成冒烟测试。"""



import pytest



from app.llm.graphs.orchestrator_graph import AgentOrchestratorGraph

from app.schemas.agent.dto import LLMResultDTO, LLMRuntimeConfigDTO

from app.schemas.agent.orchestrator_state import OrchestratorState





class FakeModelRouter:

    """避免集成测试依赖真实 LLM 网关。"""



    async def complete(self, prompt: str, runtime_config: LLMRuntimeConfigDTO) -> LLMResultDTO:

        return LLMResultDTO(

            content='[{"task_id":"t1","domain":"generic","title":"分析需求","instruction":"整理招聘流程建议"}]',

            model_name=runtime_config.model_name,

        )





def _runtime() -> LLMRuntimeConfigDTO:

    return LLMRuntimeConfigDTO(

        model_name="test-model",

        api_key="secret",

        base_url="http://localhost",

        enable_tools=False,

    )





@pytest.mark.asyncio

async def test_graph_analyst_to_planner_interrupt_with_pydantic_state():

    """

    验证 StateGraph(OrchestratorState) 可运行至 Planner interrupt。



    thread_id 使用 session_key，Checkpoint 可还原为实体。

    """

    graph = AgentOrchestratorGraph(model_router=FakeModelRouter())

    session_key = "graph-pydantic-state-key"

    initial = OrchestratorState(

        session_id=99,

        session_key=session_key,

        employee_id=1,

        user_input="请帮我优化招聘流程",

        prompt="请帮我优化招聘流程",

        runtime_config=_runtime(),

    )



    chunks: list = []

    async for chunk in graph.astream(initial, session_key=session_key):

        chunks.append(chunk)



    snapshot = await graph.get_state(session_key)

    assert snapshot is not None

    assert snapshot.interrupts, "Planner 应在审批处 interrupt"



    restored = OrchestratorState.from_checkpoint(snapshot.values)

    assert restored.session_key == session_key

    assert restored.user_input == "请帮我优化招聘流程"

    assert isinstance(restored.runtime_config, LLMRuntimeConfigDTO)


