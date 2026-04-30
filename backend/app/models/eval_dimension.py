from __future__ import annotations

from datetime import datetime
from typing import TYPE_CHECKING
from sqlalchemy import BigInteger, String, SmallInteger, Integer, DateTime, Text
from sqlalchemy.orm import Mapped, mapped_column, relationship
from sqlalchemy.sql import func
from . import Base

if TYPE_CHECKING:
    from .eval_template_dimension import EvalTemplateDimension


class EvalDimension(Base):
    __tablename__ = "eval_dimension"

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    dimension_name: Mapped[str] = mapped_column(String(50), nullable=False, comment="维度名称")
    description: Mapped[str | None] = mapped_column(String(255), comment="维度说明")
    default_prompt_template: Mapped[str] = mapped_column(Text, nullable=False, comment="默认提示词模板")
    sort_order: Mapped[int] = mapped_column(Integer, nullable=False, default=0, comment="排序")
    status: Mapped[int] = mapped_column(SmallInteger, nullable=False, default=1, comment="状态：1正常，0停用")
    is_deleted: Mapped[int] = mapped_column(SmallInteger, nullable=False, default=0, comment="逻辑删除")
    create_time: Mapped[datetime] = mapped_column(DateTime, nullable=False, server_default=func.now(), comment="创建时间")
    update_time: Mapped[datetime] = mapped_column(DateTime, nullable=False, server_default=func.now(), onupdate=func.now(), comment="更新时间")

    template_dimensions: Mapped[list[EvalTemplateDimension]] = relationship(
        foreign_keys="EvalTemplateDimension.dimension_id",
        primaryjoin="EvalDimension.id == foreign(EvalTemplateDimension.dimension_id)",
        viewonly=True,
        lazy="raise",
    )
