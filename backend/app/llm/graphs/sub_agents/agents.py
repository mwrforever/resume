"""
六个业务子 Agent，全部用 LangGraph 内置 `create_react_agent` 组装。

每个工厂函数返回一个 CompiledStateGraph，名字与协议 v2 中 `AgentNodeId.*_AGENT`
保持一致，供 supervisor 注册：

- generic_agent      — 兜底闲聊/通用指令，无工具
- job_agent          — 岗位检索（只读快照）
- application_agent  — 投递查询 + 状态变更（写操作走 interrupt）
- resume_agent       — 简历附件加载与 Markdown 整理
- evaluation_agent   — 复用 EvaluationGraph 子图执行 AI 评估
- memory_agent       — 长期偏好记忆写入

子 Agent 与 supervisor 共享 `AgentRuntimeState`（继承自 MessagesState），
工具通过 `InjectedState` 直接读到当前业务快照、运行时配置等上下文。
"""

from __future__ import annotations

from langchain_core.language_models import BaseChatModel
from langgraph.graph.state import CompiledStateGraph
from langgraph.prebuilt import create_react_agent

from app.llm.graphs.coordinator.state import AgentRuntimeState
from app.llm.graphs.sub_agents.tools import (
    build_application_tools,
    build_evaluation_tools,
    build_job_tools,
    build_memory_tools,
    build_resume_tools,
)
from app.llm.model_router import LLMModelRouter
from app.repositories.application_repository import ApplicationRepository
from app.repositories.evaluation_repository import EvalRepository
from app.repositories.job_repository import JobRepository
from app.repositories.resume_repository import ResumeRepository
from app.services.agent_context_service import AgentContextService
from app.services.agent_resume_pipeline_service import AgentResumePipelineService

# ---------- 子 Agent 系统提示词（生产级提示词在 P3 阶段统一替换） ----------

GENERIC_AGENT_PROMPT = (
    "你是 HR Agent 平台的通用助手 generic_agent。负责处理闲聊、说明、引导类问题。"
    "你不调用任何业务工具，只用自然语言回答。如果用户的问题应当由其他子 Agent "
    "（例如岗位查询、投递管理、简历整理、AI 评估、记忆管理）处理，请简洁地"
    "把请求交还给中心调度，不要尝试自行执行业务操作。"
)

JOB_AGENT_PROMPT = (
    "你是岗位 Agent job_agent。可以使用工具 search_jobs 在当前员工的岗位库中筛选岗位，"
    "并以 DataCard 形式展示给用户。回答时务必基于工具返回的真实数据，"
    "不要编造岗位字段。完成查询后用一两句话给出总结即可。"
)

APPLICATION_AGENT_PROMPT = (
    "你是投递 Agent application_agent。可以查询投递列表（list_applications），"
    "也可以提议变更投递状态（propose_application_status_update）。"
    "状态变更必须由用户在前端 ActionCard 上确认后才会生效，请清晰说明你将发起的动作。"
    "不允许编造投递 ID；如果信息不足，引导用户补充。"
)

RESUME_AGENT_PROMPT = (
    "你是简历 Agent resume_agent。可调用 load_resume_context 读取当前会话引用的简历原文，"
    "并通过 format_resume_markdown 把原文整理为结构化 Markdown。"
    "如果会话未绑定简历，请引导用户先在前端上传简历附件。"
)

EVALUATION_AGENT_PROMPT = (
    "你是评估 Agent evaluation_agent。当用户希望评估某条投递时，"
    "调用 evaluate_application(application_id) 触发评估子图。"
    "评估完成后会自动下发 ``data.evaluation_report`` 卡片，"
    "你只需简明扼要地总结分数、标签、关键优劣势，不要重复输出维度细节。"
)

MEMORY_AGENT_PROMPT = (
    "你是记忆 Agent memory_agent。当用户表达明显的偏好/习惯时，"
    "调用 record_preference_memory(content) 把它写入长期记忆。"
    "对于普通对话内容（非偏好），请直接说明无需记录并交还给中心调度。"
)


# ---------- 子 Agent 工厂 ----------


def build_generic_agent(model: BaseChatModel) -> CompiledStateGraph:
    """通用兜底 Agent，无工具。"""
    return create_react_agent(
        model=model,
        tools=[],
        prompt=GENERIC_AGENT_PROMPT,
        state_schema=AgentRuntimeState,
        name="generic_agent",
    )


def build_job_agent(model: BaseChatModel) -> CompiledStateGraph:
    """岗位查询 Agent。"""
    return create_react_agent(
        model=model,
        tools=build_job_tools(),
        prompt=JOB_AGENT_PROMPT,
        state_schema=AgentRuntimeState,
        name="job_agent",
    )


def build_application_agent(model: BaseChatModel) -> CompiledStateGraph:
    """投递管理 Agent（含中断式动作工具）。"""
    return create_react_agent(
        model=model,
        tools=build_application_tools(),
        prompt=APPLICATION_AGENT_PROMPT,
        state_schema=AgentRuntimeState,
        name="application_agent",
    )


def build_resume_agent(
    model: BaseChatModel,
    *,
    pipeline: AgentResumePipelineService | None,
    model_router: LLMModelRouter,
) -> CompiledStateGraph:
    """简历附件 Agent。"""
    return create_react_agent(
        model=model,
        tools=build_resume_tools(pipeline=pipeline, model_router=model_router),
        prompt=RESUME_AGENT_PROMPT,
        state_schema=AgentRuntimeState,
        name="resume_agent",
    )


def build_evaluation_agent(
    model: BaseChatModel,
    *,
    app_repo: ApplicationRepository | None,
    job_repo: JobRepository | None,
    eval_repo: EvalRepository | None,
    resume_repo: ResumeRepository | None,
) -> CompiledStateGraph:
    """评估 Agent，工具复用评估 LangGraph 子图。"""
    return create_react_agent(
        model=model,
        tools=build_evaluation_tools(
            app_repo=app_repo,
            job_repo=job_repo,
            eval_repo=eval_repo,
            resume_repo=resume_repo,
        ),
        prompt=EVALUATION_AGENT_PROMPT,
        state_schema=AgentRuntimeState,
        name="evaluation_agent",
    )


def build_memory_agent(
    model: BaseChatModel,
    *,
    context_service: AgentContextService | None,
) -> CompiledStateGraph:
    """长期记忆 Agent。"""
    return create_react_agent(
        model=model,
        tools=build_memory_tools(context_service),
        prompt=MEMORY_AGENT_PROMPT,
        state_schema=AgentRuntimeState,
        name="memory_agent",
    )


__all__ = [
    "GENERIC_AGENT_PROMPT",
    "JOB_AGENT_PROMPT",
    "APPLICATION_AGENT_PROMPT",
    "RESUME_AGENT_PROMPT",
    "EVALUATION_AGENT_PROMPT",
    "MEMORY_AGENT_PROMPT",
    "build_generic_agent",
    "build_job_agent",
    "build_application_agent",
    "build_resume_agent",
    "build_evaluation_agent",
    "build_memory_agent",
]
