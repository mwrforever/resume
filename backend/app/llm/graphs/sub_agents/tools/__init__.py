"""
子 Agent 工具集合（基于 LangChain @tool + Pydantic args_schema）。

- 工具通过 `Annotated[..., InjectedState]` 直接读取协调器共享 state，无需自写 wrapper
- 涉及 DB / 服务依赖的工具用 `build_*_tools(...)` 工厂注入，返回 list[BaseTool]
- 涉及"等待用户输入"的工具用 `langgraph.types.interrupt()` 触发中断
- 结构化数据卡片（评估报告、岗位卡片）用 `langgraph.config.get_stream_writer()` 推送到 custom 流
"""

from app.llm.graphs.sub_agents.tools.application_tools import build_application_tools
from app.llm.graphs.sub_agents.tools.evaluation_tools import build_evaluation_tools
from app.llm.graphs.sub_agents.tools.job_tools import build_job_tools
from app.llm.graphs.sub_agents.tools.memory_tools import build_memory_tools
from app.llm.graphs.sub_agents.tools.resume_tools import build_resume_tools

__all__ = [
    "build_application_tools",
    "build_evaluation_tools",
    "build_job_tools",
    "build_memory_tools",
    "build_resume_tools",
]
