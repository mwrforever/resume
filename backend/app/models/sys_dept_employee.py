from __future__ import annotations

from datetime import datetime
from typing import TYPE_CHECKING
from sqlalchemy import BigInteger, DateTime, Index, SmallInteger, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column, relationship
from sqlalchemy.sql import func
from . import Base

if TYPE_CHECKING:
    from .sys_dept import SysDept
    from .sys_employee import SysEmployee


class SysDeptEmployee(Base):
    __tablename__ = "sys_dept_employee"
    # 真实查询：按 employee_id 列出关联部门（list_employee_depts / 批量 in_）；
    # 一个员工在同一部门不允许重复加入（业务唯一）
    __table_args__ = (
        UniqueConstraint("dept_id", "employee_id", name="uk_dept_employee"),
        Index("idx_employee", "employee_id"),
    )

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    dept_id: Mapped[int] = mapped_column(BigInteger, nullable=False)
    employee_id: Mapped[int] = mapped_column(BigInteger, nullable=False)
    is_primary: Mapped[int] = mapped_column(SmallInteger, nullable=False, default=0)
    create_time: Mapped[datetime] = mapped_column(DateTime, nullable=False, server_default=func.now())

    # 防止 LEFT JOIN 因 SysDept 软删除退化为 INNER JOIN
    dept: Mapped[SysDept] = relationship(
        foreign_keys=dept_id,
        primaryjoin="and_(SysDeptEmployee.dept_id == foreign(SysDept.id), SysDept.is_deleted == 0)",
        viewonly=True,
        lazy="raise",
    )
    # 防止 LEFT JOIN 因 SysEmployee 软删除退化为 INNER JOIN
    employee: Mapped[SysEmployee] = relationship(
        foreign_keys=employee_id,
        primaryjoin="and_(SysDeptEmployee.employee_id == foreign(SysEmployee.id), SysEmployee.is_deleted == 0)",
        viewonly=True,
        lazy="raise",
    )
