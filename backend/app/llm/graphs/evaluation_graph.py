"""评估 LangGraph 子图。

将原 ResumeEvalChain 拆解为可观测、可串可并的 LangGraph 子图：
`load_context → match_skills → fan_out_dimensions(并行) → reduce_dimensions → comprehensive → finalize`。

Celery 任务通过 `run_sync` 同步调用；Agent EvaluationAgent 通过 `arun` 异步调用。
两者复用同一份编排逻辑，保证业务一致。
"""

from __future__ import annotations

import asyncio
import inspect
import json
import logging
import re
from functools import lru_cache
from typing import Annotated, Any, TypedDict

from jinja2 import TemplateError
from langgraph.graph import END, START, StateGraph
from langgraph.types import Send
from pydantic import BaseModel, ConfigDict, Field

from app.core.exceptions import ValidationError
from app.llm.clients.client import async_llm_complete
from app.llm.prompts.manager import prompt_manager

logger = logging.getLogger(__name__)


# ---------------------------------------------------------------------------
# State 与 DTO
# ---------------------------------------------------------------------------


class EvaluationDimensionSpec(BaseModel):
    """评估模板单维度规约。"""

    model_config = ConfigDict(extra="forbid")

    dimension_id: int
    dimension_name: str
    weight: float
    prompt_template: str = ""


class EvaluationSkillSpec(BaseModel):
    """评估模板单技能规约。"""

    model_config = ConfigDict(extra="forbid")

    skill_id: int
    skill: str
    type: int


class EvaluationDimensionResult(BaseModel):
    """单维度评估结果。"""

    model_config = ConfigDict(extra="forbid")

    dimension_id: int
    dimension_name: str
    score: float
    advantage: str = ""
    disadvantage: str = ""
    is_completed: bool = True
    error_message: str | None = None


class EvaluationSkillHit(BaseModel):
    """单技能命中结果。"""

    model_config = ConfigDict(extra="forbid")

    skill_id: int
    skill: str
    is_hit: bool
    hit_context: str = ""


class EvaluationState(BaseModel):
    """评估子图共享 State。"""

    # LangGraph 内部可能传入额外控制字段（如 __pregel_finish__），允许 ignore
    model_config = ConfigDict(extra="ignore")

    application_id: int
    resume_id: int
    job_id: int
    job_name: str
    job_description: str
    resume_text: str
    dimensions: list[EvaluationDimensionSpec]
    skills: list[EvaluationSkillSpec]

    # 中间产物
    skill_hits: list[EvaluationSkillHit] = Field(default_factory=list)
    dimension_buffer: list[EvaluationDimensionResult] = Field(default_factory=list)
    dimension_results: list[EvaluationDimensionResult] = Field(default_factory=list)
    weighted_score: float = 0.0
    final_score: float = 0.0
    final_label: str = ""
    advantage_comment: str = ""
    disadvantage_comment: str = ""
    error_message: str | None = None


class EvaluationResult(BaseModel):
    """子图最终输出（供 Celery / Agent 暴露）。"""

    model_config = ConfigDict(extra="forbid")

    application_id: int
    resume_id: int
    job_id: int
    skill_hits: list[EvaluationSkillHit]
    dimensions: list[EvaluationDimensionResult]
    weighted_score: float
    final_score: float
    final_label: str
    advantage_comment: str
    disadvantage_comment: str


# ---------------------------------------------------------------------------
# 节点
# ---------------------------------------------------------------------------


_OBJECT_PATTERN = re.compile(r"\{.*\}", re.DOTALL)
_DIMENSION_PLACEHOLDERS = {
    "dimension_name": "{{ dimension_name }}",
    "resume_text": "{{ resume_text }}",
    "job_name": "{{ job_name }}",
    "job_description": "{{ job_description }}",
    "skill_hits": "{{ skill_hits }}",
}


def _parse_object(raw: str) -> dict[str, Any]:
    """从 LLM 输出中提取首段 JSON 对象，失败返回空 dict。"""
    if not raw:
        return {}
    match = _OBJECT_PATTERN.search(raw)
    if not match:
        return {}
    try:
        parsed = json.loads(match.group())
    except json.JSONDecodeError:
        return {}
    return parsed if isinstance(parsed, dict) else {}


def _normalize_score(value: Any) -> float:
    """把任意值归一化到 0-100 之间的 float。"""
    try:
        score = float(value)
    except (TypeError, ValueError):
        return 0.0
    return max(0.0, min(100.0, score))


async def _async_call_llm_json(prompt: str, timeout: int) -> dict[str, Any]:
    """异步调用 LLM 并解析 JSON 输出。"""
    raw = await async_llm_complete(prompt, max_retries=2, timeout=timeout)
    return _parse_object(raw)


