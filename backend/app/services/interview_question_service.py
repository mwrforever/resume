"""面试题生成工作流业务服务。"""

from __future__ import annotations

import json
import logging
from pathlib import Path
from typing import Any

import yaml

from app.llm.model_router import LLMModelRouter
from app.schemas.agent.dto import (
    InterviewDimensionDTO,
    InterviewQuestionItemDTO,
    InterviewQuestionPlanDTO,
    InterviewQuestionPlanItemDTO,
    InterviewQuestionSetDTO,
    LLMRuntimeConfigDTO,
)
from app.services.agent_resume_pipeline_service import AgentResumePipelineService

logger = logging.getLogger(__name__)

PROMPT_TEMPLATE_DIR = Path(__file__).resolve().parents[1] / "llm" / "prompts" / "templates"
FALLBACK_DIMENSIONS = ["项目深度", "技术能力", "沟通表达", "稳定性", "岗位匹配"]


class InterviewQuestionService:
    """面试题生成业务服务，供 LangGraph 节点调用。"""

    def __init__(self, *, model_router: LLMModelRouter | Any, resume_pipeline: AgentResumePipelineService | Any) -> None:
        """
        初始化面试题生成服务。

        Args:
            model_router: LLM 模型路由器
            resume_pipeline: Agent 简历上下文服务
        """
        self._model_router = model_router
        self._resume_pipeline = resume_pipeline

    async def load_resume_text(self, *, employee_id: int, resume_ref: dict[str, Any]) -> str:
        """
        加载简历结构化文本。

        Args:
            employee_id: 当前员工 ID
            resume_ref: 前端传入的简历引用

        Returns:
            str: 优先返回结构化 Markdown，否则返回简历原文
        """
        resume_id = int(resume_ref.get("resume_id") or resume_ref.get("id") or 0)
        job_id = resume_ref.get("job_id")
        context = await self._resume_pipeline.load_resume_context(
            resume_id=resume_id,
            job_id=int(job_id) if job_id is not None else None,
            employee_id=employee_id,
        )
        structured_markdown = str(getattr(context, "structured_markdown", "") or "").strip()
        raw_text = str(getattr(context, "raw_text", "") or "").strip()
        return structured_markdown or raw_text

    async def suggest_dimensions(self, *, resume_text: str, runtime_config: LLMRuntimeConfigDTO) -> list[InterviewDimensionDTO]:
        """
        基于简历提议面试维度，失败时返回固定兜底维度。

        Args:
            resume_text: 简历文本
            runtime_config: LLM 运行配置

        Returns:
            list[InterviewDimensionDTO]: 面试维度列表
        """
        prompt = self._render_prompt("interview_dimension_suggest", resume_text=resume_text[:120000])
        try:
            result = await self._model_router.complete(prompt, runtime_config)
            data = self._parse_json_object(result.content)
            dimensions = data.get("dimensions")
            if not isinstance(dimensions, list):
                raise ValueError("dimensions must be a list")
            return [InterviewDimensionDTO.model_validate(item) for item in dimensions if isinstance(item, dict)]
        except (RuntimeError, ValueError, TypeError, KeyError, json.JSONDecodeError):
            logger.warning("Interview dimension suggestion failed, using fallback dimensions", exc_info=True)
            return self._fallback_dimensions()

    async def build_question_plan(
        self,
        *,
        resume_text: str,
        selected_dimensions: list[str],
        runtime_config: LLMRuntimeConfigDTO,
    ) -> InterviewQuestionPlanDTO:
        """
        构建面试题生成计划。

        Args:
            resume_text: 简历文本
            selected_dimensions: 已选择面试维度
            runtime_config: LLM 运行配置

        Returns:
            InterviewQuestionPlanDTO: 面试题计划
        """
        prompt = self._render_prompt(
            "interview_question_plan",
            resume_text=resume_text[:120000],
            selected_dimensions=json.dumps(selected_dimensions, ensure_ascii=False),
        )
        try:
            result = await self._model_router.complete(prompt, runtime_config)
            return InterviewQuestionPlanDTO.model_validate(self._parse_json_object(result.content))
        except (RuntimeError, ValueError, TypeError, KeyError, json.JSONDecodeError):
            logger.warning("Interview question plan generation failed, using fallback plan", exc_info=True)
            return self._fallback_plan(selected_dimensions)

    async def generate_questions_for_dimension(
        self,
        *,
        resume_text: str,
        plan_item: InterviewQuestionPlanItemDTO,
        runtime_config: LLMRuntimeConfigDTO,
    ) -> list[InterviewQuestionItemDTO]:
        """
        按单个维度生成结构化面试题。

        Args:
            resume_text: 简历文本
            plan_item: 当前维度计划
            runtime_config: LLM 运行配置

        Returns:
            list[InterviewQuestionItemDTO]: 结构化面试题列表
        """
        prompt = self._render_prompt(
            "interview_question_generate",
            resume_text=resume_text[:120000],
            plan_item=json.dumps(plan_item.model_dump(mode="json"), ensure_ascii=False),
        )
        try:
            result = await self._model_router.complete(prompt, runtime_config)
            data = self._parse_json_object(result.content)
            questions = data.get("questions")
            if not isinstance(questions, list):
                raise ValueError("questions must be a list")
            return [InterviewQuestionItemDTO.model_validate(item) for item in questions if isinstance(item, dict)]
        except (RuntimeError, ValueError, TypeError, KeyError, json.JSONDecodeError):
            logger.warning("Interview question generation failed, using fallback question", exc_info=True)
            return [self._fallback_question(plan_item)]

    def build_question_set_block(self, questions: list[InterviewQuestionItemDTO]) -> dict[str, Any]:
        """
        构建前端渲染用面试题清单 block。

        Args:
            questions: 已生成结构化面试题

        Returns:
            dict[str, Any]: `agent_message.content.blocks` 中的业务卡片块
        """
        question_set = InterviewQuestionSetDTO(
            total_questions=len(questions),
            dimensions=sorted({item.dimension for item in questions}),
            questions=questions,
        )
        return {"type": "interview_question_set", "question_set": question_set.model_dump(mode="json")}

    def _fallback_dimensions(self) -> list[InterviewDimensionDTO]:
        """
        返回固定兜底面试维度。

        Returns:
            list[InterviewDimensionDTO]: 固定维度列表
        """
        return [InterviewDimensionDTO(name=name, reason="LLM 暂不可用时使用固定面试维度", source="fallback") for name in FALLBACK_DIMENSIONS]

    def _fallback_plan(self, selected_dimensions: list[str]) -> InterviewQuestionPlanDTO:
        """
        返回固定兜底题目规划。

        Args:
            selected_dimensions: 已选择面试维度

        Returns:
            InterviewQuestionPlanDTO: 固定计划
        """
        dimensions = selected_dimensions or FALLBACK_DIMENSIONS[:3]
        question_count = max(1, 10 // len(dimensions))
        items = [
            InterviewQuestionPlanItemDTO(
                dimension=dimension,
                question_count=question_count,
                difficulty="中等",
                focus="核实简历真实性、项目贡献与岗位匹配度",
            )
            for dimension in dimensions
        ]
        return InterviewQuestionPlanDTO(total_questions=sum(item.question_count for item in items), items=items, summary="使用固定兜底计划生成面试题。")

    def _fallback_question(self, plan_item: InterviewQuestionPlanItemDTO) -> InterviewQuestionItemDTO:
        """
        返回单个兜底面试题。

        Args:
            plan_item: 当前维度计划

        Returns:
            InterviewQuestionItemDTO: 固定面试题
        """
        return InterviewQuestionItemDTO(
            question=f"请结合简历，说明你在{plan_item.dimension}方面最能代表真实能力的一段经历。",
            dimension=plan_item.dimension,
            difficulty=plan_item.difficulty,
            evaluation_points=["真实贡献", "表达清晰度", "岗位相关性"],
            follow_up_suggestions=["追问具体指标、关键决策和本人负责部分"],
            excellent_signals=["能说明背景、行动、结果和技术取舍"],
            average_signals=["能描述经历但缺少量化结果"],
            risk_signals=["无法说明本人贡献或细节前后矛盾"],
        )

    def _render_prompt(self, template_name: str, **context: str) -> str:
        """
        渲染多字段 YAML Prompt 模板。

        Args:
            template_name: 模板文件名，不含 `.yaml`
            context: 模板变量

        Returns:
            str: 拼装后的完整 prompt
        """
        template_path = PROMPT_TEMPLATE_DIR / f"{template_name}.yaml"
        with template_path.open("r", encoding="utf-8") as file:
            payload = yaml.safe_load(file) or {}
        sections = [str(payload.get(key) or "") for key in ("role", "context", "instructions", "output_format")]
        prompt = "\n\n".join(section.strip() for section in sections if section.strip())
        for key, value in context.items():
            prompt = prompt.replace("{" + key + "}", value)
        return prompt.strip()

    @staticmethod
    def _parse_json_object(content: str) -> dict[str, Any]:
        """
        从 LLM 输出中解析 JSON 对象。

        Args:
            content: LLM 原始输出

        Returns:
            dict[str, Any]: JSON 对象
        """
        text = (content or "").strip()
        if text.startswith("```"):
            text = text.strip("`").strip()
            if text.startswith("json"):
                text = text[4:].strip()
        start = text.find("{")
        end = text.rfind("}")
        if start == -1 or end == -1 or end < start:
            raise json.JSONDecodeError("No JSON object found", text, 0)
        data = json.loads(text[start : end + 1])
        if not isinstance(data, dict):
            raise TypeError("LLM output must be a JSON object")
        return data