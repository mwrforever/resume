from __future__ import annotations

from datetime import datetime
from decimal import Decimal
from typing import TYPE_CHECKING
from sqlalchemy import BigInteger, DECIMAL, DateTime, Index, Integer, String, Text
from sqlalchemy.orm import Mapped, mapped_column, relationship
from sqlalchemy.sql import func
from . import Base

if TYPE_CHECKING:
    from .eval_dimension import EvalDimension


class ResumeEvalDetail(Base):
    __tablename__ = "resume_eval_detail"
    # 真实查询：按 match_id 列出评估明细 / 删除（evaluation_repository.list_details_by_match / delete_details_by_match）
    __table_args__ = (
        Index("idx_match", "match_id"),
    )

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    match_id: Mapped[int] = mapped_column(BigInteger, nullable=False, comment="关联匹配记录ID")
    dimension_id: Mapped[int] = mapped_column(BigInteger, nullable=False, comment="关联维度ID")
    dimension_score: Mapped[Decimal] = mapped_column(DECIMAL(5, 2), nullable=False, comment="维度得分(0-100)")
    dimension_advantage: Mapped[str | None] = mapped_column(String(500), comment="维度优点")
    dimension_disadvantage: Mapped[str | None] = mapped_column(String(500), comment="维度缺点")
    ai_reasoning: Mapped[str | None] = mapped_column(Text, comment="AI理由")
    is_completed: Mapped[int] = mapped_column(Integer, nullable=False, default=1, comment="是否成功完成评估：1成功，0失败")
    error_message: Mapped[str | None] = mapped_column(String(500), comment="评估失败时的错误信息")
    create_time: Mapped[datetime] = mapped_column(DateTime, nullable=False, server_default=func.now(), comment="创建时间")

    # 防止 LEFT JOIN 因 EvalDimension 软删除退化为 INNER JOIN
    dimension: Mapped[EvalDimension] = relationship(
        foreign_keys=dimension_id,
        primaryjoin="and_(ResumeEvalDetail.dimension_id == foreign(EvalDimension.id), EvalDimension.is_deleted == 0)",
        viewonly=True,
        lazy="raise",
    )
