from __future__ import annotations

from datetime import datetime
from typing import TYPE_CHECKING
from sqlalchemy import BigInteger, String, SmallInteger, DateTime
from sqlalchemy.orm import Mapped, mapped_column, relationship
from sqlalchemy.sql import func
from . import Base

if TYPE_CHECKING:
    from .resume import Resume
    from .job_application import JobApplication


class SysUser(Base):
    __tablename__ = "sys_user"

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    email: Mapped[str] = mapped_column(String(100), nullable=False, unique=True, comment="邮箱")
    real_name: Mapped[str] = mapped_column(String(50), nullable=False, comment="真实姓名")
    password_hash: Mapped[str] = mapped_column(String(255), nullable=False, comment="密码哈希")
    status: Mapped[int] = mapped_column(SmallInteger, nullable=False, default=1, comment="账号状态：1正常，0禁用")
    is_deleted: Mapped[int] = mapped_column(SmallInteger, nullable=False, default=0, comment="逻辑删除")
    create_time: Mapped[datetime] = mapped_column(DateTime, nullable=False, server_default=func.now(), comment="注册时间")
    update_time: Mapped[datetime] = mapped_column(DateTime, nullable=False, server_default=func.now(), onupdate=func.now(), comment="更新时间")

    # 防止 LEFT JOIN 因 Resume 软删除退化为 INNER JOIN
    resumes: Mapped[list[Resume]] = relationship(
        foreign_keys="Resume.user_id",
        primaryjoin="and_(SysUser.id == foreign(Resume.user_id), Resume.is_deleted == 0)",
        viewonly=True,
        lazy="raise",
    )
    # 防止 LEFT JOIN 因 JobApplication 软删除退化为 INNER JOIN
    applications: Mapped[list[JobApplication]] = relationship(
        foreign_keys="JobApplication.user_id",
        primaryjoin="and_(SysUser.id == foreign(JobApplication.user_id), JobApplication.is_deleted == 0)",
        viewonly=True,
        lazy="raise",
    )