async def _match_skills_node(state: EvaluationState) -> dict[str, Any]:
    """技能命中节点：调用 LLM 判断每个技能在简历中的命中情况。"""
    if not state.skills:
        logger.info("评估子图技能命中跳过：无技能项 application_id=%s", state.application_id)
        return {"skill_hits": []}

    prompt = prompt_manager.render(
        "evaluation/skill_match",
        job_name=state.job_name,
        job_description=state.job_description or "",
        skills=json.dumps(
            [{"skill": skill.skill, "type": skill.type} for skill in state.skills],
            ensure_ascii=False,
        ),
        resume_text=state.resume_text,
    )
    result = await _async_call_llm_json(prompt, timeout=90)
    raw_hits = result.get("skill_hits") or []
    hit_map = {
        str(item.get("skill") or "").strip(): item
        for item in raw_hits
        if isinstance(item, dict)
    }

    hits: list[EvaluationSkillHit] = []
    for skill in state.skills:
        item = hit_map.get(skill.skill.strip())
        is_hit = bool(item and item.get("is_hit"))
        hit_context = str(item.get("hit_context") or "") if item else ""
        hits.append(
            EvaluationSkillHit(
                skill_id=skill.skill_id,
                skill=skill.skill,
                is_hit=is_hit,
                hit_context=hit_context,
            )
        )
    logger.info(
        "评估子图技能命中完成：application_id=%s skill_count=%s hit_count=%s",
        state.application_id,
        len(hits),
        sum(1 for item in hits if item.is_hit),
    )
    return {"skill_hits": hits}


def _normalize_dimension_template(prompt_template: str) -> str:
    """把数据库历史模板中的 `{var}` 占位符兼容为 Jinja2 `{{ var }}`。"""
    normalized = prompt_template
    for key, value in _DIMENSION_PLACEHOLDERS.items():
        normalized = re.sub(rf"(?<!{{){{{key}}}(?!}})", value, normalized)
    return normalized


def _render_dimension_template(
    prompt_template: str,
    dimension_name: str,
    resume_text: str,
    job_name: str,
    job_description: str,
    skill_hits: list[EvaluationSkillHit],
) -> str:
    """渲染用户自定义维度模板，失败时回退原文。"""
    try:
        return prompt_manager.render_text(
            _normalize_dimension_template(prompt_template),
            dimension_name=dimension_name,
            resume_text=resume_text,
            job_name=job_name,
            job_description=job_description or "",
            skill_hits=json.dumps(
                [item.model_dump(mode="json") for item in skill_hits],
                ensure_ascii=False,
            ),
        )
    except TemplateError:
        logger.warning("评估子图维度模板渲染失败，回退原文：dimension=%s", dimension_name)
        return prompt_template


async def _dimension_eval_node(payload: dict[str, Any]) -> dict[str, Any]:
    """
    单维度评估节点（fan-out 后由 LangGraph Send 投递）。

    payload 必须包含：dimension（dict）、resume_text、job_name、job_description、skill_hits、application_id。
    返回的 `dimension_buffer` 会被附带 reducer 累加，`dimension_reduce` 节点再做最终聚合。
    """
    dimension = EvaluationDimensionSpec.model_validate(payload["dimension"])
    skill_hits_raw = payload.get("skill_hits") or []
    skill_hits = [EvaluationSkillHit.model_validate(item) for item in skill_hits_raw]
    resume_text = str(payload.get("resume_text") or "")
    job_name = str(payload.get("job_name") or "")
    job_description = str(payload.get("job_description") or "")

    prompt_template = _render_dimension_template(
        dimension.prompt_template,
        dimension.dimension_name,
        resume_text,
        job_name,
        job_description,
        skill_hits,
    )
    prompt = prompt_manager.render(
        "evaluation/dimension_eval",
        job_name=job_name,
        job_description=job_description,
        dimension=json.dumps(
            {"dimension_name": dimension.dimension_name, "weight": dimension.weight},
            ensure_ascii=False,
        ),
        skill_hits=json.dumps(
            [item.model_dump(mode="json") for item in skill_hits],
            ensure_ascii=False,
        ),
        prompt_template=prompt_template,
        resume_text=resume_text,
    )

    result = await _async_call_llm_json(prompt, timeout=120)
    score = _normalize_score(result.get("score"))
    advantage = str(result.get("advantage") or "")
    disadvantage = str(result.get("disadvantage") or "")

    dim_result = EvaluationDimensionResult(
        dimension_id=dimension.dimension_id,
        dimension_name=dimension.dimension_name,
        score=score,
        advantage=advantage,
        disadvantage=disadvantage,
        is_completed=True,
    )
    return {"dimension_buffer": [dim_result]}


