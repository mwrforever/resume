import json
import re
import logging

from app.llm.clients.client import llm_complete
from app.llm.prompts.manager import prompt_manager

logger = logging.getLogger(__name__)


class JobAiSuggestChain:
    """根据岗位名称和简要描述润色岗位描述"""

    def suggest(self, name: str, description: str) -> dict:
        """
        Returns:
            dict: {comprehensive_description}
        """
        prompt = prompt_manager.render("job_ai_suggest", job_name=name, job_description=description or "")
        try:
            raw = llm_complete(prompt, max_retries=2, timeout=90)
            result = self._parse_object(raw)
        except RuntimeError as e:
            logger.error(f"岗位AI建议生成失败: {e}")
            result = {}

        return {
            "comprehensive_description": str(result.get("comprehensive_description") or description or "").strip(),
        }

    def _parse_object(self, result: str) -> dict:
        match = re.search(r'\{.*}', result, re.DOTALL)
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
        prompt = prompt_manager.render("job_template_ai_suggest", job_name=job_name, job_description=job_description or "")
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
        prompt = prompt_manager.render("eval_dimension_ai_suggest", job_name=job_name, job_description=job_description or "")
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
        prompt = prompt_manager.render("template_skill_ai_suggest", dimensions=json.dumps(dimensions, ensure_ascii=False))
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


# ResumeEvalChain 已迁移到 app.llm.graphs.evaluation_graph，Celery 与 Agent 同源复用。
