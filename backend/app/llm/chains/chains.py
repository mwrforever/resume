import json
import re
import logging
from concurrent.futures import ThreadPoolExecutor
from app.llm.clients.client import llm_complete
from app.llm.prompts.prompts import (
    COMPREHENSIVE_EVAL_PROMPT,
    DIMENSION_EVAL_WITH_SKILLS_PROMPT,
    EVAL_DIMENSION_AI_SUGGEST_PROMPT,
    JOB_AI_SUGGEST_PROMPT,
    JOB_TEMPLATE_AI_SUGGEST_PROMPT,
    SKILL_MATCH_PROMPT,
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
    def evaluate(self, resume_text: str, job_name: str, job_description: str, dimensions: list, skills: list) -> dict:
        skill_hits = self._match_skills(resume_text, job_name, job_description, skills)
        dimension_results = self._evaluate_dimensions(resume_text, job_name, job_description, dimensions, skill_hits)
        weighted_score = self._calculate_weighted_score(dimension_results, dimensions)
        comprehensive = self._evaluate_comprehensive(job_name, job_description, skill_hits, dimension_results, weighted_score)
        return {
            "dimensions": dimension_results,
            "skill_hits": skill_hits,
            "weighted_score": weighted_score,
            "final_score": comprehensive.get("final_score"),
            "final_label": str(comprehensive.get("final_label") or ""),
            "advantage_comment": str(comprehensive.get("advantage_comment") or ""),
            "disadvantage_comment": str(comprehensive.get("disadvantage_comment") or ""),
        }

    def _match_skills(self, resume_text: str, job_name: str, job_description: str, skills: list) -> list[dict]:
        prompt = SKILL_MATCH_PROMPT.format(
            job_name=job_name,
            job_description=job_description or "",
            skills=json.dumps(skills, ensure_ascii=False),
            resume_text=resume_text,
        )
        result = self._call_json(prompt, timeout=90)
        hits = result.get("skill_hits")
        return hits if isinstance(hits, list) else []

    def _evaluate_dimensions(
        self,
        resume_text: str,
        job_name: str,
        job_description: str,
        dimensions: list,
        skill_hits: list[dict],
    ) -> list[dict]:
        if not dimensions:
            return []
        max_workers = min(len(dimensions), 4)
        with ThreadPoolExecutor(max_workers=max_workers) as executor:
            return list(executor.map(
                lambda dimension: self._evaluate_dimension(
                    resume_text,
                    job_name,
                    job_description,
                    dimension,
                    skill_hits,
                ),
                dimensions,
            ))

    def _evaluate_dimension(
        self,
        resume_text: str,
        job_name: str,
        job_description: str,
        dimension: dict,
        skill_hits: list[dict],
    ) -> dict:
        prompt_template = self._render_dimension_template(
            str(dimension.get("prompt_template") or ""),
            resume_text,
            job_name,
            job_description,
            skill_hits,
        )
        prompt = DIMENSION_EVAL_WITH_SKILLS_PROMPT.format(
            job_name=job_name,
            job_description=job_description or "",
            dimension=json.dumps({
                "dimension_name": dimension.get("dimension_name"),
                "weight": dimension.get("weight"),
            }, ensure_ascii=False),
            skill_hits=json.dumps(skill_hits, ensure_ascii=False),
            prompt_template=prompt_template,
            resume_text=resume_text,
        )
        result = self._call_json(prompt, timeout=120)
        return {
            "dimension_name": str(result.get("dimension_name") or dimension.get("dimension_name") or ""),
            "score": self._normalize_score(result.get("score")),
            "advantage": str(result.get("advantage") or ""),
            "disadvantage": str(result.get("disadvantage") or ""),
        }

    def _render_dimension_template(
        self,
        prompt_template: str,
        resume_text: str,
        job_name: str,
        job_description: str,
        skill_hits: list[dict],
    ) -> str:
        try:
            return prompt_template.format(
                resume_text=resume_text,
                job_name=job_name,
                job_description=job_description or "",
                skill_hits=json.dumps(skill_hits, ensure_ascii=False),
            )
        except (KeyError, ValueError, IndexError):
            return prompt_template

    def _evaluate_comprehensive(
        self,
        job_name: str,
        job_description: str,
        skill_hits: list[dict],
        dimension_results: list[dict],
        weighted_score: float,
    ) -> dict:
        prompt = COMPREHENSIVE_EVAL_PROMPT.format(
            job_name=job_name,
            job_description=job_description or "",
            skill_hits=json.dumps(skill_hits, ensure_ascii=False),
            dimension_results=json.dumps(dimension_results, ensure_ascii=False),
            weighted_score=round(weighted_score, 2),
        )
        result = self._call_json(prompt, timeout=120)
        if result.get("final_score") is None:
            raise ValueError("AI综合评估结果缺少最终分数")
        return {
            "final_score": self._normalize_score(result.get("final_score")),
            "final_label": str(result.get("final_label") or ""),
            "advantage_comment": str(result.get("advantage_comment") or ""),
            "disadvantage_comment": str(result.get("disadvantage_comment") or ""),
        }

    def _calculate_weighted_score(self, dimension_results: list[dict], dimensions: list[dict]) -> float:
        total_weighted_score = 0.0
        total_weight = 0.0
        for result, dimension in zip(dimension_results, dimensions):
            weight = float(dimension.get("weight") or 0)
            total_weighted_score += self._normalize_score(result.get("score")) * weight
            total_weight += weight
        if total_weight <= 0:
            return 0.0
        original_total = sum(float(dimension.get("weight") or 0) for dimension in dimensions)
        return (total_weighted_score / total_weight) * original_total

    def _call_json(self, prompt: str, timeout: int) -> dict:
        raw = llm_complete(prompt, max_retries=2, timeout=timeout)
        return self._parse_result(raw)

    def _normalize_score(self, value: object) -> float:
        try:
            score = float(value)
        except (TypeError, ValueError):
            return 0.0
        return max(0.0, min(100.0, score))

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
