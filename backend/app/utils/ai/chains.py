import json
import re
import logging
from app.utils.ai.client import llm_complete
from app.utils.ai.prompts import DIMENSION_EVAL_PROMPT, SKILL_HIT_PROMPT, COMPREHENSIVE_EVAL_PROMPT

logger = logging.getLogger(__name__)


class DimensionEvalChain:
    """维度评估Chain"""

    def evaluate(self, resume_text: str, dimension_name: str, job_name: str, job_skills: str) -> dict:
        """
        评估简历在指定维度的得分

        Returns:
            dict: {score: int, advantage: str, disadvantage: str}
        """
        prompt = DIMENSION_EVAL_PROMPT.format(
            dimension_name=dimension_name,
            job_name=job_name,
            job_skills=job_skills,
            resume_text=resume_text
        )
        try:
            result = llm_complete(prompt)
            return self._parse_result(result)
        except Exception as e:
            logger.error(f"维度评估失败: {e}")
            return {"score": 50, "advantage": "评估异常", "disadvantage": ""}

    def _parse_result(self, result: str) -> dict:
        """解析JSON结果"""
        match = re.search(r'\{.*\}', result, re.DOTALL)
        if match:
            try:
                return json.loads(match.group())
            except json.JSONDecodeError:
                pass
        return {"score": 50, "advantage": "解析失败", "disadvantage": ""}


class SkillHitChain:
    """技能命中检测Chain"""

    def evaluate(self, resume_text: str, skill_list: list, skill_type: int) -> dict:
        """
        检测简历中技能的命中情况

        Returns:
            dict: {hits: [{skill, is_hit, hit_context}]}
        """
        prompt = SKILL_HIT_PROMPT.format(
            skill_list=", ".join([s["skill"] for s in skill_list]),
            skill_type=skill_type,
            resume_text=resume_text
        )
        try:
            result = llm_complete(prompt)
            return self._parse_result(result)
        except Exception as e:
            logger.error(f"技能命中检测失败: {e}")
            return {"hits": []}

    def _parse_result(self, result: str) -> dict:
        match = re.search(r'\{.*\}', result, re.DOTALL)
        if match:
            try:
                return json.loads(match.group())
            except json.JSONDecodeError:
                pass
        return {"hits": []}


class ComprehensiveEvalChain:
    """综合评价Chain"""

    def evaluate(self, job_name: str, final_score: float, dimensions: list) -> dict:
        """
        生成简历对岗位的综合评价

        Returns:
            dict: {advantage_comment: str, disadvantage_comment: str}
        """
        dimensions_str = ", ".join([f"{d['dimension_name']}:{d['score']}分" for d in dimensions])
        prompt = COMPREHENSIVE_EVAL_PROMPT.format(
            job_name=job_name,
            final_score=final_score,
            dimensions=dimensions_str
        )
        try:
            result = llm_complete(prompt)
            return self._parse_result(result)
        except Exception as e:
            logger.error(f"综合评价生成失败: {e}")
            return {"advantage_comment": "", "disadvantage_comment": ""}

    def _parse_result(self, result: str) -> dict:
        match = re.search(r'\{.*\}', result, re.DOTALL)
        if match:
            try:
                return json.loads(match.group())
            except json.JSONDecodeError:
                pass
        return {"advantage_comment": "", "disadvantage_comment": ""}