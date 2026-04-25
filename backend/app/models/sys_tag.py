from sqlalchemy import Column, BigInteger, String, SmallInteger, Integer, DateTime
from sqlalchemy.sql import func
from . import Base


class SysTag(Base):
    __tablename__ = "sys_tag"

    id = Column(BigInteger, primary_key=True, autoincrement=True)
    tag_name = Column(String(50), nullable=False, comment="标签名称")
    tag_type = Column(SmallInteger, nullable=False, default=1, comment="标签分类：1岗位特性，2福利待遇，3技能加分")
    sort_order = Column(Integer, nullable=False, default=0, comment="排序")
    status = Column(SmallInteger, nullable=False, default=1, comment="状态：1正常，0停用")
    color = Column(String(20), nullable=False, default="default", comment="标签颜色")
    is_deleted = Column(SmallInteger, nullable=False, default=0, comment="逻辑删除")
    create_time = Column(DateTime, nullable=False, server_default=func.now(), comment="创建时间")
