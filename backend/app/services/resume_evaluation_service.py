"""
图二业务规则：简历评估。

职责：
- 加载简历原文
- AI 结构化画像
- 加载候选岗位（Redis 优先）
- 严格校验岗位全名与员工归属
- 通过 evaluation_graph.arun 跑深度评估（维度+技能匹配+加权打分）
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
from app.llm.graphs.evaluation_graph import EvaluationState, arun as run_evaluation_graph
from app.llm.graphs.workflows.context import WorkflowRuntimeContext
from app.llm.model_router import LLMModelRouter
from app.llm.prompts.prompts import prompt_manager as _pm
from app.repositories.evaluation_repository import EvalRepository
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
        eval_repo: EvalRepository,
        cache: CacheService,
    ) -> None:
        self._router = model_router
        self._loader = resume_loader
        self._job_repo = job_repo
        self._eval_repo = eval_repo
        self._cache = cache

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
        """AI 分析简历画像；空简历跳过 LLM 调用直接返回空画像。

        空简历路径（解析失败/未上传）下不浪费一次 LLM 调用，由 graph 的条件边
        短路到 END，不再走 load_job_candidates 及后续节点。
        """
        resume_text = str(state.get("resume_text") or "")
        if not resume_text.strip():
            logger.info("简历原文为空，跳过画像分析：session_id=%s", ctx.session_id)
            return {"resume_profile": {}}
        prompt = _pm.render("resume_evaluation/profile_analyze", resume_text=resume_text)
        # 静默调用：画像 JSON 是内部结构化数据，不该当正文流式展示给用户。
        # 用户在步骤条看到"正在结构化解析简历…"即可，避免裸 JSON 泄露。
        text = await self._call_llm_silently(prompt, ctx)
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
        """严格校验岗位全名与员工归属，返回完整岗位信息（含评估所需 template_id/description）。"""
        name = str(state.get("selected_job_name") or "").strip()
        if not name:
            raise ValidationError("岗位名称不能为空")
        jobs = await self._job_repo.get_by_employee(ctx.employee_id)
        match = next((j for j in jobs if str(j.name) == name), None)
        if match is None:
            raise ValidationError(f"未找到岗位 '{name}' 或不属于当前员工")
        # 返回深度评估所需字段：template_id 决定维度/技能，description 参与 prompt
        return {
            "id": match.id,
            "name": match.name,
            "template_id": match.template_id,
            "description": str(match.description or ""),
        }

    async def run_evaluation_subgraph(self, state, ctx: WorkflowRuntimeContext) -> dict:
        """通过 evaluation_graph.arun 跑深度评估（维度+技能匹配+加权打分）。

        岗位的评估模板（template_id）决定维度与技能清单：
        - template_id 为 None → 岗位未配置模板，无法进行深度评估，友好报错阻断
        - dimensions 为空 → 模板无有效维度，同样阻断
        application_id 在子图内仅用于日志/落库，此处用 0 作哨兵（Agent 场景无投递单）。
        """
        job = state.get("job_full") or {}
        template_id = job.get("template_id")
        job_id = int(job.get("id") or 0)
        if not template_id:
            raise ValidationError(
                f"岗位 '{job.get('name')}' 未配置评估模板，无法进行深度评估，请联系管理员配置模板"
            )
        dimensions = await self._eval_repo.get_template_dimensions(int(template_id))
        if not dimensions:
            raise ValidationError(f"评估模板 {template_id} 无有效维度，无法进行深度评估")
        skills = await self._eval_repo.get_template_skills(int(template_id))
        resume_id = int((state.get("resume_ref") or {}).get("resume_id") or 0)
        eval_state = EvaluationState(
            application_id=0,  # Agent 场景无投递单，子图内仅用于日志
            resume_id=resume_id,
            job_id=job_id,
            job_name=str(job.get("name") or ""),
            job_description=str(job.get("description") or ""),
            resume_text=str(state.get("resume_text") or ""),
            dimensions=dimensions,
            skills=skills,
        )
        result = await run_evaluation_graph(eval_state)
        logger.info(
            "深度评估完成：session_id=%s job_id=%s final_score=%.2f",
            ctx.session_id, job_id, result.final_score,
        )
        return {"evaluation_result": result.model_dump(mode="json")}

    async def build_visualization_report(self, state, ctx: WorkflowRuntimeContext) -> dict:
        """组装可视化报告：用 visual_report prompt 把画像+岗位+评估结果合成为前端六段结构。"""
        prompt = _pm.render(
            "resume_evaluation/visual_report",
            resume_profile=json.dumps(state.get("resume_profile") or {}, ensure_ascii=False),
            selected_job=json.dumps(state.get("job_full") or {}, ensure_ascii=False),
            evaluation_result=json.dumps(state.get("evaluation_result") or {}, ensure_ascii=False),
        )
        # 静默调用：报告 JSON 是结构化中间产物，不该当正文流式展示。
        # 最终报告通过 finalize_evaluation_report 节点的 evaluation_report block 输出。
        text = await self._call_llm_silently(prompt, ctx)
        try:
            report = ResumeEvaluationReportDTO.model_validate_json(text).model_dump(mode="json")
        except (ValueError, json.JSONDecodeError):
            # LLM 输出不符合 DTO schema 时兜底：用评估结果原始字段拼装，保证不白屏
            logger.warning("可视化报告 JSON 解析失败，使用兜底拼装")
            eval_result = state.get("evaluation_result") or {}
            report = ResumeEvaluationReportDTO(
                final_score=float(eval_result.get("final_score") or 0),
                final_label=str(eval_result.get("final_label") or ""),
                decision="建议人工复核",
                summary=str(eval_result.get("advantage_comment") or ""),
                match_overview={"advantages": [], "risks": []},
                resume_structure=state.get("resume_profile") or {},
                experience_timeline=[],
                skill_dimensions=[
                    {"dimension_name": d.get("dimension_name"), "score": d.get("score"),
                     "advantage": d.get("advantage"), "disadvantage": d.get("disadvantage")}
                    for d in eval_result.get("dimension_results") or []
                ],
                job_gaps=[],
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

    async def _call_llm_silently(self, prompt: str, ctx: WorkflowRuntimeContext) -> str:
        """静默 LLM 调用：只消费流式输出，不 emit 任何 text/thinking block。

        用于产出结构化 JSON 中间数据的节点（画像分析、可视化报告）：
        这些 JSON 是内部数据，最终通过 evaluation_report block 结构化展示，
        不该把裸 JSON 当正文流式吐给用户。
        步骤条（step.update）仍由 runner 翻译节点 updates 发出，用户能看到进度。
        """
        text_buf: list[str] = []
        try:
            async for chunk in self._router.stream(prompt, ctx.runtime_config):
                if chunk.kind == "text":
                    text_buf.append(chunk.text_delta)
        except Exception:
            logger.exception("LLM 静默调用失败")
        return "".join(text_buf)
