from sqlalchemy import Column, BigInteger, DECIMAL, DateTime, String, Integer
from sqlalchemy.sql import func
from . import Base


class ResumeJobMatch(Base):
    __tablename__ = "resume_job_match"

    id = Column(BigInteger, primary_key=True, autoincrement=True)
    resume_id = Column(BigInteger, nullable=False, comment="简历ID")
    job_id = Column(BigInteger, nullable=False, comment="岗位ID")
    final_score = Column(DECIMAL(5, 2), nullable=False, default=0.00, comment="最终得分")
    final_label = Column(String(20), nullable=False, default='未达标', comment="最终标签")
    advantage_comment = Column(String(500), comment="整体优点")
    disadvantage_comment = Column(String(500), comment="整体缺点")
    is_direct_preferred = Column(Integer, nullable=False, default=0, comment="是否直接优选")
    error_message = Column(String(500), comment="评估失败时的错误信息")
    evaluated_at = Column(DateTime, comment="评估完成时间")
    create_time = Column(DateTime, nullable=False, server_default=func.now(), comment="创建时间")