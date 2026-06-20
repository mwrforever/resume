"""
AgentRuntimeService：SSE 编排核心。

职责：
- stream_message：构造 emitter + ctx → 调 Runner → 把所有 envelope 写入 Redis buffer → 落库 → yield
- resolve_interaction：用 Command(resume=values) 恢复 graph，复用 stream_message 编排
- 收尾时把 emitter 累积的 envelope 折叠成 agent_message.content.blocks

不做：业务规则、Prompt、LLM 调用、session CRUD。
"""

from __future__ import annotations

import asyncio
import logging
import uuid
from collections.abc import AsyncIterator, Callable
from datetime import datetime
from typing import Any

from langgraph.types import Command

from app.core.exceptions import ValidationError
from app.llm.graphs.workflows.runner import AgentWorkflowRunner
from app.llm.graphs.workflows.context import WorkflowRuntimeContext
from app.llm.streaming.emitter import AgentStreamEmitter
from app.repositories.agent_repository import AgentRepository
from app.schemas.agent.dto import LLMRuntimeConfigDTO
from app.schemas.agent.request import AgentInteractionSubmit, AgentMessageCreate
from app.schemas.agent.stream import AgentStreamEnvelope
from app.services.cache_service import CacheService

logger = logging.getLogger(__name__)

def _is_missing_checkpoint_error(exc: Exception) -> bool:
    """判定是否为 checkpoint 丢失错误（InMemorySaver 服务重启后 resume）。

    LangGraph 在 thread 无 checkpoint 时以 None 输入续接会抛错，含 "checkpoint"/
    "no state"/"thread not found" 相关信息。宽松匹配避免漏判。

    @param exc: graph 执行异常
    @return True 表示属于 checkpoint 丢失场景，调用方应降级为 no_resumable_checkpoint 错误码
    """
    msg = str(exc).lower()
    return (
        "checkpoint" in msg
        or "no state" in msg
        or ("thread" in msg and "not found" in msg)
    )


STREAM_BUFFER_KEY = "agent:stream_buffer:{session_id}:{run_id}"
STREAM_BUFFER_TTL = 1800  # 30 分钟
# 本会话已分配的最大 block index 缓存（跨 run 全局递增）。
# 热路径：emitter 启动读此 key 决定 index_start；冷路径（miss）回退 DB last_block_index。
BLOCK_INDEX_KEY = "agent:block_index:{session_id}"
BLOCK_INDEX_TTL = 86400  # 1 天（会话生命周期内有效）


