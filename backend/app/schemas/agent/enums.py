"""Agent 业务通用枚举。流式协议相关枚举请见 `app.schemas.agent.stream.events`。"""

from enum import StrEnum


class AgentDomain(StrEnum):
    """领域 Agent 归属域，供后续意图识别与权限收敛复用。"""

    JOB = "job"
    APPLICATION = "application"
    EVALUATION = "evaluation"
    RESUME = "resume"
    MEMORY = "memory"
    GENERIC = "generic"


class ToolCallStatus(StrEnum):
    """工具调用终态。"""

    SUCCESS = "success"
    FAILED = "failed"
