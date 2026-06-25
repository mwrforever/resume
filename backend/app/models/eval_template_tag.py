from __future__ import annotations

from datetime import datetime
from typing import TYPE_CHECKING
from sqlalchemy import BigInteger, DateTime, Index, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column, relationship
from sqlalchemy.sql import func
from . import Base

if TYPE_CHECKING:
    from .eval_template import EvalTemplate
    from .sys_tag import SysTag


class EvalTemplateTag(Base):
    __tablename__ = "eval_template_tag"
    # 真实查询：按 template_id 列出/删除模板标签；按 tag_id 反查模板数
    __table_args__ = (
        UniqueConstraint("template_id", "tag_id", name="uk_template_tag"),
        Index("idx_tag", "tag_id"),
    )

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    template_id: Mapped[int] = mapped_column(BigInteger, nullable=False, comment="模板ID")
    tag_id: Mapped[int] = mapped_column(BigInteger, nullable=False, comment="标签ID")
    create_time: Mapped[datetime] = mapped_column(DateTime, nullable=False, server_default=func.now(), comment="创建时间")

    # 防止 LEFT JOIN 因 EvalTemplate 软删除退化为 INNER JOIN
    template: Mapped[EvalTemplate] = relationship(
        foreign_keys=template_id,
        primaryjoin="and_(EvalTemplateTag.template_id == foreign(EvalTemplate.id), EvalTemplate.is_deleted == 0)",
        viewonly=True,
        lazy="raise",
    )
    # 防止 LEFT JOIN 因 SysTag 软删除退化为 INNER JOIN
    tag: Mapped[SysTag] = relationship(
        foreign_keys=tag_id,
        primaryjoin="and_(EvalTemplateTag.tag_id == foreign(SysTag.id), SysTag.is_deleted == 0)",
        viewonly=True,
        lazy="raise",
    )
