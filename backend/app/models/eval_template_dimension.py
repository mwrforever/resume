from sqlalchemy import Column, BigInteger, DECIMAL, Integer, DateTime, Text
from sqlalchemy.sql import func
from . import Base


class EvalTemplateDimension(Base):
    __tablename__ = "eval_template_dimension"

    id = Column(BigInteger, primary_key=True, autoincrement=True)
    template_id = Column(BigInteger, nullable=False, comment="模板ID")
    dimension_id = Column(BigInteger, nullable=False, comment="全局维度ID")
    weight = Column(DECIMAL(5, 2), nullable=False, comment="权重")
    prompt_template = Column(Text, nullable=False, comment="提示词模板")
    sort_order = Column(Integer, nullable=False, default=0, comment="排序")
    create_time = Column(DateTime, nullable=False, server_default=func.now(), comment="创建时间")
