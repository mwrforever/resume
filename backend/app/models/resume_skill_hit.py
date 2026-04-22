from sqlalchemy import Column, BigInteger, SmallInteger, DateTime, String
from sqlalchemy.sql import func
from . import Base


class ResumeSkillHit(Base):
    __tablename__ = "resume_skill_hit"

    id = Column(BigInteger, primary_key=True, autoincrement=True)
    match_id = Column(BigInteger, nullable=False, comment="关联匹配记录ID")
    skill_id = Column(BigInteger, nullable=False, comment="关联技能ID")
    is_hit = Column(SmallInteger, nullable=False, comment="是否命中")
    hit_context = Column(String(500), comment="命中上下文")
    create_time = Column(DateTime, nullable=False, server_default=func.now(), comment="创建时间")