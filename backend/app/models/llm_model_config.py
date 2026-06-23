from datetime import datetime
from decimal import Decimal
from typing import Any

from sqlalchemy import BigInteger, Boolean, DateTime, Index, Integer, JSON, Numeric, SmallInteger, String, Text, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column
from sqlalchemy.sql import func

from . import Base


class LlmModelConfig(Base):
    __tablename__ = "llm_model_config"
    __table_args__ = (
        UniqueConstraint("biz_type", "biz_id", "model_name", "is_deleted", name="uk_biz_model_deleted"),
        Index("idx_biz", "biz_type", "biz_id", "status", "is_deleted"),
        Index("idx_model_name", "model_name"),
    )

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    biz_type: Mapped[str] = mapped_column(String(30), nullable=False, comment="业务类型：employee/dept")
    biz_id: Mapped[int] = mapped_column(BigInteger, nullable=False, comment="业务ID：员工ID/部门ID")
    config_name: Mapped[str] = mapped_column(String(50), nullable=False, comment="配置名称")
    protocol: Mapped[str] = mapped_column(String(20), nullable=False, default="openai", comment="协议")
    base_url: Mapped[str] = mapped_column(String(500), nullable=False, comment="OpenAI兼容Base URL")
    api_key_ciphertext: Mapped[str] = mapped_column(Text, nullable=False, comment="加密后的API Key")
    api_key_mask: Mapped[str] = mapped_column(String(50), nullable=False, comment="脱敏展示值")
    model_name: Mapped[str] = mapped_column(String(100), nullable=False, comment="模型名称")
    fallback_model_name: Mapped[str | None] = mapped_column(String(100), comment="兜底模型名称")
    extra_body: Mapped[dict[str, Any] | None] = mapped_column(JSON, comment="扩展参数")
    enable_thinking: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False, comment="是否开启思考模式")
    enable_tools: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True, comment="是否启用工具调用")
    enable_prompt_cache: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False, comment="是否启用LLM前缀缓存")
    enable_memory: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True, comment="是否启用上下文记忆")
    temperature: Mapped[Decimal] = mapped_column(Numeric(4, 2), nullable=False, default=Decimal("0.70"), comment="生成随机性")
    top_p: Mapped[Decimal] = mapped_column(Numeric(4, 2), nullable=False, default=Decimal("0.90"), comment="核采样参数")
    max_tokens: Mapped[int] = mapped_column(Integer, nullable=False, default=8192, comment="最大输出Token")
    presence_penalty: Mapped[Decimal] = mapped_column(Numeric(4, 2), nullable=False, default=Decimal("0.00"), comment="话题出现惩罚")
    frequency_penalty: Mapped[Decimal] = mapped_column(Numeric(4, 2), nullable=False, default=Decimal("0.00"), comment="频率惩罚")
    timeout_seconds: Mapped[int] = mapped_column(SmallInteger, nullable=False, default=120, comment="请求超时时间")
    max_retries: Mapped[int] = mapped_column(SmallInteger, nullable=False, default=2, comment="最大重试次数")
    status: Mapped[int] = mapped_column(SmallInteger, nullable=False, default=1, comment="状态：1启用，0停用")
    is_deleted: Mapped[int] = mapped_column(BigInteger, nullable=False, default=0, comment="软删除标记：0未删除，删除时写入Unix微秒时间戳")
    last_test_at: Mapped[datetime | None] = mapped_column(DateTime, comment="最近测试时间")
    last_test_status: Mapped[int | None] = mapped_column(SmallInteger, comment="最近测试状态")
    last_test_message: Mapped[str | None] = mapped_column(String(500), comment="最近测试结果")
    create_time: Mapped[datetime] = mapped_column(DateTime, nullable=False, server_default=func.now(), comment="创建时间")
    update_time: Mapped[datetime] = mapped_column(DateTime, nullable=False, server_default=func.now(), onupdate=func.now(), comment="更新时间")
