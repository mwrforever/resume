from __future__ import annotations

from datetime import datetime
from typing import TYPE_CHECKING
from sqlalchemy import BigInteger, DateTime, Index, SmallInteger, String
from sqlalchemy.orm import Mapped, mapped_column, relationship
from sqlalchemy.sql import func
from . import Base

if TYPE_CHECKING:
    from .eval_template_skill import EvalTemplateSkill


class ResumeSkillHit(Base):
    __tablename__ = "resume_skill_hit"
    # 真实查询：按 match_id 列出 / 删除技能命中记录
    __table_args__ = (
        Index("idx_match", "match_id"),
    )

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    match_id: Mapped[int] = mapped_column(BigInteger, nullable=False, comment="关联匹配记录ID")
    skill_id: Mapped[int] = mapped_column(BigInteger, nullable=False, comment="关联技能ID")
    is_hit: Mapped[int] = mapped_column(SmallInteger, nullable=False, comment="是否命中")
    hit_context: Mapped[str | None] = mapped_column(String(500), comment="命中上下文")
    create_time: Mapped[datetime] = mapped_column(DateTime, nullable=False, server_default=func.now(), comment="创建时间")

    skill: Mapped[EvalTemplateSkill] = relationship(
        foreign_keys=skill_id,
        primaryjoin="ResumeSkillHit.skill_id == foreign(EvalTemplateSkill.id)",
        viewonly=True,
        lazy="raise",
    )
