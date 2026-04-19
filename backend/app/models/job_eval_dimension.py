from sqlalchemy import Column, BigInteger, String, DECIMAL, Integer, DateTime, Text
from sqlalchemy.sql import func
from . import Base


class JobEvalDimension(Base):
    __tablename__ = "job_eval_dimension"

    id = Column(BigInteger, primary_key=True, autoincrement=True)
    job_id = Column(BigInteger, nullable=False, comment="关联岗位ID")
    dimension_name = Column(String(50), nullable=False, comment="维度名称(如：项目经验)")
    weight = Column(DECIMAL(5, 2), nullable=False, comment="权重占比(如0.30)")
    prompt_template = Column(Text, nullable=False, comment="LangChain提示词模板")
    sort_order = Column(Integer, nullable=False, default=0, comment="排序")
    create_time = Column(DateTime, nullable=False, server_default=func.now(), comment="创建时间")
