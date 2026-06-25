"""
后台 AI 建议链（async 版）。

历史背景：原同步链通过 ``asyncio.to_thread`` + ``asyncio.run`` 在 FastAPI 事件循环外
跑同步 ``llm_complete``，会让 gateway 缓存的 ``ChatOpenAI`` 实例绑到临时 loop，
loop 关闭后 httpx 客户端失效，导致后续所有 AI 建议接口稳定失败。
现统一改为 async 直调 ``async_llm_complete``，复用主事件循环，不再有 loop 错配。

捕获 ``LLMGatewayError``：上游模型调用失败时，返回空结构，让 service 层用
``ValidationError`` 统一抛出"AI 未返回建议"的友好提示，前端能正常拿到 message。
"""

import json
import re
import logging

from app.llm.clients.client import async_llm_complete
from app.llm.gateway import LLMGatewayError
from app.llm.prompts.manager import prompt_manager

logger = logging.getLogger(__name__)


def _extract_json_object(result: str) -> dict:
    """从模型返回文本中抽取首个 JSON 对象，解析失败统一返回空 dict。"""
    match = re.search(r'\{.*}', result, re.DOTALL)
    if not match:
        return {}
    try:
        parsed = json.loads(match.group())
        return parsed if isinstance(parsed, dict) else {}
    except json.JSONDecodeError:
        return {}


class JobAiSuggestChain:
    """根据岗位名称和简要描述润色岗位描述。"""

    async def suggest(self, name: str, description: str) -> dict:
        """
        异步调用 LLM 生成综合描述。模型调用异常时返回原始描述兜底。

        Returns:
            dict: {comprehensive_description}
        """
        prompt = prompt_manager.render("admin/job_description", job_name=name, job_description=description or "")
        try:
            raw = await async_llm_complete(prompt, max_retries=2, timeout=90)
            result = _extract_json_object(raw)
        except LLMGatewayError as e:
            # 网关层异常：模型不可用 / 超时 / 鉴权失败等，回退到原始描述
            logger.error("岗位 AI 建议生成失败: %s", e)
            result = {}

        return {
            "comprehensive_description": str(result.get("comprehensive_description") or description or "").strip(),
        }


class JobTemplateAiSuggestChain:
    """根据岗位生成评估模板（含维度与技能）建议。"""

    async def suggest(self, job_name: str, job_description: str) -> dict:
        prompt = prompt_manager.render("admin/eval_template", job_name=job_name, job_description=job_description or "")
        try:
            raw = await async_llm_complete(prompt, max_retries=2, timeout=120)
        except LLMGatewayError as e:
            # 抛给 service 层转成统一业务异常，前端可拿到 message
            logger.error("评估模板 AI 建议生成失败: %s", e)
            raise
        result = _extract_json_object(raw)
        return {
            "template_name": str(result.get("template_name") or "").strip(),
            "description": str(result.get("description") or "").strip(),
            "dimensions": result.get("dimensions") if isinstance(result.get("dimensions"), list) else [],
            "skills": result.get("skills") if isinstance(result.get("skills"), list) else [],
        }


class EvalDimensionAiSuggestChain:
    """根据岗位生成单个评估维度建议。"""

    async def suggest(self, job_name: str, job_description: str) -> dict:
        prompt = prompt_manager.render("admin/eval_dimension", job_name=job_name, job_description=job_description or "")
        try:
            raw = await async_llm_complete(prompt, max_retries=2, timeout=90)
        except LLMGatewayError as e:
            logger.error("评估维度 AI 建议生成失败: %s", e)
            raise
        result = _extract_json_object(raw)
        return {
            "dimension_name": str(result.get("dimension_name") or "").strip(),
            "description": str(result.get("description") or "").strip(),
            "default_prompt_template": str(result.get("default_prompt_template") or "").strip(),
        }


class TemplateSkillAiSuggestChain:
    """根据已选维度生成技能项建议。"""

    async def suggest(self, dimensions: list[dict]) -> dict:
        prompt = prompt_manager.render("admin/template_skills", dimensions=json.dumps(dimensions, ensure_ascii=False))
        try:
            raw = await async_llm_complete(prompt, max_retries=2, timeout=90)
        except LLMGatewayError as e:
            logger.error("模板技能 AI 建议生成失败: %s", e)
            raise
        result = _extract_json_object(raw)
        return {
            "skills": result.get("skills") if isinstance(result.get("skills"), list) else [],
        }


# ResumeEvalChain 已迁移到 app.llm.graphs.evaluation_graph，Celery 与 Agent 同源复用。
