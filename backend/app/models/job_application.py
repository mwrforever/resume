from __future__ import annotations

from datetime import datetime
from typing import TYPE_CHECKING
from sqlalchemy import BigInteger, SmallInteger, DateTime, JSON
from sqlalchemy.orm import Mapped, mapped_column, relationship
from sqlalchemy.sql import func
from . import Base

if TYPE_CHECKING:
    from .job_position import JobPosition
    from .sys_user import SysUser
    from .resume import Resume
    from .resume_job_match import ResumeJobMatch


class JobApplication(Base):
    __tablename__ = "job_application"

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    user_id: Mapped[int] = mapped_column(BigInteger, nullable=False, comment="投递用户ID")
    job_id: Mapped[int] = mapped_column(BigInteger, nullable=False, comment="岗位ID")
    resume_id: Mapped[int] = mapped_column(BigInteger, nullable=False, comment="关联简历ID")
    status: Mapped[int] = mapped_column(SmallInteger, nullable=False, default=0, comment="状态：0待评估，1待处理，2已查看，3面试中，4已拒绝，5已录用，6已结束")
    job_snapshot: Mapped[dict | None] = mapped_column(JSON, comment="投递时岗位与标签快照")
    is_deleted: Mapped[int] = mapped_column(SmallInteger, nullable=False, default=0, comment="逻辑删除")
    create_time: Mapped[datetime] = mapped_column(DateTime, nullable=False, server_default=func.now(), comment="投递时间")
    update_time: Mapped[datetime] = mapped_column(DateTime, nullable=False, server_default=func.now(), onupdate=func.now(), comment="更新时间")

    # 防止 LEFT JOIN 因 JobPosition 软删除退化为 INNER JOIN
    job: Mapped[JobPosition] = relationship(
        foreign_keys=job_id,
        primaryjoin="and_(JobApplication.job_id == foreign(JobPosition.id), JobPosition.is_deleted == 0)",
        viewonly=True,
        lazy="raise",
    )
    # 防止 LEFT JOIN 因 SysUser 软删除退化为 INNER JOIN
    user: Mapped[SysUser] = relationship(
        foreign_keys=user_id,
        primaryjoin="and_(JobApplication.user_id == foreign(SysUser.id), SysUser.is_deleted == 0)",
        viewonly=True,
        lazy="raise",
    )
    # 防止 LEFT JOIN 因 Resume 软删除退化为 INNER JOIN
    resume: Mapped[Resume] = relationship(
        foreign_keys=resume_id,
        primaryjoin="and_(JobApplication.resume_id == foreign(Resume.id), Resume.is_deleted == 0)",
        viewonly=True,
        lazy="raise",
    )
    match: Mapped[ResumeJobMatch | None] = relationship(
        foreign_keys="ResumeJobMatch.application_id",
        primaryjoin="JobApplication.id == foreign(ResumeJobMatch.application_id)",
        viewonly=True,
        lazy="raise",
    )
