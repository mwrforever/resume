from __future__ import annotations

from datetime import datetime
from typing import TYPE_CHECKING
from sqlalchemy import BigInteger, Index, String, SmallInteger, DateTime
from sqlalchemy.orm import Mapped, mapped_column, relationship
from sqlalchemy.sql import func
from . import Base

if TYPE_CHECKING:
    from .sys_dept_employee import SysDeptEmployee
    from .job_position import JobPosition


class SysEmployee(Base):
    __tablename__ = "sys_employee"
    # 索引依据 employee_repository / dept_repository 的真实查询：
    # - 登录 / 唯一性校验：按 email / emp_no / phone 单字段查询
    # - 部门成员的真实姓名匹配（dept_repository.list_employees_by_real_name）
    __table_args__ = (
        Index("idx_email", "email"),
        Index("idx_emp_no", "emp_no"),
        Index("idx_phone", "phone"),
        Index("idx_real_name", "real_name"),
    )

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    emp_no: Mapped[str | None] = mapped_column(String(30), comment="员工工号")
    real_name: Mapped[str] = mapped_column(String(50), nullable=False, comment="真实姓名")
    email: Mapped[str | None] = mapped_column(String(100), comment="邮箱")
    phone: Mapped[str | None] = mapped_column(String(20), comment="手机号")
    password_hash: Mapped[str | None] = mapped_column(String(500), comment="密码哈希")
    status: Mapped[int] = mapped_column(SmallInteger, nullable=False, default=1, comment="在职状态：1在职，0离职")
    # 是否管理员：1=管理员（可访问用户管理/员工管理），0=普通员工。
    # 替代旧版写死管理员邮箱的判定方式，支持多管理员与动态授权。
    is_admin: Mapped[int] = mapped_column(SmallInteger, nullable=False, default=0, server_default="0", comment="是否管理员：1是，0否")
    is_deleted: Mapped[int] = mapped_column(SmallInteger, nullable=False, default=0, comment="逻辑删除")
    create_time: Mapped[datetime] = mapped_column(DateTime, nullable=False, server_default=func.now(), comment="创建时间")
    update_time: Mapped[datetime] = mapped_column(DateTime, nullable=False, server_default=func.now(), onupdate=func.now(), comment="更新时间")

    dept_employees: Mapped[list[SysDeptEmployee]] = relationship(
        foreign_keys="SysDeptEmployee.employee_id",
        primaryjoin="SysEmployee.id == foreign(SysDeptEmployee.employee_id)",
        viewonly=True,
        lazy="raise",
    )
    # 防止 LEFT JOIN 因 JobPosition 软删除退化为 INNER JOIN
    job_positions: Mapped[list[JobPosition]] = relationship(
        foreign_keys="JobPosition.employee_id",
        primaryjoin="and_(SysEmployee.id == foreign(JobPosition.employee_id), JobPosition.is_deleted == 0)",
        viewonly=True,
        lazy="raise",
    )
