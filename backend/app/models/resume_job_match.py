from sqlalchemy import Column, BigInteger, String, DECIMAL, Tinyint, DateTime
from sqlalchemy.sql import func
from . import Base


class ResumeJobMatch(Base):
    __tablename__ = "resume_job_match"

    id = Column(BigInteger, primary_key=True, autoincrement=True)
    resume_id = Column(BigInteger, nullable=False, comment="简历ID")
    job_id = Column(BigInteger, nullable=False, comment="岗位ID")
    final_score = Column(DECIMAL(5, 2), nullable=False, default=0.00, comment="最终加权匹配得分(0-100)")
    final_label = Column(String(20), nullable=False, default="未达标", comment="最终标签")
    advantage_comment = Column(String(500), comment="整体优点评价")
    disadvantage_comment = Column(String(500), comment="整体缺点评价(无缺点时空字符串)")
    is_direct_preferred = Column(Tinyint, nullable=False, default=0, comment="是否直接优选命中")
    evaluated_at = Column(DateTime, comment="评估完成时间")
    create_time = Column(DateTime, nullable=False, server_default=func.now(), comment="创建时间")