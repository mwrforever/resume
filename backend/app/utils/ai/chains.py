import json
import re
import logging
from app.utils.ai.client import llm_complete
from app.utils.ai.prompts import (
    JOB_AI_SUGGEST_PROMPT, RESUME_EVAL_PROMPT,
)

logger = logging.getLogger(__name__)


class JobAiSuggestChain:
    """根据岗位名称和简要描述，一次性生成：详细描述 + 评估维度 + 技能建议"""

    def suggest(self, name: str, description: str) -> dict:
        """
        Returns:
            dict: {comprehensive_description, dimensions, skills}
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