import json
import re
import logging
from app.utils.ai.client import llm_complete
from app.utils.ai.prompts import (
    EVAL_DIMENSION_AI_SUGGEST_PROMPT,
    JOB_AI_SUGGEST_PROMPT,
    JOB_TEMPLATE_AI_SUGGEST_PROMPT,
    RESUME_EVAL_PROMPT,
    TEMPLATE_SKILL_AI_SUGGEST_PROMPT,
)

logger = logging.getLogger(__name__)


class JobAiSuggestChain:
    """根据岗位名称和简要描述润色岗位描述"""

    def suggest(self, name: str, description: str) -> dict:
        """
        Returns:
            dict: {comprehensive_description}
        """
        prompt = JOB_AI_SUGGEST_PROMPT.format(job_name=name, job_description=description or "")
        try:
            raw = llm_complete(prompt, max_retries=2, timeout=90)
            result = self._parse_object(raw)
        except Exception as e:
            logger.error(f"岗位AI建议生成失败: {e}")
            result = {}

        return {
            "comprehensive_description": str(result.get("comprehensive_description") or description or "").strip(),
        }

    def _parse_object(self, result: str) -> dict:
        match = re.search(r'\{.*\}', result, re.DOTALL)
        if match:
            try:
                parsed = json.loads(match.group())
                if isinstance(parsed, dict):
                    return parsed
            except json.JSONDecodeError:
                pass
        return {}


class JobTemplateAiSuggestChain:
    def suggest(self, job_name: str, job_description: str) -> dict:
        prompt = JOB_TEMPLATE_AI_SUGGEST_PROMPT.format(job_name=job_name, job_description=job_description or "")
        raw = llm_complete(prompt, max_retries=2, timeout=120)
        result = self._parse_object(raw)
        return {
            "template_name": str(result.get("template_name") or "").strip(),
            "description": str(result.get("description") or "").strip(),
            "dimensions": result.get("dimensions") if isinstance(result.get("dimensions"), list) else [],
            "skills": result.get("skills") if isinstance(result.get("skills"), list) else [],
        }

    def _parse_object(self, result: str) -> dict:
        match = re.search(r'\{.*\}', result, re.DOTALL)
        if match:
            try:
                parsed = json.loads(match.group())
                if isinstance(parsed, dict):
                    return parsed
            except json.JSONDecodeError:
                pass
        return {}


class EvalDimensionAiSuggestChain:
    def suggest(self, job_name: str, job_description: str) -> dict:
        prompt = EVAL_DIMENSION_AI_SUGGEST_PROMPT.format(job_name=job_name, job_description=job_description or "")
        raw = llm_complete(prompt, max_retries=2, timeout=90)
        result = self._parse_object(raw)
        return {
            "dimension_name": str(result.get("dimension_name") or "").strip(),
            "description": str(result.get("description") or "").strip(),
            "default_prompt_template": str(result.get("default_prompt_template") or "").strip(),
        }

    def _parse_object(self, result: str) -> dict:
        match = re.search(r'\{.*\}', result, re.DOTALL)
        if match:
            try:
                parsed = json.loads(match.group())
                if isinstance(parsed, dict):
                    return parsed
            except json.JSONDecodeError:
                pass
        return {}


class TemplateSkillAiSuggestChain:
    def suggest(self, dimensions: list[dict]) -> dict:
        prompt = TEMPLATE_SKILL_AI_SUGGEST_PROMPT.format(dimensions=json.dumps(dimensions, ensure_ascii=False))
        raw = llm_complete(prompt, max_retries=2, timeout=90)
        result = self._parse_object(raw)
        return {
            "skills": result.get("skills") if isinstance(result.get("skills"), list) else [],
        }

    def _parse_object(self, result: str) -> dict:
        match = re.search(r'\{.*\}', result, re.DOTALL)
        if match:
            try:
                parsed = json.loads(match.group())
                if isinstance(parsed, dict):
                    return parsed
            except json.JSONDecodeError:
                pass
        return {}


class ResumeEvalChain:
    """一次性生成简历维度评估、技能命中和综合评价"""

    def evaluate(self, resume_text: str, job_name: str, job_description: str, dimensions: list, skills: list) -> dict:
        prompt = RESUME_EVAL_PROMPT.format(
            job_name=job_name,
            job_description=job_description or "",
            dimensions=json.dumps(dimensions, ensure_ascii=False),
            skills=json.dumps(skills, ensure_ascii=False),
            resume_text=resume_text,
        )
        raw = llm_complete(prompt, max_retries=2, timeout=120)
        return self._parse_result(raw)

    def _parse_result(self, result: str) -> dict:
        match = re.search(r'\{.*\}', result, re.DOTALL)
        if match:
            try:
                parsed = json.loads(match.group())
                if isinstance(parsed, dict):
                    return parsed
            except json.JSONDecodeError:
                pass
        return {}