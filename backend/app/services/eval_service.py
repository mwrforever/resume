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
        """根据得分获取标签"""
        if score >= 90:
            return "优秀"
        elif score >= 70:
            return "良好"
        elif score >= 50:
            return "一般"
        return "未达标"

    async def evaluate_resume(self, resume_id: int, job_id: int) -> dict:
        """
        对简历进行AI评估

        Args:
            resume_id: 简历ID
            job_id: 岗位ID

        Returns:
            dict: 评估结果
        """
        # 获取数据
        resume = await self.resume_repo.get_by_id(resume_id)
        if not resume or not resume.raw_text:
            raise NotFoundError("简历不存在或未解析")

        job = await self.job_repo.get_by_id(job_id)
        if not job:
            raise NotFoundError("岗位不存在")

        # 获取或创建匹配记录
        match = await self.eval_repo.get_match_by_resume_and_job(resume_id, job_id)
        if not match:
            match = await self.eval_repo.create_match(resume_id, job_id)

        # TODO: 从数据库获取岗位的评估维度和技能要求
        # 目前使用模拟数据
        dimensions = [
            {"dimension_id": 1, "dimension_name": "技术能力", "weight": 0.4},
            {"dimension_id": 2, "dimension_name": "项目经验", "weight": 0.35},
            {"dimension_id": 3, "dimension_name": "学历背景", "weight": 0.25}
        ]

        # 评估每个维度
        dimension_results = []
        total_weighted_score = 0

        for dim in dimensions:
            result = self.dimension_chain.evaluate(
                resume_text=resume.raw_text,
                dimension_name=dim["dimension_name"],
                job_name=job.name,
                job_skills=""
            )

            await self.eval_repo.create_eval_detail(
                match_id=match.id,
                dimension_id=dim["dimension_id"],
                score=result["score"],
                advantage=result.get("advantage", ""),
                disadvantage=result.get("disadvantage", "")
            )

            dimension_results.append({
                "dimension_name": dim["dimension_name"],
                "score": result["score"],
                "advantage": result.get("advantage", ""),
                "disadvantage": result.get("disadvantage", "")
            })

            total_weighted_score += result["score"] * dim["weight"]

        # 生成综合评价
        comprehensive = self.comprehensive_chain.evaluate(
            job_name=job.name,
            final_score=total_weighted_score,
            dimensions=dimension_results
        )

        # 确定标签
        label = self._get_label(total_weighted_score)

        # 更新匹配结果
        await self.eval_repo.update_match_result(
            match_id=match.id,
            score=total_weighted_score,
            label=label,
            advantage=comprehensive.get("advantage_comment", ""),
            disadvantage=comprehensive.get("disadvantage_comment", "")
        )

        logger.info(f"简历 {resume_id} 评估完成，岗位 {job_id}，得分 {total_weighted_score}")

        return {
            "match_id": match.id,
            "final_score": total_weighted_score,
            "final_label": label,
            "dimensions": dimension_results,
            "advantage_comment": comprehensive.get("advantage_comment", ""),
            "disadvantage_comment": comprehensive.get("disadvantage_comment", "")
        }

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
            "final_score": float(match.final_score),
            "final_label": match.final_label,
            "advantage_comment": match.advantage_comment or "",
            "disadvantage_comment": match.disadvantage_comment or "",
            "dimensions": [
                {
                    "dimension_id": d.dimension_id,
                    "dimension_name": d.dimension_name,
                    "score": float(d.dimension_score),
                    "advantage": d.dimension_advantage or "",
                    "disadvantage": d.dimension_disadvantage or ""
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