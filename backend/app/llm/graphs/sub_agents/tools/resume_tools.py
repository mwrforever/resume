"""ResumeAgent tools for loading and formatting resume context."""

from __future__ import annotations

import json
import logging
import uuid
from pathlib import Path
from typing import Annotated, Any

from langchain_core.tools import BaseTool, tool
from langgraph.prebuilt import InjectedState

from app.core.exceptions import ValidationError
from app.llm.graphs.coordinator.state import AgentRuntimeState
from app.llm.graphs.sub_agents.tools._streaming import emit_custom
from app.llm.model_router import LLMModelRouter
from app.schemas.agent.dto import LLMRuntimeConfigDTO
from app.services.agent_resume_pipeline_service import AgentResumePipelineService
from app.utils.resume_parser import extract_resume_text

logger = logging.getLogger(__name__)

ERROR_RESUME_DISABLED = "\u7b80\u5386\u80fd\u529b\u672a\u542f\u7528"
ERROR_RESUME_REF_MISSING = "\u5f53\u524d\u4f1a\u8bdd\u672a\u7ed1\u5b9a\u7b80\u5386\u9644\u4ef6"
ERROR_RESUME_TEXT_MISSING = "\u7b80\u5386\u539f\u6587\u4e3a\u7a7a"
RESUME_CONTEXT_TITLE = "\u7b80\u5386\u539f\u6587\u5df2\u52a0\u8f7d"
RESUME_MARKDOWN_TITLE = "\u7b80\u5386 Markdown \u5df2\u751f\u6210"


def _runtime_config_from_state(state: AgentRuntimeState) -> LLMRuntimeConfigDTO:
    """Build an LLM runtime DTO from injected graph state."""
    return LLMRuntimeConfigDTO.model_validate(state.get("runtime_config") or {})


def _resume_ref(state: AgentRuntimeState) -> dict[str, Any] | None:
    """Return resume reference from injected graph state."""
    resume_ref = state.get("resume_ref")
    return resume_ref if isinstance(resume_ref, dict) else None


def build_resume_tools(
    pipeline: AgentResumePipelineService | None,
    model_router: LLMModelRouter,
) -> list[BaseTool]:
    """Build ResumeAgent LangChain tools."""

    @tool("load_resume_context")
    async def load_resume_context(state: Annotated[AgentRuntimeState, InjectedState]) -> str:
        """Load the current session resume raw text and emit a resume-context data card."""
        if not pipeline:
            return json.dumps({"error": ERROR_RESUME_DISABLED}, ensure_ascii=False)
        resume_ref = _resume_ref(state)
        if not resume_ref:
            return json.dumps({"error": ERROR_RESUME_REF_MISSING}, ensure_ascii=False)

        context = await pipeline.load_resume_context(
            resume_id=int(resume_ref["resume_id"]),
            job_id=int(resume_ref["job_id"]) if resume_ref.get("job_id") is not None else None,
            employee_id=int(state["employee_id"]),
        )
        raw_text = (context.raw_text or "").strip()
        if not raw_text and context.file_path:
            # 将存储相对路径解析为本地绝对路径后读取
            full_path = AgentResumePipelineService.resolve_resume_file_path(context.file_path)
            raw_text = extract_resume_text(full_path).strip()
            await pipeline.persist_raw_text(context.resume_id, raw_text)
        if not raw_text:
            return json.dumps({"error": ERROR_RESUME_TEXT_MISSING}, ensure_ascii=False)

        emit_custom(
            "data_card",
            {
                "card_id": uuid.uuid4().hex,
                "card_type": "resume_context",
                "title": RESUME_CONTEXT_TITLE,
                "summary": context.file_name,
                "body": {
                    "resume_id": context.resume_id,
                    "job_id": context.job_id,
                    "file_name": context.file_name,
                    "raw_text_preview": raw_text[:1200],
                    "raw_text_length": len(raw_text),
                },
            },
        )
        return json.dumps(
            {
                "resume_id": context.resume_id,
                "job_id": context.job_id,
                "file_name": context.file_name,
                "raw_text": raw_text,
            },
            ensure_ascii=False,
        )

    @tool("format_resume_markdown")
    async def format_resume_markdown(
        raw_text: str,
        state: Annotated[AgentRuntimeState, InjectedState],
    ) -> str:
        """Format resume raw text into structured Markdown through the model router."""
        if not pipeline:
            return json.dumps({"error": ERROR_RESUME_DISABLED}, ensure_ascii=False)
        text = (raw_text or "").strip()
        if not text:
            return json.dumps({"error": ERROR_RESUME_TEXT_MISSING}, ensure_ascii=False)

        try:
            markdown = await pipeline.format_structured_markdown(
                raw_text=text,
                runtime_config=_runtime_config_from_state(state),
                model_router=model_router,
            )
        except ValidationError as exc:
            logger.warning("Resume markdown formatting failed: %s", exc.message)
            return json.dumps({"error": exc.message}, ensure_ascii=False)

        emit_custom(
            "data_card",
            {
                "card_id": uuid.uuid4().hex,
                "card_type": "resume_markdown",
                "title": RESUME_MARKDOWN_TITLE,
                "summary": markdown[:120],
                "body": {"markdown": markdown},
            },
        )
        return json.dumps({"markdown": markdown}, ensure_ascii=False)

    return [load_resume_context, format_resume_markdown]
