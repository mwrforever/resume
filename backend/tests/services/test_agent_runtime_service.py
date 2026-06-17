"""AgentRuntimeService：stream_message + resolve_interaction 关键路径。"""

from __future__ import annotations

from collections.abc import AsyncIterator
from unittest.mock import AsyncMock, MagicMock

import pytest
from pydantic import SecretStr

from app.llm.streaming.emitter import AgentStreamEmitter
from app.schemas.agent.dto import LLMRuntimeConfigDTO
from app.schemas.agent.request import AgentInteractionSubmit, AgentMessageCreate
from app.schemas.agent.stream import AgentStreamEnvelope
from app.services.agent_runtime_service import AgentRuntimeService


def _envelope(
    emitter: AgentStreamEmitter, seq_override: int | None = None,
    type_: str = "block.start",
) -> AgentStreamEnvelope:
    """构造测试用 envelope。"""
    return emitter._wrap(type=type_, data={
        "index": 0, "block": {"type": "text", "text": "", "status": "streaming"},
    })


def _runtime_cfg() -> LLMRuntimeConfigDTO:
    """构造测试用 LLM 配置。"""
    return LLMRuntimeConfigDTO(
        provider="deepseek", base_url="x", api_key=SecretStr("sk"), model_name="m",
    )


def _make_session() -> MagicMock:
    """构造模拟的 AgentSession ORM 对象。"""
    return MagicMock(
        id=1, session_key="k1", current_task_id="existing-task-id",
        last_block_index=0, employee_id=2,
        selected_model_name=None, enable_thinking=False,
    )


def _build_svc(runner_astream_fn=None) -> AgentRuntimeService:
    """构造测试用 AgentRuntimeService。"""
    repo = MagicMock()
    repo.create_message = AsyncMock(side_effect=[
        MagicMock(id=10),  # user message
        MagicMock(id=20),  # agent message
    ])
    repo.update_session = AsyncMock()
    repo.commit = AsyncMock()
    repo.rollback = AsyncMock()
    repo.next_message_order = AsyncMock(side_effect=[1, 2])
    repo.list_messages = AsyncMock(return_value=[])
    cache = MagicMock()
    cache.set = AsyncMock()
    cache.get_json = AsyncMock(return_value=None)
    cache.client = MagicMock()
    cache.client.append = AsyncMock()
    cache.client.expire = AsyncMock()
    cache.client.delete = AsyncMock()
    # block index 缓存：默认 miss（返回 None），走 DB last_block_index fallback
    cache.client.get = AsyncMock(return_value=None)
    cache.client.set = AsyncMock()

    runner = MagicMock()
    if runner_astream_fn:
        runner.astream = runner_astream_fn
    else:
        async def _default_astream(*, thread_id, graph_input, ctx):
            yield _envelope(ctx.emitter)
        runner.astream = _default_astream

    workflow_graphs = {
        "interview_questions": MagicMock(),
        "resume_evaluation": MagicMock(),
    }
    return AgentRuntimeService(
        repo=repo, cache=cache, workflow_graphs=workflow_graphs,
        runner_factory=lambda graph: runner,
        interview_service=MagicMock(), evaluation_service=MagicMock(),
        resume_loader=MagicMock(),
    )


@pytest.mark.asyncio
async def test_stream_message_emits_run_start_then_runner_then_run_finish():
    """编排骨架：run.start → runner events → run.finish。"""
    svc = _build_svc()
    session = _make_session()
    body = AgentMessageCreate(content="hi", workflow_type="interview_questions")
    out_types = []
    async for env in svc.stream_message(session=session, body=body, runtime_config=_runtime_cfg()):
        out_types.append(env.type)

    assert out_types[0] == "run.start"
    assert out_types[-1] == "run.finish"
    # 中间应有 runner 产出的 block.start
    assert "block.start" in out_types


@pytest.mark.asyncio
async def test_stream_message_catches_graph_error_and_emits_run_error():
    """graph 执行异常时应发射 run.error 而非崩溃。"""
    async def _failing_astream(*, thread_id, graph_input, ctx):
        yield _envelope(ctx.emitter)
        raise RuntimeError("graph crash")

    svc = _build_svc(runner_astream_fn=_failing_astream)
    session = _make_session()
    body = AgentMessageCreate(content="hi", workflow_type="interview_questions")
    out_types = []
    async for env in svc.stream_message(session=session, body=body, runtime_config=_runtime_cfg()):
        out_types.append(env.type)

    assert "run.error" in out_types
    assert out_types[-1] == "run.finish"


