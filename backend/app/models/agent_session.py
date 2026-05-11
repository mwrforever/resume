from datetime import datetime

from sqlalchemy import BigInteger, DateTime, Index, Integer, SmallInteger, String, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column
from sqlalchemy.sql import func

from . import Base


class AgentSession(Base):
    __tablename__ = "agent_session"
    __table_args__ = (
        UniqueConstraint("session_key", "is_deleted", name="uk_session_key"),
        Index("idx_employee_time", "employee_id", "create_time"),
        Index("idx_status", "status", "is_deleted"),
    )

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    session_key: Mapped[str] = mapped_column(String(64), nullable=False)
    employee_id: Mapped[int] = mapped_column(BigInteger, nullable=False)
    title: Mapped[str] = mapped_column(String(100), nullable=False)
    status: Mapped[int] = mapped_column(SmallInteger, nullable=False, default=1)
    is_deleted: Mapped[int] = mapped_column(SmallInteger, nullable=False, default=0)
    selected_model_name: Mapped[str | None] = mapped_column(String(100))
    selected_model_source: Mapped[str | None] = mapped_column(String(20))
    context_summary: Mapped[str | None] = mapped_column(String(1000))
    last_message_time: Mapped[datetime | None] = mapped_column(DateTime)
    version: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    create_time: Mapped[datetime] = mapped_column(DateTime, nullable=False, server_default=func.now())
    update_time: Mapped[datetime] = mapped_column(DateTime, nullable=False, server_default=func.now(), onupdate=func.now())
