"""Agent 编排与流式协议枚举（前后端唯一事实来源，禁止在业务代码中硬编码字符串）。"""

from enum import StrEnum


class AgentStreamProtocolVersion(StrEnum):
    """流式协议版本号。"""

    V1 = "1.0"


class AgentSseEventName(StrEnum):
    """SSE 顶层 event 行名称。"""

    V1 = "agent.v1"
    LEGACY = "agent.legacy"


class AgentNodeId(StrEnum):
    """LangGraph 节点标识，与编排架构图一致。"""

    INPUT = "input"
    ANALYST = "analyst"
    RESUME_PREPARE = "resume_prepare"
    RESUME_EXTRACT = "resume_extract"
    RESUME_MARKDOWN = "resume_markdown"
    HUMAN_FEEDBACK = "human_feedback"
    PLANNER = "planner"
    SUPERVISOR = "supervisor"
    SERIAL_ROUTE = "serial_route"
    FAN_OUT = "fan_out"
    DOMAIN_AGENT = "domain_agent"
    RESULT_MERGER = "result_merger"
    LEGACY_EXECUTOR = "legacy_executor"
    EVALUATOR = "evaluator"
    COMPRESSOR = "compressor"
    REPORTER = "reporter"


class AgentPlannerSubStep(StrEnum):
    """Planner 节点内部子步骤（payload.sub_step）。"""

    DRAFT = "plan_draft"
    REVIEW_WAIT = "plan_review_wait"
    REVISE = "plan_revise"


class AgentEventTypeV1(StrEnum):
    """agent.v1 协议 event_type 枚举。"""

    RUN_STARTED = "lifecycle.run_started"
    RUN_FINISHED = "lifecycle.run_finished"
    RUN_FAILED = "lifecycle.run_failed"
    NODE_ENTER = "lifecycle.node_enter"
    NODE_EXIT = "lifecycle.node_exit"
    NODE_ERROR = "lifecycle.node_error"
    INTERRUPT = "lifecycle.interrupt"
    RESUME_ACK = "lifecycle.resume_ack"

    TEXT_DELTA = "stream.text_delta"
    TEXT_DONE = "stream.text_done"
    THOUGHT_DELTA = "stream.thought_delta"
    THOUGHT_DONE = "stream.thought_done"

    UI_RENDER = "ui.render"
    UI_PATCH = "ui.patch"
    UI_DISMISS = "ui.dismiss"

    PLAN_REVISION_STARTED = "plan.revision_started"
    PLAN_REVISION_REJECTED = "plan.revision_rejected"
    PLAN_REPAIR_SUGGESTIONS = "plan.repair_suggestions"
    PLAN_APPROVED = "plan.approved"

    FAN_OUT = "dispatch.fan_out"
    MERGE_DONE = "dispatch.merge_done"

    TOOL_CALL_START = "tool.call_start"
    TOOL_CALL_LOG = "tool.call_log"
    TOOL_CALL_END = "tool.call_end"

    PERSIST_USER_MESSAGE = "persist.user_message"
    PERSIST_AGENT_MESSAGE = "persist.agent_message"
    PERSIST_MEMORY_UPDATED = "persist.memory_updated"


class AgentInterruptKind(StrEnum):
    """interrupt() 等待的人类输入类型。"""

    HUMAN_FEEDBACK = "human_feedback"
    PLAN_REVIEW = "plan_review"


class PlanReviewDecision(StrEnum):
    """规划审批决策。"""

    APPROVED = "approved"
    REJECTED = "rejected"


class PlanReviewStatus(StrEnum):
    """规划审批状态（写入编排 State）。"""

    PENDING = "pending"
    APPROVED = "approved"
    REJECTED = "rejected"


class UiComponentKey(StrEnum):
    """前端组件注册表键名。"""

    FEEDBACK_SUGGESTER = "FeedbackSuggester"
    PLAN_REVIEW_TREE = "PlanReviewTree"
    PLAN_REPAIR_HINTS = "PlanRepairHints"
    ACTION_CONFIRM_CARD = "ActionConfirmCard"
    RUNTIME_STEPPER = "RuntimeStepper"


class UiPlacement(StrEnum):
    """UI 组件挂载位置。"""

    INLINE_AFTER_USER = "inline_after_user"
    SIDEBAR = "sidebar"
    MODAL = "modal"


class AgentDomain(StrEnum):
    """领域 Agent 归属域。"""

    JOB = "job"
    APPLICATION = "application"
    EVALUATION = "evaluation"
    MEMORY = "memory"
    GENERIC = "generic"


class SupervisorDecisionType(StrEnum):
    """调度者决策类型。"""

    SERIAL = "serial"
    PARALLEL = "parallel"
    REDUCE = "reduce"
    FINISH = "finish"


class SubTaskStatus(StrEnum):
    """子任务执行状态。"""

    PENDING = "pending"
    RUNNING = "running"
    DONE = "done"
    FAILED = "failed"
    SKIPPED = "skipped"


class ToolCallStatus(StrEnum):
    """工具调用终态。"""

    SUCCESS = "success"
    FAILED = "failed"


class ToolKind(StrEnum):
    """工具粒度类型。"""

    MACRO = "macro"
    MICRO = "micro"
