import asyncio
import logging
from pathlib import Path
from typing import Any
from app.repositories.eval_repo import EvalRepository
from app.repositories.resume_repo import ResumeRepository
from app.repositories.job_repo import JobRepository
from app.utils.ai.chains import ResumeEvalChain
from app.utils.resume_parser import extract_resume_text
from app.core.config import get_settings
from app.core.exceptions import NotFoundError, ValidationError

logger = logging.getLogger(__name__)


class EvalService:
    def __init__(self, eval_repo: EvalRepository, resume_repo: ResumeRepository, job_repo: JobRepository) -> None:
        self.eval_repo = eval_repo
        self.resume_repo = resume_repo
        self.job_repo = job_repo
        self.resume_eval_chain = ResumeEvalChain()

    def _get_label(self, score: float) -> str:
        if score >= 90:
            return "优秀"
        elif score >= 70:
            return "良好"
        elif score >= 50:
            return "一般"
        return "未达标"

    async def evaluate_resume(self, resume_id: int, job_id: int) -> dict:
        """对简历进行AI评估（并行维度评估）"""
        resume = await self.resume_repo.get_by_id(resume_id)
        if not resume:
            raise NotFoundError("简历不存在或未解析")
        resume_text = resume.raw_text or await self._parse_resume_text(resume)
        if not resume_text:
            raise NotFoundError("简历不存在或未解析")

        job = await self.job_repo.get_by_id(job_id)
        if not job:
            raise NotFoundError("岗位不存在")

        # 获取或创建匹配记录；重评估时先清理旧数据
        match = await self.eval_repo.get_match_by_resume_and_job(resume_id, job_id)
        if not match:
            match = await self.eval_repo.create_match(resume_id, job_id)
        else:
            await self.eval_repo.delete_eval_details_by_match(match.id)
            await self.eval_repo.delete_skill_hits_by_match(match.id)

        # 从数据库读取岗位实际配置的评估维度
        db_dimensions = await self.job_repo.get_dimensions(job_id)
        if not db_dimensions:
            raise NotFoundError("岗位未配置评估维度，无法评估")

        dimensions = [
            {
                "dimension_id": d.id,
                "dimension_name": d.dimension_name,
                "weight": float(d.weight),
                "prompt_template": d.prompt_template,
            }
            for d in db_dimensions
        ]

        all_skills = await self.job_repo.get_job_skills(job_id)
        skills = [
            {
                "skill_id": s.id,
                "skill": s.skill_name,
                "type": s.skill_type,
            }
            for s in all_skills
        ]

        eval_result = await asyncio.to_thread(
            self.resume_eval_chain.evaluate,
            resume_text,
            job.name,
            job.description or "",
            [
                {
                    "dimension_name": d["dimension_name"],
                    "weight": d["weight"],
                    "prompt_template": d["prompt_template"],
                }
                for d in dimensions
            ],
            [{"skill": s["skill"], "type": s["type"]} for s in skills],
        )

        dimension_results = await self._save_dimension_results(
            match.id,
            dimensions,
            eval_result.get("dimensions", []),
        )

        # 计算加权总分（只计算成功的维度）
        completed_results = [r for r in dimension_results if r["is_completed"]]
        if not completed_results:
            raise ValidationError("AI评估结果缺少有效维度")

        total_weighted_score = 0.0
        total_weight = 0.0
        for r, dim in zip(dimension_results, dimensions):
            if r["is_completed"]:
                total_weighted_score += r["score"] * dim["weight"]
                total_weight += dim["weight"]

        if total_weight > 0:
            original_total = sum(d["weight"] for d in dimensions)
            total_weighted_score = (total_weighted_score / total_weight) * original_total

        label = self._get_label(total_weighted_score)
        advantage_comment = str(eval_result.get("advantage_comment") or "")
        disadvantage_comment = str(eval_result.get("disadvantage_comment") or "")

        await self.eval_repo.update_match_result(
            match_id=match.id,
            score=total_weighted_score,
            label=label,
            advantage=advantage_comment,
            disadvantage=disadvantage_comment
        )

        await self._save_skill_hits(match.id, skills, eval_result.get("skill_hits", []))

        logger.info(f"简历 {resume_id} 评估完成，岗位 {job_id}，得分 {total_weighted_score}")

        return {
            "match_id": match.id,
            "final_score": total_weighted_score,
            "final_label": label,
            "dimensions": dimension_results,
            "advantage_comment": advantage_comment,
            "disadvantage_comment": disadvantage_comment
        }

    async def _parse_resume_text(self, resume: Any) -> str:
        settings = get_settings()
        file_path = Path(resume.file_path)
        if not file_path.is_absolute():
            file_path = Path(settings.LOCAL_STORAGE_PATH) / file_path
        if not file_path.exists():
            raise NotFoundError("简历文件不存在")
        raw_text = extract_resume_text(file_path)
        if raw_text:
            await self.resume_repo.update_raw_text(resume.id, raw_text)
        return raw_text

    def _normalize_score(self, value: Any) -> float:
        try:
            score = float(value)
        except (TypeError, ValueError):
            return 0.0
        return max(0.0, min(100.0, score))

    async def _save_dimension_results(self, match_id: int, dimensions: list[dict], ai_dimensions: list) -> list:
        result_by_name = {
            str(item.get("dimension_name", "")).strip(): item
            for item in ai_dimensions
            if isinstance(item, dict)
        }
        dimension_results = []

        for index, dim in enumerate(dimensions):
            item = result_by_name.get(str(dim["dimension_name"]).strip())
            if item is None and index < len(ai_dimensions) and isinstance(ai_dimensions[index], dict):
                item = ai_dimensions[index]

            if item is None:
                await self.eval_repo.create_eval_detail_with_status(
                    match_id=match_id,
                    dimension_id=dim["dimension_id"],
                    score=0.0,
                    advantage="",
                    disadvantage="",
                    is_completed=False,
                    error_message="AI评估结果缺少该维度"
                )
                dimension_results.append({
                    "dimension_name": dim["dimension_name"],
                    "score": 0.0,
                    "advantage": "",
                    "disadvantage": "",
                    "is_completed": False,
                    "error_message": "AI评估结果缺少该维度"
                })
                continue

            score = self._normalize_score(item.get("score"))
            advantage = str(item.get("advantage") or "")
            disadvantage = str(item.get("disadvantage") or "")
            await self.eval_repo.create_eval_detail_with_status(
                match_id=match_id,
                dimension_id=dim["dimension_id"],
                score=score,
                advantage=advantage,
                disadvantage=disadvantage,
                is_completed=True
            )
            dimension_results.append({
                "dimension_name": dim["dimension_name"],
                "score": score,
                "advantage": advantage,
                "disadvantage": disadvantage,
                "is_completed": True
            })

        return dimension_results

    async def _save_skill_hits(self, match_id: int, skills: list[dict], ai_hits: list) -> None:
        hit_by_name = {
            str(item.get("skill", "")).strip(): item
            for item in ai_hits
            if isinstance(item, dict)
        }

        for skill in skills:
            item = hit_by_name.get(str(skill["skill"]).strip())
            is_hit = bool(item and item.get("is_hit"))
            hit_context = str(item.get("hit_context") or "") if item else ""
            await self.eval_repo.create_skill_hit(
                match_id=match_id,
                skill_id=skill["skill_id"],
                is_hit=1 if is_hit else 0,
                hit_context=hit_context,
            )

    async def get_evaluation_detail(self, match_id: int) -> dict:
        """获取评估详情"""
        match = await self.eval_repo.get_match_by_id(match_id)
        if not match:
            raise NotFoundError("评估记录不存在")

        details = await self.eval_repo.get_eval_details(match_id)
        hits = await self.eval_repo.get_skill_hits(match_id)

        return {
            "match_id": match.id,
            "resume_id": match.resume_id,
            "job_id": match.job_id,
            "final_score": float(match.final_score) if match.final_score else 0,
            "final_label": match.final_label or "未评估",
            "advantage_comment": match.advantage_comment or "",
            "disadvantage_comment": match.disadvantage_comment or "",
            "dimensions": [
                {
                    "dimension_id": d.dimension_id,
                    "dimension_name": d.dimension_name,
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
                    "skill_name": getattr(h, "skill_name", None),
                    "skill_type": getattr(h, "skill_type", None),
                    "is_hit": h.is_hit == 1,
                    "hit_context": h.hit_context or "",
                    "match_label": getattr(h, "match_label", None)
                } for h in hits
            ]
        }