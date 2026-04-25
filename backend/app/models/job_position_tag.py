from sqlalchemy import Column, BigInteger, DateTime
from sqlalchemy.sql import func
from . import Base


class JobPositionTag(Base):
    __tablename__ = "job_position_tag"

    id = Column(BigInteger, primary_key=True, autoincrement=True)
    job_id = Column(BigInteger, nullable=False, comment="岗位ID")
    tag_id = Column(BigInteger, nullable=False, comment="标签ID")
    create_time = Column(DateTime, nullable=False, server_default=func.now(), comment="关联时间")
