"""Agent 会话 ORM 模型（与新 DDL 对齐）。"""

from datetime import datetime

from sqlalchemy import BigInteger, DateTime, Index, Integer, String, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column
from sqlalchemy.sql import func

from . import Base


class AgentSession(Base):
    """Agent 会话表。"""

    __tablename__ = "agent_session"
    __table_args__ = (
        UniqueConstraint("session_key", name="uk_session_key"),
        Index("idx_employee", "employee_id", "status", "last_message_time"),
    )

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    session_key: Mapped[str] = mapped_column(String(64), nullable=False)
    employee_id: Mapped[int] = mapped_column(BigInteger, nullable=False)
    title: Mapped[str | None] = mapped_column(String(80))
    selected_model_name: Mapped[str | None] = mapped_column(String(80))
    enable_thinking: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    status: Mapped[int] = mapped_column(Integer, nullable=False, default=1)
    last_message_time: Mapped[datetime | None] = mapped_column(DateTime)
    create_time: Mapped[datetime] = mapped_column(DateTime, nullable=False, server_default=func.now())
    update_time: Mapped[datetime] = mapped_column(DateTime, nullable=False, server_default=func.now(), onupdate=func.now())
