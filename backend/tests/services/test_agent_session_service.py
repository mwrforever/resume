"""AgentSessionService：CRUD 测试（thinking 开关已改为发送时动态参数，不再持久化）。"""

from __future__ import annotations

from unittest.mock import AsyncMock, MagicMock

import pytest

from app.core.exceptions import NotFoundError
from app.schemas.agent.request import AgentSessionCreate, AgentSessionUpdate
from app.services.agent_session_service import AgentSessionService


def _make_session_orm(**overrides) -> MagicMock:
    """构造模拟的 AgentSession ORM 对象。"""
    defaults = dict(
        id=1, session_key="k", current_task_id="t1", employee_id=2, title="T",
        selected_model_name=None, enable_thinking=0, status=1,
        last_message_time=None, create_time=None, update_time=None,
        progress=None,  # T1 新增列：显式 None 避免 MagicMock 自动属性被 pydantic 当作非法 dict
    )
    defaults.update(overrides)
    m = MagicMock(**defaults)
    for k, v in defaults.items():
        setattr(m, k, v)
    return m


@pytest.mark.asyncio
async def test_create_session_returns_item():
    """创建会话后返回 AgentSessionItem。"""
    repo = MagicMock()
    repo.create_session = AsyncMock(return_value=_make_session_orm())
    repo.commit = AsyncMock()
    svc = AgentSessionService(repo)
    item = await svc.create_session(
        AgentSessionCreate(title="T"),
        current_user={"user_type": "employee", "sub": "2"},
    )
    assert item.title == "T"
    repo.commit.assert_awaited_once()


@pytest.mark.asyncio
async def test_session_not_found_raises():
    """查询不存在的会话应抛 NotFoundError。"""
    repo = MagicMock()
    repo.get_session = AsyncMock(return_value=None)
    svc = AgentSessionService(repo)
    with pytest.raises(NotFoundError):
        await svc.get_session_detail(
            session_id=999,
            current_user={"user_type": "employee", "sub": "2"},
        )


@pytest.mark.asyncio
async def test_update_session_renames():
    """更新会话标题。"""
    updated_orm = _make_session_orm(title="新标题")
    repo = MagicMock()
    repo.get_session = AsyncMock(return_value=_make_session_orm())
    repo.update_session = AsyncMock(return_value=updated_orm)
    repo.commit = AsyncMock()
    svc = AgentSessionService(repo)
    item = await svc.update_session(
        session_id=1,
        body=AgentSessionUpdate(title="新标题"),
        current_user={"user_type": "employee", "sub": "2"},
    )
    assert item.title == "新标题"


@pytest.mark.asyncio
async def test_delete_session_soft_deletes():
    """软删除会话。"""
    repo = MagicMock()
    repo.get_session = AsyncMock(return_value=_make_session_orm())
    repo.soft_delete_session = AsyncMock()
    repo.commit = AsyncMock()
    svc = AgentSessionService(repo)
    await svc.delete_session(
        session_id=1,
        current_user={"user_type": "employee", "sub": "2"},
    )
    repo.soft_delete_session.assert_awaited_once_with(1)
    repo.commit.assert_awaited_once()


@pytest.mark.asyncio
async def test_create_session_generates_current_task_id():
    """创建会话时应生成首个 current_task_id 并写入 repo。"""
    captured: dict = {}

    async def fake_create(**kwargs):
        captured.update(kwargs)
        return _make_session_orm(current_task_id=kwargs.get("current_task_id", ""))

    repo = MagicMock()
    repo.create_session = fake_create
    repo.commit = AsyncMock()
    svc = AgentSessionService(repo)
    await svc.create_session(
        AgentSessionCreate(title="T"),
        current_user={"user_type": "employee", "sub": "2"},
    )
    # create_session 必须传入 current_task_id（非空 uuid hex，长度 32）
    assert captured.get("current_task_id")
    assert len(captured["current_task_id"]) == 32