def _fanout_dimensions(state: EvaluationState) -> list[Send]:
    """LangGraph 条件边：将每个维度作为独立任务派发给 dimension_eval 节点。"""
    if not state.dimensions:
        return []
    return [
        Send(
            "dimension_eval",
            {
                "dimension": dimension.model_dump(mode="python"),
                "skill_hits": [item.model_dump(mode="python") for item in state.skill_hits],
                "resume_text": state.resume_text,
                "job_name": state.job_name,
                "job_description": state.job_description,
                "application_id": state.application_id,
            },
        )
        for dimension in state.dimensions
    ]


def _dimension_reduce_node(state: EvaluationState) -> dict[str, Any]:
    """聚合维度结果，按模板顺序补齐缺失维度并计算加权分。"""
    by_name = {item.dimension_name.strip(): item for item in state.dimension_buffer}
    merged: list[EvaluationDimensionResult] = []
    for dimension in state.dimensions:
        item = by_name.get(dimension.dimension_name.strip())
        if item is None:
            merged.append(
                EvaluationDimensionResult(
                    dimension_id=dimension.dimension_id,
                    dimension_name=dimension.dimension_name,
                    score=0.0,
                    advantage="",
                    disadvantage="",
                    is_completed=False,
                    error_message="AI评估结果缺少该维度",
                )
            )
        else:
            # 维度匹配后用模板里的 dimension_id（确保最终落库一致）
            merged.append(item.model_copy(update={"dimension_id": dimension.dimension_id}))

    completed = [item for item in merged if item.is_completed]
    if not completed:
        raise ValidationError("AI评估结果缺少有效维度")

    total_score = 0.0
    total_weight = 0.0
    for item, dimension in zip(merged, state.dimensions, strict=False):
        total_score += item.score * float(dimension.weight)
        total_weight += float(dimension.weight)
    original_total = sum(float(dim.weight) for dim in state.dimensions)
    weighted_score = (
        (total_score / total_weight) * original_total if total_weight > 0 else 0.0
    )
    logger.info(
        "评估子图维度聚合完成：application_id=%s dimension_count=%s weighted_score=%.2f",
        state.application_id,
        len(merged),
        weighted_score,
    )
    return {"dimension_results": merged, "weighted_score": weighted_score}


def _label_for_score(score: float) -> str:
    """根据分数兜底生成标签。

    分档与 visual_report.yaml / comprehensive.yaml 中给 LLM 的枚举对齐：
    ≥85 优秀；70-84 良好；55-69 一般；<55 待改进。
    """
    if score >= 85:
        return "优秀"
    if score >= 70:
        return "良好"
    if score >= 55:
        return "一般"
    return "待改进"


async def _comprehensive_node(state: EvaluationState) -> dict[str, Any]:
    """综合评估节点：让 LLM 输出最终分、标签、优劣势总评。"""
    prompt = prompt_manager.render(
        "evaluation/comprehensive",
        job_name=state.job_name,
        job_description=state.job_description or "",
        skill_hits=json.dumps(
            [item.model_dump(mode="json") for item in state.skill_hits],
            ensure_ascii=False,
        ),
        dimension_results=json.dumps(
            [
                {
                    "dimension_name": item.dimension_name,
                    "score": item.score,
                    "advantage": item.advantage,
                    "disadvantage": item.disadvantage,
                }
                for item in state.dimension_results
            ],
            ensure_ascii=False,
        ),
        weighted_score=round(state.weighted_score, 2),
    )
    result = await _async_call_llm_json(prompt, timeout=120)
    if result.get("final_score") is None:
        raise ValidationError("AI综合评估结果缺少最终分数")
    final_score = _normalize_score(result.get("final_score"))
    final_label = str(result.get("final_label") or "") or _label_for_score(final_score)
    advantage = str(result.get("advantage_comment") or "")
    disadvantage = str(result.get("disadvantage_comment") or "")
    logger.info(
        "评估子图综合评估完成：application_id=%s final_score=%.2f label=%s",
        state.application_id,
        final_score,
        final_label,
    )
    return {
        "final_score": final_score,
        "final_label": final_label,
        "advantage_comment": advantage,
        "disadvantage_comment": disadvantage,
    }


def _finalize_node(state: EvaluationState) -> dict[str, Any]:
    """收尾节点：占位，便于未来插入轻量校验/审计。"""
    if not state.dimension_results:
        raise ValidationError("评估子图未产出维度结果")
    return {}


# ---------------------------------------------------------------------------
# 自定义 reducer
# ---------------------------------------------------------------------------


