from __future__ import annotations

from datetime import datetime
from decimal import Decimal
from typing import TYPE_CHECKING
from sqlalchemy import BigInteger, DECIMAL, Integer, DateTime, Text
from sqlalchemy.orm import Mapped, mapped_column, relationship
from sqlalchemy.sql import func
from . import Base

if TYPE_CHECKING:
    from .eval_template import EvalTemplate
    from .eval_dimension import EvalDimension


class EvalTemplateDimension(Base):
    __tablename__ = "eval_template_dimension"

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    template_id: Mapped[int] = mapped_column(BigInteger, nullable=False, comment="模板ID")
    dimension_id: Mapped[int] = mapped_column(BigInteger, nullable=False, comment="全局维度ID")
    weight: Mapped[Decimal] = mapped_column(DECIMAL(5, 2), nullable=False, comment="权重")
    prompt_template: Mapped[str] = mapped_column(Text, nullable=False, comment="提示词模板")
    sort_order: Mapped[int] = mapped_column(Integer, nullable=False, default=0, comment="排序")
    create_time: Mapped[datetime] = mapped_column(DateTime, nullable=False, server_default=func.now(), comment="创建时间")

    # 防止 LEFT JOIN 因 EvalTemplate 软删除退化为 INNER JOIN
    template: Mapped[EvalTemplate] = relationship(
        foreign_keys=template_id,
        primaryjoin="and_(EvalTemplateDimension.template_id == foreign(EvalTemplate.id), EvalTemplate.is_deleted == 0)",
        viewonly=True,
        lazy="raise",
    )
    # 防止 LEFT JOIN 因 EvalDimension 软删除退化为 INNER JOIN
    dimension: Mapped[EvalDimension] = relationship(
        foreign_keys=dimension_id,
        primaryjoin="and_(EvalTemplateDimension.dimension_id == foreign(EvalDimension.id), EvalDimension.is_deleted == 0)",
        viewonly=True,
        lazy="raise",
    )
