from sqlalchemy import Column, BigInteger, String, SmallInteger, DateTime
from sqlalchemy.sql import func
from . import Base


class EvalTemplateSkill(Base):
    __tablename__ = "eval_template_skill"

    id = Column(BigInteger, primary_key=True, autoincrement=True)
    template_id = Column(BigInteger, nullable=False, comment="模板ID")
    skill_name = Column(String(100), nullable=False, comment="技能名称")
    skill_type = Column(SmallInteger, nullable=False, comment="技能类型：1必须满足，2优先匹配，3普通技能")
    match_label = Column(String(20), comment="命中标签")
    is_ai_generated = Column(SmallInteger, nullable=False, default=0, comment="是否AI生成")
    create_time = Column(DateTime, nullable=False, server_default=func.now(), comment="创建时间")
