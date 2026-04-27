from sqlalchemy import BigInteger, Column, DateTime, SmallInteger
from sqlalchemy.sql import func

from . import Base


class SysDeptEmployee(Base):
    __tablename__ = "sys_dept_employee"

    id = Column(BigInteger, primary_key=True, autoincrement=True)
    dept_id = Column(BigInteger, nullable=False)
    employee_id = Column(BigInteger, nullable=False)
    is_primary = Column(SmallInteger, nullable=False, default=0)
    create_time = Column(DateTime, nullable=False, server_default=func.now())
