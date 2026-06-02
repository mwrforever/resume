"""简历评估工作流业务服务。"""

from __future__ import annotations

import json
import logging
from pathlib import Path
from typing import Any

import yaml

from app.core.exceptions import ForbiddenError, NotFoundError, ValidationError
from app.llm.model_router import LLMModelRouter
from app.repositories.job_repository import JobRepository
from app.schemas.agent.dto import LLMRuntimeConfigDTO, ResumeEvaluationReportDTO
from app.services.agent_resume_pipeline_service import AgentResumePipelineService

logger = logging.getLogger(__name__)

PROMPT_TEMPLATE_DIR = Path(__file__).resolve().parents[1] / "llm" / "prompts" / "templates"


class ResumeEvaluationWorkflowService:
    """简历评估工作流业务服务，负责岗位校验、报告生成和 JSON block 组装。"""

    def __init__(
        self,
        *,
        model_router: LLMModelRouter | Any,
        resume_pipeline: AgentResumePipelineService | Any,
        job_repo: JobRepository | Any,
    ) -> None:
        """
        初始化简历评估工作流服务。

        Args:
            model_router: LLM 模型路由器
            resume_pipeline: Agent 简历上下文服务
            job_repo: 岗位仓储
        """
        self._model_router = model_router
        self._resume_pipeline = resume_pipeline
        self._job_repo = job_repo

    async def load_resume_text(self, *, employee_id: int, resume_ref: dict[str, Any]) -> str:
        """
        加载简历结构化文本。

        Args:
            employee_id: 当前员工 ID
            resume_ref: 简历引用

        Returns:
            str: 结构化 Markdown 或原始简历文本
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

    async def validate_selected_job(self, *, employee_id: int, job_id: int, job_name: str) -> dict[str, Any]:
        """
        校验用户选择的岗位 ID 与岗位名称严格一致。

        Args:
            employee_id: 当前员工 ID
            job_id: 岗位 ID
            job_name: 用户确认的岗位名称

        Returns:
            dict[str, Any]: 岗位快照
        """
        job = await self._job_repo.get_by_id(job_id)
        if not job:
            raise NotFoundError("岗位不存在")
        if int(getattr(job, "employee_id", 0)) != int(employee_id):
            raise ForbiddenError("无权访问该岗位")
        actual_name = str(getattr(job, "name", "") or "").strip()
        if actual_name != job_name.strip():
            raise ValidationError("岗位名称与岗位ID不匹配，请重新选择岗位")
        return {
            "job_id": int(getattr(job, "id")),
            "job_name": actual_name,
            "description": str(getattr(job, "description", "") or ""),
        }

    async def analyze_resume_profile(self, *, resume_text: str, runtime_config: LLMRuntimeConfigDTO) -> dict[str, Any]:
        """
        生成简历画像结构。

        Args:
            resume_text: 简历文本
            runtime_config: LLM 运行配置

        Returns:
            dict[str, Any]: 简历画像 JSON
        """
        prompt = self._render_prompt("resume_profile_analyze", resume_text=resume_text[:120000])
        result = await self._model_router.complete(prompt, runtime_config)
        return self._parse_json_object(result.content)

    async def build_visual_report(
        self,
        *,
        resume_profile: dict[str, Any],
        selected_job: dict[str, Any],
        evaluation_result: dict[str, Any],
        runtime_config: LLMRuntimeConfigDTO,
    ) -> ResumeEvaluationReportDTO:
        """
        生成前端展示用简历评估报告。

        Args:
            resume_profile: 简历画像
            selected_job: 已严格校验的岗位快照
            evaluation_result: 评估链路结果
            runtime_config: LLM 运行配置

        Returns:
            ResumeEvaluationReportDTO: 评估报告 DTO
        """
        prompt = self._render_prompt(
            "resume_evaluation_visual_report",
            resume_profile=json.dumps(resume_profile, ensure_ascii=False),
            selected_job=json.dumps(selected_job, ensure_ascii=False),
            evaluation_result=json.dumps(evaluation_result, ensure_ascii=False),
        )
        try:
            result = await self._model_router.complete(prompt, runtime_config)
            return ResumeEvaluationReportDTO.model_validate(self._parse_json_object(result.content))
        except (RuntimeError, ValueError, TypeError, KeyError, json.JSONDecodeError):
            logger.warning("Resume evaluation report generation failed, using fallback report", exc_info=True)
            return self._fallback_report(selected_job=selected_job, evaluation_result=evaluation_result)

    def build_report_block(self, report: ResumeEvaluationReportDTO) -> dict[str, Any]:
        """
        构建前端渲染用简历评估报告 block。

        Args:
            report: 简历评估报告

        Returns:
            dict[str, Any]: `agent_message.content.blocks` 中的业务卡片块
        """
        return {"type": "resume_evaluation_report", "report": report.model_dump(mode="json")}

    def _fallback_report(self, *, selected_job: dict[str, Any], evaluation_result: dict[str, Any]) -> ResumeEvaluationReportDTO:
        """
        生成兜底评估报告。

        Args:
            selected_job: 岗位快照
            evaluation_result: 评估链路结果

        Returns:
            ResumeEvaluationReportDTO: 兜底报告
        """
        score = float(evaluation_result.get("final_score") or evaluation_result.get("score") or 0)
        return ResumeEvaluationReportDTO(
            final_score=score,
            final_label=str(evaluation_result.get("final_label") or "待复核"),
            decision=str(evaluation_result.get("decision") or "建议人工复核"),
            summary=f"已完成 {selected_job.get('job_name', '')} 的简历评估，报告生成需要人工复核。",
            match_overview={"advantages": [], "risks": []},
            resume_structure={},
            experience_timeline=[],
            skill_dimensions=[],
            job_gaps=[],
        )

    def _render_prompt(self, template_name: str, **context: str) -> str:
        """
        渲染多字段 YAML Prompt 模板。

        Args:
            template_name: 模板文件名，不含 `.yaml`
            context: 模板变量

        Returns:
            str: 完整 prompt
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