from sqlalchemy import select, update, func, case
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

    async def update_match_error(self, match_id: int, error_message: str) -> bool:
        """更新匹配记录的错误状态"""
        await self.db.execute(
            update(ResumeJobMatch)
            .where(ResumeJobMatch.id == match_id)
            .values(error_message=error_message)
        )
        await self.db.commit()
        return True

    async def create_eval_detail_with_status(
        self,
        match_id: int,
        dimension_id: int,
        score: float,
        advantage: str,
        disadvantage: str,
        is_completed: bool = True,
        error_message: str = None
    ) -> ResumeEvalDetail:
        """创建评估详情（支持失败状态）"""
        detail = ResumeEvalDetail(
            match_id=match_id,
            dimension_id=dimension_id,
            dimension_score=score,
            dimension_advantage=advantage,
            dimension_disadvantage=disadvantage,
            is_completed=1 if is_completed else 0,
            error_message=error_message
        )
        self.db.add(detail)
        await self.db.commit()
        await self.db.refresh(detail)
        return detail

    async def get_resumes_with_pending_status(self, job_id: int) -> list:
        """获取岗位下待评估的简历（无匹配记录的）"""
        from app.models.resume import Resume
        from sqlalchemy import not_

        # 子查询：已评估的简历ID
        evaluated_subq = (
            select(ResumeJobMatch.resume_id)
            .where(ResumeJobMatch.job_id == job_id)
        )

        result = await self.db.execute(
            select(Resume)
            .where(
                Resume.is_deleted == 0,
                Resume.status == 2,  # 评估完成
                ~Resume.id.in_(evaluated_subq)
            )
        )
        return result.scalars().all()

    async def get_match_distribution(self, job_id: int) -> dict:
        """获取岗位下简历匹配度分布"""
        result = await self.db.execute(
            select(
                func.count().label('total'),
                func.sum(case((ResumeJobMatch.final_label == '优秀', 1), else_=0)).label('excellent'),
                func.sum(case((ResumeJobMatch.final_label == '良好', 1), else_=0)).label('good'),
                func.sum(case((ResumeJobMatch.final_label == '一般', 1), else_=0)).label('average'),
                func.sum(case((ResumeJobMatch.final_label == '未达标', 1), else_=0)).label('fail'),
            )
            .where(ResumeJobMatch.job_id == job_id)
        )
        row = result.one()
        total = row.total or 0
        return {
            "total": total,
            "excellent": {"count": row.excellent or 0, "percentage": round((row.excellent or 0) / total * 100, 1) if total > 0 else 0},
            "good": {"count": row.good or 0, "percentage": round((row.good or 0) / total * 100, 1) if total > 0 else 0},
            "average": {"count": row.average or 0, "percentage": round((row.average or 0) / total * 100, 1) if total > 0 else 0},
            "fail": {"count": row.fail or 0, "percentage": round((row.fail or 0) / total * 100, 1) if total > 0 else 0},
        }

    async def get_resumes_by_job(self, job_id: int, offset: int = 0, limit: int = 20) -> tuple:
        """获取岗位下的简历列表（按匹配度降序）"""
        from app.models.resume import Resume
        from sqlalchemy import desc

        result = await self.db.execute(
            select(Resume, ResumeJobMatch.final_score, ResumeJobMatch.final_label, ResumeJobMatch.id.label('match_id'))
            .select_from(Resume)
            .outerjoin(ResumeJobMatch, ResumeJobMatch.resume_id == Resume.id)
            .where(ResumeJobMatch.job_id == job_id)
            .order_by(desc(ResumeJobMatch.final_score))
            .offset(offset)
            .limit(limit)
        )
        rows = result.all()

        items = []
        for row in rows:
            items.append({
                "resume_id": row.Resume.id,
                "file_name": row.Resume.file_name,
                "match_id": row.match_id,
                "final_score": float(row.final_score) if row.final_score else None,
                "final_label": row.final_label,
                "status": "completed" if row.final_score else "pending"
            })

        # Count total
        count_result = await self.db.execute(
            select(func.count())
            .select_from(ResumeJobMatch)
            .where(ResumeJobMatch.job_id == job_id)
        )
        total = count_result.scalar() or 0

        return items, total

    async def count_pending_evaluations(self) -> int:
        """获取待评估数（评估完成但无匹配记录的简历）"""
        from app.models.resume import Resume
        from sqlalchemy import not_, exists

        # 子查询：已有匹配记录的简历ID
        matched_subq = (
            select(ResumeJobMatch.resume_id)
            .distinct()
        )

        result = await self.db.execute(
            select(func.count(Resume.id))
            .where(
                Resume.is_deleted == 0,
                Resume.status == 2,  # 评估完成
                ~exists(matched_subq.where(ResumeJobMatch.resume_id == Resume.id))
            )
        )
        return result.scalar() or 0

    async def get_avg_match_score(self) -> float:
        """获取平均匹配分数"""
        result = await self.db.execute(
            select(func.avg(ResumeJobMatch.final_score))
            .where(ResumeJobMatch.final_score.isnot(None))
        )
        return result.scalar() or 0.0