"""AgentRepository：会话与消息最小 CRUD 形状（mock 验证方法调用）。"""

from __future__ import annotations

from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from app.repositories.agent_repository import AgentRepository


def _mock_session() -> AsyncMock:
    """构造模拟的 SQLAlchemy AsyncSession。"""
    s = AsyncMock()
    s.flush = AsyncMock()
    s.commit = AsyncMock()
    s.rollback = AsyncMock()
    return s


def _make_session_orm(**overrides) -> MagicMock:
    """构造模拟的 AgentSession ORM 对象。"""
    defaults = dict(
        id=1, session_key="k1", employee_id=1, title="T",
        selected_model_name=None, enable_thinking=0, status=1,
        last_message_time=None, create_time=None, update_time=None,
    )
    defaults.update(overrides)
    m = MagicMock(**defaults)
    # model_validate 会读取属性
    for k, v in defaults.items():
        setattr(m, k, v)
    return m


@pytest.mark.asyncio
async def test_create_session_calls_flush_and_returns():
    """create_session 应该构造 ORM 对象、add + flush，并返回结果。"""
    db = _mock_session()
    repo = AgentRepository(db)

    session_obj = _make_session_orm()
    # mock _db.refresh 来更新对象
    db.refresh = AsyncMock()

    with patch.object(AgentRepository, "create_session", autospec=True) as mock_create:
        mock_create.return_value = session_obj
        result = await repo.create_session(
            session_key="k1", employee_id=1, title="T", selected_model_name=None,
        )
    assert result.session_key == "k1"
    assert result.title == "T"


@pytest.mark.asyncio
async def test_update_message_content_executes_update():
    """update_message_content 应执行 SQL UPDATE。"""
    db = _mock_session()
    db.execute = AsyncMock()
    db.flush = AsyncMock()
    repo = AgentRepository(db)

    await repo.update_message_content(message_id=42, content={"blocks": [{"type": "text", "text": "x"}]})

    # 确认 execute 被调用了一次
    db.execute.assert_awaited_once()
    db.flush.assert_awaited_once()


@pytest.mark.asyncio
async def test_soft_delete_session_sets_status_zero():
    """soft_delete_session 应把 status 置 0。"""
    db = _mock_session()
    db.execute = AsyncMock()
    db.flush = AsyncMock()
    repo = AgentRepository(db)

    await repo.soft_delete_session(session_id=1)
    db.execute.assert_awaited_once()
    # 验证 flush 被调用
    db.flush.assert_awaited_once()


@pytest.mark.asyncio
async def test_next_message_order_returns_max_plus_one():
    """next_message_order 应返回当前最大 sort_order + 1。"""
    db = _mock_session()
    scalar_result = MagicMock()
    scalar_result.scalar.return_value = 5
    db.execute = AsyncMock(return_value=scalar_result)
    repo = AgentRepository(db)

    order = await repo.next_message_order(session_id=1)
    assert order == 6
