"""
LangGraph Checkpointer 工厂。

协调器 + 子 Agent 使用 `langgraph.types.interrupt()` 实现表单/动作中断，
LangGraph 必须配置 checkpointer 才能保存中断点状态以支持后续 `Command(resume=...)`。

使用 `AsyncSqliteSaver` 落盘到 SETTINGS.LANGGRAPH_SQLITE_PATH，
进程重启 / 容器升级后中断态仍可 resume。

约束：
- AsyncSqliteSaver 是 async context manager，必须在 FastAPI lifespan 中以
  `async with` 方式持有，结束时自动关闭底层 aiosqlite 连接。
- SQLite 并发写有锁，本项目 backend 容器只允许单 uvicorn worker；
  需要水平扩展时换 PostgresSaver/RedisSaver。
"""

from __future__ import annotations

import logging
from contextlib import asynccontextmanager
from pathlib import Path
from typing import AsyncIterator

from langgraph.checkpoint.base import BaseCheckpointSaver
from langgraph.checkpoint.sqlite.aio import AsyncSqliteSaver

from app.core.config import get_settings

logger = logging.getLogger(__name__)


@asynccontextmanager
async def open_checkpointer() -> AsyncIterator[BaseCheckpointSaver]:
    """在 FastAPI lifespan 中以 `async with` 方式打开 checkpointer。

    使用方式：
        async with open_checkpointer() as checkpointer:
            graph = build_xxx_graph(checkpointer)
            ...
    """
    sqlite_path = get_settings().LANGGRAPH_SQLITE_PATH
    # 确保父目录存在（首次部署 / 卷刚挂上时目录是空的）
    Path(sqlite_path).parent.mkdir(parents=True, exist_ok=True)

    async with AsyncSqliteSaver.from_conn_string(sqlite_path) as saver:
        logger.info("LangGraph checkpointer 已初始化：AsyncSqliteSaver(%s)", sqlite_path)
        yield saver
