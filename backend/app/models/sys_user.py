from sqlalchemy import Column, BigInteger, String, Tinyint, DateTime
from sqlalchemy.sql import func
from . import Base


class SysUser(Base):
    __tablename__ = "sys_user"

    id = Column(BigInteger, primary_key=True, autoincrement=True)
    email = Column(String(100), nullable=False, unique=True, comment="邮箱")
    real_name = Column(String(50), nullable=False, comment="真实姓名")
    password_hash = Column(String(255), nullable=False, comment="密码哈希")
    status = Column(Tinyint, nullable=False, default=1, comment="账号状态：1正常，0禁用")
    is_deleted = Column(Tinyint, nullable=False, default=0, comment="逻辑删除")
    create_time = Column(DateTime, nullable=False, server_default=func.now(), comment="注册时间")
    update_time = Column(DateTime, nullable=False, server_default=func.now(), onupdate=func.now(), comment="更新时间")
