from __future__ import annotations

from datetime import datetime
from typing import TYPE_CHECKING
from sqlalchemy import BigInteger, Index, String, SmallInteger, Integer, DateTime
from sqlalchemy.orm import Mapped, mapped_column, relationship
from sqlalchemy.sql import func
from . import Base

if TYPE_CHECKING:
    from .sys_employee import SysEmployee
    from .sys_dept_employee import SysDeptEmployee
    from .job_position import JobPosition


class SysDept(Base):
    __tablename__ = "sys_dept"
    # 索引依据 dept_repository 真实查询：
    # - 按 dept_code 精确查（业务唯一性，软删后允许复用，所以不做 UNIQUE）
    # - 按 parent_id 查子部门 / 校验是否存在子部门
    # - 列表常按 (is_deleted, sort_order) 过滤排序
    __table_args__ = (
        Index("idx_dept_code", "dept_code"),
        Index("idx_parent", "parent_id", "is_deleted"),
        Index("idx_status_sort", "is_deleted", "status", "sort_order"),
    )

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    parent_id: Mapped[int] = mapped_column(BigInteger, nullable=False, default=0, comment="父部门ID(0为顶级)")
    dept_code: Mapped[str | None] = mapped_column(String(20), comment="部门编码")
    dept_name: Mapped[str] = mapped_column(String(50), nullable=False, comment="部门名称")
    leader_id: Mapped[int | None] = mapped_column(BigInteger, comment="部门负责人员工ID")
    sort_order: Mapped[int] = mapped_column(Integer, nullable=False, default=0, comment="显示排序")
    status: Mapped[int] = mapped_column(SmallInteger, nullable=False, default=1, comment="状态：1正常，0停用")
    is_deleted: Mapped[int] = mapped_column(SmallInteger, nullable=False, default=0, comment="逻辑删除")
    create_time: Mapped[datetime] = mapped_column(DateTime, nullable=False, server_default=func.now(), comment="创建时间")
    update_time: Mapped[datetime] = mapped_column(DateTime, nullable=False, server_default=func.now(), onupdate=func.now(), comment="更新时间")

    # 自引用：防止 LEFT JOIN 因父部门软删除退化为 INNER JOIN
    parent: Mapped[SysDept | None] = relationship(
        foreign_keys=parent_id,
        primaryjoin="and_(remote(SysDept.id) == foreign(SysDept.parent_id), SysDept.is_deleted == 0)",
        viewonly=True,
        lazy="raise",
    )
    # 防止 LEFT JOIN 因 leader (SysEmployee) 软删除退化为 INNER JOIN
    leader: Mapped[SysEmployee | None] = relationship(
        foreign_keys=leader_id,
        primaryjoin="and_(SysDept.leader_id == foreign(SysEmployee.id), SysEmployee.is_deleted == 0)",
        viewonly=True,
        lazy="raise",
    )
    dept_employees: Mapped[list[SysDeptEmployee]] = relationship(
        foreign_keys="SysDeptEmployee.dept_id",
        primaryjoin="SysDept.id == foreign(SysDeptEmployee.dept_id)",
        viewonly=True,
        lazy="raise",
    )
    # 防止 LEFT JOIN 因 JobPosition 软删除退化为 INNER JOIN
    job_positions: Mapped[list[JobPosition]] = relationship(
        foreign_keys="JobPosition.dept_id",
        primaryjoin="and_(SysDept.id == foreign(JobPosition.dept_id), JobPosition.is_deleted == 0)",
        viewonly=True,
        lazy="raise",
    )
