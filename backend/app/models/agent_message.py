"""Agent 消息 ORM 模型（与新 DDL 对齐）。"""

from datetime import datetime
from typing import Any

from sqlalchemy import BigInteger, DateTime, Index, Integer, JSON, String
from sqlalchemy.orm import Mapped, mapped_column
from sqlalchemy.sql import func

from . import Base


class AgentMessage(Base):
    """Agent 消息表。"""

    __tablename__ = "agent_message"
    __table_args__ = (
        Index("idx_session_order", "session_id", "sort_order"),
    )

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    session_id: Mapped[int] = mapped_column(BigInteger, nullable=False)
    parent_message_id: Mapped[int | None] = mapped_column(BigInteger)
    role: Mapped[str] = mapped_column(String(16), nullable=False)
    workflow_type: Mapped[str] = mapped_column(String(32), nullable=False)
    run_id: Mapped[str | None] = mapped_column(String(64))
    content: Mapped[dict[str, Any]] = mapped_column(JSON, nullable=False)
    model_name: Mapped[str | None] = mapped_column(String(80))
    token_count: Mapped[int | None] = mapped_column(Integer)
    sort_order: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    create_time: Mapped[datetime] = mapped_column(DateTime, nullable=False, server_default=func.now())
