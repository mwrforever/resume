from __future__ import annotations

from datetime import datetime
from typing import TYPE_CHECKING
from sqlalchemy import BigInteger, String, SmallInteger, DateTime, Text
from sqlalchemy.orm import Mapped, mapped_column, relationship
from sqlalchemy.sql import func
from . import Base

if TYPE_CHECKING:
    from .sys_user import SysUser
    from .job_application import JobApplication


class Resume(Base):
    __tablename__ = "resume"

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    user_id: Mapped[int | None] = mapped_column(BigInteger, comment="上传者ID")
    file_name: Mapped[str] = mapped_column(String(255), nullable=False, comment="原始文件名")
    file_path: Mapped[str] = mapped_column(String(500), nullable=False, comment="文件相对路径")
    storage_type: Mapped[str] = mapped_column(String(20), nullable=False, default="LOCAL", comment="存储类型")
    raw_text: Mapped[str | None] = mapped_column(Text, comment="AI解析后的纯文本内容")
    status: Mapped[int] = mapped_column(SmallInteger, nullable=False, default=0, comment="状态：0正常，1异常")
    is_deleted: Mapped[int] = mapped_column(SmallInteger, nullable=False, default=0, comment="逻辑删除")
    create_time: Mapped[datetime] = mapped_column(DateTime, nullable=False, server_default=func.now(), comment="上传时间")
    update_time: Mapped[datetime] = mapped_column(DateTime, nullable=False, server_default=func.now(), onupdate=func.now(), comment="更新时间")

    # 防止 LEFT JOIN 因 SysUser 软删除退化为 INNER JOIN
    user: Mapped[SysUser | None] = relationship(
        foreign_keys=user_id,
        primaryjoin="and_(Resume.user_id == foreign(SysUser.id), SysUser.is_deleted == 0)",
        viewonly=True,
        lazy="raise",
    )
    # 防止 LEFT JOIN 因 JobApplication 软删除退化为 INNER JOIN
    applications: Mapped[list[JobApplication]] = relationship(
        foreign_keys="JobApplication.resume_id",
        primaryjoin="and_(Resume.id == foreign(JobApplication.resume_id), JobApplication.is_deleted == 0)",
        viewonly=True,
        lazy="raise",
    )
