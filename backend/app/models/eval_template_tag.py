from sqlalchemy import Column, BigInteger, DateTime
from sqlalchemy.sql import func
from . import Base


class EvalTemplateTag(Base):
    __tablename__ = "eval_template_tag"

    id = Column(BigInteger, primary_key=True, autoincrement=True)
    template_id = Column(BigInteger, nullable=False, comment="模板ID")
    tag_id = Column(BigInteger, nullable=False, comment="标签ID")
    create_time = Column(DateTime, nullable=False, server_default=func.now(), comment="创建时间")
