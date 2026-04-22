from sqlalchemy import Column, BigInteger, DECIMAL, DateTime, String, Text, TINYINT
from sqlalchemy.sql import func
from . import Base


class ResumeEvalDetail(Base):
    __tablename__ = "resume_eval_detail"

    id = Column(BigInteger, primary_key=True, autoincrement=True)
    match_id = Column(BigInteger, nullable=False, comment="关联匹配记录ID")
    dimension_id = Column(BigInteger, nullable=False, comment="关联维度ID")
    dimension_score = Column(DECIMAL(5, 2), nullable=False, comment="维度得分(0-100)")
    dimension_advantage = Column(String(500), comment="维度优点")
    dimension_disadvantage = Column(String(500), comment="维度缺点")
    ai_reasoning = Column(Text, comment="AI理由")
    is_completed = Column(TINYINT, nullable=False, default=1, comment="是否成功完成评估：1成功，0失败")
    error_message = Column(String(500), comment="评估失败时的错误信息")
    create_time = Column(DateTime, nullable=False, server_default=func.now(), comment="创建时间")