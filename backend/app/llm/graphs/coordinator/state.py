"""
协调器与子 Agent 共享的 LangGraph State。

直接复用 LangGraph 内置的 `MessagesState`（自带 `add_messages` reducer），
在其基础上扩展业务运行时字段：业务快照、运行时配置、当前用户身份、附件引用、最终回复缓存。

LangGraph supervisor 与每个 `create_react_agent` 子图都共享这套 state schema，
工具函数通过 `Annotated[..., InjectedState]` 直接读取上下文，无需自写 reducer。
"""

from __future__ import annotations

from typing import Any

from langgraph.graph import MessagesState
from langgraph.managed import IsLastStep, RemainingSteps


class AgentRuntimeState(MessagesState):
    """
    协调器 + 子 Agent 共用的状态。

    继承 `MessagesState`：
      - messages: Annotated[list[AnyMessage], add_messages]

    扩展字段：
      - employee_id: 当前员工 ID（用于权限校验）
      - session_id: agent_session.id
      - session_key: agent_session.session_key（也作为 LangGraph thread_id）
      - tool_context: 业务快照（jobs/applications/evaluations）
      - resume_ref: 当前会话的简历附件引用（resume_id/job_id/file_name）
      - runtime_config: 运行时 LLM 配置快照（model_name/protocol/...）
      - final_message: 最终给用户的文本回复（finalize 时由协调器写入）

    LangGraph 内置必填字段（`create_react_agent` 强制要求）：
      - is_last_step:    当前是否为最后一步（IsLastStep）
      - remaining_steps: 还允许递归的步数（RemainingSteps）
    """

    employee_id: int
    session_id: int
    session_key: str
    tool_context: dict[str, Any]
    resume_ref: dict[str, Any] | None
    runtime_config: dict[str, Any]
    final_message: str
    is_last_step: IsLastStep
    remaining_steps: RemainingSteps
