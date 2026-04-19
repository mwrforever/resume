from sqlalchemy import Column, BigInteger, String, Tinyint, DateTime
from sqlalchemy.sql import func
from . import Base


class JobSkill(Base):
    __tablename__ = "job_skill"

    id = Column(BigInteger, primary_key=True, autoincrement=True)
    job_id = Column(BigInteger, nullable=False, comment="关联岗位ID")
    skill_name = Column(String(100), nullable=False, comment="技能名称")
    skill_type = Column(Tinyint, nullable=False, comment="技能类型：1必须满足，2优先匹配，3普通技能")
    match_label = Column(String(20), comment="命中标签(优秀/良好/一般，仅type=2有效)")
    is_ai_generated = Column(Tinyint, nullable=False, default=0, comment="是否AI自动生成")
    create_time = Column(DateTime, nullable=False, server_default=func.now(), comment="创建时间")
