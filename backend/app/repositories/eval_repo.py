from sqlalchemy import select, update
from sqlalchemy.ext.asyncio import AsyncSession
from app.models.resume_job_match import ResumeJobMatch
from app.models.resume_eval_detail import ResumeEvalDetail
from app.models.resume_skill_hit import ResumeSkillHit
from datetime import datetime


class EvalRepository:
    def __init__(self, db: AsyncSession):
        self.db = db

    async def create_match(self, resume_id: int, job_id: int) -> ResumeJobMatch:
        match = ResumeJobMatch(resume_id=resume_id, job_id=job_id)
        self.db.add(match)
        await self.db.commit()
        await self.db.refresh(match)
        return match

    async def get_match_by_id(self, match_id: int) -> ResumeJobMatch:
        result = await self.db.execute(
            select(ResumeJobMatch).where(ResumeJobMatch.id == match_id)
        )
        return result.scalar_one_or_none()

    async def get_match_by_resume_and_job(self, resume_id: int, job_id: int) -> ResumeJobMatch:
        result = await self.db.execute(
            select(ResumeJobMatch)
            .where(ResumeJobMatch.resume_id == resume_id, ResumeJobMatch.job_id == job_id)
        )
        return result.scalar_one_or_none()

    async def update_match_result(self, match_id: int, score: float, label: str,
                                   advantage: str, disadvantage: str) -> bool:
        await self.db.execute(
            update(ResumeJobMatch)
            .where(ResumeJobMatch.id == match_id)
            .values(
                final_score=score,
                final_label=label,
                advantage_comment=advantage,
                disadvantage_comment=disadvantage,
                evaluated_at=datetime.now()
            )
        )
        await self.db.commit()
        return True

    async def create_eval_detail(self, match_id: int, dimension_id: int,
                                  score: float, advantage: str, disadvantage: str) -> ResumeEvalDetail:
        detail = ResumeEvalDetail(
            match_id=match_id,
            dimension_id=dimension_id,
            dimension_score=score,
            dimension_advantage=advantage,
            dimension_disadvantage=disadvantage
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

    async def create_skill_hit(self, match_id: int, skill_id: int,
                                is_hit: int, hit_context: str) -> ResumeSkillHit:
        hit = ResumeSkillHit(
            match_id=match_id,
            skill_id=skill_id,
            is_hit=is_hit,
            hit_context=hit_context
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