@pytest.mark.asyncio
async def test_resolve_interaction_emits_resolve_then_runner_then_finish():
    """resolve_interaction 应先发 interaction.resolve 再跑 graph。"""
    async def _astream(*, thread_id, graph_input, ctx):
        yield _envelope(ctx.emitter, type_="block.start")

    svc = _build_svc(runner_astream_fn=_astream)
    session = _make_session()
    body = AgentInteractionSubmit(values={"selected": ["d1"]})
    out_types = []
    async for env in svc.resolve_interaction(
        session=session, request_id="req_1", body=body,
        runtime_config=_runtime_cfg(), workflow_type="interview_questions",
    ):
        out_types.append(env.type)

    assert out_types[0] == "interaction.resolve"
    assert out_types[-1] == "run.finish"


@pytest.mark.asyncio
async def test_envelopes_to_blocks_folds_correctly():
    """_envelopes_to_blocks 应正确折叠 text delta。"""
    emitter = AgentStreamEmitter(session_id=1, run_id="r", workflow_type="interview_questions")

    envs = [
        emitter.emit_block_start(index=0, block={"type": "text", "text": "", "status": "streaming"}),
        emitter.emit_block_delta(index=0, delta={"text_delta": "hello "}),
        emitter.emit_block_delta(index=0, delta={"text_delta": "world"}),
        emitter.emit_block_stop(index=0),
    ]
    blocks = AgentRuntimeService._envelopes_to_blocks(envs)
    assert len(blocks) == 1
    assert blocks[0]["text"] == "hello world"
    assert blocks[0]["status"] == "success"


@pytest.mark.asyncio
async def test_resolve_thread_id_returns_existing():
    """已有 current_task_id 时直接返回，不写库。"""
    svc = AgentRuntimeService.__new__(AgentRuntimeService)  # 跳过 __init__
    svc._repo = MagicMock()
    svc._repo.update_session = AsyncMock()
    session = MagicMock(current_task_id="existing-task-id")
    tid = await svc._resolve_thread_id(session)
    assert tid == "existing-task-id"
    svc._repo.update_session.assert_not_awaited()


@pytest.mark.asyncio
async def test_resolve_thread_id_generates_for_empty():
    """空 current_task_id 时兜底生成并 update。"""
    svc = AgentRuntimeService.__new__(AgentRuntimeService)
    svc._repo = MagicMock()
    svc._repo.update_session = AsyncMock()
    session = MagicMock(current_task_id="")
    tid = await svc._resolve_thread_id(session)
    assert len(tid) == 32  # uuid4().hex
    svc._repo.update_session.assert_awaited_once()
    assert session.current_task_id == tid


@pytest.mark.asyncio
async def test_advance_task_id_generates_new():
    """_advance_task_id 生成新 uuid 并 update session 表。"""
    svc = AgentRuntimeService.__new__(AgentRuntimeService)
    svc._repo = MagicMock()
    svc._repo.update_session = AsyncMock()
    session = MagicMock(current_task_id="old-task")
    nxt = await svc._advance_task_id(session)
    assert len(nxt) == 32
    assert nxt != "old-task"
    assert session.current_task_id == nxt
    svc._repo.update_session.assert_awaited_once()


@pytest.mark.asyncio
async def test_stream_message_advances_task_id_on_normal_end():
    """graph 正常结束时推进 task_id，run.finish 携带 next_task_id。"""
    svc = _build_svc()
    session = _make_session()
    body = AgentMessageCreate(content="hi", workflow_type="interview_questions")
    finish_env = None
    async for env in svc.stream_message(session=session, body=body, runtime_config=_runtime_cfg()):
        if env.type == "run.finish":
            finish_env = env
    assert finish_env is not None
    assert finish_env.data["next_task_id"]
    assert len(finish_env.data["next_task_id"]) == 32


@pytest.mark.asyncio
async def test_stream_message_no_advance_on_graph_error():
    """graph 异常时不推进 task_id，run.finish 的 next_task_id 为 None。"""
    async def _failing_astream(*, thread_id, graph_input, ctx):
        yield _envelope(ctx.emitter)
        raise RuntimeError("graph crash")

    svc = _build_svc(runner_astream_fn=_failing_astream)
    session = _make_session()
    body = AgentMessageCreate(content="hi", workflow_type="interview_questions")
    finish_env = None
    async for env in svc.stream_message(session=session, body=body, runtime_config=_runtime_cfg()):
        if env.type == "run.finish":
            finish_env = env
    assert finish_env is not None
    assert finish_env.data["next_task_id"] is None


