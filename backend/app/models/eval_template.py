from sqlalchemy import Column, BigInteger, String, SmallInteger, DateTime
from sqlalchemy.sql import func
from . import Base


class EvalTemplate(Base):
    __tablename__ = "eval_template"

    id = Column(BigInteger, primary_key=True, autoincrement=True)
    template_name = Column(String(100), nullable=False, comment="模板名称")
    description = Column(String(255), comment="模板说明")
    status = Column(SmallInteger, nullable=False, default=1, comment="状态：1启用，0停用")
    is_deleted = Column(SmallInteger, nullable=False, default=0, comment="逻辑删除")
    create_time = Column(DateTime, nullable=False, server_default=func.now(), comment="创建时间")
    update_time = Column(DateTime, nullable=False, server_default=func.now(), onupdate=func.now(), comment="更新时间")
