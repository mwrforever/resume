from __future__ import annotations

from datetime import datetime
from typing import TYPE_CHECKING
from sqlalchemy import BigInteger, DateTime, Index, SmallInteger, String, Text
from sqlalchemy.orm import Mapped, mapped_column, relationship
from sqlalchemy.sql import func
from . import Base

if TYPE_CHECKING:
    from .sys_dept import SysDept
    from .sys_employee import SysEmployee
    from .eval_template import EvalTemplate
    from .eval_template_skill import EvalTemplateSkill
    from .job_application import JobApplication


class JobPosition(Base):
    __tablename__ = "job_position"
    # 真实查询：
    # - 列表/全局岗位：(is_deleted, status) 过滤 + id desc
    # - 员工自己的岗位列表（job_repository.get_by_employee）
    # - 按部门统计岗位数（dept_repository.count_jobs_by_dept）
    # - 按模板统计/列表（eval_template_repository.count_jobs_by_template）
    __table_args__ = (
        Index("idx_status_deleted", "is_deleted", "status"),
        Index("idx_employee", "employee_id", "is_deleted"),
        Index("idx_dept", "dept_id", "is_deleted"),
        Index("idx_template", "template_id", "is_deleted"),
    )

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    employee_id: Mapped[int] = mapped_column(BigInteger, nullable=False, comment="发布人(员工ID)")
    dept_id: Mapped[int] = mapped_column(BigInteger, nullable=False, comment="所属招聘部门")
    template_id: Mapped[int | None] = mapped_column(BigInteger, comment="评估模板ID")
    name: Mapped[str] = mapped_column(String(100), nullable=False, comment="岗位名称")
    description: Mapped[str | None] = mapped_column(Text, comment="岗位简要描述(用于AI生成技能)")
    status: Mapped[int] = mapped_column(SmallInteger, nullable=False, default=2, comment="状态：1招聘中，0已下架，2待发布")
    is_deleted: Mapped[int] = mapped_column(SmallInteger, nullable=False, default=0, comment="逻辑删除")
    create_time: Mapped[datetime] = mapped_column(DateTime, nullable=False, server_default=func.now(), comment="发布时间")
    update_time: Mapped[datetime] = mapped_column(DateTime, nullable=False, server_default=func.now(), onupdate=func.now(), comment="更新时间")

    # 防止 LEFT JOIN 因 SysDept 软删除退化为 INNER JOIN
    department: Mapped[SysDept] = relationship(
        foreign_keys=dept_id,
        primaryjoin="and_(JobPosition.dept_id == foreign(SysDept.id), SysDept.is_deleted == 0)",
        viewonly=True,
        lazy="raise",
    )
    # 防止 LEFT JOIN 因 SysEmployee 软删除退化为 INNER JOIN
    publisher: Mapped[SysEmployee] = relationship(
        foreign_keys=employee_id,
        primaryjoin="and_(JobPosition.employee_id == foreign(SysEmployee.id), SysEmployee.is_deleted == 0)",
        viewonly=True,
        lazy="raise",
    )
    # 防止 LEFT JOIN 因 EvalTemplate 软删除退化为 INNER JOIN
    template: Mapped[EvalTemplate | None] = relationship(
        foreign_keys=template_id,
        primaryjoin="and_(JobPosition.template_id == foreign(EvalTemplate.id), EvalTemplate.is_deleted == 0)",
        viewonly=True,
        lazy="raise",
    )
    template_skills: Mapped[list[EvalTemplateSkill]] = relationship(
        foreign_keys="EvalTemplateSkill.template_id",
        primaryjoin="JobPosition.template_id == foreign(EvalTemplateSkill.template_id)",
        viewonly=True,
        lazy="raise",
    )
    # 防止 LEFT JOIN 因 JobApplication 软删除退化为 INNER JOIN
    applications: Mapped[list[JobApplication]] = relationship(
        foreign_keys="JobApplication.job_id",
        primaryjoin="and_(JobPosition.id == foreign(JobApplication.job_id), JobApplication.is_deleted == 0)",
        viewonly=True,
        lazy="raise",
    )
