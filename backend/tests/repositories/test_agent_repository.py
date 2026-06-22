"""AgentRepository.list_sessions 排序回归（议题：会话按创建时间排序）。

无依赖真实 DB：mock 接住 session.execute 拿到的 SQL statement，渲染后验证 ORDER BY 用 create_time。
"""
from __future__ import annotations

from unittest.mock import MagicMock

import pytest
from sqlalchemy.dialects import mysql

from app.repositories.agent_repository import AgentRepository


def _normalize(s: str) -> str:
    """折叠连续空白，便于跨方言/换行匹配关键字。"""
    return " ".join(s.lower().split())


@pytest.mark.asyncio
async def test_list_sessions_orders_by_create_time_desc():
    """list_sessions 生成的 SQL 必须按 create_time（而非 update_time）降序。

    现状（修复前）：order_by(update_time.desc(), id.desc()) → 不符合"按创建时间排序"语义。
    修复后：order_by(create_time.desc(), id.desc())。
    """
    captured: dict[str, str] = {}
    mock_db = MagicMock()
    result_mock = MagicMock()
    result_mock.scalars.return_value.all.return_value = []

    async def _capture(stmt):
        captured["sql"] = str(stmt.compile(dialect=mysql.dialect()))
        return result_mock

    mock_db.execute = _capture

    repo = AgentRepository(mock_db)
    await repo.list_sessions(employee_id=1, skip=0, limit=10)

    sql = _normalize(captured["sql"])
    assert "order by" in sql, f"未生成 ORDER BY：{sql}"
    # create_time 必须出现在 ORDER BY 里（紧邻 order by 之后、desc 之前）
    assert "order by agent_session.create_time desc" in sql, (
        f"ORDER BY 未使用 create_time 降序：{sql}"
    )
    # 不应再以 update_time 作为排序键
    assert "update_time desc" not in sql, f"仍在用 update_time 排序：{sql}"