@pytest.mark.asyncio
async def test_resolve_block_index_start_redis_hit():
    """Redis 缓存命中时，index_start = 缓存值 + 1。"""
    svc = AgentRuntimeService.__new__(AgentRuntimeService)
    svc._cache = MagicMock()
    svc._cache.client = MagicMock()
    svc._cache.client.get = AsyncMock(return_value="7")  # Redis 缓存值为 7
    svc._repo = MagicMock()
    session = MagicMock(id=1, last_block_index=0)
    start = await svc._resolve_block_index_start(session)
    assert start == 8  # 7 + 1


@pytest.mark.asyncio
async def test_resolve_block_index_start_redis_miss_fallback_db():
    """Redis miss 时回退 DB session.last_block_index，index_start = db + 1。"""
    svc = AgentRuntimeService.__new__(AgentRuntimeService)
    svc._cache = MagicMock()
    svc._cache.client = MagicMock()
    svc._cache.client.get = AsyncMock(return_value=None)  # Redis miss
    svc._repo = MagicMock()
    session = MagicMock(id=1, last_block_index=5)
    start = await svc._resolve_block_index_start(session)
    assert start == 6  # 5 + 1


@pytest.mark.asyncio
async def test_persist_block_index_writes_redis_and_db():
    """_persist_block_index 同时写 Redis 缓存与 DB last_block_index（延时落库）。"""
    svc = AgentRuntimeService.__new__(AgentRuntimeService)
    svc._cache = MagicMock()
    svc._cache.client = MagicMock()
    svc._cache.client.set = AsyncMock()
    svc._repo = MagicMock()
    svc._repo.update_session = AsyncMock()
    await svc._persist_block_index(session_id=1, max_index=15)
    svc._cache.client.set.assert_awaited_once()
    svc._repo.update_session.assert_awaited_once()
    # 验证 DB 写入 last_block_index=15
    args, kwargs = svc._repo.update_session.call_args
    assert kwargs.get("last_block_index") == 15


def test_has_interrupt_detects_interaction_request():
    """_has_interrupt 通过 interaction.request 事件判定是否中断。"""
    emitter = AgentStreamEmitter(session_id=1, run_id="r", workflow_type="interview_questions")
    # 无 interaction.request → 未中断
    envs_no_interrupt = [
        emitter.emit_block_start(index=0, block={"type": "text", "text": ""}),
    ]
    assert AgentRuntimeService._has_interrupt(envs_no_interrupt) is False
    # 含 interaction.request → 中断
    envs_interrupt = [
        emitter.emit_block_start(index=0, block={"type": "text", "text": ""}),
        emitter.emit_interaction_request(
            request_id="r1", interaction_type="dimension_selection",
            title="t", prompt="p", data={},
        ),
    ]
    assert AgentRuntimeService._has_interrupt(envs_interrupt) is True


@pytest.mark.asyncio
async def test_stream_message_no_task_id_advance_on_interrupt():
    """interrupt（维度卡片等待用户）时不应推进 task_id——Bug1 核心回归。

    模拟 graph 在维度建议后产生 interaction.request（=interrupt 结束 astream），
    断言 run.finish 的 next_task_id 为 None（task_id 保持不变，保证 resume 命中正确 checkpoint）。
    """
    async def _interrupt_astream(*, thread_id, graph_input, ctx):
        # 先产出 thinking block，再产出 interaction.request（=interrupt）
        yield _envelope(ctx.emitter)
        yield ctx.emitter.emit_interaction_request(
            request_id="dim_test", interaction_type="dimension_selection",
            title="请选择维度", prompt="p", data={"candidates": []},
        )

    svc = _build_svc(runner_astream_fn=_interrupt_astream)
    session = _make_session()
    body = AgentMessageCreate(content="hi", workflow_type="interview_questions")
    finish_env = None
    async for env in svc.stream_message(session=session, body=body, runtime_config=_runtime_cfg()):
        if env.type == "run.finish":
            finish_env = env
    assert finish_env is not None
    # interrupt 时 task_id 不应推进
    assert finish_env.data["next_task_id"] is None
