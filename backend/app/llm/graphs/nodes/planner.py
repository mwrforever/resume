"""规划节点：节点内 interrupt + Command 实现审批内循环。"""



import json

import logging

import re

from typing import Any



from langgraph.types import Command, interrupt



from app.llm.model_router import LLMModelRouter

from app.schemas.agent.enums import (

    AgentDomain,

    AgentInterruptKind,

    AgentNodeId,

    AgentPlannerSubStep,

    PlanReviewDecision,

    PlanReviewStatus,

)

from app.schemas.agent.orchestrator_state import OrchestratorState, SubTaskDTO

from app.schemas.agent.request import PlanReviewResumePayload



logger = logging.getLogger(__name__)





async def planner_node(

    state: OrchestratorState,

    *,

    model_router: LLMModelRouter,

) -> Command | dict:

    """

    Planner 内循环：



    1. 必要时 LLM 生成 plan_draft，并通过 Command(update) 先写入 Checkpoint

    2. interrupt 等待用户审批（此时 plan_draft 已持久化）

    3. 驳回 → Command(goto=planner) 带修复建议；通过 → Command(goto=supervisor)

    """

    if state.plan_revision >= state.max_plan_revisions:

        logger.warning("规划修订次数超限：session_key=%s revision=%s", state.session_key, state.plan_revision)

        return Command(

            goto=AgentNodeId.REPORTER.value,

            update={"error_message": "plan_revision_exceeded"},

        )



    if _should_draft_plan(state):

        next_revision = (

            state.plan_revision + 1

            if state.plan_review_status == PlanReviewStatus.REJECTED

            else max(state.plan_revision, 1)

        )

        draft = await _llm_plan_draft(state, model_router)

        logger.info(

            "规划草案已生成：session_key=%s revision=%s task_count=%s",

            state.session_key,

            next_revision,

            len(draft),

        )

        # 必须先落库再 interrupt，否则 Checkpoint 中 plan_draft 为空

        return Command(

            goto=AgentNodeId.PLANNER.value,

            update={

                "plan_draft": draft,

                "plan_revision": next_revision,

                "plan_review_status": PlanReviewStatus.PENDING,

            },

        )



    resume_raw = interrupt(

        {

            "interrupt_kind": AgentInterruptKind.PLAN_REVIEW.value,

            "revision": state.plan_revision,

            "sub_step": AgentPlannerSubStep.REVIEW_WAIT.value,

            "tasks": [task.model_dump(mode="json") for task in state.plan_draft],

        }

    )



    decision = PlanReviewResumePayload.model_validate(resume_raw)



    if decision.decision == PlanReviewDecision.REJECTED:

        feedback = (decision.feedback or "").strip()

        if not feedback:

            feedback = "请说明需要调整的方向。"

        suggestions = await _llm_repair_suggestions(state, feedback, model_router)

        logger.info(

            "规划被驳回，准备重规划：session_key=%s revision=%s",

            state.session_key,

            state.plan_revision,

        )

        return Command(

            goto=AgentNodeId.PLANNER.value,

            update={

                "plan_review_status": PlanReviewStatus.REJECTED,

                "plan_review_feedback": feedback,

                "plan_repair_suggestions": suggestions,

            },

        )



    final_tasks = _normalize_subtasks(decision.tasks or state.plan_draft)

    logger.info(

        "规划已批准：session_key=%s revision=%s task_count=%s",

        state.session_key,

        state.plan_revision,

        len(final_tasks),

    )

    return Command(

        goto=AgentNodeId.SUPERVISOR.value,

        update={

            "plan_tasks": final_tasks,

            "plan_review_status": PlanReviewStatus.APPROVED,

            "plan_review_feedback": None,

            "plan_repair_suggestions": [],

        },

    )





def _should_draft_plan(state: OrchestratorState) -> bool:

    """首轮或驳回后需要重新生成草案。"""

    if not state.plan_draft:

        return True

    return state.plan_review_status == PlanReviewStatus.REJECTED





def _normalize_subtasks(raw_tasks: list[Any]) -> list[SubTaskDTO]:

    """将审批回传的任务列表统一为 SubTaskDTO 实体。"""

    normalized: list[SubTaskDTO] = []

    for task in raw_tasks:

        if isinstance(task, SubTaskDTO):

            normalized.append(task)

        else:

            normalized.append(SubTaskDTO.model_validate(task))

    return normalized





