from datetime import datetime
from decimal import Decimal
from sqlalchemy import case, delete, func, select, update, union_all, literal_column
from sqlalchemy.ext.asyncio import AsyncSession
from app.models.eval_dimension import EvalDimension
from app.models.eval_template_dimension import EvalTemplateDimension
from app.models.eval_template_skill import EvalTemplateSkill
from app.models.job_application import JobApplication
from app.models.job_position import JobPosition
from app.models.resume import Resume
from app.models.resume_eval_detail import ResumeEvalDetail
from app.models.resume_job_match import ResumeJobMatch
from app.models.resume_skill_hit import ResumeSkillHit
from app.models.sys_user import SysUser


class EvalRepository:
    def __init__(self, db: AsyncSession):
        self.db = db

    async def create_match(self, application_id: int, resume_id: int, job_id: int) -> ResumeJobMatch:
        # 显式占位 final_score / final_label：旧库列无 DB 级 DEFAULT，仅靠 ORM Python 端 default
        # 在 INSERT 时不会进入列清单，导致 MySQL 报 1364 'doesn't have a default value'。
        # 评估完成后由 update_match_result 写入真实值。
        match = ResumeJobMatch(
            application_id=application_id,
            resume_id=resume_id,
            job_id=job_id,
            final_score=Decimal("0.00"),
            final_label="未达标",
        )
        self.db.add(match)
        await self.db.flush()
        await self.db.refresh(match)
        return match

    async def get_match_by_id(self, match_id: int) -> ResumeJobMatch:
        result = await self.db.execute(select(ResumeJobMatch).where(ResumeJobMatch.id == match_id))
        return result.scalar_one_or_none()

    async def get_matches_by_ids(self, match_ids: list[int]) -> dict[int, ResumeJobMatch]:
        """批量查询评估匹配记录，返回 match_id -> ResumeJobMatch 字典"""
        if not match_ids:
            return {}
        result = await self.db.execute(select(ResumeJobMatch).where(ResumeJobMatch.id.in_(match_ids)))
        return {match.id: match for match in result.scalars().all()}

    async def get_match_by_application_id(self, application_id: int) -> ResumeJobMatch:
        result = await self.db.execute(
            select(ResumeJobMatch).where(ResumeJobMatch.application_id == application_id)
        )
        return result.scalar_one_or_none()

    async def update_match_result(self, match_id: int, score: float, label: str, advantage: str, disadvantage: str) -> bool:
        await self.db.execute(
            update(ResumeJobMatch)
            .where(ResumeJobMatch.id == match_id)
            .values(
                final_score=score,
                final_label=label,
                advantage_comment=advantage,
                disadvantage_comment=disadvantage,
                evaluated_at=datetime.now(),
                error_message=None,
            )
        )
        await self.db.flush()
        return True

    async def update_match_error(self, match_id: int, error_message: str) -> bool:
        await self.db.execute(
            update(ResumeJobMatch)
            .where(ResumeJobMatch.id == match_id)
            .values(error_message=error_message)
        )
        await self.db.flush()
        return True

    async def create_eval_detail(self, match_id: int, dimension_id: int, score: float, advantage: str, disadvantage: str) -> ResumeEvalDetail:
        detail = ResumeEvalDetail(
            match_id=match_id,
            dimension_id=dimension_id,
            dimension_score=score,
            dimension_advantage=advantage,
            dimension_disadvantage=disadvantage,
        )
        self.db.add(detail)
        await self.db.flush()
        await self.db.refresh(detail)
        return detail

    async def create_eval_detail_with_status(
        self,
        match_id: int,
        dimension_id: int,
        score: float,
        advantage: str,
        disadvantage: str,
        is_completed: bool = True,
        error_message: str = None,
    ) -> ResumeEvalDetail:
        detail = ResumeEvalDetail(
            match_id=match_id,
            dimension_id=dimension_id,
            dimension_score=score,
            dimension_advantage=advantage,
            dimension_disadvantage=disadvantage,
            is_completed=1 if is_completed else 0,
            error_message=error_message,
        )
        self.db.add(detail)
        await self.db.flush()
        await self.db.refresh(detail)
        return detail

    async def get_eval_details(self, match_id: int) -> list[ResumeEvalDetail]:
        result = await self.db.execute(
            select(ResumeEvalDetail).where(ResumeEvalDetail.match_id == match_id)
        )
        return result.scalars().all()

    async def delete_eval_details_by_match(self, match_id: int) -> None:
        await self.db.execute(delete(ResumeEvalDetail).where(ResumeEvalDetail.match_id == match_id))
        await self.db.flush()

    async def create_skill_hit(self, match_id: int, skill_id: int, is_hit: int, hit_context: str) -> ResumeSkillHit:
        hit = ResumeSkillHit(
            match_id=match_id,
            skill_id=skill_id,
            is_hit=is_hit,
            hit_context=hit_context,
        )
        self.db.add(hit)
        await self.db.flush()
        await self.db.refresh(hit)
        return hit

    async def get_skill_hits(self, match_id: int) -> list[ResumeSkillHit]:
        result = await self.db.execute(
            select(ResumeSkillHit).where(ResumeSkillHit.match_id == match_id)
        )
        return result.scalars().all()

    async def delete_skill_hits_by_match(self, match_id: int) -> None:
        await self.db.execute(delete(ResumeSkillHit).where(ResumeSkillHit.match_id == match_id))
        await self.db.flush()

    async def get_match_distribution(self, job_id: int) -> dict:
        result = await self.db.execute(
            select(
                func.count().label("total"),
                func.sum(case((ResumeJobMatch.final_label == "优秀", 1), else_=0)).label("excellent"),
                func.sum(case((ResumeJobMatch.final_label == "良好", 1), else_=0)).label("good"),
                func.sum(case((ResumeJobMatch.final_label == "一般", 1), else_=0)).label("average"),
                func.sum(case((ResumeJobMatch.final_label == "未达标", 1), else_=0)).label("fail"),
            ).where(ResumeJobMatch.job_id == job_id)
        )
        row = result.one()
        total = row.total or 0
        return {
            "total": total,
            "excellent": {"count": row.excellent or 0, "percentage": round((row.excellent or 0) / total * 100, 1) if total else 0},
            "good": {"count": row.good or 0, "percentage": round((row.good or 0) / total * 100, 1) if total else 0},
            "average": {"count": row.average or 0, "percentage": round((row.average or 0) / total * 100, 1) if total else 0},
            "fail": {"count": row.fail or 0, "percentage": round((row.fail or 0) / total * 100, 1) if total else 0},
        }

    async def count_pending_evaluations(self) -> int:
        matched_subq = select(ResumeJobMatch.application_id).distinct()
        result = await self.db.execute(
            select(func.count(JobApplication.id)).where(
                JobApplication.is_deleted == 0,
                JobApplication.status == 0,
                ~JobApplication.id.in_(matched_subq),
            )
        )
        return result.scalar() or 0

    async def get_applications_by_job(self, job_id: int, offset: int = 0, limit: int = 20) -> tuple[list[dict], int]:
        result = await self.db.execute(
            select(
                JobApplication.id.label("application_id"),
                JobApplication.resume_id,
                Resume.file_name,
                ResumeJobMatch.id.label("match_id"),
                ResumeJobMatch.final_score,
                ResumeJobMatch.final_label,
                ResumeJobMatch.error_message,
            )
            .join(Resume, Resume.id == JobApplication.resume_id)
            .outerjoin(ResumeJobMatch, ResumeJobMatch.application_id == JobApplication.id)
            .where(JobApplication.job_id == job_id, JobApplication.is_deleted == 0)
            .order_by(ResumeJobMatch.final_score.desc(), JobApplication.id.desc())
            .offset(offset)
            .limit(limit)
        )
        items = [
            {
                "application_id": row.application_id,
                "resume_id": row.resume_id,
                "file_name": row.file_name,
                "match_id": row.match_id,
                "final_score": float(row.final_score) if row.final_score is not None else None,
                "final_label": row.final_label or "待评估",
                "status": "failed" if row.error_message else ("completed" if row.match_id else "pending"),
            }
            for row in result.all()
        ]
        count_result = await self.db.execute(
            select(func.count(JobApplication.id)).where(
                JobApplication.job_id == job_id,
                JobApplication.is_deleted == 0,
            )
        )
        return items, count_result.scalar() or 0

    async def get_matches_by_application_ids(self, application_ids: list[int]) -> dict[int, int]:
        if not application_ids:
            return {}
        result = await self.db.execute(
            select(ResumeJobMatch.id, ResumeJobMatch.application_id)
            .where(ResumeJobMatch.application_id.in_(application_ids))
        )
        return {row.application_id: row.id for row in result.all()}

    async def get_template_dimensions(self, template_id: int) -> list[dict]:
        """获取模板维度的完整配置（含权重、提示词模板），供评估子图使用。"""
        result = await self.db.execute(
            select(
                EvalTemplateDimension.dimension_id,
                EvalDimension.dimension_name,
                EvalTemplateDimension.weight,
                EvalTemplateDimension.prompt_template,
            )
            .join(EvalDimension, EvalDimension.id == EvalTemplateDimension.dimension_id)
            .where(
                EvalTemplateDimension.template_id == template_id,
                EvalDimension.is_deleted == 0,
                EvalDimension.status == 1,
            )
            .order_by(EvalTemplateDimension.sort_order.asc(), EvalTemplateDimension.id.asc())
        )
        return [
            {
                "dimension_id": int(row.dimension_id),
                "dimension_name": row.dimension_name,
                "weight": float(row.weight),
                "prompt_template": row.prompt_template,
            }
            for row in result.all()
        ]

    async def get_template_skills(self, template_id: int) -> list[dict]:
        """获取模板技能列表，供评估子图使用。"""
        result = await self.db.execute(
            select(
                EvalTemplateSkill.id,
                EvalTemplateSkill.skill_name,
                EvalTemplateSkill.skill_type,
            )
            .where(EvalTemplateSkill.template_id == template_id)
            .order_by(EvalTemplateSkill.skill_type.asc(), EvalTemplateSkill.id.asc())
        )
        return [
            {"skill_id": int(row.id), "skill": row.skill_name, "type": int(row.skill_type)}
            for row in result.all()
        ]

    async def get_template_dimensions_for_display(self, template_id: int) -> list[dict]:
        result = await self.db.execute(
            select(
                EvalTemplateDimension.dimension_id,
                EvalDimension.dimension_name,
            )
            .join(EvalDimension, EvalDimension.id == EvalTemplateDimension.dimension_id)
            .where(
                EvalTemplateDimension.template_id == template_id,
                EvalDimension.is_deleted == 0,
                EvalDimension.status == 1,
            )
            .order_by(EvalTemplateDimension.sort_order.asc(), EvalTemplateDimension.id.asc())
        )
        return [{"dimension_id": row.dimension_id, "dimension_name": row.dimension_name} for row in result.all()]

    async def get_template_skills_for_display(self, template_id: int) -> list[dict]:
        result = await self.db.execute(
            select(
                EvalTemplateSkill.id,
                EvalTemplateSkill.skill_name,
                EvalTemplateSkill.skill_type,
                EvalTemplateSkill.match_label,
            )
            .where(EvalTemplateSkill.template_id == template_id)
            .order_by(EvalTemplateSkill.skill_type.asc(), EvalTemplateSkill.id.asc())
        )
        return [
            {"id": row.id, "skill_name": row.skill_name, "skill_type": row.skill_type, "match_label": row.match_label}
            for row in result.all()
        ]

    async def get_avg_match_score(self) -> float:
        result = await self.db.execute(
            select(func.avg(ResumeJobMatch.final_score)).where(ResumeJobMatch.final_score.isnot(None))
        )
        return result.scalar() or 0.0

    async def get_recent_activities(self, limit: int = 10) -> list[dict]:
        """获取最近动态（投递、评估、简历上传），合并后按时间倒序取前N条"""
        # 最近投递
        app_q = (
            select(
                JobApplication.id.label("source_id"),
                literal_column("'application'").label("type"),
                JobApplication.create_time.label("time"),
                SysUser.real_name.label("user_name"),
                JobPosition.name.label("job_name"),
                literal_column("NULL").label("file_name"),
                literal_column("NULL").label("final_score"),
            )
            .join(SysUser, (SysUser.id == JobApplication.user_id) & (SysUser.is_deleted == 0))
            .join(JobPosition, JobPosition.id == JobApplication.job_id)
            .where(JobApplication.is_deleted == 0)
            .order_by(JobApplication.create_time.desc())
            .limit(limit)
        )

        # 最近评估完成
        eval_q = (
            select(
                ResumeJobMatch.id.label("source_id"),
                literal_column("'evaluation'").label("type"),
                ResumeJobMatch.evaluated_at.label("time"),
                SysUser.real_name.label("user_name"),
                literal_column("NULL").label("job_name"),
                literal_column("NULL").label("file_name"),
                ResumeJobMatch.final_score.label("final_score"),
            )
            .join(JobApplication, JobApplication.id == ResumeJobMatch.application_id)
            .join(SysUser, (SysUser.id == JobApplication.user_id) & (SysUser.is_deleted == 0))
            .where(ResumeJobMatch.evaluated_at.isnot(None))
            .order_by(ResumeJobMatch.evaluated_at.desc())
            .limit(limit)
        )

        # 最近简历上传
        resume_q = (
            select(
                Resume.id.label("source_id"),
                literal_column("'resume_upload'").label("type"),
                Resume.create_time.label("time"),
                SysUser.real_name.label("user_name"),
                literal_column("NULL").label("job_name"),
                Resume.file_name.label("file_name"),
                literal_column("NULL").label("final_score"),
            )
            .outerjoin(SysUser, (SysUser.id == Resume.user_id) & (SysUser.is_deleted == 0))
            .where(Resume.is_deleted == 0)
            .order_by(Resume.create_time.desc())
            .limit(limit)
        )

        combined = union_all(app_q, eval_q, resume_q).alias("activities")
        result = await self.db.execute(
            select(combined).order_by(combined.c.time.desc()).limit(limit)
        )

        return [
            {
                "id": row.source_id,
                "type": row.type,
                "text": self._format_activity_text(row.type, row.user_name, row.job_name, row.file_name, row.final_score),
                "time": row.time.isoformat(),
            }
            for row in result.all()
        ]

    @staticmethod
    def _format_activity_text(act_type: str, user_name: str | None, job_name: str | None, file_name: str | None, final_score: float | None) -> str:
        name = user_name or "匿名用户"
        if act_type == "application":
            return f"{name}投递了 {job_name or '未知'} 岗位"
        if act_type == "evaluation":
            score_text = f"，得分{final_score:.0f}" if final_score is not None else ""
            return f"{name}完成了 AI评估{score_text}"
        if act_type == "resume_upload":
            return f"{name}上传了新简历"
        return ""

    async def commit(self) -> None:
        """提交当前事务，由 Service 层统一调度"""
        await self.db.commit()

    async def rollback(self) -> None:
        """回滚当前事务，由 Service 层统一调度"""
        await self.db.rollback()
