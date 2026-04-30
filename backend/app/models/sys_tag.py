from __future__ import annotations

from datetime import datetime
from typing import TYPE_CHECKING
from sqlalchemy import BigInteger, String, SmallInteger, Integer, DateTime
from sqlalchemy.orm import Mapped, mapped_column, relationship
from sqlalchemy.sql import func
from . import Base

if TYPE_CHECKING:
    from .eval_template_tag import EvalTemplateTag


class SysTag(Base):
    __tablename__ = "sys_tag"

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    tag_name: Mapped[str] = mapped_column(String(50), nullable=False, comment="标签名称")
    tag_type: Mapped[int] = mapped_column(SmallInteger, nullable=False, default=1, comment="标签分类：1岗位特性，2福利待遇，3技能加分")
    sort_order: Mapped[int] = mapped_column(Integer, nullable=False, default=0, comment="排序")
    status: Mapped[int] = mapped_column(SmallInteger, nullable=False, default=1, comment="状态：1正常，0停用")
    color: Mapped[str] = mapped_column(String(20), nullable=False, default="default", comment="标签颜色")
    is_deleted: Mapped[int] = mapped_column(SmallInteger, nullable=False, default=0, comment="逻辑删除")
    create_time: Mapped[datetime] = mapped_column(DateTime, nullable=False, server_default=func.now(), comment="创建时间")

    template_tags: Mapped[list[EvalTemplateTag]] = relationship(
        foreign_keys="EvalTemplateTag.tag_id",
        primaryjoin="SysTag.id == foreign(EvalTemplateTag.tag_id)",
        viewonly=True,
        lazy="raise",
    )
