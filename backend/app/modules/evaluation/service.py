from app.modules.evaluation.repository import EvalRepository
from app.modules.resume.repository import ResumeRepository
from app.modules.job.repository import JobRepository
from app.modules.application.repository import ApplicationRepository
from app.infrastructure.exception import NotFoundError, ValidationError


class EvalService:
    def __init__(self, eval_repo: EvalRepository, resume_repo: ResumeRepository, job_repo: JobRepository, app_repo: ApplicationRepository) -> None:
        self.eval_repo = eval_repo
        self.resume_repo = resume_repo
        self.job_repo = job_repo
        self.app_repo = app_repo

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
        snapshot = app.job_snapshot
        dimension_map = {
            int(item["dimension_id"]): item
            for item in snapshot.get("dimensions", [])
            if item.get("dimension_id") is not None
        }
        skill_map = {
            int(item["id"]): item
            for item in snapshot.get("skills", [])
            if item.get("id") is not None
        }

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
