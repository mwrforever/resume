from datetime import datetime
from decimal import Decimal

from sqlalchemy import BigInteger, DateTime, DECIMAL, Index, String, Text, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column
from sqlalchemy.sql import func

from . import Base


class AgentMemory(Base):
    __tablename__ = "agent_memory"
    __table_args__ = (
        UniqueConstraint("employee_id", "memory_type", "memory_key", name="uk_agent_memory_key"),
        Index("idx_employee", "employee_id"),
        Index("idx_type", "employee_id", "memory_type"),
    )

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    employee_id: Mapped[int] = mapped_column(BigInteger, nullable=False)
    memory_type: Mapped[str] = mapped_column(String(30), nullable=False)
    memory_key: Mapped[str] = mapped_column(String(100), nullable=False)
    content: Mapped[str] = mapped_column(Text, nullable=False)
    importance_score: Mapped[Decimal] = mapped_column(DECIMAL(5, 2), nullable=False, default=0)
    confidence_score: Mapped[Decimal] = mapped_column(DECIMAL(5, 2), nullable=False, default=0)
    source_session_id: Mapped[int | None] = mapped_column(BigInteger)
    last_access_time: Mapped[datetime | None] = mapped_column(DateTime)
    create_time: Mapped[datetime] = mapped_column(DateTime, nullable=False, server_default=func.now())
    update_time: Mapped[datetime] = mapped_column(DateTime, nullable=False, server_default=func.now(), onupdate=func.now())
