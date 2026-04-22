from sqlalchemy import Column, BigInteger, String, SmallInteger, DateTime, Text
from sqlalchemy.sql import func
from . import Base


class JobPosition(Base):
    __tablename__ = "job_position"

    id = Column(BigInteger, primary_key=True, autoincrement=True)
    employee_id = Column(BigInteger, nullable=False, comment="发布人(员工ID)")
    dept_id = Column(BigInteger, nullable=False, comment="所属招聘部门")
    name = Column(String(100), nullable=False, comment="岗位名称")
    description = Column(Text, comment="岗位简要描述(用于AI生成技能)")
    status = Column(SmallInteger, nullable=False, default=1, comment="状态：1招聘中，0已下架")
    is_deleted = Column(SmallInteger, nullable=False, default=0, comment="逻辑删除")
    create_time = Column(DateTime, nullable=False, server_default=func.now(), comment="发布时间")
    update_time = Column(DateTime, nullable=False, server_default=func.now(), onupdate=func.now(), comment="更新时间")
