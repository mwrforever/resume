"""
Agent 服务层 - 核心业务编排模块

本模块负责员工 Agent 会话的全部业务流程编排，包括：
- 会话管理（创建/查询/更新/删除）
- 消息处理（普通发送和流式发送）
- Prompt 构建（含长期记忆注入）
- Runtime Graph 执行（LangGraph 状态图）
- 临时动作生成与执行（需用户确认的业务操作）
- 业务数据快照构建（供内置工具使用）

调用链路：Endpoint → AgentService → AgentRepository/AgentContextService/AgentRuntimeGraph
"""

import logging
import time
import uuid
from collections.abc import AsyncIterator
from datetime import datetime
from typing import Any

from sqlalchemy.exc import SQLAlchemyError

from app.core.exceptions import ForbiddenError, NotFoundError, ValidationError
from app.llm.gateway import LLMGatewayError
from app.llm.streaming.event_emitter import AgentStreamEventEmitter
from app.schemas.agent.enums import AgentInterruptKind, AgentSseEventName
from app.schemas.agent.dto import AgentToolContextDTO
from app.schemas.agent.orchestrator_state import OrchestratorState
from app.schemas.agent.request import AgentRunResumeRequest, PlanReviewResumePayload
from app.llm.graphs.orchestrator_graph import AgentOrchestratorGraph
from app.services.agent_orchestrator_runner import AgentOrchestratorRunner
from app.services.agent_resume_pipeline_service import AgentResumePipelineService
from app.repositories.agent_repository import AgentRepository
from app.repositories.application_repository import ApplicationRepository
from app.repositories.evaluation_repository import EvalRepository
from app.repositories.job_repository import JobRepository
from app.repositories.resume_repository import ResumeRepository
from app.schemas.agent.dto import LLMResultDTO, LLMRuntimeConfigDTO
from app.schemas.agent.request import (
    AgentMessageCreate,
    AgentSessionCreate,
    AgentSessionUpdate,
    AgentTemporaryActionExecute,
)
from app.schemas.agent.response import (
    AgentMessageItem,
    AgentReply,
    AgentSessionDetail,
    AgentSessionItem,
    AgentStreamEvent,
    AgentTemporaryActionItem,
)
from app.services.agent_context_service import AgentContextService
from app.services.llm_config_service import LlmConfigService

logger = logging.getLogger(__name__)