def _reduce_dimension_buffer(
    current: list[EvaluationDimensionResult] | None,
    incoming: list[EvaluationDimensionResult] | dict,
) -> list[EvaluationDimensionResult]:
    """LangGraph 字段级 reducer：追加 dimension_eval 节点返回的单维度结果到 buffer。"""
    base = list(current or [])
    if isinstance(incoming, dict):
        items = incoming.get("dimension_buffer") or []
    else:
        items = incoming or []
    for raw in items:
        if isinstance(raw, EvaluationDimensionResult):
            base.append(raw)
        else:
            base.append(EvaluationDimensionResult.model_validate(raw))
    return base


# 由于 Pydantic 的 BaseModel 无法直接挂 reducer，我们用 LangGraph TypedDict 风格的派生 state。


class _GraphStateDict(TypedDict, total=False):
    """LangGraph 内部使用的 state dict，便于挂载 reducer。"""

    application_id: int
    resume_id: int
    job_id: int
    job_name: str
    job_description: str
    resume_text: str
    dimensions: list[dict]
    skills: list[dict]
    skill_hits: list[dict]
    dimension_buffer: Annotated[list[EvaluationDimensionResult], _reduce_dimension_buffer]
    dimension_results: list[EvaluationDimensionResult]
    weighted_score: float
    final_score: float
    final_label: str
    advantage_comment: str
    disadvantage_comment: str
    error_message: str | None


def _wrap_node(fn):
    """适配 async BaseModel 节点函数到 TypedDict 状态。"""

    async def _inner(state: _GraphStateDict) -> dict[str, Any]:
        typed = EvaluationState.model_validate(state)
        result = fn(typed)
        if inspect.isawaitable(result):
            result = await result
        if not isinstance(result, dict):
            return {}
        # 把 Pydantic 输出转为 dict 兼容形态
        wrapped: dict[str, Any] = {}
        for key, value in result.items():
            if isinstance(value, list):
                wrapped[key] = [
                    item.model_dump(mode="python") if isinstance(item, BaseModel) else item
                    for item in value
                ]
            elif isinstance(value, BaseModel):
                wrapped[key] = value.model_dump(mode="python")
            else:
                wrapped[key] = value
        return wrapped

    _inner.__name__ = fn.__name__
    return _inner


def _wrap_fanout(state: _GraphStateDict) -> list[Send]:
    typed = EvaluationState.model_validate(state)
    return _fanout_dimensions(typed)


# ---------------------------------------------------------------------------
# Graph compile & 公共入口
# ---------------------------------------------------------------------------


@lru_cache(maxsize=1)
def _compiled_graph():
    """编译并缓存评估子图。"""
    graph = StateGraph(_GraphStateDict)
    graph.add_node("match_skills", _wrap_node(_match_skills_node))
    graph.add_node("dimension_eval", _dimension_eval_node)
    graph.add_node("dimension_reduce", _wrap_node(_dimension_reduce_node))
    graph.add_node("comprehensive", _wrap_node(_comprehensive_node))
    graph.add_node("finalize", _wrap_node(_finalize_node))

    graph.add_edge(START, "match_skills")
    graph.add_conditional_edges(
        "match_skills",
        _wrap_fanout,
        path_map=["dimension_eval"],
    )
    graph.add_edge("dimension_eval", "dimension_reduce")
    graph.add_edge("dimension_reduce", "comprehensive")
    graph.add_edge("comprehensive", "finalize")
    graph.add_edge("finalize", END)
    return graph.compile()


async def arun(state: EvaluationState) -> EvaluationResult:
    """异步运行评估子图，返回最终结果。"""
    graph = _compiled_graph()
    initial = state.model_dump(mode="python")
    final = await graph.ainvoke(initial)
    typed = EvaluationState.model_validate(final)
    if typed.error_message:
        raise ValidationError(typed.error_message)
    return EvaluationResult(
        application_id=typed.application_id,
        resume_id=typed.resume_id,
        job_id=typed.job_id,
        skill_hits=typed.skill_hits,
        dimensions=typed.dimension_results,
        weighted_score=typed.weighted_score,
        final_score=typed.final_score,
        final_label=typed.final_label,
        advantage_comment=typed.advantage_comment,
        disadvantage_comment=typed.disadvantage_comment,
    )


def run_sync(state: EvaluationState) -> EvaluationResult:
    """同步入口（Celery / 单测），内部跑独立事件循环。"""
    try:
        asyncio.get_running_loop()
    except RuntimeError:
        return asyncio.run(arun(state))
    raise RuntimeError("evaluation_graph.run_sync 不能在事件循环内调用，请改用 arun")