import asyncio
import logging
from app.repositories.eval_repo import EvalRepository
from app.repositories.resume_repo import ResumeRepository
from app.repositories.job_repo import JobRepository
from app.utils.ai.chains import DimensionEvalChain, SkillHitChain, ComprehensiveEvalChain
from app.core.exceptions import NotFoundError

logger = logging.getLogger(__name__)


class EvalService:
    def __init__(self, eval_repo: EvalRepository, resume_repo: ResumeRepository, job_repo: JobRepository):
        self.eval_repo = eval_repo
        self.resume_repo = resume_repo
        self.job_repo = job_repo
        self.dimension_chain = DimensionEvalChain()
        self.skill_hit_chain = SkillHitChain()
        self.comprehensive_chain = ComprehensiveEvalChain()

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
        if not resume or not resume.raw_text:
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

        # 并行评估所有维度
        dimension_results = await self._evaluate_dimensions_parallel(
            match.id, resume.raw_text, job.name, dimensions
        )

        # 计算加权总分（只计算成功的维度）
        completed_results = [r for r in dimension_results if r["is_completed"]]
        if not completed_results:
            raise Exception("所有维度评估均失败")

        total_weighted_score = 0.0
        total_weight = 0.0
        for r, dim in zip(dimension_results, dimensions):
            if r["is_completed"]:
                total_weighted_score += r["score"] * dim["weight"]
                total_weight += dim["weight"]

        if total_weight > 0:
            original_total = sum(d["weight"] for d in dimensions)
            total_weighted_score = (total_weighted_score / total_weight) * original_total

        # 生成综合评价
        comprehensive = self.comprehensive_chain.evaluate(
            job_name=job.name,
            final_score=total_weighted_score,
            dimensions=completed_results
        )

        label = self._get_label(total_weighted_score)

        await self.eval_repo.update_match_result(
            match_id=match.id,
            score=total_weighted_score,
            label=label,
            advantage=comprehensive.get("advantage_comment", ""),
            disadvantage=comprehensive.get("disadvantage_comment", "")
        )

        # 技能命中检测（按 skill_type 分组，各调用一次 LLM）
        await self._evaluate_skill_hits(match.id, resume.raw_text, job_id)

        logger.info(f"简历 {resume_id} 评估完成，岗位 {job_id}，得分 {total_weighted_score}")

        return {
            "match_id": match.id,
            "final_score": total_weighted_score,
            "final_label": label,
            "dimensions": dimension_results,
            "advantage_comment": comprehensive.get("advantage_comment", ""),
            "disadvantage_comment": comprehensive.get("disadvantage_comment", "")
        }

    async def _evaluate_dimensions_parallel(self, match_id: int, resume_text: str, job_name: str, dimensions: list) -> list:
        """并行评估所有维度，优先使用维度专属 prompt_template"""
        async def evaluate_single(dim: dict):
            try:
                result = await asyncio.to_thread(
                    self.dimension_chain.evaluate_with_template,
                    resume_text,
                    job_name,
                    dim["prompt_template"],
                    dim["dimension_name"],
                )
                await self.eval_repo.create_eval_detail_with_status(
                    match_id=match_id,
                    dimension_id=dim["dimension_id"],
                    score=result["score"],
                    advantage=result.get("advantage", ""),
                    disadvantage=result.get("disadvantage", ""),
                    is_completed=True
                )
                return {
                    "dimension_name": dim["dimension_name"],
                    "score": result["score"],
                    "advantage": result.get("advantage", ""),
                    "disadvantage": result.get("disadvantage", ""),
                    "is_completed": True
                }
            except Exception as e:
                logger.error(f"维度 {dim['dimension_name']} 评估失败: {e}")
                await self.eval_repo.create_eval_detail_with_status(
                    match_id=match_id,
                    dimension_id=dim["dimension_id"],
                    score=50.0,
                    advantage="",
                    disadvantage="",
                    is_completed=False,
                    error_message=str(e)
                )
                return {
                    "dimension_name": dim["dimension_name"],
                    "score": 50.0,
                    "advantage": "",
                    "disadvantage": "",
                    "is_completed": False,
                    "error_message": str(e)
                }

        tasks = [evaluate_single(dim) for dim in dimensions]
        return await asyncio.gather(*tasks)

    async def _evaluate_skill_hits(self, match_id: int, resume_text: str, job_id: int) -> None:
        """按 skill_type 分组检测技能命中，并写入 resume_skill_hit"""
        all_skills = await self.job_repo.get_job_skills(job_id)
        if not all_skills:
            return

        from itertools import groupby
        sorted_skills = sorted(all_skills, key=lambda s: s.skill_type)
        for skill_type, group in groupby(sorted_skills, key=lambda s: s.skill_type):
            skills_in_group = list(group)
            skill_list = [{"skill": s.skill_name} for s in skills_in_group]
            skill_id_map = {s.skill_name: s.id for s in skills_in_group}
            try:
                result = await asyncio.to_thread(
                    self.skill_hit_chain.evaluate,
                    resume_text,
                    skill_list,
                    skill_type,
                )
                for hit in result.get("hits", []):
                    skill_id = skill_id_map.get(hit.get("skill", ""))
                    if skill_id:
                        await self.eval_repo.create_skill_hit(
                            match_id=match_id,
                            skill_id=skill_id,
                            is_hit=1 if hit.get("is_hit") else 0,
                            hit_context=hit.get("hit_context", ""),
                        )
            except Exception as e:
                logger.error(f"skill_type={skill_type} 技能命中检测失败: {e}")

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
                    "is_hit": h.is_hit == 1,
                    "hit_context": h.hit_context or ""
                } for h in hits
            ]
        }