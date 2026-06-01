"""
中心调度 Agent 编译器。

直接使用 `langgraph_supervisor.create_supervisor` 内置实现：
- supervisor 自身是一个 ReAct Agent，工具集为 6 个 handoff
- 每个子 Agent 是 `create_react_agent` 编译图
- 共享 state schema = `AgentRuntimeState`（继承 MessagesState）
- 编译时挂上 checkpointer 以支持工具内部 `interrupt()` 暂停 / `Command(resume=...)` 恢复
"""

from __future__ import annotations

import logging

from langchain_core.language_models import BaseChatModel
from langgraph.checkpoint.base import BaseCheckpointSaver
from langgraph.graph.state import CompiledStateGraph
from langgraph_supervisor import create_supervisor

from app.llm.graphs.coordinator.checkpointer import get_default_checkpointer
from app.llm.graphs.coordinator.state import AgentRuntimeState
from app.llm.graphs.sub_agents import (
    build_application_agent,
    build_evaluation_agent,
    build_generic_agent,
    build_job_agent,
    build_memory_agent,
    build_resume_agent,
)
from app.llm.model_router import LLMModelRouter
from app.repositories.application_repository import ApplicationRepository
from app.repositories.evaluation_repository import EvalRepository
from app.repositories.job_repository import JobRepository
from app.repositories.resume_repository import ResumeRepository
from app.services.agent_context_service import AgentContextService
from app.services.agent_resume_pipeline_service import AgentResumePipelineService

logger = logging.getLogger(__name__)


# 中心调度系统提示词（生产级版本）
COORDINATOR_PROMPT = (
    "你是 HR 招聘助手的中枢调度。你的职责是根据用户请求调用合适的工具完成招聘任务。\n\n"
    "可用工具与调度规则：\n"
    "- 岗位查询工具：查询/筛选员工名下的岗位信息\n"
    "- 投递管理工具：查询投递列表、提议变更投递状态（变更需用户在 ActionCard 上确认）\n"
    "- 简历解析工具：读取当前会话已上传的简历附件、整理为结构化 Markdown\n"
    "- 评估工具：对指定的投递触发 AI 评估并生成评估报告\n"
    "- 记忆工具：将用户偏好/习惯写入长期记忆\n"
    "- 通用对话工具：处理闲聊、说明、引导类问题\n\n"
    "调度规则：\n"
    "1. 必须使用 handoff 工具进行任务交接，不要自行回答业务问题。\n"
    "2. 一次只交接给一个工具；如需多步，等返回结果后再决定下一步。\n"
    "3. 任务完成后只需用一两句话做最终总结回复用户。\n"
    "4. 严格遵守用户授权边界：写操作必须走 ActionCard 确认流程。\n"
    "5. 如果信息不足，主动询问用户以获取必要信息。\n"
)


def build_coordinator_graph(
    *,
    chat_model: BaseChatModel,
    model_router: LLMModelRouter,
    job_repo: JobRepository | None,
    app_repo: ApplicationRepository | None,
    eval_repo: EvalRepository | None,
    resume_repo: ResumeRepository | None,
    context_service: AgentContextService | None,
    resume_pipeline: AgentResumePipelineService | None,
    checkpointer: BaseCheckpointSaver | None = None,
) -> CompiledStateGraph:
    """
    依据当前请求的依赖容器构造一个全新的协调器编译图。

    每次新会话/新表单提交都构造一份新的图，复用同一个进程级 checkpointer
    （通过 session_key 作为 thread_id 区分会话）。

    Args:
        chat_model: 用于 supervisor 决策与所有子 Agent 推理的底层 BaseChatModel
        model_router: 兼容旧路由器，供需要直接调用 LLM 的工具（例如简历整理）使用
        *_repo / *_service / pipeline: 业务依赖；为 None 时对应工具会兜底返回错误
        checkpointer: 可注入测试用 InMemorySaver；不传则使用进程默认实例

    Returns:
        CompiledStateGraph: 已编译好的中心调度图
    """
    sub_agents = [
        build_generic_agent(chat_model),
        build_job_agent(chat_model),
        build_application_agent(chat_model),
        build_resume_agent(chat_model, pipeline=resume_pipeline, model_router=model_router),
        build_evaluation_agent(
            chat_model,
            app_repo=app_repo,
            job_repo=job_repo,
            eval_repo=eval_repo,
            resume_repo=resume_repo,
        ),
        build_memory_agent(chat_model, context_service=context_service),
    ]

    supervisor_graph = create_supervisor(
        agents=sub_agents,
        model=chat_model,
        prompt=COORDINATOR_PROMPT,
        state_schema=AgentRuntimeState,
        output_mode="last_message",
        add_handoff_messages=True,
        supervisor_name="coordinator",
    )
    compiled = supervisor_graph.compile(checkpointer=checkpointer or get_default_checkpointer())
    logger.debug("协调器图编译完成：sub_agents=%s", [agent.name for agent in sub_agents])
    return compiled


__all__ = ["COORDINATOR_PROMPT", "build_coordinator_graph"]
