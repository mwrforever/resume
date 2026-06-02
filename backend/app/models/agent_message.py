from datetime import datetime
from typing import Any

from sqlalchemy import BigInteger, DateTime, Index, Integer, JSON, String
from sqlalchemy.orm import Mapped, mapped_column
from sqlalchemy.sql import func

from . import Base


class AgentMessage(Base):
    __tablename__ = "agent_message"
    __table_args__ = (
        Index("idx_session_order", "session_id", "sort_order", "id"),
        Index("idx_parent", "parent_message_id"),
        Index("idx_agent_message_workflow_run", "workflow_type", "run_id"),
    )

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    session_id: Mapped[int] = mapped_column(BigInteger, nullable=False)
    parent_message_id: Mapped[int | None] = mapped_column(BigInteger)
    role: Mapped[str] = mapped_column(String(20), nullable=False)
    message_type: Mapped[str] = mapped_column(String(30), nullable=False)
    workflow_type: Mapped[str | None] = mapped_column(String(50))
    run_id: Mapped[str | None] = mapped_column(String(80))
    content: Mapped[dict[str, Any]] = mapped_column(JSON, nullable=False)
    model_name: Mapped[str | None] = mapped_column(String(100))
    token_count: Mapped[int | None] = mapped_column(Integer)
    sort_order: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    create_time: Mapped[datetime] = mapped_column(DateTime, nullable=False, server_default=func.now())
