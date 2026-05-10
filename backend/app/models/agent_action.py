from datetime import datetime
from typing import Any

from sqlalchemy import BigInteger, DateTime, Index, JSON, SmallInteger, String, Text, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column
from sqlalchemy.sql import func

from . import Base


class AgentAction(Base):
    __tablename__ = "agent_action"
    __table_args__ = (
        UniqueConstraint("idempotency_key", name="uk_idempotency_key"),
        Index("idx_session_status", "session_id", "status"),
        Index("idx_employee_status", "employee_id", "status"),
    )

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    session_id: Mapped[int] = mapped_column(BigInteger, nullable=False)
    message_id: Mapped[int | None] = mapped_column(BigInteger)
    run_id: Mapped[int | None] = mapped_column(BigInteger)
    employee_id: Mapped[int] = mapped_column(BigInteger, nullable=False)
    capability_key: Mapped[str] = mapped_column(String(80), nullable=False)
    action_name: Mapped[str] = mapped_column(String(100), nullable=False)
    target_type: Mapped[str | None] = mapped_column(String(50))
    target_id: Mapped[int | None] = mapped_column(BigInteger)
    input_payload: Mapped[dict[str, Any]] = mapped_column(JSON, nullable=False)
    preview_payload: Mapped[dict[str, Any]] = mapped_column(JSON, nullable=False)
    status: Mapped[int] = mapped_column(SmallInteger, nullable=False, default=1)
    idempotency_key: Mapped[str] = mapped_column(String(100), nullable=False)
    confirmed_at: Mapped[datetime | None] = mapped_column(DateTime)
    executed_at: Mapped[datetime | None] = mapped_column(DateTime)
    rejected_at: Mapped[datetime | None] = mapped_column(DateTime)
    error_message: Mapped[str | None] = mapped_column(Text)
    create_time: Mapped[datetime] = mapped_column(DateTime, nullable=False, server_default=func.now())
    update_time: Mapped[datetime] = mapped_column(DateTime, nullable=False, server_default=func.now(), onupdate=func.now())
