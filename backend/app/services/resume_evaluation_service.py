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
import re
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

# 占位维度名正则：如"维度1"、"维度 2"（LLM 在 visual_report 步骤可能生成的占位名）
_PLACEHOLDER_DIM_RE = re.compile(r"^\s*维度\s*\d+\s*$")


def _override_dimension_names(report: dict[str, Any], eval_dimension_results: list[dict[str, Any]]) -> None:
    """用评估结果的真实维度名覆盖报告 skill_dimensions 的占位名。

    最终报告是独立 LLM 调用（visual_report prompt），可能输出"维度1/维度2"占位名。
    评估子图的 dimension_results 携带真实 dimension_name（来自 DB 模板），是权威来源。

    对齐策略：
    1. 优先按 dimension_id 精确匹配覆盖；
    2. 报告项缺 dimension_id 或未命中时，仅当报告名是占位（维度N）才按列表顺序兜底覆盖；
    3. eval_dimension_results 为空则不覆盖（保留 LLM 原名）。

    Args:
        report: 可视化报告 dict（含 skill_dimensions），原地修改。
        eval_dimension_results: 评估结果中的维度结果列表（含 dimension_id/dimension_name）。
    """
    if not eval_dimension_results:
        return
    by_id = {
        int(d.get("dimension_id") or 0): d
        for d in eval_dimension_results
        if d.get("dimension_id")
    }
    # 顺序兜底用：尚未被 dimension_id 匹配的评估维度名，按序分配给占位报告项
    fallback_names = [str(d.get("dimension_name") or "") for d in eval_dimension_results]
    fallback_idx = 0
    for sd in report.get("skill_dimensions") or []:
        did = sd.get("dimension_id")
        if did is not None and int(did) in by_id:
            sd["dimension_name"] = by_id[int(did)].get("dimension_name") or sd.get("dimension_name")
            continue
        # 无 id 或未命中：仅当报告名是占位时才用顺序兜底覆盖
        if _PLACEHOLDER_DIM_RE.match(str(sd.get("dimension_name") or "")):
            if fallback_idx < len(fallback_names):
                sd["dimension_name"] = fallback_names[fallback_idx]
                fallback_idx += 1


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
        """按 file_path 解析简历原文，emit tool_use block。

        解析结果进 state.resume_text，同 task 内由 checkpoint 复用（无 Redis 缓存）。
        """
        writer = get_stream_writer()
        idx = ctx.emitter.next_block_index()
        file_path = str((state.get("resume_ref") or {}).get("file_path") or "")
        writer(ctx.emitter.emit_block_start(index=idx, block={
            "type": "tool_use", "tool_name": "load_resume",
            "display_name": "读取简历", "input": {"file_path": file_path}, "status": "running",
        }))
        try:
            text = await self._loader.load_by_path(file_path=file_path) if file_path else ""
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
        # 思考内容（若开启）写入 analyze_resume_profile step，供步骤展开查看。
        text = await self._call_llm_silently(
            prompt, ctx, stage_label="分析画像", raise_on_error=True,
        )
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
        # 思考内容（若开启）写入 build_visualization_report step，供步骤展开查看。
        text = await self._call_llm_silently(
            prompt, ctx, stage_label="组装报告", raise_on_error=True,
        )
        try:
            report = ResumeEvaluationReportDTO.model_validate_json(text).model_dump(mode="json")
            # 兜底：用评估结果的真实维度名覆盖 LLM 可能生成的占位名（维度1/维度2）
            eval_result = state.get("evaluation_result") or {}
            _override_dimension_names(report, eval_result.get("dimension_results") or [])
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
                     "weight": d.get("weight"), "matched_skills": d.get("matched_skills") or [],
                     "comment": f"{d.get('advantage') or ''} {d.get('disadvantage') or ''}".strip(),
                     "advantage": d.get("advantage"), "disadvantage": d.get("disadvantage")}
                    for d in eval_result.get("dimension_results") or []
                ],
                job_gaps=[],
                # 兜底补全新字段：画像用 resume_profile；综合评语复用 advantage/disadvantage_comment
                profile_summary=state.get("resume_profile") or {},
                interview_suggestions=[],
                comprehensive_comment={
                    "advantages": str(eval_result.get("advantage_comment") or ""),
                    "risks": str(eval_result.get("disadvantage_comment") or ""),
                },
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

    async def _call_llm_silently(
        self, prompt: str, ctx: WorkflowRuntimeContext, *, stage_label: str | None = None,
        raise_on_error: bool = False,
    ) -> str:
        """静默 LLM 调用：只消费流式输出，不 emit 任何 text block。

        用于产出结构化 JSON 中间数据的节点（画像分析、可视化报告）：
        这些 JSON 是内部数据，最终通过 evaluation_report block 结构化展示，
        不该把裸 JSON 当正文流式吐给用户。步骤条（step.update）仍由 runner
        翻译节点 tasks 事件发出，用户能看到进度（含运行中/成功/失败）。

        错误处理（raise_on_error）：
        - True（核心节点：画像分析 / 可视化报告）：LLM 重试+fallback 全部失败后，
          把阶段块标记为 failed 并**向上抛出异常**，由 graph 冒泡、Service emit
          run.error 中断流程，不再静默返回空串走假兜底。
        - False（保留旧行为）：吞掉异常返回已累积文本。

        思考内容（若开启且传入 stage_label）：写入一个新分配的 tool_use 块，
        块随消息持久化，run 结束后历史消息里仍可展开查看推理过程。
        """
        text_buf: list[str] = []
        thinking_buf: list[str] = []
        # 阶段思考：开启思考且指定阶段名时，新分配 tool_use 块承载（可持久化）
        stage_idx: int | None = None
        if ctx.runtime_config.enable_thinking and stage_label:
            stage_idx = ctx.emitter.next_block_index()
            writer = get_stream_writer()
            writer(ctx.emitter.emit_block_start(index=stage_idx, block={
                "type": "tool_use", "tool_name": "thinking",
                "display_name": stage_label,
                "input": {}, "status": "streaming",
            }))
        try:
            async for chunk in self._router.stream(prompt, ctx.runtime_config):
                if chunk.kind == "text":
                    text_buf.append(chunk.text_delta)
                elif chunk.kind == "thinking":
                    thinking_buf.append(chunk.text_delta)
                    self._emit_stage_reasoning(ctx, stage_idx, chunk.text_delta)
        except Exception as exc:
            logger.exception("LLM 静默调用失败（stage=%s）", stage_label)
            if raise_on_error:
                # 阶段块标记 failed（前端显示红色错误），再上抛中断流程
                if stage_idx is not None:
                    writer = get_stream_writer()
                    writer(ctx.emitter.emit_block_delta(index=stage_idx, delta={
                        "status": "failed", "error": str(exc),
                    }))
                    writer(ctx.emitter.emit_block_stop(index=stage_idx))
                raise
        # 兜底：开启思考但模型未返回任何 reasoning_content
        if ctx.runtime_config.enable_thinking and stage_label and not "".join(thinking_buf).strip():
            self._emit_stage_reasoning(ctx, stage_idx, "（当前模型未返回推理过程）")
        # 阶段块收尾：streaming → success
        if stage_idx is not None:
            writer = get_stream_writer()
            writer(ctx.emitter.emit_block_stop(index=stage_idx))
        return "".join(text_buf)

    @staticmethod
    def _emit_stage_reasoning(
        ctx: WorkflowRuntimeContext, block_index: int | None, delta: str,
    ) -> None:
        """把思考增量写入指定 tool_use 块（仅当 block_index 非空时调用）。"""
        if block_index is None:
            return
        writer = get_stream_writer()
        writer(ctx.emitter.emit_block_delta(
            index=block_index, delta={"reasoning": delta},
        ))
