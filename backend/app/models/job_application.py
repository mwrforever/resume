from sqlalchemy import Column, BigInteger, SmallInteger, DateTime, JSON
from sqlalchemy.sql import func
from . import Base


class JobApplication(Base):
    __tablename__ = "job_application"

    id = Column(BigInteger, primary_key=True, autoincrement=True)
    user_id = Column(BigInteger, nullable=False, comment="投递用户ID")
    job_id = Column(BigInteger, nullable=False, comment="岗位ID")
    resume_id = Column(BigInteger, nullable=False, comment="关联简历ID")
    status = Column(SmallInteger, nullable=False, default=0, comment="状态：0待评估，1待处理，2已查看，3面试中，4已拒绝，5已录用，6已结束")
    job_snapshot = Column(JSON, comment="投递时岗位与评估模板快照")
    is_deleted = Column(SmallInteger, nullable=False, default=0, comment="逻辑删除")
    create_time = Column(DateTime, nullable=False, server_default=func.now(), comment="投递时间")
    update_time = Column(DateTime, nullable=False, server_default=func.now(), onupdate=func.now(), comment="更新时间")