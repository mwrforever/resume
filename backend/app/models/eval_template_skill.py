from __future__ import annotations

from datetime import datetime
from typing import TYPE_CHECKING
from sqlalchemy import BigInteger, String, SmallInteger, DateTime
from sqlalchemy.orm import Mapped, mapped_column, relationship
from sqlalchemy.sql import func
from . import Base

if TYPE_CHECKING:
    from .eval_template import EvalTemplate


class EvalTemplateSkill(Base):
    __tablename__ = "eval_template_skill"

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    template_id: Mapped[int] = mapped_column(BigInteger, nullable=False, comment="模板ID")
    skill_name: Mapped[str] = mapped_column(String(100), nullable=False, comment="技能名称")
    skill_type: Mapped[int] = mapped_column(SmallInteger, nullable=False, comment="技能类型：1必须满足，2优先匹配，3普通技能")
    match_label: Mapped[str | None] = mapped_column(String(20), comment="命中标签")
    is_ai_generated: Mapped[int] = mapped_column(SmallInteger, nullable=False, default=0, comment="是否AI生成")
    create_time: Mapped[datetime] = mapped_column(DateTime, nullable=False, server_default=func.now(), comment="创建时间")

    # 防止 LEFT JOIN 因 EvalTemplate 软删除退化为 INNER JOIN
    template: Mapped[EvalTemplate] = relationship(
        foreign_keys=template_id,
        primaryjoin="and_(EvalTemplateSkill.template_id == foreign(EvalTemplate.id), EvalTemplate.is_deleted == 0)",
        viewonly=True,
        lazy="raise",
    )
