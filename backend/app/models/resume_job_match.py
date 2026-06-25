from __future__ import annotations

from datetime import datetime
from decimal import Decimal
from typing import TYPE_CHECKING
from sqlalchemy import BigInteger, DECIMAL, DateTime, Index, Integer, String, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column, relationship
from sqlalchemy.sql import func
from . import Base

if TYPE_CHECKING:
    from .job_application import JobApplication
    from .resume_eval_detail import ResumeEvalDetail
    from .resume_skill_hit import ResumeSkillHit


class ResumeJobMatch(Base):
    __tablename__ = "resume_job_match"
    # 真实查询：
    # - 按 application_id 取唯一一条评估（业务一对一）
    # - 按 job_id 列出该岗位评估结果排序（final_score desc）
    # - 评估时间 evaluated_at desc（统计页用）
    __table_args__ = (
        UniqueConstraint("application_id", name="uk_application"),
        Index("idx_job_score", "job_id", "final_score"),
        Index("idx_evaluated_at", "evaluated_at"),
    )

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    application_id: Mapped[int] = mapped_column(BigInteger, nullable=False, comment="投递记录ID")
    resume_id: Mapped[int] = mapped_column(BigInteger, nullable=False, comment="简历ID")
    job_id: Mapped[int] = mapped_column(BigInteger, nullable=False, comment="岗位ID")
    final_score: Mapped[Decimal] = mapped_column(DECIMAL(5, 2), nullable=False, default=Decimal("0.00"), server_default="0.00", comment="最终得分")
    final_label: Mapped[str] = mapped_column(String(20), nullable=False, default='未达标', server_default='未达标', comment="最终标签")
    advantage_comment: Mapped[str | None] = mapped_column(String(500), comment="整体优点")
    disadvantage_comment: Mapped[str | None] = mapped_column(String(500), comment="整体缺点")
    is_direct_preferred: Mapped[int] = mapped_column(Integer, nullable=False, default=0, server_default="0", comment="是否直接优选")
    error_message: Mapped[str | None] = mapped_column(String(500), comment="评估失败时的错误信息")
    evaluated_at: Mapped[datetime | None] = mapped_column(DateTime, comment="评估完成时间")
    create_time: Mapped[datetime] = mapped_column(DateTime, nullable=False, server_default=func.now(), comment="创建时间")

    # 防止 LEFT JOIN 因 JobApplication 软删除退化为 INNER JOIN
    application: Mapped[JobApplication] = relationship(
        foreign_keys=application_id,
        primaryjoin="and_(ResumeJobMatch.application_id == foreign(JobApplication.id), JobApplication.is_deleted == 0)",
        viewonly=True,
        lazy="raise",
    )
    details: Mapped[list[ResumeEvalDetail]] = relationship(
        foreign_keys="ResumeEvalDetail.match_id",
        primaryjoin="ResumeJobMatch.id == foreign(ResumeEvalDetail.match_id)",
        viewonly=True,
        lazy="raise",
    )
    skill_hits: Mapped[list[ResumeSkillHit]] = relationship(
        foreign_keys="ResumeSkillHit.match_id",
        primaryjoin="ResumeJobMatch.id == foreign(ResumeSkillHit.match_id)",
        viewonly=True,
        lazy="raise",
    )
