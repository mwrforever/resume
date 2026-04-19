from sqlalchemy import Column, BigInteger, Tinyint, DateTime
from sqlalchemy.sql import func
from . import Base


class JobApplication(Base):
    __tablename__ = "job_application"

    id = Column(BigInteger, primary_key=True, autoincrement=True)
    user_id = Column(BigInteger, nullable=False, comment="投递用户ID")
    job_id = Column(BigInteger, nullable=False, comment="岗位ID")
    resume_id = Column(BigInteger, nullable=False, comment="关联简历ID")
    status = Column(Tinyint, nullable=False, default=0, comment="状态：0待处理，1已查看，2评估完成，3面试邀请")
    is_deleted = Column(Tinyint, nullable=False, default=0, comment="逻辑删除")
    create_time = Column(DateTime, nullable=False, server_default=func.now(), comment="投递时间")
    update_time = Column(DateTime, nullable=False, server_default=func.now(), onupdate=func.now(), comment="更新时间")