from datetime import datetime
from decimal import Decimal
from typing import Any

from sqlalchemy import BigInteger, Boolean, DateTime, Index, Integer, JSON, Numeric, String, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column
from sqlalchemy.sql import func

from . import Base


class AgentUserModelRuntimeConfig(Base):
    __tablename__ = "agent_user_model_runtime_config"
    __table_args__ = (
        UniqueConstraint("employee_id", "llm_config_id", name="uk_employee_llm_config"),
        Index("idx_employee_last_used", "employee_id", "last_used_at"),
        Index("idx_llm_config", "llm_config_id"),
    )

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    employee_id: Mapped[int] = mapped_column(BigInteger, nullable=False, comment="员工ID")
    llm_config_id: Mapped[int] = mapped_column(BigInteger, nullable=False, comment="模型连接配置ID")
    model_name: Mapped[str] = mapped_column(String(100), nullable=False, comment="模型名称快照")
    model_source: Mapped[str] = mapped_column(String(20), nullable=False, comment="模型来源：employee/dept")
    enable_thinking: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False, comment="是否开启思考模式")
    enable_tools: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True, comment="是否启用工具调用")
    enable_prompt_cache: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False, comment="是否启用LLM前缀缓存")
    enable_memory: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True, comment="是否启用上下文记忆")
    temperature: Mapped[Decimal] = mapped_column(Numeric(4, 2), nullable=False, default=Decimal("0.70"), comment="生成随机性")
    top_p: Mapped[Decimal] = mapped_column(Numeric(4, 2), nullable=False, default=Decimal("0.90"), comment="核采样参数")
    max_tokens: Mapped[int] = mapped_column(Integer, nullable=False, default=2048, comment="最大输出Token")
    presence_penalty: Mapped[Decimal] = mapped_column(Numeric(4, 2), nullable=False, default=Decimal("0.00"), comment="话题出现惩罚")
    frequency_penalty: Mapped[Decimal] = mapped_column(Numeric(4, 2), nullable=False, default=Decimal("0.00"), comment="频率惩罚")
    extra_body: Mapped[dict[str, Any] | None] = mapped_column(JSON, comment="高级运行参数")
    last_used_at: Mapped[datetime | None] = mapped_column(DateTime, comment="最近使用时间")
    create_time: Mapped[datetime] = mapped_column(DateTime, nullable=False, server_default=func.now(), comment="创建时间")
    update_time: Mapped[datetime] = mapped_column(DateTime, nullable=False, server_default=func.now(), onupdate=func.now(), comment="更新时间")
