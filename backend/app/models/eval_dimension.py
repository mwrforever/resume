from sqlalchemy import Column, BigInteger, String, SmallInteger, Integer, DateTime, Text
from sqlalchemy.sql import func
from . import Base


class EvalDimension(Base):
    __tablename__ = "eval_dimension"

    id = Column(BigInteger, primary_key=True, autoincrement=True)
    dimension_name = Column(String(50), nullable=False, comment="维度名称")
    description = Column(String(255), comment="维度说明")
    default_prompt_template = Column(Text, nullable=False, comment="默认提示词模板")
    sort_order = Column(Integer, nullable=False, default=0, comment="排序")
    status = Column(SmallInteger, nullable=False, default=1, comment="状态：1正常，0停用")
    is_deleted = Column(SmallInteger, nullable=False, default=0, comment="逻辑删除")
    create_time = Column(DateTime, nullable=False, server_default=func.now(), comment="创建时间")
    update_time = Column(DateTime, nullable=False, server_default=func.now(), onupdate=func.now(), comment="更新时间")
