from app.repositories.evaluation_repository import EvalRepository
from app.repositories.resume_repository import ResumeRepository
from app.repositories.job_repository import JobRepository
from app.repositories.application_repository import ApplicationRepository
from app.core.exceptions import NotFoundError, ValidationError
from app.services.cache_service import CacheService
from app.utils.cache_utils import (
    EVAL_RECENT_KEY,
    EVAL_RECENT_TTL,
    EVAL_PENDING_COUNT_KEY,
    EVAL_PENDING_COUNT_TTL,
    EVAL_AVG_SCORE_KEY,
    EVAL_AVG_SCORE_TTL,
    EVAL_MATCH_DIST_KEY,
    EVAL_MATCH_DIST_TTL,
)


class EvalService:
    def __init__(
        self,
        eval_repo: EvalRepository,
        resume_repo: ResumeRepository,
        job_repo: JobRepository,
        app_repo: ApplicationRepository,
        cache: CacheService | None = None,
    ) -> None:
        self.eval_repo = eval_repo
        self.resume_repo = resume_repo
        self.job_repo = job_repo
        self.app_repo = app_repo
        self.cache = cache

    async def validate_batch_applications(self, application_ids: list[int]) -> None:
        if not application_ids:
            raise ValidationError("请选择需要评估的投递")
        unique_ids = list(dict.fromkeys(application_ids))
        existing_ids = await self.app_repo.get_existing_ids(unique_ids)
        missing_ids = [application_id for application_id in unique_ids if application_id not in existing_ids]
        if missing_ids:
            raise NotFoundError(f"投递记录不存在: {','.join(str(application_id) for application_id in missing_ids)}")

    async def get_evaluation_detail(self, match_id: int) -> dict:
        """获取评估详情"""
        match = await self.eval_repo.get_match_by_id(match_id)
        if not match:
            raise NotFoundError("评估记录不存在")
        app = await self.app_repo.get_by_id(match.application_id)
        if not app or not app.job_snapshot:
            raise ValidationError("投递快照不存在，无法查看评估详情")

        template_id = (app.job_snapshot.get("job") or {}).get("template_id")
        if not template_id:
            raise ValidationError("投递快照缺少模板信息")

        dimension_rows = await self.eval_repo.get_template_dimensions_for_display(template_id)
        skill_rows = await self.eval_repo.get_template_skills_for_display(template_id)

        dimension_map = {int(item["dimension_id"]): item for item in dimension_rows}
        skill_map = {int(item["id"]): item for item in skill_rows}

        details = await self.eval_repo.get_eval_details(match_id)
        hits = await self.eval_repo.get_skill_hits(match_id)

        return {
            "match_id": match.id,
            "application_id": match.application_id,
            "resume_id": match.resume_id,
            "job_id": match.job_id,
            "final_score": float(match.final_score) if match.final_score else 0,
            "final_label": match.final_label or "未评估",
            "advantage_comment": match.advantage_comment or "",
            "disadvantage_comment": match.disadvantage_comment or "",
            "dimensions": [
                {
                    "dimension_id": d.dimension_id,
                    "dimension_name": dimension_map.get(d.dimension_id, {}).get("dimension_name", f"维度{d.dimension_id}"),
                    "score": float(d.dimension_score),
                    "advantage": d.dimension_advantage or "",
                    "disadvantage": d.dimension_disadvantage or "",
                    "is_completed": d.is_completed == 1,
                    "error_message": d.error_message
                } for d in details
            ],
            "skill_hits": [
                {
                    "skill_id": h.skill_id,
                    "skill_name": skill_map.get(h.skill_id, {}).get("skill_name"),
                    "skill_type": skill_map.get(h.skill_id, {}).get("skill_type"),
                    "is_hit": h.is_hit == 1,
                    "hit_context": h.hit_context or "",
                    "match_label": skill_map.get(h.skill_id, {}).get("match_label")
                } for h in hits
            ]
        }

    async def get_pending_count(self) -> int:
        """获取待评估数量（带缓存）"""
        if self.cache:
            cached = await self.cache.get(EVAL_PENDING_COUNT_KEY)
            if cached is not None:
                return int(cached)
        count = await self.eval_repo.count_pending_evaluations()
        if self.cache:
            await self.cache.set(EVAL_PENDING_COUNT_KEY, str(count), EVAL_PENDING_COUNT_TTL)
        return count

    async def get_avg_score(self) -> float:
        """获取平均匹配分（带缓存）"""
        if self.cache:
            cached = await self.cache.get(EVAL_AVG_SCORE_KEY)
            if cached is not None:
                return float(cached)
        score = await self.eval_repo.get_avg_match_score()
        if self.cache:
            await self.cache.set(EVAL_AVG_SCORE_KEY, str(score), EVAL_AVG_SCORE_TTL)
        return score

    async def get_recent_activities(self, limit: int = 10) -> list:
        """获取最近活动（带缓存）"""
        if self.cache:
            cached = await self.cache.get_json(EVAL_RECENT_KEY)
            if cached is not None:
                return cached[:limit]
        activities = await self.eval_repo.get_recent_activities(limit)
        if self.cache:
            await self.cache.set_json(EVAL_RECENT_KEY, activities, EVAL_RECENT_TTL)
        return activities

    async def get_match_distribution(self, job_id: int) -> list:
        """获取岗位匹配度分布（带缓存）"""
        if self.cache:
            cached = await self.cache.get_json(EVAL_MATCH_DIST_KEY.format(job_id=job_id))
            if cached is not None:
                return cached
        distribution = await self.eval_repo.get_match_distribution(job_id)
        if self.cache:
            await self.cache.set_json(EVAL_MATCH_DIST_KEY.format(job_id=job_id), distribution, EVAL_MATCH_DIST_TTL)
        return distribution
