"""简历评估工作流业务服务。"""

from __future__ import annotations

import json
import logging
from pathlib import Path
from typing import Any

import yaml

from app.core.exceptions import ForbiddenError, NotFoundError, ValidationError
from app.llm.model_router import LLMModelRouter
from app.llm.prompts.manager import prompt_manager
from app.repositories.job_repository import JobRepository
from app.schemas.agent.dto import LLMRuntimeConfigDTO, ResumeEvaluationReportDTO
from app.services.agent_resume_pipeline_service import AgentResumePipelineService
from app.llm.graphs.workflows._ctx import get_thinking_queue
from app.llm.streaming.emitter import AgentStreamEmitter
from app.schemas.agent.stream import (
    AgentNodeId,
    AgentStreamEventType,
    ThinkingStatusPayload,
    ThinkingStreamPayload,
)

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

    async def load_job_candidates(self, *, employee_id: int) -> list[dict[str, Any]]:
        """加载员工的已发布岗位列表，供前端岗位选择交互使用。

        Args:
            employee_id: 当前员工 ID

        Returns:
            list[dict[str, Any]]: 岗位候选列表，每项包含 id/job_id/name/job_name/source
        """
        jobs = await self._job_repo.get_by_employee(employee_id)
        return [
            {
                "id": int(getattr(job, "id", 0)),
                "job_id": int(getattr(job, "id", 0)),
                "name": str(getattr(job, "name", "") or ""),
                "job_name": str(getattr(job, "name", "") or ""),
                "description": str(getattr(job, "description", "") or ""),
                "source": "hr_requirement",
            }
            for job in jobs
            if getattr(job, "status", 0) == 1
        ]

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
        job = None
        if job_id and job_id > 0:
            job = await self._job_repo.get_by_id(job_id)
        if not job and job_name.strip():
            job = await self._job_repo.get_by_name(employee_id, job_name.strip())
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
        prompt = prompt_manager.render("resume_evaluation/profile_analyze", resume_text=resume_text[:120000])
        # 启用思考模式时通过 ContextVar 队列推送 thinking 事件，前端可实时看到模型推理过程
        result = await self._complete_with_thinking(prompt, runtime_config, label="分析简历画像")
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
        prompt = prompt_manager.render("resume_evaluation/visual_report",
            resume_profile=json.dumps(resume_profile, ensure_ascii=False),
            selected_job=json.dumps(selected_job, ensure_ascii=False),
            evaluation_result=json.dumps(evaluation_result, ensure_ascii=False),
        )
        try:
            result = await self._complete_with_thinking(prompt, runtime_config, label="生成可视化评估报告")
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

    # _render_prompt 已废弃，统一使用 prompt_manager.render()

    @staticmethod
    async def _complete_with_thinking(self, prompt: str, runtime_config: LLMRuntimeConfigDTO, *, label: str) -> Any:
        """
        启用思考模式时把 LLM 流式增量转为 thinking 事件推入请求级队列；否则保持原 complete 行为。

        Args:
            prompt: 拼装后的 prompt 文本
            runtime_config: LLM 运行配置
            label: 思考面板标题，用于前端区分本次思考流（如"分析简历画像"）

        Returns:
            含 `.content` 属性的结果对象
        """
        queue = get_thinking_queue()
        if not bool(getattr(runtime_config, "enable_thinking", False)) or queue is None:
            return await self._model_router.complete(prompt, runtime_config)

        emitter = AgentStreamEmitter(session_id=0, session_key="thinking-local", workflow_type="resume_evaluation")
        message_id = emitter.run_id
        await queue.put(
            emitter.emit(
                event=AgentStreamEventType.THINKING_STATUS,
                node_id=AgentNodeId.RESUME_EVALUATION,
                payload=ThinkingStatusPayload(message_id=message_id, status="started", title=label),
            )
        )
        accumulated_parts: list[str] = []
        try:
            async for chunk in self._model_router.stream(prompt, runtime_config):
                delta = str(getattr(chunk, "delta", "") or "")
                if delta:
                    accumulated_parts.append(delta)
                    await queue.put(
                        emitter.emit(
                            event=AgentStreamEventType.THINKING_STREAM,
                            node_id=AgentNodeId.RESUME_EVALUATION,
                            payload=ThinkingStreamPayload(message_id=message_id, delta=delta),
                        )
                    )
                final_result = getattr(chunk, "result", None)
                if final_result is not None:
                    await queue.put(
                        emitter.emit(
                            event=AgentStreamEventType.THINKING_STATUS,
                            node_id=AgentNodeId.RESUME_EVALUATION,
                            payload=ThinkingStatusPayload(message_id=message_id, status="completed", title=label),
                        )
                    )
                    return final_result
        except Exception:
            await queue.put(
                emitter.emit(
                    event=AgentStreamEventType.THINKING_STATUS,
                    node_id=AgentNodeId.RESUME_EVALUATION,
                    payload=ThinkingStatusPayload(message_id=message_id, status="unavailable", title=label),
                )
            )
            raise

        await queue.put(
            emitter.emit(
                event=AgentStreamEventType.THINKING_STATUS,
                node_id=AgentNodeId.RESUME_EVALUATION,
                payload=ThinkingStatusPayload(message_id=message_id, status="completed", title=label),
            )
        )

        class _LocalResult:
            __slots__ = ("content",)
            def __init__(self, content: str) -> None: self.content = content
        return _LocalResult("".join(accumulated_parts))
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