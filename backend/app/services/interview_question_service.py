"""面试题生成工作流业务服务。

职责：
- 维度提议、出题计划、题目生成（图一三个核心 LLM 调用）
- 全部经由可流式的 thinking/text 通道，思考模式开启时把 reasoning_content
  推到 thinking block，正文累加到内部 buffer 用于 JSON 解析（默认不
  emit 给前端，避免 JSON 字面量变成正文，但 thinking 仍然展示）
- 解析 LLM 输出时容忍三种形态：顶层 list / 顶层 obj / Markdown 代码块包裹

不做：状态机编排（在 graph 节点里）、消息落库（在 AgentRuntimeService）。
"""

from __future__ import annotations

import asyncio
import json
import logging
import re
import uuid
from typing import Any

from langgraph.config import get_stream_writer
from langgraph.types import interrupt

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

# 抽取首段 JSON：兼容 LLM 输出被 Markdown 代码块或额外说明文字包裹的常见情况
# 贪婪匹配最外层括号；优先抓 {...}，其次 [...]
_JSON_OBJECT_PATTERN = re.compile(r"\{.*\}", re.DOTALL)
_JSON_ARRAY_PATTERN = re.compile(r"\[.*\]", re.DOTALL)

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

    def build_resume_upload_interaction(self) -> dict:
        """构造简历上传 interaction payload（缺简历时 interrupt 用）。

        用户上传后提交 {file_path, file_name}，由 graph resume 回到 load_resume
        节点重跑，interrupt() 第二次调用直接返回该值，随后走正常解析。
        """
        return {
            "request_id": f"resume_{uuid.uuid4().hex[:8]}",
            "interaction_type": "resume_upload",
            "title": "需要先上传一份简历",
            "prompt": "检测到尚未附带简历文件。面试题生成需要基于简历内容，请上传后继续（上传后自动续接，无需重新发送）。",
            "data": {},
        }

    async def load_resume(self, state, ctx: WorkflowRuntimeContext) -> dict:
        """按 file_path 解析简历原文；缺简历时 interrupt 弹上传卡，上传后续接解析。

        解析结果进 state.resume_text，同 task 内由 checkpoint 复用（无 Redis 缓存）。
        """
        writer = get_stream_writer()
        idx = ctx.emitter.next_block_index()
        file_path = str((state.get("resume_ref") or {}).get("file_path") or "")
        # 缺简历 → 循环 interrupt 弹上传卡，直到拿到合法 file_path 再往下走。
        # 续接路径下（Q3：发新消息时 Command(resume=驳回信号) 喂回 interrupt），
        # 收到的可能是 {regenerate, feedback} 而非 {file_path}；resume_upload 节点
        # 没有"驳回重推"语义，必须再次 interrupt 让用户真正上传文件。
        while not file_path:
            user_values = interrupt(self.build_resume_upload_interaction())
            if isinstance(user_values, dict):
                file_path = str(user_values.get("file_path") or "")
        writer(ctx.emitter.emit_block_start(index=idx, block={
            "type": "tool_use", "tool_name": "load_resume",
            "display_name": "读取简历", "input": {"file_path": file_path}, "status": "running",
        }))
        try:
            text = await self._loader.load_by_path(file_path=file_path)
        finally:
            writer(ctx.emitter.emit_block_stop(index=idx))
        return {"resume_text": text, "resume_ref": {"file_path": file_path}}

    async def suggest_dimensions(self, state, ctx: WorkflowRuntimeContext) -> dict:
        """AI 提议维度；支持驳回循环（已采纳保留 + 已否决替换 + 反馈优先）。

        驳回循环过程态字段（来自 _request_dimension_selection 写入）：
        - state.dimension_feedback: 用户对未采纳部分的文本反馈
        - state.accepted_dimensions: 用户已勾选的维度（必须 1:1 保留）
        - state.rejected_dimensions: 用户未勾选的维度（必须替换为新建议）

        返回时重置上述三个过程态字段为空，避免下一轮误用。
        """
        # 取驳回过程态
        user_feedback = (state.get("dimension_feedback") or "").strip() or None
        accepted = state.get("accepted_dimensions") or []
        rejected = state.get("rejected_dimensions") or []
        accepted_json = (
            json.dumps(
                [{"name": d.get("name"), "reason": d.get("reason")} for d in accepted],
                ensure_ascii=False,
            )
            if accepted else None
        )
        rejected_json = (
            json.dumps(
                [{"name": d.get("name"), "reason": d.get("reason")} for d in rejected],
                ensure_ascii=False,
            )
            if rejected else None
        )

        prompt = _pm.render(
            "interview_questions/dimension_suggest",
            resume_text=state.get("resume_text") or "",
            user_intent=self._extract_user_intent(state),
            user_feedback=user_feedback,
            accepted_dimensions=accepted_json,
            rejected_dimensions=rejected_json,
        )
        text = await self._stream_with_thinking(
            prompt, ctx, stage_label="分析维度", raise_on_error=True,
        )
        dims = self._parse_dimensions(text)
        if not dims:
            logger.warning(
                "AI 维度提议解析为空，使用内置维度兜底；原始返回前 200 字：%s",
                text[:200].replace("\n", " "),
            )
            # LLM 调用成功但内容解析失败（如格式不符）→ 用内置维度兜底（非调用失败）。
            # 用 list() 浅拷贝：避免后续防御性 dims.insert 原地污染模块级 BUILTIN_DIMENSIONS 常量
            dims = list(BUILTIN_DIMENSIONS)

        # 防御性兜底：LLM 偶尔不遵守"保留 accepted"约束 → 后端强制注入
        # 检查 accepted 中每一项是否在 dims 里出现，未出现则插入到队首
        if accepted:
            dim_names = {d.get("name") for d in dims}
            for acc in accepted:
                acc_name = acc.get("name")
                if acc_name and acc_name not in dim_names:
                    dims.insert(0, {
                        "name": acc_name,
                        "reason": acc.get("reason", ""),
                        "source": "ai",
                    })
                    logger.info("LLM 漏保留已采纳维度，强制注入：%s", acc_name)

        # 重置驳回过程态：用过即清，避免下一轮误用
        return {
            "suggested_dimensions": dims,
            "dimension_feedback": "",
            "accepted_dimensions": [],
            "rejected_dimensions": [],
        }

    def build_dimension_interaction(self, state) -> dict:
        """构造维度选择 interaction payload。"""
        return {
            "request_id": f"dim_{uuid.uuid4().hex[:8]}",
            "interaction_type": "dimension_selection",
            "title": "请选择面试重点维度",
            "prompt": "从下列候选维度中选择需要重点考察的（多选），可在下方补充意见或追加维度",
            "data": {"candidates": state.get("suggested_dimensions") or []},
        }

    async def build_question_plan(self, state, ctx: WorkflowRuntimeContext) -> dict:
        """AI 生成出题计划。

        review_feedback 来自上一轮 plan_approval 驳回时透传的反馈；
        previous_plan 是上一轮被驳回的计划本体（去掉 _feedback 字段后的 JSON），
        作为对比基线让 LLM 知道"哪个被驳回了"，避免原样复用；
        user_intent 透传维度卡片提交时的"补充意见"或首条用户消息。
        """
        question_plan = state.get("question_plan") or {}
        review_feedback = str(question_plan.get("_feedback") or "").strip() or None
        # 上一轮计划作对比基线（去掉 _feedback，仅取业务字段）；仅驳回循环时传
        previous_plan_json = None
        if review_feedback and question_plan:
            clean_plan = {k: v for k, v in question_plan.items() if k != "_feedback"}
            if clean_plan:
                previous_plan_json = json.dumps(clean_plan, ensure_ascii=False)
        prompt = _pm.render(
            "interview_questions/question_plan",
            resume_text=state.get("resume_text") or "",
            selected_dimensions=json.dumps(
                state.get("selected_dimensions") or [], ensure_ascii=False,
            ),
            user_intent=(
                state.get("dimension_feedback")
                or self._extract_user_intent(state)
                or None
            ),
            review_feedback=review_feedback,
            previous_plan=previous_plan_json,
        )
        text = await self._stream_with_thinking(
            prompt, ctx, stage_label="规划出题", raise_on_error=True,
        )
        plan = self._parse_plan(text) or self._fallback_plan(
            state.get("selected_dimensions") or BUILTIN_DIMENSIONS,
        )
        return {"question_plan": plan}

    def build_plan_interaction(self, state) -> dict:
        """构造计划审批 interaction payload。"""
        return {
            "request_id": f"plan_{uuid.uuid4().hex[:8]}",
            "interaction_type": "plan_approval",
            "title": "请确认出题计划",
            "prompt": "审阅维度分布与题量，可直接编辑后批准或填写反馈驳回",
            "data": {"plan": state.get("question_plan") or {}},
        }

    async def fanout_generate_questions(self, state, ctx: WorkflowRuntimeContext) -> dict:
        """并发为每个维度生成题目；单分支失败不阻塞其他。

        为每个维度预分配一个 tool_use 进度 block，让前端在并行生成期间
        能看到每个维度的运行状态（BUG-2：fanout 期间无反馈）。
        """
        writer = get_stream_writer()
        plan: dict = state.get("question_plan") or {}
        items = plan.get("items") or []
        if not items:
            return {"generated_questions": []}
        # 预分配每个维度对应的 tool_use block index，在并发任务里复用
        dim_indices = {i: ctx.emitter.next_block_index() for i in range(len(items))}
        for i, item in enumerate(items):
            dim_name = str(item.get("dimension") or f"维度{i + 1}")
            writer(ctx.emitter.emit_block_start(index=dim_indices[i], block={
                "type": "tool_use", "tool_name": "generate_questions",
                "display_name": f"生成【{dim_name}】题目",
                "input": {"dimension": dim_name, "count": item.get("question_count")},
                "status": "streaming",
            }))
        # 一次 fanout 内的所有 LLM 调用共享 ctx；单维度异常被 gather 捕获
        tasks = [
            self._generate_for_dimension(item, state["resume_text"], ctx, dim_indices[i])
            for i, item in enumerate(items)
        ]
        results = await asyncio.gather(*tasks, return_exceptions=True)
        all_questions: list[dict[str, Any]] = []
        for i, r in enumerate(results):
            if isinstance(r, Exception):
                logger.exception("生成单维度题目失败：%s", r)
                writer(ctx.emitter.emit_block_delta(index=dim_indices[i], delta={
                    "status": "failed", "error": str(r),
                }))
                writer(ctx.emitter.emit_block_stop(index=dim_indices[i]))
                continue
            all_questions.extend(r)
            writer(ctx.emitter.emit_block_delta(index=dim_indices[i], delta={
                "status": "success", "output": {"count": len(r)},
            }))
            writer(ctx.emitter.emit_block_stop(index=dim_indices[i]))
        return {"generated_questions": all_questions}

    async def reduce_questions(self, state, ctx: WorkflowRuntimeContext) -> dict:
        """归并并保证总数在 8-12 之间。"""
        questions: list = list(state.get("generated_questions") or [])
        if len(questions) > 12:
            questions = questions[:12]
        return {"generated_questions": questions}

    async def finalize_question_set(self, state, ctx: WorkflowRuntimeContext) -> dict:
        """最终输出面试题清单，emit interview_questions block。"""
        questions = state.get("generated_questions") or []
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

    async def _stream_with_thinking(
        self, prompt: str, ctx: WorkflowRuntimeContext,
        *,
        stage_label: str | None = None, block_index: int | None = None,
        raise_on_error: bool = False,
    ) -> str:
        """LLM 流式调用：思考模式开启时把 reasoning_content 写入指定载体；
        text 正文不 emit（结构化 JSON 不当作正文展示），仅累加返回。

        归位策略（二选一，由调用方指定）：
        - stage_label：阶段级节点的思考写入一个新分配的 tool_use 块（display_name
          为该阶段中文名）。块会随消息持久化，run 结束后历史消息里仍可展开查看。
        - block_index：维度级思考写入该维度预分配的 tool_use 块（fanout 各归各位）。

        错误处理（raise_on_error）：
        - True（核心节点：维度提议 / 出题计划 / 单维度出题）：LLM 重试+fallback 全部
          失败后，把承载块标记为 failed 并**向上抛出异常**。核心节点的异常会被 graph
          冒泡、Service 层 emit run.error 中断整个流程；fanout 单维度的异常则被
          asyncio.gather(return_exceptions=True) 隔离，仅标记该维度失败不拖垮其他维度。
        - False（保留旧行为）：吞掉异常返回已累积文本，由调用方走兜底逻辑。

        与 ResumeEvaluationService._stream_text_with_optional_thinking 的差异：
        本通道不为正文创建 text block——这里的 text 是结构化 JSON，会被后端
        解析后通过 dimension_selection / plan_approval / interview_questions 等
        专用 block 呈现，不能直接渲染为正文。
        """
        if not ctx.runtime_config.enable_thinking:
            # 关闭思考：静默消费，不 emit 任何 reasoning
            text_buf: list[str] = []
            try:
                async for chunk in self._router.stream(prompt, ctx.runtime_config):
                    if chunk.kind == "text":
                        text_buf.append(chunk.text_delta)
            except Exception:
                logger.exception("LLM 内部 JSON 调用失败（stage=%s）", stage_label)
                if raise_on_error:
                    # 核心节点：失败即上抛，由上层中断流程并提示，不再返回空串走假兜底
                    raise
            return "".join(text_buf)

        writer = get_stream_writer()
        text_parts: list[str] = []
        thinking_parts: list[str] = []

        # 阶级思考：新分配一个 tool_use 块承载（display_name 用阶段中文名）
        stage_idx: int | None = None
        if stage_label is not None and block_index is None:
            stage_idx = ctx.emitter.next_block_index()
            writer(ctx.emitter.emit_block_start(index=stage_idx, block={
                "type": "tool_use", "tool_name": "thinking",
                "display_name": stage_label,
                "input": {}, "status": "streaming",
            }))
        target_idx = stage_idx if stage_idx is not None else block_index

        def _emit_reasoning_delta(delta: str) -> None:
            """把思考增量写入目标 tool_use 块。"""
            if target_idx is not None:
                writer(ctx.emitter.emit_block_delta(
                    index=target_idx, delta={"reasoning": delta},
                ))

        try:
            async for chunk in self._router.stream(prompt, ctx.runtime_config):
                if chunk.kind == "thinking":
                    thinking_parts.append(chunk.text_delta)
                    _emit_reasoning_delta(chunk.text_delta)
                elif chunk.kind == "text":
                    text_parts.append(chunk.text_delta)
        except Exception as exc:
            logger.exception("LLM 内部 JSON 调用失败（stage=%s）", stage_label)
            if raise_on_error:
                # 仅标记**本方法创建**的 stage 块为 failed（前端显示红色错误）；
                # 借用调用方的 block_index（fanout 维度块）时不在此标记，
                # 交由调用方（fanout 异常处理器）统一收尾，避免重复 emit。
                if stage_idx is not None:
                    writer(ctx.emitter.emit_block_delta(index=stage_idx, delta={
                        "status": "failed", "error": str(exc),
                    }))
                    writer(ctx.emitter.emit_block_stop(index=stage_idx))
                raise
        # 兜底：开启思考但模型未返回任何 reasoning_content，emit 一条提示
        if not "".join(thinking_parts).strip():
            _emit_reasoning_delta("（当前模型未返回推理过程）")
        # 阶段块收尾：streaming → success（让前端 ToolUseBlock 显示绿勾）
        if stage_idx is not None:
            writer(ctx.emitter.emit_block_stop(index=stage_idx))
        return "".join(text_parts)

    async def _generate_for_dimension(
        self, plan_item: dict, resume_text: str, ctx: WorkflowRuntimeContext,
        block_index: int,
    ) -> list[dict[str, Any]]:
        """为单个维度生成题目，思考写入该维度预分配的 tool_use 块（block_index）。

        模板要求 LLM 输出 {"questions": [...]}，此处对三种形态做归一化：
        顶层 list、顶层 {questions: [...]}、Markdown 代码块包裹。
        """
        prompt = _pm.render(
            "interview_questions/question_generate",
            resume_text=resume_text,
            plan_item=json.dumps(plan_item, ensure_ascii=False),
        )
        # raise_on_error=True：单维度 LLM 失败时上抛，由 fanout 的 gather 隔离，
        # 仅标记该维度失败，不拖垮其他并行维度（核心错误语义见 _stream_with_thinking）。
        text = await self._stream_with_thinking(
            prompt, ctx, block_index=block_index, raise_on_error=True,
        )
        questions = self._parse_questions(text)
        if not questions:
            # 解析空主因：LLM 输出被 max_tokens 截断导致 JSON 不完整。继续返回 []
            # 会让 fanout 静默丢失整个维度（block 仍标 success，HR 看不出来），
            # 改为上抛 → fanout gather 捕获 → 该维度块标 failed，HR 可见可重试。
            logger.warning(
                "题目生成 JSON 解析失败：dimension=%s，原始返回前 200 字：%s",
                plan_item.get("dimension"), text[:200].replace("\n", " "),
            )
            raise ValueError(
                f"维度「{plan_item.get('dimension')}」题目生成失败："
                "模型返回无法解析（可能被 max_tokens 截断），请重试或提高模型 max_tokens"
            )
        return questions

    @staticmethod
    def _try_load_json(text: str) -> Any | None:
        """容错解析：先尝试整体 json.loads；失败时从文本中抢救首段 {} 或 []。

        LLM 即使被指令"只输出 JSON"，仍可能输出 ```json ... ``` 代码块或
        附带一段说明文字。在解析侧做归一化比改 prompt 更稳。
        """
        if not text:
            return None
        try:
            return json.loads(text)
        except (json.JSONDecodeError, ValueError):
            pass
        # 优先匹配对象（{}），覆盖大部分包装形态；其次匹配数组（[]）
        for pattern in (_JSON_OBJECT_PATTERN, _JSON_ARRAY_PATTERN):
            m = pattern.search(text)
            if not m:
                continue
            try:
                return json.loads(m.group(0))
            except (json.JSONDecodeError, ValueError):
                continue
        return None

    @classmethod
    def _parse_dimensions(cls, text: str) -> list[dict[str, Any]]:
        """解析 AI 返回的维度列表。

        三种形态：
        1) 顶层 list：[{"name": ..., "reason": ...}, ...]
        2) 顶层 obj：{"dimensions": [...]}（dimension_suggest.yaml 当前模板）
        3) Markdown 代码块包裹的以上两种
        """
        data = cls._try_load_json(text)
        if data is None:
            return []
        # 顶层对象时取 dimensions 字段
        if isinstance(data, dict):
            data = data.get("dimensions") or data.get("items") or []
        if not isinstance(data, list):
            return []
        result: list[dict[str, Any]] = []
        for item in data:
            if not isinstance(item, dict):
                continue
            try:
                result.append(InterviewDimensionDTO.model_validate(item).model_dump())
            except (ValueError, TypeError):
                # 单条不合规则丢弃，不阻塞其他维度
                continue
        return result

    @classmethod
    def _parse_plan(cls, text: str) -> dict[str, Any] | None:
        """解析 AI 返回的出题计划，兼容 Markdown 代码块包裹。"""
        data = cls._try_load_json(text)
        if not isinstance(data, dict):
            return None
        try:
            return InterviewQuestionPlanDTO.model_validate(data).model_dump()
        except (ValueError, TypeError):
            return None

    @classmethod
    def _parse_questions(cls, text: str) -> list[dict[str, Any]]:
        """解析 AI 返回的题目列表。

        三种形态：顶层 list、顶层 {"questions": [...]}、Markdown 代码块包裹。
        """
        data = cls._try_load_json(text)
        if data is None:
            return []
        if isinstance(data, dict):
            data = data.get("questions") or data.get("items") or []
        if not isinstance(data, list):
            return []
        return [item for item in data if isinstance(item, dict)]

    @staticmethod
    def _extract_user_intent(state) -> str | None:
        """从 state 中提取本次用户意图（首条用户消息内容），用于 prompt 注入。

        runner.py 已把消息内容透传到 state["user_message"] 中（如未来扩展），
        当前 state schema 暂未包含；这里防御性地从可选字段读取，缺失返回 None。
        """
        intent = state.get("user_intent") if hasattr(state, "get") else None
        if intent and isinstance(intent, str):
            return intent.strip() or None
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
