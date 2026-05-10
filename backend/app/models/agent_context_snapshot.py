from datetime import datetime

from sqlalchemy import BigInteger, DateTime, Index, Integer, String, Text, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column
from sqlalchemy.sql import func

from . import Base


class AgentContextSnapshot(Base):
    __tablename__ = "agent_context_snapshot"
    __table_args__ = (
        UniqueConstraint("session_id", "snapshot_version", name="uk_session_version"),
        Index("idx_session", "session_id"),
    )

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    session_id: Mapped[int] = mapped_column(BigInteger, nullable=False)
    snapshot_version: Mapped[int] = mapped_column(Integer, nullable=False)
    summary_text: Mapped[str] = mapped_column(Text, nullable=False)
    covered_message_start_id: Mapped[int] = mapped_column(BigInteger, nullable=False)
    covered_message_end_id: Mapped[int] = mapped_column(BigInteger, nullable=False)
    message_count: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    token_count: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    model_name: Mapped[str | None] = mapped_column(String(100))
    create_time: Mapped[datetime] = mapped_column(DateTime, nullable=False, server_default=func.now())