class AgentRuntimeService:
    """SSE 编排 + Redis buffer + 消息落库。"""

    def __init__(
        self, *,
        repo: AgentRepository,
        cache: CacheService,
        workflow_graphs: dict[str, Any],
        runner_factory: Callable[[Any], AgentWorkflowRunner],
        interview_service,
        evaluation_service,
        resume_loader,
    ) -> None:
        self._repo = repo
        self._cache = cache
        self._workflow_graphs = workflow_graphs
        self._runner_factory = runner_factory
        self._interview_service = interview_service
        self._evaluation_service = evaluation_service
        self._resume_loader = resume_loader

    async def _resolve_block_index_start(self, session) -> int:
        """解析本 run 的 block index 起始值（跨 run 全局递增）。

        优先读 Redis 缓存（热路径）；miss 则用 DB session.last_block_index（冷路径，
        兼容 Redis 重启/丢失）。返回 last + 1 作为本 run 第一个 block 的 index。

        约束：每会话同一时刻只有一个活跃 run，故读改写无并发冲突。

        @param session: AgentSession ORM 对象（提供 last_block_index 作 DB 兜底）
        """
        key = BLOCK_INDEX_KEY.format(session_id=session.id)
        try:
            cached = await self._cache.client.get(key)
            if cached is not None:
                return int(cached) + 1
        except Exception:
            logger.exception("读取 block index 缓存失败：session_id=%s", session.id)
        # Redis miss / 异常 → 回退 DB session.last_block_index
        db_last = int(getattr(session, "last_block_index", 0) or 0)
        return db_last + 1

    async def _persist_block_index(
        self, session_id: int, max_index: int,
    ) -> None:
        """run.finish 时延时落库本会话最新 block index（Redis + DB）。

        Redis 设为最新值（热路径供下一 run 读）；DB session.last_block_index 同步更新
        （冷路径兜底，保证 Redis 丢失后仍能恢复）。失败仅日志，不阻塞主流程。
        """
        key = BLOCK_INDEX_KEY.format(session_id=session_id)
        try:
            await self._cache.client.set(key, max_index, ex=BLOCK_INDEX_TTL)
        except Exception:
            logger.exception("写入 block index 缓存失败：session_id=%s", session_id)
        try:
            await self._repo.update_session(session_id, last_block_index=max_index)
        except Exception:
            logger.exception("延时落库 last_block_index 失败：session_id=%s", session_id)

    async def _persist_progress(
        self, session, run_steps: list[dict], workflow_type: str, *, reset: bool,
    ) -> None:
        """把本 run 的 step.update 序列合并进 session.progress 并落库。

        @param reset: True=新 task（stream_message），丢弃已有 steps；
                      False=续接（resolve/resume），合并已有 steps（跨 interaction 段累积）。
        """
        existing: list[dict] = []
        if not reset:
            prog = getattr(session, "progress", None) or {}
            existing = (prog.get("steps") or []) if isinstance(prog, dict) else []
        # 按 step_id upsert：新覆盖旧（状态更新），保留首次出现顺序
        by_id: dict[str, dict] = {}
        for s in existing:
            sid = str(s.get("step_id") or "")
            if sid:
                by_id[sid] = s
        for s in run_steps:
            sid = str(s.get("step_id") or "")
            if not sid:
                continue
            entry: dict = {
                "step_id": sid,
                "title": s.get("title", ""),
                "status": s.get("status", "pending"),
            }
            if s.get("detail"):
                entry["detail"] = s["detail"]
            by_id[sid] = entry
        merged = list(by_id.values())
        progress = {"workflow_type": workflow_type, "steps": merged}
        try:
            await self._repo.update_session(session.id, progress=progress)
            session.progress = progress  # 保持内存对象新鲜
        except Exception:
            logger.exception("持久化 progress 失败：session_id=%s", session.id)

    @staticmethod
    def _has_interrupt(envelopes: list[AgentStreamEnvelope]) -> bool:
        """判断本 run 是否以 interrupt（人机交互卡片）结束。

        LangGraph 遇到 interrupt() 时 astream 会正常结束迭代（不抛异常），
        故不能仅凭"无异常"判定 graph 完成。通过检测是否产出 interaction.request
        事件来区分：有 → 中断等待用户；无 → 正常走到 END。
        """
        return any(env.type == "interaction.request" for env in envelopes)

    async def stream_message(
        self, *, session, body: AgentMessageCreate, runtime_config: LLMRuntimeConfigDTO,
    ) -> AsyncIterator[AgentStreamEnvelope]:
        """新一轮 run：落库用户消息 → 跑 graph → 落库 agent 消息。

        Args:
            session: AgentSession ORM 对象
            body: 用户消息创建请求体
            runtime_config: LLM 运行时配置

        Yields:
            AgentStreamEnvelope 协议事件（run.start → step/block events → run.finish）
        """
        run_id = f"run_{uuid.uuid4().hex[:12]}"
        # 解析本 run 的 block index 起始值（跨 run 全局递增，避免驳回循环时 index 冲突/覆盖）
        index_start = await self._resolve_block_index_start(session)
        emitter = AgentStreamEmitter(
            session_id=session.id, run_id=run_id, workflow_type=body.workflow_type,
            index_start=index_start,
        )
        ctx = WorkflowRuntimeContext(
            emitter=emitter, runtime_config=runtime_config,
            interview_service=self._interview_service,
            evaluation_service=self._evaluation_service,
            resume_loader=self._resume_loader,
            session_id=session.id, employee_id=session.employee_id, run_id=run_id,
        )
        # 解析简历引用（前端 context_refs 优先，否则从 Redis 会话引用读取）
        resume_ref = await self._resolve_resume_ref(session.id, body)
        graph_input = await self._build_graph_input(body, resume_ref)
        # 落库用户消息
        user_message = await self._create_user_message(
            session, body, run_id=run_id, runtime_config=runtime_config,
        )

        envelope_buffer: list[AgentStreamEnvelope] = []
        # 本 run 累积的 step.update 序列，供 finally 持久化到 session.progress
        run_steps: list[dict] = []

        # 发射 run.start
        env = emitter.emit_run_start(
            enable_thinking=runtime_config.enable_thinking,
            user_message_id=user_message.id,
        )
        envelope_buffer.append(env)
        await self._buffer_append(session.id, run_id, env)
        yield env

        # 运行 graph
        runner = self._runner_factory(self._workflow_graphs[body.workflow_type])
        thread_id = await self._resolve_thread_id(session)
        graph_completed = False  # 仅"无异常 且 未中断（走到 END）"才视为完成
        # client_aborted：客户端中途断开（fetch.abort），asyncio 抛 CancelledError/GeneratorExit。
        # 此时 yield 已不可用（连接已断），但已生成的 envelopes 必须落库到 agent_message，
        # 让用户在新一轮发送 / reload 时能看到中断前的内容（业务规则：可终止状态发送先中断、保留已生成内容）。
        client_aborted = False
        try:
            try:
                async for env in runner.astream(
                    thread_id=thread_id, graph_input=graph_input, ctx=ctx,
                ):
                    envelope_buffer.append(env)
                    if env.type == "step.update":
                        run_steps.append(env.data)
                    await self._buffer_append(session.id, run_id, env)
                    yield env
            except (GeneratorExit, asyncio.CancelledError):
                # 客户端断开：标记 aborted，不再 yield；落到外层 finally 完成落库
                client_aborted = True
                logger.info(
                    "客户端中断流式 run，转入收尾落库：session_id=%s run_id=%s",
                    session.id, run_id,
                )
                raise
            except Exception as exc:
                graph_completed = False
                logger.exception("Graph 执行异常：session_id=%s run_id=%s", session.id, run_id)
                err_env = emitter.emit_run_error(
                    code="graph_execution_failed", message=str(exc), retriable=False,
                )
                envelope_buffer.append(err_env)
                await self._buffer_append(session.id, run_id, err_env)
                yield err_env
            else:
                # 无异常：还需区分 interrupt（等待用户）与 END（真正完成）
                graph_completed = not self._has_interrupt(envelope_buffer)
        finally:
            # 不论正常 / 异常 / 客户端中断，都把已生成的 envelopes 折叠落库；
            # 客户端中断时跳过 yield 与 task_id 推进（保留 thread 让下一轮 resume 命中 checkpoint）。
            try:
                agent_message = await self._persist_agent_message(
                    session=session, user_message=user_message, run_id=run_id,
                    envelopes=envelope_buffer, runtime_config=runtime_config,
                    workflow_type=body.workflow_type,
                )
            except Exception:
                logger.exception(
                    "收尾落库失败：session_id=%s run_id=%s aborted=%s",
                    session.id, run_id, client_aborted,
                )
                agent_message = None
            # 仅 graph 真正走到 END 才推进 task_id（A2：client_aborted 保留 thread 供续接）。
            # interrupt/异常保持不变以保证 resume 命中正确 checkpoint。
            advance = graph_completed
            next_task_id = await self._advance_task_id(session) if advance else None
            # 延时落库 block index：本 run 已分配的 index 不能被下一 run 复用
            try:
                await self._persist_block_index(session.id, emitter.max_block_index_used)
            except Exception:
                logger.exception("延时落库 block index 失败：session_id=%s", session.id)
            # 持久化累积进度到 session.progress（reset=True：新 task 丢弃旧 steps）
            try:
                await self._persist_progress(
                    session, run_steps, body.workflow_type, reset=True,
                )
            except Exception:
                logger.exception("stream_message 持久化 progress 失败：session_id=%s", session.id)
            # 客户端已断开 → 不再 yield finish（连接已无效），仅完成落库后退出
            if not client_aborted and agent_message is not None:
                finish_env = emitter.emit_run_finish(
                    agent_message_id=agent_message.id, next_task_id=next_task_id,
                )
                await self._buffer_append(session.id, run_id, finish_env)
                yield finish_env
            # 清理 Redis buffer
            try:
                await self._cache.client.delete(
                    STREAM_BUFFER_KEY.format(session_id=session.id, run_id=run_id),
                )
            except Exception:
                logger.exception("清理 stream buffer 失败：session_id=%s run_id=%s",
                                 session.id, run_id)

    async def resolve_interaction(
        self, *, session, request_id: str, body: AgentInteractionSubmit,
        runtime_config: LLMRuntimeConfigDTO, workflow_type: str,
    ) -> AsyncIterator[AgentStreamEnvelope]:
        """提交 interaction 恢复 graph。

        Args:
            session: AgentSession ORM 对象
            request_id: 前端提交的 interaction request_id
            body: interaction 提交内容
            runtime_config: LLM 运行时配置
            workflow_type: 工作流类型

        Yields:
            AgentStreamEnvelope 协议事件
        """
        run_id = f"run_{uuid.uuid4().hex[:12]}"
        # 解析本 run 的 block index 起始值（跨 run 全局递增）
        index_start = await self._resolve_block_index_start(session)
        emitter = AgentStreamEmitter(
            session_id=session.id, run_id=run_id, workflow_type=workflow_type,
            index_start=index_start,
        )
        ctx = WorkflowRuntimeContext(
            emitter=emitter, runtime_config=runtime_config,
            interview_service=self._interview_service,
            evaluation_service=self._evaluation_service,
            resume_loader=self._resume_loader,
            session_id=session.id, employee_id=session.employee_id, run_id=run_id,
        )
        # 先回执 interaction.resolve，让前端立刻关闭卡片
        resolve_env = emitter.emit_interaction_resolve(request_id=request_id, values=body.values)
        # 回写旧 interaction block 的 status 为 submitted；若已是 submitted 说明重复提交，
        # 幂等短路：只回执 resolve 让前端关闭卡片，不再重复 resume graph。
        is_first_submit = await self._update_old_interaction_block_status(
            session_id=session.id, request_id=request_id, values=body.values,
        )
        await self._buffer_append(session.id, run_id, resolve_env)
        yield resolve_env
        if not is_first_submit:
            logger.info("interaction 重复提交，幂等短路：session_id=%s request_id=%s",
                        session.id, request_id)
            return

        # 补发 run.start：让前端把 runState.running 置 true，从而渲染
        # 步骤条与进行中面板。否则深度评估期间前端看起来像"终止了"，
        # 直到 run.finish + reload 才突然冒出结果。
        # resume=True：续接模式，前端不清空 current_blocks，避免流式内容闪烁重建。
        start_env = emitter.emit_run_start(
            enable_thinking=runtime_config.enable_thinking,
            user_message_id=None,
            resume=True,
        )
        await self._buffer_append(session.id, run_id, start_env)
        yield start_env

        # 进入 graph 恢复（Command(resume=values)）
        envelope_buffer: list[AgentStreamEnvelope] = [resolve_env, start_env]
        # 本 run 累积的 step.update 序列，续接模式下与已有 progress 合并
        run_steps: list[dict] = []
        runner = self._runner_factory(self._workflow_graphs[workflow_type])
        thread_id = await self._resolve_thread_id(session)
        graph_completed = False  # 仅"无异常 且 未中断（走到 END）"才视为完成
        # client_aborted：与 stream_message 同构 — 客户端中途断开，跳过 yield 但完成落库
        client_aborted = False
        try:
            try:
                async for env in runner.astream(
                    thread_id=thread_id,
                    graph_input=Command(resume=body.values),
                    ctx=ctx,
                ):
                    envelope_buffer.append(env)
                    if env.type == "step.update":
                        run_steps.append(env.data)
                    await self._buffer_append(session.id, run_id, env)
                    yield env
            except (GeneratorExit, asyncio.CancelledError):
                client_aborted = True
                logger.info(
                    "客户端中断 resume 流式 run，转入收尾落库：session_id=%s run_id=%s",
                    session.id, run_id,
                )
                raise
            except Exception as exc:
                graph_completed = False
                logger.exception("Graph 恢复失败：session_id=%s run_id=%s", session.id, run_id)
                err_env = emitter.emit_run_error(
                    code="graph_execution_failed", message=str(exc), retriable=False,
                )
                envelope_buffer.append(err_env)
                await self._buffer_append(session.id, run_id, err_env)
                yield err_env
            else:
                # 无异常：区分 interrupt（如驳回后再次到 plan 审批卡）与 END
                graph_completed = not self._has_interrupt(envelope_buffer)
        finally:
            # 不论何种结束路径都要落库 agent 消息（含中断），保证可终止状态后内容不丢
            try:
                agent_message = await self._persist_agent_message(
                    session=session, user_message=None, run_id=run_id,
                    envelopes=envelope_buffer, runtime_config=runtime_config,
                    workflow_type=workflow_type,
                )
            except Exception:
                logger.exception(
                    "resume 收尾落库失败：session_id=%s run_id=%s aborted=%s",
                    session.id, run_id, client_aborted,
                )
                agent_message = None
            # 仅 graph 真正走到 END 才推进 task_id（A2：client_aborted 保留 thread 供续接）。
            # 驳回循环 / 异常保持不变以保证 resume 命中。
            advance = graph_completed
            next_task_id = await self._advance_task_id(session) if advance else None
            try:
                await self._persist_block_index(session.id, emitter.max_block_index_used)
            except Exception:
                logger.exception("延时落库 block index 失败：session_id=%s", session.id)
            # 持久化累积进度（reset=False：续接，合并已有 steps）
            try:
                await self._persist_progress(
                    session, run_steps, workflow_type, reset=False,
                )
            except Exception:
                logger.exception(
                    "resolve_interaction 持久化 progress 失败：session_id=%s", session.id,
                )
            if not client_aborted and agent_message is not None:
                finish_env = emitter.emit_run_finish(
                    agent_message_id=agent_message.id, next_task_id=next_task_id,
                )
                await self._buffer_append(session.id, run_id, finish_env)
                yield finish_env
            try:
                await self._cache.client.delete(
                    STREAM_BUFFER_KEY.format(session_id=session.id, run_id=run_id),
                )
            except Exception:
                logger.exception("清理 stream buffer 失败：session_id=%s run_id=%s",
                                 session.id, run_id)

    async def resume_run(
        self, *, session, runtime_config: LLMRuntimeConfigDTO, workflow_type: str,
    ) -> AsyncIterator[AgentStreamEnvelope]:
        """从 checkpoint 续接被中断的 run（A2）。

        graph_input=None → LangGraph 从该 thread 最近 checkpoint 继续：被中断节点重跑
        （部分输出已在历史消息，本次作为新 agent 消息追加），后续节点正常执行。
        不推进 task_id（ii：不支持放弃，仅 END 推进）。

        Args:
            session: AgentSession ORM 对象（提供 current_task_id 作为 thread_id）
            runtime_config: LLM 运行时配置
            workflow_type: 工作流类型（决定从 _workflow_graphs 选取哪张图）

        Yields:
            AgentStreamEnvelope 协议事件（run.start(resume=True) → graph events → run.finish）
        """
        run_id = f"run_{uuid.uuid4().hex[:12]}"
        # 解析本 run 的 block index 起始值（跨 run 全局递增，避免驳回循环时 index 冲突）
        index_start = await self._resolve_block_index_start(session)
        emitter = AgentStreamEmitter(
            session_id=session.id, run_id=run_id, workflow_type=workflow_type,
            index_start=index_start,
        )
        ctx = WorkflowRuntimeContext(
            emitter=emitter, runtime_config=runtime_config,
            interview_service=self._interview_service,
            evaluation_service=self._evaluation_service,
            resume_loader=self._resume_loader,
            session_id=session.id, employee_id=session.employee_id, run_id=run_id,
        )
        # 发射 run.start：resume=True 让前端不清空 current_blocks，避免流式闪烁重建
        start_env = emitter.emit_run_start(
            enable_thinking=runtime_config.enable_thinking,
            user_message_id=None,
            resume=True,
        )
        await self._buffer_append(session.id, run_id, start_env)
        yield start_env

        envelope_buffer: list[AgentStreamEnvelope] = [start_env]
        # 本 run 累积的 step.update 序列，续接模式下与已有 progress 合并
        run_steps: list[dict] = []
        runner = self._runner_factory(self._workflow_graphs[workflow_type])
        thread_id = await self._resolve_thread_id(session)
        graph_completed = False  # 仅"无异常 且 未中断（走到 END）"才视为完成
        # client_aborted：客户端中途断开（fetch.abort），跳过 yield 但仍完成落库，
        # 让用户在新一轮发送 / reload 时能看到中断前的内容
        client_aborted = False
        try:
            try:
                async for env in runner.astream(
                    thread_id=thread_id, graph_input=None, ctx=ctx,
                ):
                    envelope_buffer.append(env)
                    if env.type == "step.update":
                        run_steps.append(env.data)
                    await self._buffer_append(session.id, run_id, env)
                    yield env
            except (GeneratorExit, asyncio.CancelledError):
                client_aborted = True
                logger.info(
                    "客户端中断 resume run，转入收尾落库：session_id=%s run_id=%s",
                    session.id, run_id,
                )
                raise
            except Exception as exc:
                graph_completed = False
                # checkpoint 丢失（服务重启 / InMemorySaver 内存清空）→ 专属错误码，前端降级为新会话
                code = (
                    "no_resumable_checkpoint"
                    if _is_missing_checkpoint_error(exc)
                    else "graph_execution_failed"
                )
                logger.exception("resume run 失败：session_id=%s run_id=%s", session.id, run_id)
                err_env = emitter.emit_run_error(
                    code=code, message=str(exc), retriable=False,
                )
                envelope_buffer.append(err_env)
                await self._buffer_append(session.id, run_id, err_env)
                yield err_env
            else:
                # 无异常：区分 interrupt（再次到交互卡片）与 END（真正完成）
                graph_completed = not self._has_interrupt(envelope_buffer)
        finally:
            # 不论正常 / 异常 / 客户端中断，都把已生成的 envelopes 折叠落库
            try:
                agent_message = await self._persist_agent_message(
                    session=session, user_message_id=None, run_id=run_id,
                    envelopes=envelope_buffer, runtime_config=runtime_config,
                    workflow_type=workflow_type,
                )
            except Exception:
                logger.exception(
                    "resume 收尾落库失败：session_id=%s run_id=%s aborted=%s",
                    session.id, run_id, client_aborted,
                )
                agent_message = None
            # 仅 graph 真正走到 END 才推进 task_id（A2：不支持放弃，保留 thread 供再次续接）。
            # interrupt/异常/checkpoint 丢失保持不变以保证 resume 命中。
            advance = graph_completed
            next_task_id = await self._advance_task_id(session) if advance else None
            # 延时落库 block index：本 run 已分配的 index 不能被下一 run 复用
            try:
                await self._persist_block_index(session.id, emitter.max_block_index_used)
            except Exception:
                logger.exception("延时落库 block index 失败：session_id=%s", session.id)
            # 持久化累积进度（reset=False：续接同 task，合并已有 steps）
            try:
                await self._persist_progress(
                    session, run_steps, workflow_type, reset=False,
                )
            except Exception:
                logger.exception(
                    "resume_run 持久化 progress 失败：session_id=%s", session.id,
                )
            # 客户端已断开 → 不再 yield finish（连接已无效），仅完成落库后退出
            if not client_aborted and agent_message is not None:
                finish_env = emitter.emit_run_finish(
                    agent_message_id=agent_message.id, next_task_id=next_task_id,
                )
                await self._buffer_append(session.id, run_id, finish_env)
                yield finish_env
            # 清理 Redis buffer
            try:
                await self._cache.client.delete(
                    STREAM_BUFFER_KEY.format(session_id=session.id, run_id=run_id),
                )
            except Exception:
                logger.exception("清理 stream buffer 失败：session_id=%s run_id=%s",
                                 session.id, run_id)

    # ---------- 内部 ----------

    async def _resolve_thread_id(self, session) -> str:
        """解析当前 run 的 thread_id = session.current_task_id。

        兼容旧数据：若 current_task_id 为空（迁移前旧会话），兜底生成并 update。

        @return 用于 graph config 的 thread_id
        """
        task_id = (session.current_task_id or "").strip()
        if task_id:
            return task_id
        task_id = uuid.uuid4().hex
        await self._repo.update_session(session.id, current_task_id=task_id)
        session.current_task_id = task_id
        logger.info("旧会话兜底生成 current_task_id：session_id=%s", session.id)
        return task_id

    async def _advance_task_id(self, session) -> str:
        """工作流正常 END 时推进 task_id：生成新 uuid 覆盖 session 表。

        保证下一轮 run 在全新隔离的 LangGraph thread 上下文中执行。

        @return 新的 task_id（供 run.finish 回传）
        """
        next_task_id = uuid.uuid4().hex
        await self._repo.update_session(session.id, current_task_id=next_task_id)
        session.current_task_id = next_task_id
        return next_task_id

    async def _resolve_resume_ref(
        self, session_id: int, body: AgentMessageCreate,
    ) -> dict[str, Any] | None:
        """解析简历引用：仅从本轮 context_refs 取 file_path。

        遵循"agent_message 内容仅供展示"原则：不从历史消息推导，也不再使用 Redis
        会话引用（懒建会话后无意义）。不命中返回 None，由工作流兜底处理空简历
        （图二 _route_after_profile 对空简历短路 END，图一 load_resume 也能处理空文本）。
        """
        for ref in body.context_refs or []:
            if str(ref.get("type") or "").lower() == "resume":
                file_path = str(ref.get("file_path") or "").strip()
                if not file_path:
                    raise ValidationError("简历附件缺少 file_path")
                return {
                    "file_path": file_path,
                    "file_name": str(ref.get("file_name") or ""),
                }
        return None

    async def _build_graph_input(
        self, body: AgentMessageCreate, resume_ref: dict | None,
    ) -> dict:
        """构造 graph 输入。

        - resume_ref：简历引用，三层 fallback 已在 _resolve_resume_ref 完成
        - validation_attempts：图二评估循环计数器初始 0
        - user_intent：把本次用户消息内容透传给图一，用于 dimension_suggest /
          question_plan 的 user_intent 注入，保证不同问题不会得到一样的维度建议
        """
        return {
            "resume_ref": resume_ref or {},
            "validation_attempts": 0,
            "user_intent": (body.content or "").strip(),
        }

    async def _create_user_message(
        self, session, body: AgentMessageCreate, *, run_id: str,
        runtime_config: LLMRuntimeConfigDTO,
    ):
        """落库用户消息。

        副作用：若会话尚未命名（首次发送消息），用本次问题（≤80 字，与 DB 列长度对齐）
        作为标题，保证侧边栏与 Topbar 标题信息完整；展示侧的 .truncate 负责单行省略。
        标题截取走纯字符串处理，不调 LLM。
        """
        msg = await self._repo.create_message(
            session_id=session.id,
            role="user",
            workflow_type=body.workflow_type,
            run_id=run_id,
            # 用户消息 content 同时承载正文 blocks 与本次附带的简历引用（context_refs）。
            # context_refs 仅供前端展示文件图标，不反向解析为工作流上下文（遵循"内容不当下文"原则）。
            content={
                "blocks": [{"type": "text", "text": body.content}],
                "context_refs": body.context_refs or [],
            },
            sort_order=await self._repo.next_message_order(session.id),
        )
        # 仅当当前会话没有标题（None / 空 / 默认占位）时才用首条问题作为标题
        existing_title = (session.title or "").strip()
        if not existing_title or existing_title in {"新会话", "未命名会话"}:
            snippet = self._make_title_from_content(body.content or "")
            if snippet:
                await self._repo.update_session(session.id, title=snippet)
                # 同步内存对象，避免后续 yield 中读到旧 title
                session.title = snippet
                logger.info(
                    "首次发送消息自动设置会话标题：session_id=%s title=%s",
                    session.id, snippet,
                )
                # 投递 LLM 异步精化任务：基于用户首条问题生成 ≤20 字中文标题。
                # 失败（Broker 不可用、序列化异常等）静默忽略，默认标题已能用作兜底。
                # SecretStr 字段必须显式取值后再走 JSON broker：mode="json" 会把 api_key
                # 渲染为掩码 "**********"，task 重建 DTO 后调 LLM 必返回 401。
                try:
                    from app.workers.tasks.agent_task import refine_session_title_task
                    runtime_config_dict = runtime_config.model_dump(mode="json")
                    runtime_config_dict["api_key"] = runtime_config.api_key.get_secret_value()
                    refine_session_title_task.delay(
                        session.id,
                        body.content or "",
                        runtime_config_dict,
                    )
                    logger.info(
                        "已投递会话标题精化任务：session_id=%s", session.id,
                    )
                except Exception as exc:
                    logger.warning(
                        "投递会话标题精化任务失败（忽略）：session_id=%s err=%s",
                        session.id, exc,
                    )
        return msg

    @staticmethod
    def _make_title_from_content(content: str) -> str:
        """把用户消息内容压成单行 ≤80 字的会话标题（与 DB 列长度对齐）。

        规则：
        1. strip 首尾空白
        2. 所有换行/制表符替换为单空格，再合并连续空白
        3. 截取前 80 个字符（中文按字符计；不再加省略号，前端 .truncate 已处理）

        80 字以内的问题原样落库；超长部分由展示侧的 .truncate 单行省略展示，
        落库值仍是完整可读的标题。
        """
        if not content:
            return ""
        flat = content.strip().replace("\r", " ").replace("\n", " ").replace("\t", " ")
        # 合并连续空白
        flat = " ".join(flat.split())
        return flat[:80]

    async def _persist_agent_message(
        self, *, session, user_message, run_id: str,
        envelopes: list[AgentStreamEnvelope],
        runtime_config: LLMRuntimeConfigDTO, workflow_type: str,
    ):
        """把 envelope 序列折叠为 blocks 并落库 agent 消息。"""
        blocks = self._envelopes_to_blocks(envelopes)
        try:
            msg = await self._repo.create_message(
                session_id=session.id,
                parent_message_id=user_message.id if user_message else None,
                role="agent",
                workflow_type=workflow_type,
                run_id=run_id,
                content={"blocks": blocks},
                model_name=runtime_config.model_name,
                sort_order=await self._repo.next_message_order(session.id),
            )
            await self._repo.update_session(
                session.id, status=1, last_message_time=datetime.now(),
            )
            await self._repo.commit()
            return msg
        except Exception:
            await self._repo.rollback()
            logger.exception("agent_message 落库失败")
            raise

    @staticmethod
    def _envelopes_to_blocks(envelopes: list[AgentStreamEnvelope]) -> list[dict[str, Any]]:
        """把 envelope 序列折叠成 block 数组。

        规则：
        - block.start 建立骨架
        - block.delta 累加 text/text_delta、覆盖 status/output、一次性写满业务卡
        - block.stop 标记完成（streaming → success）
        """
        blocks_by_index: dict[int, dict[str, Any]] = {}
        for env in envelopes:
            if env.type == "block.start":
                idx = int(env.data["index"])
                blocks_by_index[idx] = dict(env.data["block"])
            elif env.type == "block.delta":
                idx = int(env.data["index"])
                if idx not in blocks_by_index:
                    continue
                delta = env.data.get("delta") or {}
                # text/thinking 累加
                if "text_delta" in delta and "text" in blocks_by_index[idx]:
                    blocks_by_index[idx]["text"] = (
                        blocks_by_index[idx].get("text") or ""
                    ) + delta["text_delta"]
                # tool_use 思考过程累加（开启思考模式时各维度块自带的 reasoning）
                if "reasoning" in delta:
                    blocks_by_index[idx]["reasoning"] = (
                        blocks_by_index[idx].get("reasoning") or ""
                    ) + delta["reasoning"]
                # tool_use 完成状态
                for k in ("status", "output", "error"):
                    if k in delta:
                        blocks_by_index[idx][k] = delta[k]
                # 业务卡一次写满
                for k in ("question_set", "report"):
                    if k in delta:
                        blocks_by_index[idx][k] = delta[k]
                # interaction 提交值
                if "values" in delta:
                    blocks_by_index[idx]["values"] = delta["values"]
            elif env.type == "block.stop":
                idx = int(env.data["index"])
                if idx in blocks_by_index:
                    # streaming → success（除非业务已显式标记其他状态）
                    if blocks_by_index[idx].get("status") == "streaming":
                        blocks_by_index[idx]["status"] = "success"
        return [blocks_by_index[i] for i in sorted(blocks_by_index)]

    async def _buffer_append(
        self, session_id: int, run_id: str, env: AgentStreamEnvelope,
    ) -> None:
        """JSONL 形式 APPEND 到 Redis buffer；失败仅日志，不中断主流程。"""
        try:
            key = STREAM_BUFFER_KEY.format(session_id=session_id, run_id=run_id)
            line = env.model_dump_json() + "\n"
            await self._cache.client.append(key, line)
            await self._cache.client.expire(key, STREAM_BUFFER_TTL)
        except Exception:
            logger.exception("Redis stream buffer append 失败")

    async def _update_old_interaction_block_status(
        self, *, session_id: int, request_id: str, values: dict[str, Any],
    ) -> bool:
        """把指定 request_id 对应的旧 interaction block 标记为已处理。

        区分两种结果：
        - 驳回（values.regenerate=True）→ status 置 rejected，记录 feedback
        - 确认（approve/选择）→ status 置 submitted，记录 values

        @return True 表示原为 pending、本次成功转为终态；
                False 表示已经是终态（重复提交，调用方应幂等短路）。
        """
        is_reject = bool(values.get("regenerate"))
        new_status = "rejected" if is_reject else "submitted"
        try:
            messages = await self._repo.list_messages(session_id)
            for msg in reversed(messages):
                content = msg.content or {}
                blocks = content.get("blocks") or []
                dirty = False
                already_terminal = False
                for b in blocks:
                    if (
                        b.get("type") == "interaction"
                        and b.get("request_id") == request_id
                    ):
                        if b.get("status") == "pending":
                            b["status"] = new_status
                            b["values"] = values
                            dirty = True
                        else:
                            # 已是 submitted/rejected 等终态 → 重复提交，幂等标记
                            already_terminal = True
                if dirty:
                    await self._repo.update_message_content(msg.id, content)
                    await self._repo.commit()
                    return True
                if already_terminal:
                    return False
        except Exception:
            logger.exception("更新旧 interaction block status 失败")
        return True

    async def abort_pending_interaction(self, *, session) -> None:
        """中断会话当前的 interrupt 等待。

        场景：用户在 interrupt 暂停态（维度选择 / 计划审批 / 岗位选择卡）点击"中断"按钮。
        此时流式 run 已结束（run.finish 已 yield），无连接可断；本方法负责：
        1. 把最近一条 agent 消息中所有 status=pending 的 interaction block 标记为 expired
        2. 推进 session.current_task_id：让下一轮新问题走全新 LangGraph thread，
           丢弃当前 thread 上等 interrupt 的 checkpoint（用户语义=放弃当前流程）。

        失败仅日志，不抛错；调用方按 fire-and-forget 处理。
        """
        try:
            # 1) 标记所有 pending interaction block 为 expired
            messages = await self._repo.list_messages(session.id)
            for msg in reversed(messages):
                content = msg.content or {}
                blocks = content.get("blocks") or []
                dirty = False
                for b in blocks:
                    if (
                        b.get("type") == "interaction"
                        and b.get("status") == "pending"
                    ):
                        b["status"] = "expired"
                        dirty = True
                if dirty:
                    await self._repo.update_message_content(msg.id, content)
                    await self._repo.commit()
                    logger.info(
                        "用户中断 interrupt：session_id=%s message_id=%s 已标记 pending block 为 expired",
                        session.id, msg.id,
                    )
                    break  # 只处理最近一条含 pending 的消息
        except Exception:
            logger.exception("标记 pending interaction 为 expired 失败：session_id=%s", session.id)
        # 2) 推进 task_id，下一轮新问题走全新 LangGraph thread
        try:
            await self._advance_task_id(session)
            logger.info("用户中断 interrupt：session_id=%s 已推进 task_id", session.id)
        except Exception:
            logger.exception("中断后推进 task_id 失败：session_id=%s", session.id)
