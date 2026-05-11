from datetime import datetime

from sqlalchemy import BigInteger, DateTime, Index, String, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column
from sqlalchemy.sql import func

from . import Base


class AgentWorkspacePreference(Base):
    __tablename__ = "agent_workspace_preference"
    __table_args__ = (
        UniqueConstraint("employee_id", name="uk_agent_workspace_employee"),
        Index("idx_selected_llm_config", "selected_llm_config_id"),
    )

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    employee_id: Mapped[int] = mapped_column(BigInteger, nullable=False, comment="员工ID")
    selected_model_name: Mapped[str | None] = mapped_column(String(100), comment="选中模型名称，配置文件默认模型为空")
    selected_model_source: Mapped[str] = mapped_column(String(20), nullable=False, default="env", comment="选中模型来源：env/employee/dept")
    selected_llm_config_id: Mapped[int | None] = mapped_column(BigInteger, comment="选中模型连接配置ID，配置文件默认模型为空")
    last_selected_at: Mapped[datetime | None] = mapped_column(DateTime, comment="最近选择时间")
    create_time: Mapped[datetime] = mapped_column(DateTime, nullable=False, server_default=func.now(), comment="创建时间")
    update_time: Mapped[datetime] = mapped_column(DateTime, nullable=False, server_default=func.now(), onupdate=func.now(), comment="更新时间")
