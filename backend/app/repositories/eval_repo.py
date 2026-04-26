from datetime import datetime

from sqlalchemy import case, delete, func, select, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.job_application import JobApplication
from app.models.resume import Resume
from app.models.resume_eval_detail import ResumeEvalDetail
from app.models.resume_job_match import ResumeJobMatch
from app.models.resume_skill_hit import ResumeSkillHit


class EvalRepository:
    def __init__(self, db: AsyncSession):
        self.db = db

    async def create_match(self, application_id: int, resume_id: int, job_id: int) -> ResumeJobMatch:
        match = ResumeJobMatch(application_id=application_id, resume_id=resume_id, job_id=job_id)
        self.db.add(match)
        await self.db.commit()
        await self.db.refresh(match)
        return match

    async def get_match_by_id(self, match_id: int) -> ResumeJobMatch:
        result = await self.db.execute(select(ResumeJobMatch).where(ResumeJobMatch.id == match_id))
        return result.scalar_one_or_none()

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
        await self.db.commit()
        return True

    async def update_match_error(self, match_id: int, error_message: str) -> bool:
        await self.db.execute(
            update(ResumeJobMatch)
            .where(ResumeJobMatch.id == match_id)
            .values(error_message=error_message)
        )
        await self.db.commit()
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
        await self.db.commit()
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
        await self.db.commit()
        await self.db.refresh(detail)
        return detail

    async def get_eval_details(self, match_id: int) -> list[ResumeEvalDetail]:
        result = await self.db.execute(
            select(ResumeEvalDetail).where(ResumeEvalDetail.match_id == match_id)
        )
        return result.scalars().all()

    async def delete_eval_details_by_match(self, match_id: int) -> None:
        await self.db.execute(delete(ResumeEvalDetail).where(ResumeEvalDetail.match_id == match_id))
        await self.db.commit()

    async def create_skill_hit(self, match_id: int, skill_id: int, is_hit: int, hit_context: str) -> ResumeSkillHit:
        hit = ResumeSkillHit(
            match_id=match_id,
            skill_id=skill_id,
            is_hit=is_hit,
            hit_context=hit_context,
        )
        self.db.add(hit)
        await self.db.commit()
        await self.db.refresh(hit)
        return hit

    async def get_skill_hits(self, match_id: int) -> list[ResumeSkillHit]:
        result = await self.db.execute(
            select(ResumeSkillHit).where(ResumeSkillHit.match_id == match_id)
        )
        return result.scalars().all()

    async def delete_skill_hits_by_match(self, match_id: int) -> None:
        await self.db.execute(delete(ResumeSkillHit).where(ResumeSkillHit.match_id == match_id))
        await self.db.commit()

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
                "status": "completed" if row.match_id else "pending",
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

    async def get_avg_match_score(self) -> float:
        result = await self.db.execute(
            select(func.avg(ResumeJobMatch.final_score)).where(ResumeJobMatch.final_score.isnot(None))
        )
        return result.scalar() or 0.0