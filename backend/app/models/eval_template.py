from __future__ import annotations

from datetime import datetime
from typing import TYPE_CHECKING
from sqlalchemy import BigInteger, String, SmallInteger, DateTime
from sqlalchemy.orm import Mapped, mapped_column, relationship
from sqlalchemy.sql import func
from . import Base

if TYPE_CHECKING:
    from .eval_template_skill import EvalTemplateSkill
    from .eval_template_dimension import EvalTemplateDimension
    from .eval_template_tag import EvalTemplateTag
    from .job_position import JobPosition


class EvalTemplate(Base):
    __tablename__ = "eval_template"

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    template_name: Mapped[str] = mapped_column(String(100), nullable=False, comment="模板名称")
    description: Mapped[str | None] = mapped_column(String(255), comment="模板说明")
    status: Mapped[int] = mapped_column(SmallInteger, nullable=False, default=1, comment="状态：1启用，0停用")
    is_deleted: Mapped[int] = mapped_column(SmallInteger, nullable=False, default=0, comment="逻辑删除")
    create_time: Mapped[datetime] = mapped_column(DateTime, nullable=False, server_default=func.now(), comment="创建时间")
    update_time: Mapped[datetime] = mapped_column(DateTime, nullable=False, server_default=func.now(), onupdate=func.now(), comment="更新时间")

    dimensions: Mapped[list[EvalTemplateDimension]] = relationship(
        foreign_keys="EvalTemplateDimension.template_id",
        primaryjoin="EvalTemplate.id == foreign(EvalTemplateDimension.template_id)",
        viewonly=True,
        lazy="raise",
    )
    skills: Mapped[list[EvalTemplateSkill]] = relationship(
        foreign_keys="EvalTemplateSkill.template_id",
        primaryjoin="EvalTemplate.id == foreign(EvalTemplateSkill.template_id)",
        viewonly=True,
        lazy="raise",
    )
    tags: Mapped[list[EvalTemplateTag]] = relationship(
        foreign_keys="EvalTemplateTag.template_id",
        primaryjoin="EvalTemplate.id == foreign(EvalTemplateTag.template_id)",
        viewonly=True,
        lazy="raise",
    )
    # 防止 LEFT JOIN 因 JobPosition 软删除退化为 INNER JOIN
    job_positions: Mapped[list[JobPosition]] = relationship(
        foreign_keys="JobPosition.template_id",
        primaryjoin="and_(EvalTemplate.id == foreign(JobPosition.template_id), JobPosition.is_deleted == 0)",
        viewonly=True,
        lazy="raise",
    )
