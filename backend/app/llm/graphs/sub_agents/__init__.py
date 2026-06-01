"""
中心调度 Agent 的子 Agent 集合（按业务领域拆分）。

新版基于 LangGraph `create_react_agent` 内置实现：
- 每个子 Agent 由 `agents.py` 内 `build_*_agent(...)` 工厂构造为 CompiledStateGraph
- 工具实现集中在 `tools/` 子包
"""

from app.llm.graphs.sub_agents.agents import (
    build_application_agent,
    build_evaluation_agent,
    build_generic_agent,
    build_job_agent,
    build_memory_agent,
    build_resume_agent,
)

# 与协议 v2 中 AgentNodeId.*_AGENT / 前端展示一致的中文显示名
SUB_AGENT_DISPLAY_NAMES: dict[str, str] = {
    "generic_agent": "通用助手",
    "job_agent": "岗位 Agent",
    "application_agent": "投递 Agent",
    "resume_agent": "简历 Agent",
    "evaluation_agent": "评估 Agent",
    "memory_agent": "记忆 Agent",
}

__all__ = [
    "SUB_AGENT_DISPLAY_NAMES",
    "build_application_agent",
    "build_evaluation_agent",
    "build_generic_agent",
    "build_job_agent",
    "build_memory_agent",
    "build_resume_agent",
]
