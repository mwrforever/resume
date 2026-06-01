"""EvaluationAgent tools that reuse the evaluation LangGraph subgraph."""

from __future__ import annotations

import json
import logging
import uuid
from pathlib import Path
from typing import Annotated

from langchain_core.tools import BaseTool, tool
from langgraph.prebuilt import InjectedState

from app.core.config import BASE_DIR, get_settings
from app.core.exceptions import NotFoundError, ValidationError
from app.llm.graphs.coordinator.state import AgentRuntimeState
from app.llm.graphs.evaluation_graph import (
    EvaluationDimensionSpec,
    EvaluationSkillSpec,
    EvaluationState,
    arun as run_evaluation_graph,
)
from app.llm.graphs.sub_agents.tools._streaming import emit_custom
from app.repositories.application_repository import ApplicationRepository
from app.repositories.evaluation_repository import EvalRepository
from app.repositories.job_repository import JobRepository
from app.repositories.resume_repository import ResumeRepository
from app.utils.resume_parser import extract_resume_text

logger = logging.getLogger(__name__)

ERROR_EVALUATION_DISABLED = "\u8bc4\u4f30\u80fd\u529b\u672a\u542f\u7528"
ERROR_APPLICATION_NOT_FOUND = "\u6295\u9012\u4e0d\u5b58\u5728"
ERROR_JOB_NOT_FOUND = "\u5c97\u4f4d\u4e0d\u5b58\u5728"
ERROR_RESUME_NOT_FOUND = "\u7b80\u5386\u4e0d\u5b58\u5728"
ERROR_APPLICATION_OUT_OF_SCOPE = "\u6295\u9012\u4e0d\u5728\u5f53\u524d\u5458\u5de5\u4e1a\u52a1\u8303\u56f4\u5185"
ERROR_TEMPLATE_MISSING = "\u5c97\u4f4d\u672a\u7ed1\u5b9a\u8bc4\u4f30\u6a21\u677f"
ERROR_DIMENSIONS_MISSING = "\u8bc4\u4f30\u6a21\u677f\u7ef4\u5ea6\u4e0d\u5b58\u5728"
ERROR_RESUME_TEXT_MISSING = "\u7b80\u5386\u4e0d\u5b58\u5728\u6216\u672a\u89e3\u6790"


def _resolve_resume_path(file_path: str) -> Path:
    """Resolve a stored resume path using the same local-storage rule as Celery."""
    resolved = Path(file_path)
    if resolved.is_absolute():
        return resolved
    settings = get_settings()
    storage_path = Path(settings.LOCAL_STORAGE_PATH)
    if not storage_path.is_absolute():
        storage_path = BASE_DIR / storage_path
    return storage_path / resolved


def build_evaluation_tools(
    app_repo: ApplicationRepository | None,
    job_repo: JobRepository | None,
    eval_repo: EvalRepository | None,
    resume_repo: ResumeRepository | None,
) -> list[BaseTool]:
    """Build EvaluationAgent LangChain tools."""

    @tool("evaluate_application")
    async def evaluate_application(
        application_id: int,
        state: Annotated[AgentRuntimeState, InjectedState],
    ) -> str:
        """Evaluate one application through the reusable evaluation LangGraph."""
        if not all([app_repo, job_repo, eval_repo, resume_repo]):
            return json.dumps({"error": ERROR_EVALUATION_DISABLED}, ensure_ascii=False)

        application = await app_repo.get_by_id(application_id)
        if not application:
            raise NotFoundError(ERROR_APPLICATION_NOT_FOUND)
        business = (state.get("tool_context") or {}).get("business") or {}
        allowed_job_ids = {int(item.get("id")) for item in (business.get("jobs") or []) if isinstance(item, dict) and item.get("id") is not None}
        if int(application.job_id) not in allowed_job_ids:
            raise ValidationError(ERROR_APPLICATION_OUT_OF_SCOPE)

        job = await job_repo.get_by_id(application.job_id)
        if not job:
            raise NotFoundError(ERROR_JOB_NOT_FOUND)
        resume = await resume_repo.get_by_id(application.resume_id)
        if not resume:
            raise NotFoundError(ERROR_RESUME_NOT_FOUND)

        template_id = getattr(job, "template_id", None)
        if not template_id:
            raise ValidationError(ERROR_TEMPLATE_MISSING)
        dimensions = await eval_repo.get_template_dimensions(int(template_id))
        if not dimensions:
            raise NotFoundError(ERROR_DIMENSIONS_MISSING)
        skills = await eval_repo.get_template_skills(int(template_id))

        resume_text = (resume.raw_text or "").strip()
        if not resume_text and resume.file_path:
            resume_path = _resolve_resume_path(resume.file_path)
            if not resume_path.exists():
                raise NotFoundError(ERROR_RESUME_TEXT_MISSING)
            resume_text = extract_resume_text(resume_path).strip()
            if resume_text:
                await resume_repo.update_raw_text(application.resume_id, resume_text)
        if not resume_text:
            raise NotFoundError(ERROR_RESUME_TEXT_MISSING)

        graph_state = EvaluationState(
            application_id=application_id,
            resume_id=application.resume_id,
            job_id=application.job_id,
            job_name=getattr(job, "name", "") or "",
            job_description=getattr(job, "description", "") or "",
            resume_text=resume_text,
            dimensions=[
                EvaluationDimensionSpec(
                    dimension_id=int(item["dimension_id"]),
                    dimension_name=str(item["dimension_name"]),
                    weight=float(item["weight"]),
                    prompt_template=str(item.get("prompt_template") or ""),
                )
                for item in dimensions
            ],
            skills=[
                EvaluationSkillSpec(
                    skill_id=int(item["skill_id"]),
                    skill=str(item["skill"]),
                    type=int(item["type"]),
                )
                for item in skills
            ],
        )
        result = await run_evaluation_graph(graph_state)
        completed = [item for item in result.dimensions if getattr(item, "is_completed", False)]
        if not completed:
            raise ValidationError(ERROR_DIMENSIONS_MISSING)
        match = await eval_repo.get_match_by_application_id(application_id)
        report = {
            "card_id": uuid.uuid4().hex,
            "match_id": match.id if match else None,
            "application_id": application_id,
            "resume_id": application.resume_id,
            "job_id": application.job_id,
            "job_name": getattr(job, "name", "") or "",
            "final_score": result.final_score,
            "final_label": result.final_label,
            "advantage_comment": result.advantage_comment,
            "disadvantage_comment": result.disadvantage_comment,
            "skill_hits": [
                {
                    "skill_id": item.skill_id,
                    "skill_name": item.skill,
                    "is_hit": item.is_hit,
                    "hit_context": item.hit_context,
                }
                for item in result.skill_hits
            ],
            "dimensions": [item.model_dump(mode="json") for item in result.dimensions],
        }
        emit_custom("evaluation_report", report)
        logger.info(
            "EvaluationAgent completed: application_id=%s match_id=%s score=%s",
            application_id,
            report["match_id"],
            result.final_score,
        )
        return json.dumps(report, ensure_ascii=False)

    return [evaluate_application]
