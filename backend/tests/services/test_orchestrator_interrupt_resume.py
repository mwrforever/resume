"""Planner interrupt → resume（批准 / 驳回）集成测试。"""



import pytest



from app.llm.graphs.orchestrator_graph import AgentOrchestratorGraph, build_graph_config

from app.schemas.agent.dto import LLMResultDTO, LLMRuntimeConfigDTO

from app.schemas.agent.enums import (

    AgentDomain,

    AgentInterruptKind,

    PlanReviewDecision,

    PlanReviewStatus,

)

from app.schemas.agent.orchestrator_state import OrchestratorState, SubTaskDTO

from app.schemas.agent.request import PlanReviewResumePayload





class FakeModelRouter:

    """

    按 Prompt 关键词返回确定性 LLM 结果，避免外网依赖。



    - 规划草案 / 修复建议：JSON 数组

    - 其它（遗留执行器等）：纯文本最终回复

    """



    async def complete(self, prompt: str, runtime_config: LLMRuntimeConfigDTO) -> LLMResultDTO:

        if "修复建议" in prompt or "驳回意见" in prompt:

            content = '["补充投递域步骤", "明确评估标准"]'

        elif "规划器" in prompt or "JSON 数组" in prompt:

            content = (

                '[{"task_id":"t1","domain":"generic","title":"分析需求",'

                '"instruction":"整理招聘流程建议"}]'

            )

        else:

            content = "根据已审批计划，建议先梳理岗位 JD，再优化投递筛选标准。"



        return LLMResultDTO(content=content, model_name=runtime_config.model_name)





def _runtime() -> LLMRuntimeConfigDTO:

    return LLMRuntimeConfigDTO(

        model_name="test-model",

        api_key="secret",

        base_url="http://localhost",

        enable_tools=False,

    )





def _initial_state(session_key: str, user_input: str = "请帮我优化招聘流程") -> OrchestratorState:

    return OrchestratorState(

        session_id=1,

        session_key=session_key,

        employee_id=7,

        user_input=user_input,

        prompt=user_input,

        runtime_config=_runtime(),

    )





def _unwrap_interrupt_payload(item) -> dict:
    """与 AgentOrchestratorRunner 一致，解包 LangGraph Interrupt 对象。"""
    value = getattr(item, "value", item)
    return value if isinstance(value, dict) else {}


async def _run_until_interrupt(graph: AgentOrchestratorGraph, initial: OrchestratorState) -> OrchestratorState:

    """驱动图直至 Planner interrupt，并返回 Checkpoint 中的 State 实体。"""

    session_key = initial.session_key

    async for _chunk in graph.astream(initial, session_key=session_key):

        pass



    snapshot = await graph.get_state(session_key)

    assert snapshot is not None

    assert snapshot.interrupts, "应暂停在 Planner 审批 interrupt"



    state = OrchestratorState.from_checkpoint(snapshot.values)

    assert state.plan_draft, "interrupt 前应已生成 plan_draft"

    return state





@pytest.mark.asyncio

async def test_resume_approved_completes_graph_without_interrupt():

    """批准：resume 后应走完 supervisor → legacy_executor → reporter，不再 interrupt。"""

    session_key = "resume-approved-key"

    graph = AgentOrchestratorGraph(model_router=FakeModelRouter())

    initial = _initial_state(session_key)



    paused = await _run_until_interrupt(graph, initial)

    assert paused.plan_review_status == PlanReviewStatus.PENDING
    assert paused.plan_revision >= 1



    resume_payload = PlanReviewResumePayload(

        decision=PlanReviewDecision.APPROVED,

    ).model_dump(mode="json")



    async for _chunk in graph.astream_resume(resume_payload, session_key=session_key):

        pass



    snapshot = await graph.get_state(session_key)

    assert snapshot is not None

    assert not snapshot.interrupts, "批准后应执行完毕，不应再次 interrupt"



    final = OrchestratorState.from_checkpoint(snapshot.values)

    assert final.plan_review_status == PlanReviewStatus.APPROVED

    assert len(final.plan_tasks) == 1

    assert final.plan_tasks[0].task_id == "t1"

    assert final.final_content

    assert "招聘" in final.final_content or len(final.final_content) > 0



    # thread_id 必须等于 session_key（与 sql/init.sql 会话键一致）

    assert build_graph_config(session_key)["configurable"]["thread_id"] == session_key





