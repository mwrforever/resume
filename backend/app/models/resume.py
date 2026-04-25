from sqlalchemy import Column, BigInteger, String, SmallInteger, DateTime, Text
from sqlalchemy.sql import func
from . import Base


class Resume(Base):
    __tablename__ = "resume"

    id = Column(BigInteger, primary_key=True, autoincrement=True)
    user_id = Column(BigInteger, comment="上传者ID")
    file_name = Column(String(255), nullable=False, comment="原始文件名")
    file_path = Column(String(500), nullable=False, comment="文件相对路径")
    storage_type = Column(String(20), nullable=False, default="LOCAL", comment="存储类型")
    raw_text = Column(Text, comment="AI解析后的纯文本内容")
    status = Column(SmallInteger, nullable=False, default=0, comment="状态：0正常，1异常")
    is_deleted = Column(SmallInteger, nullable=False, default=0, comment="逻辑删除")
    create_time = Column(DateTime, nullable=False, server_default=func.now(), comment="上传时间")
    update_time = Column(DateTime, nullable=False, server_default=func.now(), onupdate=func.now(), comment="更新时间")