async def _llm_plan_draft(state: OrchestratorState, model_router: LLMModelRouter) -> list[SubTaskDTO]:

    """调用 LLM 生成结构化子任务列表。"""

    # 检查必要的上下文信息
    if not state.user_input:
        logger.warning("user_input 为空，无法生成规划")
        return [
            SubTaskDTO(
                task_id="clarify_intent",
                domain=AgentDomain.GENERIC,
                title="确认用户意图",
                instruction="请询问用户想要完成什么任务",
            )
        ]

    # 检查是否包含岗位相关信息（根据任务类型判断）
    # 如果分析类任务没有提供足够的上下文，先返回需要更多信息的任务
    has_sufficient_context = _check_context_sufficiency(state)

    if not has_sufficient_context:
        logger.info("上下文信息不足，需要先收集信息：session_key=%s", state.session_key)
        return [
            SubTaskDTO(
                task_id="collect_context",
                domain=AgentDomain.GENERIC,
                title="收集必要信息",
                instruction=f"当前任务：{state.user_input}。需要先确认：1) 涉及的岗位是什么？2) 需要分析哪位候选人？请询问用户补充这些信息。",
            )
        ]

    feedback_block = ""

    if state.plan_review_feedback:

        feedback_block = f"\n用户驳回意见：{state.plan_review_feedback}"

    if state.plan_repair_suggestions:

        feedback_block += "\n修复建议：\n" + "\n".join(f"- {item}" for item in state.plan_repair_suggestions)



    system_prompt = (

        "你是 HR 招聘助手规划器。根据用户需求输出 JSON 数组，每项包含："

        "task_id, domain(job|application|evaluation|memory|generic), title, instruction, depends_on。"

        "不要输出 markdown，只输出 JSON 数组。"

    )

    user_prompt = f"用户需求：{state.user_input}\n上下文摘要：{state.analysis_summary or ''}{feedback_block}"

    result = await model_router.complete(f"{system_prompt}\n\n{user_prompt}", state.runtime_config)

    return _parse_subtasks(result.content)





async def _llm_repair_suggestions(

    state: OrchestratorState,

    feedback: str,

    model_router: LLMModelRouter,

) -> list[str]:

    """根据驳回意见生成修复建议列表。"""

    prompt = (

        "你是规划审阅助手。根据用户驳回意见，给出 2-4 条可执行的修复建议，"

        "使用 JSON 数组字符串格式输出，例如 [\"建议1\", \"建议2\"]。\n"

        f"当前计划：{json.dumps([t.model_dump(mode='json') for t in state.plan_draft], ensure_ascii=False)}\n"

        f"用户意见：{feedback}"

    )

    result = await model_router.complete(prompt, state.runtime_config)

    return _parse_string_list(result.content)





def _parse_subtasks(raw: str) -> list[SubTaskDTO]:

    """解析 LLM 返回的子任务 JSON。"""

    payload = _extract_json_array(raw)

    tasks: list[SubTaskDTO] = []

    for index, item in enumerate(payload, start=1):

        if not isinstance(item, dict):

            continue

        task_id = str(item.get("task_id") or f"t{index}")

        domain_raw = str(item.get("domain") or "generic")

        try:

            domain = AgentDomain(domain_raw)

        except ValueError:

            domain = AgentDomain.GENERIC

        tasks.append(

            SubTaskDTO(

                task_id=task_id,

                domain=domain,

                title=str(item.get("title") or f"子任务 {index}"),

                instruction=str(item.get("instruction") or _fallback_instruction(item)),

                depends_on=[str(dep) for dep in (item.get("depends_on") or [])],

            )

        )

    if not tasks:

        tasks.append(

            SubTaskDTO(

                task_id="t1",

                domain=AgentDomain.GENERIC,

                title="回答用户问题",

                instruction="根据用户输入给出专业、可执行的建议。",

            )

        )

    return tasks





def _fallback_instruction(item: dict[str, Any]) -> str:

    """子任务 instruction 缺省时的兜底文案。"""

    return str(item.get("title") or "处理用户请求")





def _parse_string_list(raw: str) -> list[str]:

    """解析 JSON 字符串数组。"""

    payload = _extract_json_array(raw)

    if all(isinstance(item, str) for item in payload):

        return [str(item) for item in payload]

    return [line.strip("- ").strip() for line in raw.splitlines() if line.strip()][:4]





def _extract_json_array(raw: str) -> list[Any]:

    """从模型输出中提取 JSON 数组。"""

    text = raw.strip()

    match = re.search(r"\[[\s\S]*\]", text)

    if not match:

        return []

    try:

        parsed = json.loads(match.group(0))

    except json.JSONDecodeError:

        return []

    return parsed if isinstance(parsed, list) else []



def _check_context_sufficiency(state: OrchestratorState) -> bool:
    """检查是否收集了足够的上下文信息用于生成规划。"""

    # 如果有 resume_attachment（简历），认为上下文足够
    if state.has_resume_attachment:
        return True

    # 如果 analysis_summary 不为空，认为已经完成了分析阶段
    if state.analysis_summary and len(state.analysis_summary) > 10:
        return True

    # 如果 user_input 包含明确的关键词（如"分析"、"评估"），且不是太短
    if len(state.user_input) > 10:
        keywords = ["分析", "评估", "总结", "推荐", "匹配"]
        if any(kw in state.user_input for kw in keywords):
            return True

    return False


