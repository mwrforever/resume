"""
图二业务规则：简历评估。

职责：
- 加载简历原文
- AI 结构化画像
- 加载候选岗位（Redis 优先）
- 严格校验岗位全名与员工归属
- 调用 evaluation_subgraph（黑盒复用）
- 组装可视化报告 → evaluation_report block

emit 协议事件统一通过 get_stream_writer + ctx.emitter；
不直接 SQLAlchemy / 不直接 provider client。
"""

from __future__ import annotations

import json
import logging
import uuid
from typing import Any

from langgraph.config import get_stream_writer

from app.core.exceptions import ValidationError
from app.llm.graphs.workflows.context import WorkflowRuntimeContext
from app.llm.model_router import LLMModelRouter
from app.llm.prompts.prompts import prompt_manager as _pm
from app.repositories.job_repository import JobRepository
from app.schemas.agent.dto import ResumeEvaluationReportDTO
from app.services.cache_service import CacheService
from app.services.resume_loader import ResumeLoader

logger = logging.getLogger(__name__)

JOB_CANDIDATES_CACHE_KEY = "agent:job_candidates:{employee_id}"
JOB_CANDIDATES_TTL = 600


class ResumeEvaluationService:
    """图二业务规则。"""

    def __init__(
        self,
        *,
        model_router: LLMModelRouter,
        resume_loader: ResumeLoader,
        job_repo: JobRepository,
        cache: CacheService,
        evaluation_subgraph: Any,
    ) -> None:
        self._router = model_router
        self._loader = resume_loader
        self._job_repo = job_repo
        self._cache = cache
        self._eval_subgraph = evaluation_subgraph

    # ---------- 节点入口 ----------

    async def load_resume(self, state, ctx: WorkflowRuntimeContext) -> dict:
        """读取简历原文，emit tool_use block。"""
        writer = get_stream_writer()
        idx = ctx.emitter.next_block_index()
        resume_id = int((state.get("resume_ref") or {}).get("resume_id") or 0)
        writer(ctx.emitter.emit_block_start(index=idx, block={
            "type": "tool_use", "tool_name": "load_resume",
            "display_name": "读取简历", "input": {"resume_id": resume_id}, "status": "running",
        }))
        try:
            text = await self._loader.load(resume_id=resume_id)
        finally:
            writer(ctx.emitter.emit_block_stop(index=idx))
        return {"resume_text": text}

    async def analyze_resume_profile(self, state, ctx: WorkflowRuntimeContext) -> dict:
        """AI 分析简历画像。"""
        prompt = _pm.render("resume_evaluation/profile_analyze", resume_text=state["resume_text"])
        text, _ = await self._stream_text_with_optional_thinking(prompt, ctx)
        try:
            profile = json.loads(text)
        except json.JSONDecodeError:
            logger.warning("简历画像 JSON 解析失败，使用空对象")
            profile = {}
        return {"resume_profile": profile}

    async def load_job_candidates(self, state, ctx: WorkflowRuntimeContext) -> dict:
        """加载候选岗位列表（Redis 优先）。"""
        writer = get_stream_writer()
        idx = ctx.emitter.next_block_index()
        writer(ctx.emitter.emit_block_start(index=idx, block={
            "type": "tool_use", "tool_name": "fetch_jobs",
            "display_name": "加载候选岗位", "input": {"employee_id": ctx.employee_id}, "status": "running",
        }))
        try:
            key = JOB_CANDIDATES_CACHE_KEY.format(employee_id=ctx.employee_id)
            cached = await self._cache.get_json(key)
            if cached:
                candidates = cached
            else:
                jobs = await self._job_repo.get_by_employee(ctx.employee_id)
                candidates = [{"id": j.id, "name": j.name} for j in jobs[:20]]
                await self._cache.set_json(key, candidates, JOB_CANDIDATES_TTL)
        finally:
            writer(ctx.emitter.emit_block_stop(index=idx))
        return {"job_candidates": candidates}

    def build_job_interaction(self, state) -> dict:
        """构造岗位选择 interaction payload。"""
        return {
            "request_id": f"job_{uuid.uuid4().hex[:8]}",
            "interaction_type": "job_selection",
            "title": "请选择岗位",
            "prompt": "从候选岗位选择，或手动输入完整岗位名称",
            "data": {"candidates": state.get("job_candidates") or []},
        }

    async def validate_job(self, state, ctx: WorkflowRuntimeContext) -> dict[str, Any]:
        """严格校验岗位全名与员工归属。"""
        name = str(state.get("selected_job_name") or "").strip()
        if not name:
            raise ValidationError("岗位名称不能为空")
        jobs = await self._job_repo.get_by_employee(ctx.employee_id)
        match = next((j for j in jobs if str(j.name) == name), None)
        if match is None:
            raise ValidationError(f"未找到岗位 '{name}' 或不属于当前员工")
        return {"id": match.id, "name": match.name}

    async def run_evaluation_subgraph(self, state, ctx: WorkflowRuntimeContext) -> dict:
        """复用既有 evaluation_graph 子图。"""
        eval_input = {
            "resume_text": state["resume_text"],
            "resume_profile": state["resume_profile"],
            "job": state["job_full"],
        }
        result = await self._eval_subgraph.ainvoke(eval_input)
        return {"evaluation_result": result}

    async def build_visualization_report(self, state, ctx: WorkflowRuntimeContext) -> dict:
        """组装可视化报告数据。"""
        eval_result = state.get("evaluation_result") or {}
        report = ResumeEvaluationReportDTO(
            final_score=float(eval_result.get("final_score") or 0),
            final_label=str(eval_result.get("final_label") or ""),
            decision=str(eval_result.get("decision") or ""),
            summary=str(eval_result.get("summary") or ""),
            match_overview=eval_result.get("match_overview") or {},
            resume_structure=state.get("resume_profile") or {},
            experience_timeline=eval_result.get("experience_timeline") or [],
            skill_dimensions=eval_result.get("skill_dimensions") or [],
            job_gaps=eval_result.get("job_gaps") or [],
        ).model_dump(mode="json")
        return {"report": report}

    async def finalize_evaluation_report(self, state, ctx: WorkflowRuntimeContext) -> dict:
        """输出评估报告 block。"""
        writer = get_stream_writer()
        idx = ctx.emitter.next_block_index()
        writer(ctx.emitter.emit_block_start(index=idx, block={
            "type": "evaluation_report", "report": {}, "status": "streaming",
        }))
        writer(ctx.emitter.emit_block_delta(index=idx, delta={"report": state.get("report") or {}}))
        writer(ctx.emitter.emit_block_stop(index=idx))
        return {}

    # ---------- 内部 ----------

    async def _stream_text_with_optional_thinking(self, prompt: str, ctx: WorkflowRuntimeContext) -> tuple[str, str]:
        """LLM 流式调用，按 enable_thinking 分流。"""
        writer = get_stream_writer()
        text_idx = ctx.emitter.next_block_index()
        thinking_idx = None
        if ctx.runtime_config.enable_thinking:
            thinking_idx = ctx.emitter.next_block_index()
            writer(ctx.emitter.emit_block_start(index=thinking_idx, block={"type": "thinking", "text": ""}))
        writer(ctx.emitter.emit_block_start(index=text_idx, block={"type": "text", "text": ""}))
        text_buf: list[str] = []
        thinking_buf: list[str] = []
        try:
            async for chunk in self._router.stream(prompt, ctx.runtime_config):
                if chunk.kind == "thinking" and thinking_idx is not None:
                    writer(ctx.emitter.emit_block_delta(index=thinking_idx, delta={"text_delta": chunk.text_delta}))
                    thinking_buf.append(chunk.text_delta)
                elif chunk.kind == "text":
                    writer(ctx.emitter.emit_block_delta(index=text_idx, delta={"text_delta": chunk.text_delta}))
                    text_buf.append(chunk.text_delta)
        except Exception:
            logger.exception("LLM 流式失败")
        finally:
            if thinking_idx is not None:
                # 兜底：开启思考但模型未返回任何 reasoning_content（BUG-3B）
                if not "".join(thinking_buf).strip():
                    writer(ctx.emitter.emit_block_delta(
                        index=thinking_idx,
                        delta={"text_delta": "（当前模型未返回推理过程）"},
                    ))
                writer(ctx.emitter.emit_block_stop(index=thinking_idx))
            writer(ctx.emitter.emit_block_stop(index=text_idx))
        return "".join(text_buf), "".join(thinking_buf)
