import json
import re
import logging
from app.utils.ai.client import llm_complete
from app.utils.ai.prompts import (
    DIMENSION_EVAL_PROMPT, SKILL_HIT_PROMPT, COMPREHENSIVE_EVAL_PROMPT,
    SKILL_SUGGEST_PROMPT, DIMENSION_SUGGEST_PROMPT, JOB_DESCRIPTION_PROMPT,
)

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

    def evaluate_with_template(self, resume_text: str, job_name: str, prompt_template: str,
                               dimension_name: str = "", job_skills: str = "") -> dict:
        """使用维度专属 prompt_template 进行评估"""
        try:
            prompt = prompt_template.format(
                resume_text=resume_text,
                job_name=job_name,
                dimension_name=dimension_name,
                job_skills=job_skills,
            )
        except KeyError:
            prompt = prompt_template + f"\n\n简历内容:\n{resume_text}"
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


class JobAiSuggestChain:
    """根据岗位名称和简要描述，一次性生成：详细描述 + 评估维度 + 技能建议"""

    def suggest(self, name: str, description: str) -> dict:
        """
        Returns:
            dict: {comprehensive_description, dimensions, skills}
        """
        desc_prompt = JOB_DESCRIPTION_PROMPT.format(job_name=name, job_description=description or "")
        dim_prompt = DIMENSION_SUGGEST_PROMPT.format(job_name=name, job_description=description or "")
        skill_prompt = SKILL_SUGGEST_PROMPT.format(job_name=name, job_description=description or "")

        try:
            comprehensive_description = llm_complete(desc_prompt)
        except Exception as e:
            logger.error(f"岗位描述生成失败: {e}")
            comprehensive_description = description or ""

        try:
            dim_raw = llm_complete(dim_prompt)
            dimensions = self._parse_array(dim_raw)
        except Exception as e:
            logger.error(f"评估维度生成失败: {e}")
            dimensions = []

        try:
            skill_raw = llm_complete(skill_prompt)
            skills = self._parse_array(skill_raw)
        except Exception as e:
            logger.error(f"技能建议生成失败: {e}")
            skills = []

        return {
            "comprehensive_description": comprehensive_description.strip(),
            "dimensions": dimensions,
            "skills": skills,
        }

    def _parse_array(self, result: str) -> list:
        match = re.search(r'\[.*\]', result, re.DOTALL)
        if match:
            try:
                return json.loads(match.group())
            except json.JSONDecodeError:
                pass
        return []