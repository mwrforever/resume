from sqlalchemy import Column, BigInteger, String, SmallInteger, DateTime
from sqlalchemy.sql import func
from . import Base


class SysEmployee(Base):
    __tablename__ = "sys_employee"

    id = Column(BigInteger, primary_key=True, autoincrement=True)
    emp_no = Column(String(30), comment="员工工号")
    real_name = Column(String(50), nullable=False, comment="真实姓名")
    email = Column(String(100), comment="邮箱")
    phone = Column(String(20), comment="手机号")
    password_hash = Column(String(500), comment="密码哈希")
    status = Column(SmallInteger, nullable=False, default=1, comment="在职状态：1在职，0离职")
    is_deleted = Column(SmallInteger, nullable=False, default=0, comment="逻辑删除")
    create_time = Column(DateTime, nullable=False, server_default=func.now(), comment="创建时间")
    update_time = Column(DateTime, nullable=False, server_default=func.now(), onupdate=func.now(), comment="更新时间")