@pytest.mark.asyncio

async def test_resume_approved_with_custom_tasks_from_payload():

    """批准时前端可回传编辑后的任务列表，应写入 plan_tasks。"""

    session_key = "resume-approved-custom-tasks"

    graph = AgentOrchestratorGraph(model_router=FakeModelRouter())

    await _run_until_interrupt(graph, _initial_state(session_key))



    custom_task = SubTaskDTO(

        task_id="custom-1",

        domain=AgentDomain.JOB,

        title="重写 JD",

        instruction="根据业务线调整岗位描述",

    )

    resume_payload = PlanReviewResumePayload(

        decision=PlanReviewDecision.APPROVED,

        tasks=[custom_task],

    ).model_dump(mode="json")



    async for _chunk in graph.astream_resume(resume_payload, session_key=session_key):

        pass



    final = OrchestratorState.from_checkpoint((await graph.get_state(session_key)).values)

    assert final.plan_tasks[0].task_id == "custom-1"

    assert final.plan_tasks[0].domain == AgentDomain.JOB





@pytest.mark.asyncio

async def test_resume_rejected_returns_to_planner_interrupt():

    """

    驳回：resume 后应回到 Planner 重规划，并再次 interrupt。



    同时校验驳回反馈与修复建议已写入 State。

    """

    session_key = "resume-rejected-key"

    graph = AgentOrchestratorGraph(model_router=FakeModelRouter())

    paused = await _run_until_interrupt(graph, _initial_state(session_key))

    first_revision = paused.plan_revision



    resume_payload = PlanReviewResumePayload(

        decision=PlanReviewDecision.REJECTED,

        feedback="缺少投递域相关步骤，请补充。",

    ).model_dump(mode="json")



    async for _chunk in graph.astream_resume(resume_payload, session_key=session_key):

        pass



    snapshot = await graph.get_state(session_key)

    assert snapshot is not None

    assert snapshot.interrupts, "驳回后应重新进入审批 interrupt"



    state = OrchestratorState.from_checkpoint(snapshot.values)

    assert state.plan_review_status == PlanReviewStatus.PENDING

    assert state.plan_revision > first_revision

    assert state.plan_repair_suggestions, "驳回后应生成修复建议"

    assert state.plan_draft, "驳回后应重新生成 plan_draft"

    interrupt_value = _unwrap_interrupt_payload(snapshot.interrupts[0])

    assert interrupt_value["interrupt_kind"] == AgentInterruptKind.PLAN_REVIEW.value





@pytest.mark.asyncio

async def test_resume_reject_then_approve_full_loop():

    """驳回 → 再次 interrupt → 批准：完整 Planner 内循环应能跑通。"""

    session_key = "resume-reject-then-approve"

    graph = AgentOrchestratorGraph(model_router=FakeModelRouter())



    await _run_until_interrupt(graph, _initial_state(session_key))



    reject_payload = PlanReviewResumePayload(

        decision=PlanReviewDecision.REJECTED,

        feedback="需要增加 evaluation 域任务。",

    ).model_dump(mode="json")

    async for _chunk in graph.astream_resume(reject_payload, session_key=session_key):

        pass



    mid = await graph.get_state(session_key)

    assert mid.interrupts



    approve_payload = PlanReviewResumePayload(

        decision=PlanReviewDecision.APPROVED,

    ).model_dump(mode="json")

    async for _chunk in graph.astream_resume(approve_payload, session_key=session_key):

        pass



    final_snapshot = await graph.get_state(session_key)

    assert not final_snapshot.interrupts



    final = OrchestratorState.from_checkpoint(final_snapshot.values)

    assert final.plan_review_status == PlanReviewStatus.APPROVED

    assert final.final_content


