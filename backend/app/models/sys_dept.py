from sqlalchemy import Column, BigInteger, String, SmallInteger, Integer, DateTime
from sqlalchemy.sql import func
from . import Base


class SysDept(Base):
    __tablename__ = "sys_dept"

    id = Column(BigInteger, primary_key=True, autoincrement=True)
    parent_id = Column(BigInteger, nullable=False, default=0, comment="父部门ID(0为顶级)")
    dept_code = Column(String(20), comment="部门编码")
    dept_name = Column(String(50), nullable=False, comment="部门名称")
    leader_id = Column(BigInteger, comment="部门负责人员工ID")
    sort_order = Column(Integer, nullable=False, default=0, comment="显示排序")
    status = Column(SmallInteger, nullable=False, default=1, comment="状态：1正常，0停用")
    is_deleted = Column(SmallInteger, nullable=False, default=0, comment="逻辑删除")
    create_time = Column(DateTime, nullable=False, server_default=func.now(), comment="创建时间")
    update_time = Column(DateTime, nullable=False, server_default=func.now(), onupdate=func.now(), comment="更新时间")
