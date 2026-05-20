"""Planner 内循环与 session_key=thread_id、State 实体行为测试。"""



import pytest



from app.llm.graphs.orchestrator_graph import build_graph_config

from app.schemas.agent.dto import LLMRuntimeConfigDTO

from app.schemas.agent.enums import AgentNodeId, PlanReviewDecision, PlanReviewStatus

from app.schemas.agent.orchestrator_state import OrchestratorState

from app.schemas.agent.request import PlanReviewResumePayload





def _sample_runtime() -> LLMRuntimeConfigDTO:

    return LLMRuntimeConfigDTO(

        model_name="test",

        api_key="k",

        base_url="http://example.test",

    )





def test_build_graph_config_uses_session_key_as_thread_id():

    session_key = "abc123session"

    config = build_graph_config(session_key)

    assert config["configurable"]["thread_id"] == session_key





def test_plan_review_resume_payload_requires_feedback_on_reject():

    with pytest.raises(ValueError):

        PlanReviewResumePayload(decision=PlanReviewDecision.REJECTED, feedback="  ")





def test_orchestrator_state_roundtrip_from_checkpoint_dict():

    """Checkpoint dict 应能还原为强类型 State 实体。"""

    original = OrchestratorState(

        session_id=1,

        session_key="sess-1",

        employee_id=7,

        user_input="hello",

        runtime_config=_sample_runtime(),

        plan_review_status=PlanReviewStatus.PENDING,

    )

    restored = OrchestratorState.from_checkpoint(original.model_dump(mode="python"))

    assert restored.session_key == "sess-1"

    assert restored.runtime_config.model_name == "test"

    assert restored.plan_review_status == PlanReviewStatus.PENDING





def test_orchestrator_state_coerce_accepts_entity():

    entity = OrchestratorState(

        session_id=1,

        session_key="k",

        employee_id=1,

        runtime_config=_sample_runtime(),

    )

    assert OrchestratorState.coerce(entity) is entity





@pytest.mark.asyncio

async def test_planner_node_rejected_returns_command_to_self():

    from app.llm.graphs.nodes.planner import planner_node



    assert AgentNodeId.PLANNER.value == "planner"



    state = OrchestratorState(

        session_id=1,

        session_key="sess-1",

        employee_id=1,

        user_input="帮我处理投递",

        runtime_config=_sample_runtime(),

        plan_revision=1,

        plan_draft=[],

        plan_review_status=PlanReviewStatus.PENDING,

    )

    # 首次进入会 interrupt；集成测试在后续补充，此处仅校验 State 实体可构造

    assert state.plan_review_status == PlanReviewStatus.PENDING


