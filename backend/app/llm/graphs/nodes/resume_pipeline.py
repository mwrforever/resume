"""简历链路：准备上下文 → 内置工具抽取文本 → Agent 整理 Markdown → Analyst。"""

import logging
from pathlib import Path
from typing import TYPE_CHECKING

from app.core.exceptions import BizError
from app.llm.tools.builtin import builtin_agent_tools
from app.schemas.agent.dto import AgentToolCallDTO
from app.schemas.agent.orchestrator_state import OrchestratorState
if TYPE_CHECKING:
    from app.llm.model_router import LLMModelRouter
    from app.services.agent_resume_pipeline_service import AgentResumePipelineService

logger = logging.getLogger(__name__)


def _fail_to_reporter(message: str) -> dict:
    """统一失败出口：由 Reporter 节点向用户展示错误并结束运行。"""
    return {
        "analysis_ready": False,
        "error_message": message,
        "final_content": message,
    }


async def resume_prepare_node(
    state: OrchestratorState,
    *,
    pipeline: "AgentResumePipelineService",
) -> dict:
    """
    加载简历元数据并校验岗位归属。

    不在此节点抽取文本，原文由下一节点通过内置工具 parse_resume_file 解析。
    """
    ctx = state.resume_context
    if not ctx:
        return _fail_to_reporter("未找到简历附件信息，请重新上传并选择岗位。")

    try:
        loaded = await pipeline.load_resume_context(
            resume_id=ctx.resume_id,
            job_id=ctx.job_id,
            employee_id=state.employee_id,
        )
        logger.info(
            "简历准备完成：session_key=%s resume_id=%s job_id=%s file=%s",
            state.session_key,
            loaded.resume_id,
            loaded.job_id,
            loaded.file_name,
        )
        return {"resume_context": loaded, "error_message": None}
    except BizError as exc:
        logger.warning("简历准备失败：session_key=%s error=%s", state.session_key, exc.message)
        return _fail_to_reporter(exc.message)


async def resume_extract_node(
    state: OrchestratorState,
    *,
    pipeline: "AgentResumePipelineService",
) -> dict:
    """通过内置工具 parse_resume_file 从 PDF/DOCX 抽取原文。"""
    ctx = state.resume_context
    if not ctx or not ctx.file_path.strip():
        return _fail_to_reporter("简历文件路径缺失，无法解析。")

    tool_context = state.tool_context_dict()
    tool_context["resume_attachment"] = {
        "resume_id": ctx.resume_id,
        "file_path": ctx.file_path,
        "file_name": ctx.file_name,
    }
    tool_call = AgentToolCallDTO(
        tool_name="parse_resume_file",
        display_name="解析简历文件（PDF/DOCX）",
        input_payload={"resume_id": ctx.resume_id},
    )
    try:
        tool_result = builtin_agent_tools.execute(tool_call, tool_context)
        if not tool_result.success:
            return _fail_to_reporter(tool_result.error_message or "简历文件解析失败")

        raw_text = str((tool_result.output_payload or {}).get("raw_text") or "").strip()
        if not raw_text:
            return _fail_to_reporter("简历文件未解析到文本内容")

        updated = ctx.model_copy(update={"raw_text": raw_text})
        await pipeline.persist_raw_text(ctx.resume_id, raw_text)

        logger.info(
            "简历工具解析完成：session_key=%s resume_id=%s text_length=%s",
            state.session_key,
            ctx.resume_id,
            len(raw_text),
        )
        return {
            "resume_context": updated,
            "tool_calls": [*state.tool_calls, tool_call],
            "tool_results": [*state.tool_results, tool_result],
            "error_message": None,
        }
    except BizError as exc:
        logger.warning("简历工具解析失败：session_key=%s error=%s", state.session_key, exc.message)
        return _fail_to_reporter(f"简历解析失败：{exc.message}")


async def resume_markdown_node(
    state: OrchestratorState,
    *,
    pipeline: "AgentResumePipelineService",
    model_router: "LLMModelRouter",
) -> dict:
    """Agent：将工具抽取的原文优化为 Markdown 结构化文本。"""
    ctx = state.resume_context
    if not ctx or not ctx.raw_text.strip():
        return _fail_to_reporter("简历原文为空，无法整理为 Markdown。")

    try:
        structured = await pipeline.format_structured_markdown(
            ctx.raw_text,
            state.runtime_config,
            model_router,
        )
        updated = ctx.model_copy(update={"structured_markdown": structured})
        logger.info(
            "简历 Markdown 整理完成：session_key=%s markdown_length=%s",
            state.session_key,
            len(structured),
        )
        return {"resume_context": updated, "error_message": None}
    except BizError as exc:
        logger.warning("简历 Markdown 整理失败：session_key=%s error=%s", state.session_key, exc.message)
        return _fail_to_reporter(f"简历结构化整理失败：{exc.message}")
