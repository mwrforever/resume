"""面试题生成工作流业务服务（重构中占位，Stage 5 完整实现）。"""

from __future__ import annotations

import asyncio
import json
import logging
import uuid
from typing import Any

from langgraph.config import get_stream_writer

from app.llm.graphs.workflows.context import WorkflowRuntimeContext
from app.llm.model_router import LLMModelRouter
from app.llm.prompts.prompts import prompt_manager as _pm
from app.schemas.agent.dto import (
    InterviewDimensionDTO,
    InterviewQuestionItemDTO,
    InterviewQuestionPlanDTO,
    InterviewQuestionPlanItemDTO,
    InterviewQuestionSetDTO,
)
from app.services.resume_loader import ResumeLoader

logger = logging.getLogger(__name__)

# AI 维度提议失败时的内置兜底维度
BUILTIN_DIMENSIONS: list[dict[str, Any]] = [
    {"name": "算法基础", "reason": "通用必考维度", "source": "builtin"},
    {"name": "工程实践", "reason": "通用必考维度", "source": "builtin"},
    {"name": "系统设计", "reason": "中高级岗位关键维度", "source": "builtin"},
]


class InterviewQuestionService:
    """图一业务规则。"""

    def __init__(self, *, model_router: LLMModelRouter, resume_loader: ResumeLoader) -> None:
        self._router = model_router
        self._loader = resume_loader

    # ---------- 节点入口方法 ----------

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

    async def suggest_dimensions(self, state, ctx: WorkflowRuntimeContext) -> dict:
        """AI 提议维度；失败兜底为内置维度。

        说明：维度提议属于**内部 JSON 生成调用**，不应作为可见文本/思考内容
        推送给前端 UI。这里改为静默调用 LLM，仅当解析成功后通过 interaction
        卡片让用户选择维度。
        """
        prompt = _pm.render("interview_questions/dimension_suggest", resume_text=state["resume_text"])
        text = await self._silent_complete(prompt, ctx)
        dims = self._parse_dimensions(text)
        if not dims:
            logger.warning("AI 维度提议失败/为空，使用内置维度兜底")
            dims = BUILTIN_DIMENSIONS
        return {"suggested_dimensions": dims}

    def build_dimension_interaction(self, state) -> dict:
        """构造维度选择 interaction payload。"""
        return {
            "request_id": f"dim_{uuid.uuid4().hex[:8]}",
            "interaction_type": "dimension_selection",
            "title": "请选择面试重点维度",
            "prompt": "从下列候选维度中选择需要重点考察的（多选）",
            "data": {"candidates": state.get("suggested_dimensions") or []},
        }

    async def build_question_plan(self, state, ctx: WorkflowRuntimeContext) -> dict:
        """AI 生成出题计划。"""
        prompt = _pm.render(
            "interview_questions/question_plan",
            resume_text=state["resume_text"],
            dimensions=json.dumps(state.get("selected_dimensions") or [], ensure_ascii=False),
        )
        # 出题计划同样属于内部 JSON 生成，不向前端 UI 推流
        text = await self._silent_complete(prompt, ctx)
        plan = self._parse_plan(text) or self._fallback_plan(state.get("selected_dimensions") or BUILTIN_DIMENSIONS)
        return {"question_plan": plan}

    def build_plan_interaction(self, state) -> dict:
        """构造计划审批 interaction payload。"""
        return {
            "request_id": f"plan_{uuid.uuid4().hex[:8]}",
            "interaction_type": "plan_approval",
            "title": "请确认出题计划",
            "prompt": "审阅维度分布与题量，批准或驳回",
            "data": {"plan": state.get("question_plan") or {}},
        }

    async def fanout_generate_questions(self, state, ctx: WorkflowRuntimeContext) -> dict:
        """并发为每个维度生成题目；单分支失败不阻塞其他。"""
        plan: dict = state.get("question_plan") or {}
        items = plan.get("items") or []
        tasks = [self._generate_for_dimension(item, state["resume_text"], ctx) for item in items]
        results = await asyncio.gather(*tasks, return_exceptions=True)
        all_questions: list[dict[str, Any]] = []
        for r in results:
            if isinstance(r, Exception):
                logger.exception("生成单维度题目失败：%s", r)
                continue
            all_questions.extend(r)
        return {"_generated_questions": all_questions}

    async def reduce_questions(self, state, ctx: WorkflowRuntimeContext) -> dict:
        """归并并保证总数在 8-12 之间。"""
        questions: list = list(state.get("_generated_questions") or [])
        if len(questions) > 12:
            questions = questions[:12]
        return {"_generated_questions": questions}

    async def finalize_question_set(self, state, ctx: WorkflowRuntimeContext) -> dict:
        """最终输出面试题清单，emit interview_questions block。"""
        questions = state.get("_generated_questions") or []
        dimensions = sorted({q.get("dimension", "") for q in questions if q.get("dimension")})
        question_set = InterviewQuestionSetDTO(
            total_questions=len(questions),
            dimensions=dimensions,
            questions=[InterviewQuestionItemDTO.model_validate(q) for q in questions],
        ).model_dump(mode="json")

        writer = get_stream_writer()
        idx = ctx.emitter.next_block_index()
        writer(ctx.emitter.emit_block_start(index=idx, block={
            "type": "interview_questions", "question_set": {}, "status": "streaming",
        }))
        writer(ctx.emitter.emit_block_delta(index=idx, delta={"question_set": question_set}))
        writer(ctx.emitter.emit_block_stop(index=idx))
        return {"question_set": question_set}

    # ---------- 内部 ----------

    async def _silent_complete(
        self, prompt: str, ctx: WorkflowRuntimeContext,
    ) -> str:
        """LLM 调用（内部 JSON 生成场景）：不 emit 任何 block 事件，仅返回纯文本。

        为什么需要这条通道：维度提议、出题计划、题目生成都是结构化 JSON 调用，
        其文本是给后端解析用的，不应作为 UI 文本/思考内容推流给前端，否则前端
        会把 JSON 字面量当正文渲染，且会产生空内容的 thinking block。

        采用流式 API 是为了与 stream_text 共用同一 model_router；这里对 chunk
        只累加正文，丢弃 reasoning_content。
        """
        text_buf: list[str] = []
        try:
            async for chunk in self._router.stream(prompt, ctx.runtime_config):
                if chunk.kind == "text":
                    text_buf.append(chunk.text_delta)
        except Exception:
            logger.exception("LLM 内部 JSON 调用失败")
        return "".join(text_buf)

    async def _generate_for_dimension(
        self, plan_item: dict, resume_text: str, ctx: WorkflowRuntimeContext,
    ) -> list[dict[str, Any]]:
        """为单个维度生成题目（内部 JSON 调用，不向前端推流）。"""
        prompt = _pm.render(
            "interview_questions/question_generate",
            dimension=plan_item.get("dimension"),
            question_count=plan_item.get("question_count", 3),
            difficulty=plan_item.get("difficulty", "中等"),
            focus=plan_item.get("focus", ""),
            resume_text=resume_text,
        )
        text = await self._silent_complete(prompt, ctx)
        try:
            parsed = json.loads(text)
            return list(parsed) if isinstance(parsed, list) else []
        except json.JSONDecodeError:
            logger.warning("题目生成 JSON 解析失败")
            return []

    @staticmethod
    def _parse_dimensions(text: str) -> list[dict[str, Any]]:
        """解析 AI 返回的维度列表。"""
        try:
            data = json.loads(text)
            if isinstance(data, list):
                return [InterviewDimensionDTO.model_validate(item).model_dump() for item in data]
        except (json.JSONDecodeError, ValueError):
            pass
        return []

    @staticmethod
    def _parse_plan(text: str) -> dict[str, Any] | None:
        """解析 AI 返回的出题计划。"""
        try:
            return InterviewQuestionPlanDTO.model_validate_json(text).model_dump()
        except (json.JSONDecodeError, ValueError):
            return None

    @staticmethod
    def _fallback_plan(dimensions: list[dict[str, Any]]) -> dict[str, Any]:
        """生成兜底的出题计划。"""
        items = [InterviewQuestionPlanItemDTO(
            dimension=d.get("name", ""), question_count=3, difficulty="中等",
            focus="基础与场景结合",
        ) for d in dimensions[:3]]
        return InterviewQuestionPlanDTO(
            total_questions=sum(it.question_count for it in items),
            items=items, summary="兜底计划",
        ).model_dump()