class AgentService:
    """
    Agent 核心服务类 - 编排员工 Agent 会话的全部业务流程

    职责：
    1. 会话生命周期管理（CRUD）
    2. 消息发送与流式响应处理
    3. Prompt 构建与记忆管理
    4. Runtime Graph 执行编排
    5. 临时动作（待确认操作）的生成与执行
    6. 业务数据快照构建（供内置工具查询）

    该服务为无状态设计，所有请求级别的状态通过方法参数传递
    """

    def __init__(
        self,
        agent_repo: AgentRepository,
        llm_service: LlmConfigService,
        context_service: AgentContextService | None = None,
        orchestrator_runner: AgentOrchestratorRunner | None = None,
        job_repo: JobRepository | None = None,
        app_repo: ApplicationRepository | None = None,
        eval_repo: EvalRepository | None = None,
        resume_repo: ResumeRepository | None = None,
    ) -> None:
        """
        初始化 Agent 服务

        Args:
            agent_repo: 会话/消息数据访问层，负责数据库持久化
            llm_service: LLM 配置服务，负责模型路由和运行时配置构建
            context_service: 上下文服务，负责长期记忆管理和 Prompt 构建（可选）
            orchestrator_runner: 编排图运行器（可选，默认创建新实例）
            job_repo: 岗位数据访问层，供内置工具查询员工岗位数据（可选）
            app_repo: 投递数据访问层，供内置工具查询投递数据（可选）
            eval_repo: 评估数据访问层，供内置工具查询评估数据（可选）
        """
        self._agent_repo = agent_repo
        self._llm_service = llm_service
        self._context_service = context_service
        self._job_repo = job_repo
        self._app_repo = app_repo
        self._eval_repo = eval_repo
        self._resume_pipeline: AgentResumePipelineService | None = None
        if resume_repo and job_repo:
            self._resume_pipeline = AgentResumePipelineService(resume_repo, job_repo)
        orchestrator_graph = AgentOrchestratorGraph(resume_pipeline=self._resume_pipeline)
        self._orchestrator_runner = orchestrator_runner or AgentOrchestratorRunner(orchestrator_graph)

    async def create_session(self, body: AgentSessionCreate, current_user: dict) -> AgentSessionItem:
        """
        创建新的 Agent 会话

        Args:
            body: 会话创建请求，包含可选的初始模型选择
            current_user: 当前登录用户信息，必须为员工类型

        Returns:
            AgentSessionItem: 创建成功的会话概要信息

        流程：
        1. 从 current_user 提取员工 ID
        2. 如果指定了模型，构建运行时配置以获取模型来源
        3. 调用 repository 创建会话记录
        4. 返回会话概要
        """
        # 从登录信息中提取当前用户的员工 ID
        employee_id = self._get_employee_id(current_user)
        selected_model_source = None

        # 如果请求中指定了模型名称，则查询该模型的运行时配置以获取其来源标识
        # 模型来源用于区分配置来源于个人还是部门
        if body.selected_model_name:
            runtime_config = await self._build_runtime_config(current_user, body.selected_model_name)
            selected_model_source = runtime_config.source

        # 创建会话记录，使用 UUID 作为会话唯一标识
        session = await self._agent_repo.create_session(
            session_key=uuid.uuid4().hex,  # 全局唯一标识，用于安全引用
            employee_id=employee_id,        # 会话所属员工
            title=body.title,              # 会话标题（可为空）
            selected_model_name=body.selected_model_name,    # 选中的模型名
            selected_model_source=selected_model_source,    # 模型来源（env/personal/dept）
        )
        await self._agent_repo.commit()
        return AgentSessionItem.model_validate(session)

    async def list_sessions(self, page: int, page_size: int, current_user: dict, keyword: str | None = None) -> dict:
        """
        分页查询当前员工的未删除会话列表

        Args:
            page: 页码，从 1 开始
            page_size: 每页数量，范围 1-100
            current_user: 当前登录用户
            keyword: 可选的会话标题搜索关键字

        Returns:
            dict: 包含 total（总数量）和 items（会话列表）的分页数据
        """
        # 提取员工 ID 用于查询
        employee_id = self._get_employee_id(current_user)

        # 计算分页偏移量：(page - 1) * page_size
        skip = (page - 1) * page_size

        # 查询会话总数（用于分页导航）和会话列表
        total = await self._agent_repo.count_sessions(employee_id, keyword)
        items = await self._agent_repo.list_sessions(employee_id, skip, page_size, keyword)

        # 将 ORM 模型转换为 Pydantic 响应模型
        return {"total": total, "items": [AgentSessionItem.model_validate(item) for item in items]}

    async def get_session_detail(self, session_id: int, current_user: dict) -> AgentSessionDetail:
        """
        获取会话详情，包括消息列表和长期记忆

        Args:
            session_id: 会话 ID
            current_user: 当前登录用户

        Returns:
            AgentSessionDetail: 包含会话概要、消息列表和记忆列表的完整详情

        流程：
        1. 校验会话归属权
        2. 查询该会话下的所有消息（按时间排序）
        3. 查询该员工的长期记忆（用于上下文理解）
        4. 组装返回
        """
        # _get_session 会校验会话是否存在且属于当前用户
        session = await self._get_session(session_id, current_user)

        # 查询会话内的所有消息，按 sort_order 排序
        messages = await self._agent_repo.list_messages(session.id)

        # 初始化记忆列表（如果没有配置 context_service 则为空）
        memories: list = []
        if self._context_service:
            # 从长期记忆服务获取该员工的记忆
            memories = await self._context_service.list_memories(session.employee_id)

        # 组装完整的会话详情响应
        return AgentSessionDetail(
            session=AgentSessionItem.model_validate(session),           # 会话概要
            messages=[AgentMessageItem.model_validate(m) for m in messages],  # 消息列表
            memories=memories,                                           # 长期记忆列表
        )

    async def select_model(self, session_id: int, model_name: str | None, current_user: dict) -> AgentSessionItem:
        """
        更新会话选中的模型

        Args:
            session_id: 会话 ID
            model_name: 新的模型名称，None 表示使用配置文件默认模型
            current_user: 当前登录用户

        Returns:
            AgentSessionItem: 更新后的会话概要
        """
        session = await self._get_session(session_id, current_user)
        runtime_config = await self._build_runtime_config(current_user, model_name)
        updated = await self._agent_repo.update_session(
            session.id,
            selected_model_name=model_name,
            selected_model_source=runtime_config.source,
        )
        if not updated:
            raise NotFoundError("会话不存在")
        await self._agent_repo.commit()
        return AgentSessionItem.model_validate(updated)

    async def update_session(self, session_id: int, body: AgentSessionUpdate, current_user: dict) -> AgentSessionItem:
        """
        更新会话基础信息，目前主要用于重命名会话标题

        Args:
            session_id: 会话 ID
            body: 更新请求，目前只支持 title（标题）
            current_user: 当前登录用户

        Returns:
            AgentSessionItem: 更新后的会话概要
        """
        session = await self._get_session(session_id, current_user)
        updated = await self._agent_repo.update_session(session.id, title=body.title)
        if not updated:
            raise NotFoundError("会话不存在")
        await self._agent_repo.commit()
        return AgentSessionItem.model_validate(updated)

    async def delete_session(self, session_id: int, current_user: dict) -> None:
        """
        软删除会话

        执行后会话从列表和详情中隐藏，但数据保留以供审计。
        软删除通过 is_deleted 字段实现，比硬删除更安全。

        Args:
            session_id: 会话 ID
            current_user: 当前登录用户
        """
        session = await self._get_session(session_id, current_user)
        await self._agent_repo.soft_delete_session(session.id)
        await self._agent_repo.commit()

    async def _prepare_message_run(
        self,
        session_id: int,
        body: AgentMessageCreate,
        current_user: dict,
    ) -> tuple[Any, Any, Any, str, str | None, dict | None]:
        """send_message 与 stream_message 共用的前置准备逻辑：校验会话、构建运行时配置、创建用户消息、组装 Prompt。"""
        session = await self._get_session(session_id, current_user)
        runtime_config = await self._build_runtime_config(current_user, session.selected_model_name, body)
        user_message = await self._create_user_message(session, body)
        prompt, session_title, replay_payload = await self._prepare_prompt(
            session, body, user_message, runtime_config.enable_memory
        )
        return session, runtime_config, user_message, prompt, session_title, replay_payload

    async def send_message(self, session_id: int, body: AgentMessageCreate, current_user: dict) -> AgentReply:
        """
        处理用户普通消息发送（非流式）

        与流式发送的区别：不逐步 yield 中间状态，直接返回最终结果。
        适用于对实时性要求不高的场景。

        Args:
            session_id: 会话 ID
            body: 消息创建请求，包含内容和运行时选项
            current_user: 当前登录用户

        Returns:
            AgentReply: 完整的回复结果，包含用户消息、Agent 回复和更新后的会话信息
        """
        logger.info(
            "Agent消息发送开始：session_id=%s model_name=%s",
            session_id,
            body.selected_model_name or "默认",
        )
        session, runtime_config, user_message, prompt, session_title, _ = await self._prepare_message_run(
            session_id, body, current_user
        )
        return await self._execute_orchestrator(
            runtime_config, prompt, user_message, session, session_title, body, current_user
        )

    async def resume_session(
        self,
        session_id: int,
        body: AgentRunResumeRequest,
        current_user: dict,
    ) -> AsyncIterator[AgentStreamEvent]:
        """恢复 Planner interrupt 后继续编排（thread_id=session_key）。"""
        session = await self._get_session(session_id, current_user)
        if body.interrupt_kind != AgentInterruptKind.PLAN_REVIEW:
            raise ValidationError("当前仅支持规划审批恢复")

        messages = await self._agent_repo.list_messages(session.id)
        user_message = next((item for item in reversed(messages) if item.role == "user"), None)
        if user_message is None:
            raise ValidationError("未找到可关联的用户消息")

        emitter = self._build_stream_emitter(session)
        started_at = time.perf_counter()

        try:
            async for stream_event in self._consume_orchestrator_stream(
                self._orchestrator_runner.stream_resume(
                    session_key=session.session_key,
                    resume_payload=body.payload,
                    emitter=emitter,
                ),
                session=session,
                user_message=user_message,
            ):
                yield stream_event

            final_state, interrupted = await self._load_run_outcome(session.session_key)
            if interrupted:
                return

            llm_result = self._orchestrator_runner.build_final_result(session.session_key, final_state)
            if not llm_result:
                raise ValidationError("编排执行未产生有效回复")

            reply = await self._make_run_reply(
                session,
                user_message,
                final_state.runtime_config,
                started_at,
                None,
                failed=False,
                llm_result=llm_result,
            )
            yield AgentStreamEvent(event="final", data={"reply": reply.model_dump(mode="json")})
        except (LLMGatewayError, RuntimeError, ValueError, SQLAlchemyError) as exc:
            if isinstance(exc, SQLAlchemyError):
                await self._agent_repo.rollback()
            logger.exception("Agent恢复执行失败：session_id=%s", session.id)
            yield AgentStreamEvent(event="error", data={"message": str(exc)})

    async def stream_message(self, session_id: int, body: AgentMessageCreate, current_user: dict) -> AsyncIterator[AgentStreamEvent]:
        """
        处理用户消息发送（流式），通过 SSE 向客户端逐步推送事件

        事件序列：
        1. user_message    - 用户消息已创建
        2. tool_call        - 规划了工具调用（可选）
        3. tool_result      - 工具执行完成（可选）
        4. action_required  - 生成了待确认动作（可选）
        5. token            - LLM 流式输出增量
        6. final/error      - 最终回复或错误

        Args:
            session_id: 会话 ID
            body: 消息创建请求
            current_user: 当前登录用户

        Yields:
            AgentStreamEvent: 逐步推送的流式事件
        """
        session, runtime_config, user_message, prompt, session_title, replay_payload = await self._prepare_message_run(
            session_id, body, current_user
        )
        logger.info(
            "Agent流式消息发送开始：session_id=%s session_key=%s model_name=%s",
            session_id,
            session.session_key,
            runtime_config.model_name,
        )

        yield AgentStreamEvent(
            event="user_message",
            data={"message": AgentMessageItem.model_validate(user_message).model_dump(mode="json")}
        )

        started_at = time.perf_counter()
        emitter = self._build_stream_emitter(session)
        orchestrator_state = await self._build_orchestrator_initial_state(
            session=session,
            body=body,
            prompt=prompt,
            runtime_config=runtime_config,
            replay_payload=replay_payload,
        )

        try:
            async for stream_event in self._consume_orchestrator_stream(
                self._orchestrator_runner.stream_run(orchestrator_state, emitter=emitter),
                session=session,
                user_message=user_message,
            ):
                yield stream_event

            final_state, interrupted = await self._load_run_outcome(session.session_key)
            if interrupted:
                logger.info(
                    "Agent流式执行暂停于 interrupt：session_key=%s thread_id=%s",
                    session.session_key,
                    session.session_key,
                )
                return

            llm_result = self._orchestrator_runner.build_final_result(session.session_key, final_state)
            if not llm_result:
                llm_result = LLMResultDTO(content="", model_name=runtime_config.model_name)

            reply = await self._make_run_reply(
                session, user_message, runtime_config, started_at, session_title,
                failed=False, llm_result=llm_result,
            )
            yield AgentStreamEvent(event="final", data={"reply": reply.model_dump(mode="json")})
        except (LLMGatewayError, RuntimeError, ValueError, SQLAlchemyError) as exc:
            if isinstance(exc, SQLAlchemyError):
                await self._agent_repo.rollback()

            logger.exception("Agent流式消息执行失败：session_id=%s", session.id)
            reply = await self._make_run_reply(
                session, user_message, runtime_config, started_at, session_title,
                failed=True, error_text=str(exc),
            )
            yield AgentStreamEvent(
                event="error",
                data={"message": str(exc), "reply": reply.model_dump(mode="json")}
            )

    async def upload_session_resume(
        self,
        session_id: int,
        file,
        job_id: int,
        current_user: dict,
    ) -> dict:
        """
        Agent 会话内上传候选人简历，须绑定岗位 ID（会话上下文）；文本解析在发消息时由内置工具完成。

        返回 resume_id 供发消息时写入 context_refs。
        """
        if not self._resume_pipeline:
            raise ValidationError("简历上传服务未配置")
        session = await self._get_session(session_id, current_user)
        await self._resume_pipeline.ensure_job_owned_by_employee(job_id, session.employee_id)
        uploaded = await self._resume_pipeline.upload_resume_for_employee(session.employee_id, file)
        uploaded["job_id"] = job_id
        logger.info(
            "Agent 会话简历附件已上传：session_id=%s resume_id=%s job_id=%s",
            session.id,
            uploaded.get("resume_id"),
            job_id,
        )
        return uploaded

    async def _build_orchestrator_initial_state(
        self,
        *,
        session,
        body: AgentMessageCreate,
        prompt: str,
        runtime_config: LLMRuntimeConfigDTO,
        replay_payload: dict | None,
    ) -> OrchestratorState:
        """根据消息体组装编排初始 State，含简历附件路由标记。"""
        resume_context = None
        has_resume = False
        if self._resume_pipeline:
            resume_context = self._resume_pipeline.parse_resume_context_ref(body.context_refs)
            has_resume = resume_context is not None
        tool_context = await self._build_tool_context(session.employee_id, replay_payload)
        return OrchestratorState(
            session_id=session.id,
            session_key=session.session_key,
            employee_id=session.employee_id,
            user_input=body.content,
            prompt=prompt,
            runtime_config=runtime_config,
            tool_context=tool_context,
            has_resume_attachment=has_resume,
            resume_context=resume_context,
        )

    async def _create_user_message(self, session, body: AgentMessageCreate):
        """
        创建用户消息记录

        用户消息作为 Agent 回复和临时动作事件的关联锚点，
        通过 parent_message_id 形成对话链条。

        Args:
            session: 会话对象
            body: 消息创建请求

        Returns:
            创建的消息记录（ORM 对象）
        """
        user_message = await self._agent_repo.create_message(
            session_id=session.id,
            role="user",
            message_type="text",
            content={
                "context_refs": body.context_refs,
                "blocks": [{"type": "text", "text": body.content}],
            },
            sort_order=await self._agent_repo.next_message_order(session.id),
        )
        return user_message

    async def _prepare_prompt(
        self,
        session,
        body: AgentMessageCreate,
        user_message,
        enable_memory: bool,
    ) -> tuple[str, str | None, dict | None]:
        """
        构建最终提交给 LLM 的 Prompt

        Prompt 构建策略：
        1. 如果禁用记忆或未配置 context_service，直接返回用户输入
        2. 否则，从用户输入中提取偏好存入长期记忆
        3. 合并长期记忆和近期消息，通过 PromptManager 渲染完整模板

        Args:
            session: 会话对象
            body: 消息创建请求
            user_message: 已创建的用户消息对象
            enable_memory: 是否启用记忆功能

        Returns:
            tuple[str, str | None, dict | None]:
            - prompt: 完整 Prompt 文本
            - session_title: 如果是首条消息，生成会话标题
            - replay_payload: 上下文数据，用于构建工具执行时的业务快照
        """
        # 如果是会话的第一条消息（sort_order == 1），从用户输入生成简短标题
        session_title = self._build_session_title(body.content) if user_message.sort_order == 1 else None

        # 禁用记忆或无 context_service 时，直接返回原始输入
        if not enable_memory or not self._context_service:
            return body.content, session_title, None

        await self._context_service.upsert_preference_memory(
            session.employee_id, session.id, body.content
        )

        memories = await self._context_service.list_memories(session.employee_id, True)

        messages_before_run = await self._agent_repo.list_messages(session.id)
        recent_messages = [message for message in messages_before_run if message.id != user_message.id]

        prompt = await self._context_service.build_prompt(body.content, recent_messages, memories)

        replay_payload = self._context_service.build_replay_payload(
            raw_content=body.content,
            context_refs=body.context_refs,
            resolved_prompt=prompt,
            recent_messages=recent_messages,
            memories=memories,
            user_message_id=user_message.id,
        )
        return prompt, session_title, replay_payload

    async def _build_tool_context(self, employee_id: int, replay_payload: dict | None) -> AgentToolContextDTO:
        """
        构建工具执行时的上下文实体。

        这个上下文传递给内置工具，供工具查询业务数据。
        包含：近期消息引用、记忆引用、业务数据快照。

        Args:
            employee_id: 员工 ID
            replay_payload: _prepare_prompt 返回的上下文数据

        Returns:
            AgentToolContextDTO: 结构化工具上下文
        """
        context = replay_payload or {}
        return AgentToolContextDTO(
            recent_messages=[
                {"id": message_id} for message_id in context.get("recent_message_ids", [])
            ],
            memories=[
                {"id": memory_id} for memory_id in context.get("memory_ids", [])
            ],
            business=await self._build_business_tool_snapshot(employee_id),
        )

    async def _build_business_tool_snapshot(self, employee_id: int) -> dict[str, Any]:
        """
        构建业务数据快照，供内置工具查询

        该快照在 Agent 执行开始时构建，包含员工可见的：
        - 岗位列表（最多20个）
        - 投递列表（最多20个）
        - 评估列表（最多10个）

        Args:
            employee_id: 员工 ID

        Returns:
            dict: 包含 jobs、applications、evaluations 的业务快照
        """
        # 如果未配置业务数据访问层，返回空快照
        # 这允许 Agent 在没有完整数据权限时仍能运行（但功能受限）
        if not self._job_repo or not self._app_repo or not self._eval_repo:
            return {"jobs": [], "applications": [], "evaluations": []}

        # 查询该员工负责的所有岗位（用于后续筛选投递）
        jobs = await self._job_repo.get_by_employee(employee_id)
        job_ids = [job.id for job in jobs[:20]]  # 最多取20个岗位

        # 如果员工没有负责任何岗位，返回空快照
        if not job_ids:
            logger.info(
                "Agent业务工具快照构建完成：employee_id=%s job_count=0 application_count=0 evaluation_count=0",
                employee_id
            )
            return {"jobs": [], "applications": [], "evaluations": []}

        # 批量查询各岗位的投递数量（用于展示）
        application_counts = await self._job_repo.batch_count_applications(job_ids)

        # 查询这些岗位下的所有投递（最多20个）
        app_rows = await self._app_repo.get_all(0, 20, job_ids=job_ids)

        # 收集投递 ID 用于查询评估数据
        application_ids = [row[0].id for row in app_rows]

        # 批量查询投递的匹配评估信息
        match_map = await self._eval_repo.get_matches_by_application_ids(application_ids)

        # 一次性批量拉取所有需要的评估详情，消除 N+1
        match_ids = [mid for mid in match_map.values() if mid]
        matches = await self._eval_repo.get_matches_by_ids(match_ids) if match_ids else {}

        # 构建评估列表（包含分数、标签等）
        evaluations = []
        for application, _ in app_rows[:10]:  # 最多10个评估
            match_id = match_map.get(application.id)
            match = matches.get(match_id) if match_id else None
            if match:
                evaluations.append({
                    "match_id": match.id,
                    "application_id": application.id,
                    "job_id": application.job_id,
                    "final_score": float(match.final_score) if match.final_score is not None else None,
                    "final_label": match.final_label,
                    "error_message": match.error_message,
                })

        snapshot = {
            "jobs": [
                {
                    "id": job.id,
                    "name": job.name,
                    "status": job.status,
                    "dept_id": job.dept_id,
                    "template_id": job.template_id,
                    "application_count": application_counts.get(job.id, 0),
                }
                for job in jobs[:20]
            ],
            "applications": [
                {
                    "id": application.id,
                    "job_id": application.job_id,
                    "job_name": (application.job_snapshot or {}).get("job", {}).get("name", ""),
                    "resume_id": application.resume_id,
                    "user_name": user_name,
                    "status": application.status,
                    "match_id": match_map.get(application.id),
                }
                for application, user_name in app_rows
            ],
            "evaluations": evaluations,
        }

        logger.info(
            "Agent业务工具快照构建完成：employee_id=%s job_count=%s application_count=%s evaluation_count=%s",
            employee_id,
            len(snapshot["jobs"]),
            len(snapshot["applications"]),
            len(snapshot["evaluations"]),
        )
        return snapshot

    def _build_temporary_action(
        self,
        session,
        message_id: int,
        action_payload: dict[str, Any],
    ) -> AgentTemporaryActionItem:
        """
        构造本次流式响应内的临时待确认动作

        临时动作不写入数据库，仅存在于当前流式响应中。
        前端收到 action_required 事件后弹出确认对话框，
        用户确认后调用 execute_temporary_action 执行真正的业务操作。

        Args:
            session: 会话对象
            message_id: 触发该动作的用户消息 ID
            action_payload: 工具返回的动作详情

        Returns:
            AgentTemporaryActionItem: 待确认动作的响应模型
        """
        action = AgentTemporaryActionItem(
            id=f"tmp-{uuid.uuid4().hex}",
            session_id=session.id,
            message_id=message_id,
            employee_id=session.employee_id,
            capability_key=action_payload.get("capability_key") or "unknown",
            action_name=action_payload.get("action_name") or "待确认动作",
            target_type=action_payload.get("target_type"),
            target_id=action_payload.get("target_id"),
            input_payload=action_payload.get("input_payload") or {},
            preview_payload=action_payload.get("preview_payload") or {},
            status=1,
        )
        logger.info(
            "Agent临时待确认动作已生成：action_id=%s capability_key=%s",
            action.id,
            action.capability_key,
        )
        return action

    async def _execute_orchestrator(
        self,
        runtime_config: LLMRuntimeConfigDTO,
        prompt: str,
        user_message,
        session,
        session_title: str | None,
        body: AgentMessageCreate,
        current_user: dict,
    ) -> AgentReply:
        """非流式发送：消费编排流直至结束（若中断则提示需审批）。"""
        started_at = time.perf_counter()
        async for _event in self.stream_message(session.id, body, current_user):
            pass
        final_state, interrupted = await self._load_run_outcome(session.session_key)
        if interrupted:
            return await self._make_run_reply(
                session,
                user_message,
                runtime_config,
                started_at,
                session_title,
                failed=True,
                error_text="规划待审批，请使用流式界面确认计划后继续",
            )
        llm_result = self._orchestrator_runner.build_final_result(session.session_key, final_state)
        if not llm_result or not llm_result.content:
            return await self._make_run_reply(
                session,
                user_message,
                runtime_config,
                started_at,
                session_title,
                failed=True,
                error_text=final_state.error_message or "模型调用失败",
            )
        return await self._make_run_reply(
            session,
            user_message,
            runtime_config,
            started_at,
            session_title,
            failed=False,
            llm_result=llm_result,
        )

    @staticmethod
    def _build_stream_emitter(session) -> AgentStreamEventEmitter:
        """构造流式事件发射器，run_id 每次消息唯一，thread_id 使用 session_key。"""
        return AgentStreamEventEmitter(session_id=session.id, session_key=session.session_key)

    async def _consume_orchestrator_stream(
        self,
        event_iterator: AsyncIterator[tuple[AgentSseEventName, dict]],
        *,
        session,
        user_message,
    ) -> AsyncIterator[AgentStreamEvent]:
        """将编排 SSE 元组转为 AgentStreamEvent，并补全 action_required 临时动作结构。"""
        async for sse_name, payload in event_iterator:
            if sse_name == AgentSseEventName.LEGACY:
                legacy_event = payload.get("event")
                legacy_data = payload.get("data") or {}
                if legacy_event == "action_required":
                    action_payload = legacy_data.get("action")
                    if isinstance(action_payload, dict):
                        action = self._build_temporary_action(session, user_message.id, action_payload)
                        legacy_data = {"action": action.model_dump(mode="json")}
                yield AgentStreamEvent(event=str(legacy_event), data=legacy_data)
                continue
            yield AgentStreamEvent(event=sse_name.value, data=payload)

    async def _load_run_outcome(self, session_key: str) -> tuple[OrchestratorState, bool]:
        """读取 checkpoint 终态，并判断是否仍处于 interrupt。"""
        snapshot = await self._orchestrator_runner.get_graph_state(session_key)
        interrupted = bool(snapshot and snapshot.interrupts)
        state = await self._orchestrator_runner.load_state(session_key)
        return state, interrupted

    async def _make_run_reply(
        self,
        session,
        user_message,
        runtime_config,
        started_at: float,
        session_title: str | None,
        *,
        failed: bool,
        error_text: str | None = None,
        llm_result=None,
    ) -> AgentReply:
        """封装运行结束后构建回复的通用逻辑，自动计算耗时与推导模型名。"""
        latency_ms = self._elapsed_ms(started_at)
        model_name = llm_result.model_name if llm_result else runtime_config.model_name
        return await self._build_reply(
            session,
            user_message,
            model_name,
            latency_ms,
            error_text,
            session_title,
            failed=failed,
            llm_result=llm_result,
            use_memory=runtime_config.enable_memory,
        )

    @staticmethod
    def _elapsed_ms(started_at: float) -> int:
        """计算从 started_at 到当前的耗时（毫秒）。"""
        return int((time.perf_counter() - started_at) * 1000)

    async def _build_reply(
        self,
        session,
        user_message,
        model_name: str,
        latency_ms: int,
        error_text: str | None,
        session_title: str | None,
        *,
        failed: bool,
        llm_result=None,
        use_memory: bool = True,
    ) -> AgentReply:
        """
        构造 Agent 回复

        将 LLM 调用结果（或错误信息）持久化为 Agent 消息，
        并更新会话状态（标题、最近消息时间等）。

        Args:
            session: 会话对象
            user_message: 关联的用户消息
            model_name: 使用的模型名称
            latency_ms: 执行耗时（毫秒）
            error_text: 错误信息（如果有）
            session_title: 会话标题（首条消息时生成）
            failed: 是否为失败回复
            llm_result: LLM 调用结果（成功时提供）
            use_memory: 是否启用记忆

        Returns:
            AgentReply: 完整的回复结果
        """
        content = error_text or (llm_result.content if llm_result else None)
        token_count = 0 if failed or not llm_result else llm_result.total_tokens

        agent_message = await self._agent_repo.create_message(
            session_id=session.id,
            parent_message_id=user_message.id,
            role="agent",
            message_type="text",
            content={
                "context_refs": [],
                "blocks": [{"type": "text", "text": content}],
            },
            model_name=model_name,
            token_count=token_count,
            sort_order=await self._agent_repo.next_message_order(session.id),
        )

        session_status = 5 if failed else 1
        updated_session = await self._update_session_status(session.id, session_title, session_status)

        memories = await self._build_context_data(session) if not failed and use_memory else []

        logger.info(
            "Agent回复已完成：session_id=%s latency_ms=%s failed=%s",
            session.id,
            latency_ms,
            failed,
        )

        await self._agent_repo.commit()
        return AgentReply(
            user_message=AgentMessageItem.model_validate(user_message),
            agent_message=AgentMessageItem.model_validate(agent_message),
            session=AgentSessionItem.model_validate(updated_session) if updated_session else None,
            memories=memories,
        )

    async def _update_session_status(
        self,
        session_id: int,
        session_title: str | None,
        status: int,
    ):
        """
        更新会话状态和最近消息时间

        首条消息时还会同步更新会话标题和上下文摘要。

        Args:
            session_id: 会话 ID
            session_title: 会话标题（仅首条消息时提供）
            status: 会话状态（1 正常 / 5 失败）

        Returns:
            更新后的会话对象
        """
        session_payload: dict = {
            "status": status,
            "last_message_time": datetime.now(),
        }
        if session_title:
            session_payload["title"] = session_title
            session_payload["context_summary"] = session_title

        return await self._agent_repo.update_session(session_id, **session_payload)

    async def _build_context_data(self, session) -> list:
        """
        重新加载长期记忆，供前端即时刷新展示

        在每次成功回复后调用，获取最新的记忆数据。

        Args:
            session: 会话对象

        Returns:
            list: 长期记忆列表
        """
        if not self._context_service:
            return []
        return await self._context_service.list_memories(session.employee_id)

    async def _build_runtime_config(
        self,
        current_user: dict,
        model_name: str | None,
        body: AgentMessageCreate | None = None,
    ) -> LLMRuntimeConfigDTO:
        """
        构建本次运行的运行时配置

        从 LLM 配置服务获取模型连接配置（API Key、Base URL 等），
        并根据请求体的 runtime_options 应用临时覆盖（如思考模式开关）。

        Args:
            current_user: 当前登录用户
            model_name: 模型名称，None 表示使用默认模型
            body: 消息创建请求（可选），包含 runtime_options

        Returns:
            LLMRuntimeConfigDTO: 完整的运行时配置
        """
        runtime_config = await self._llm_service.get_runtime_config(current_user, model_name)
        if body and body.runtime_options and body.runtime_options.enable_thinking is not None:
            return runtime_config.model_copy(
                update={"enable_thinking": body.runtime_options.enable_thinking}
            )
        return runtime_config

    async def execute_temporary_action(
        self,
        body: AgentTemporaryActionExecute,
        current_user: dict,
    ) -> AgentTemporaryActionItem:
        """
        执行前端回传的临时动作（用户确认后的业务操作）

        该方法在用户确认 action_required 事件后被调用。
        目前仅支持 application.update_status（投递状态更新）。

        Args:
            body: 临时动作执行请求，包含目标、能力、参数等
            current_user: 当前登录用户

        Returns:
            AgentTemporaryActionItem: 执行结果
        """
        employee_id = self._get_employee_id(current_user)
        if body.capability_key != "application.update_status":
            raise ValidationError("临时动作能力未启用")
        await self._execute_application_status_action(body, employee_id)

        logger.info(
            "Agent临时动作已执行：capability_key=%s target_id=%s",
            body.capability_key,
            body.target_id,
        )

        return AgentTemporaryActionItem(
            id=f"tmp-executed-{uuid.uuid4().hex}",
            session_id=0,
            message_id=None,
            employee_id=employee_id,
            capability_key=body.capability_key,
            action_name=body.action_name,
            target_type=body.target_type,
            target_id=body.target_id,
            input_payload=body.input_payload,
            preview_payload=body.preview_payload,
            status=4,  # 4 = 已执行
        )

    async def _execute_application_status_action(
        self,
        action: AgentTemporaryActionExecute,
        employee_id: int,
    ) -> None:
        """
        执行投递状态变更临时动作

        重新校验权限和数据完整性，然后调用 ApplicationRepository 执行状态更新。
        整个操作在事务内完成，确保数据一致性。

        Args:
            action: 动作执行请求
            employee_id: 当前员工 ID

        Raises:
            ValidationError: 参数校验失败
            NotFoundError: 投递不存在
            ForbiddenError: 无权操作该投递
        """
        if not self._app_repo or not self._job_repo:
            raise ValidationError("投递状态更新能力未启用")

        application_id, status = self._parse_application_status_payload(action)
        application = await self._app_repo.get_by_id(application_id)
        if not application:
            raise NotFoundError("投递不存在")

        jobs = await self._job_repo.get_by_employee(employee_id)
        if application.job_id not in {job.id for job in jobs}:
            raise ForbiddenError("无权操作该投递")

        try:
            changed = await self._app_repo.update_status_active_without_commit(application_id, status)
            if not changed:
                await self._agent_repo.rollback()
                raise NotFoundError("投递不存在")
            await self._agent_repo.commit()

            logger.info(
                "Agent临时投递状态动作已执行：application_id=%s status=%s",
                application_id,
                status,
            )

        except SQLAlchemyError:
            await self._agent_repo.rollback()
            logger.exception("Agent临时动作事务提交失败：application_id=%s", application_id)
            raise

    def _parse_application_status_payload(self, action) -> tuple[int, int]:
        """
        解析并校验投递状态动作参数

        Args:
            action: 动作执行请求

        Returns:
            tuple[int, int]: (application_id, target_status)

        Raises:
            ValidationError: 参数缺失或非法
        """
        try:
            application_id = int(action.input_payload.get("application_id") or 0)
            status = int(action.input_payload.get("status") or -1)
        except (TypeError, ValueError) as exc:
            raise ValidationError("投递状态更新参数不完整") from exc

        if application_id <= 0:
            raise ValidationError("投递 ID 不合法")
        if status not in {1, 2, 3, 4, 5}:
            raise ValidationError("投递目标状态不合法")

        # 校验 target_id 与 application_id 一致（防止数据篡改）
        if action.target_id != application_id:
            raise ValidationError("动作目标与投递参数不一致")

        return application_id, status

    async def _get_session(self, session_id: int, current_user: dict):
        """
        校验当前员工是否拥有指定会话，并返回会话实体

        这是所有会话操作的权限校验入口，确保用户只能访问自己的会话。

        Args:
            session_id: 会话 ID
            current_user: 当前登录用户

        Returns:
            会话实体对象

        Raises:
            NotFoundError: 会话不存在或不属于当前用户
        """
        employee_id = self._get_employee_id(current_user)

        # 调用 repository 查询会话，同时校验归属权
        session = await self._agent_repo.get_session(session_id, employee_id)
        if not session:
            raise NotFoundError("会话不存在")
        return session

    def _get_employee_id(self, current_user: dict) -> int:
        """
        从登录态中提取员工 ID，并校验用户类型

        Args:
            current_user: 当前登录用户信息

        Returns:
            int: 员工 ID

        Raises:
            ForbiddenError: 非员工账号尝试访问 Agent 能力
        """
        if current_user.get("user_type") != "employee":
            raise ForbiddenError("仅员工账号可访问")
        return int(current_user["sub"])

    def _build_session_title(self, content: str) -> str:
        """根据首条用户消息生成简短会话标题，超出 30 字符截断并追加省略号。"""
        return content if len(content) <= 30 else content[:30] + "..."
