"""评估 LangGraph 子图：mock LLM，验证维度并行 + 加权聚合 + 综合输出。"""

import json
from collections.abc import Iterator
from contextlib import contextmanager
from unittest.mock import patch

import pytest

from app.llm.graphs import evaluation_graph
from app.llm.graphs.evaluation_graph import (
    EvaluationDimensionSpec,
    EvaluationSkillSpec,
    EvaluationState,
    arun,
)


def _state() -> EvaluationState:
    """构造一个最小可运行的评估输入。"""
    return EvaluationState(
        application_id=10,
        resume_id=20,
        job_id=30,
        job_name="后端工程师",
        job_description="负责服务端开发",
        resume_text="3 年 Python 开发经验",
        dimensions=[
            EvaluationDimensionSpec(
                dimension_id=1,
                dimension_name="技术栈匹配",
                weight=0.6,
                prompt_template="评估 {{ dimension_name }} 是否匹配。",
            ),
            EvaluationDimensionSpec(
                dimension_id=2,
                dimension_name="项目经验",
                weight=0.4,
                prompt_template="评估 {{ dimension_name }} 的深度。",
            ),
        ],
        skills=[
            EvaluationSkillSpec(skill_id=11, skill="Python", type=1),
            EvaluationSkillSpec(skill_id=12, skill="MySQL", type=1),
        ],
    )


async def _fake_async_llm_complete(prompt: str, **kwargs) -> str:
    """根据提示词中的关键标记返回不同的 JSON 输出，模拟三类节点 LLM 行为。"""
    if "高级简历综合评估专家" in prompt:
        return json.dumps(
            {
                "final_score": 87,
                "final_label": "良好",
                "advantage_comment": "整体优秀",
                "disadvantage_comment": "建议补强架构",
            },
            ensure_ascii=False,
        )
    if "技能匹配专家" in prompt:
        return json.dumps(
            {
                "skill_hits": [
                    {"skill": "Python", "is_hit": True, "hit_context": "3 年 Python"},
                    {"skill": "MySQL", "is_hit": False, "hit_context": ""},
                ]
            },
            ensure_ascii=False,
        )
    if "技术栈匹配" in prompt:
        return json.dumps(
            {"score": 90, "advantage": "技术栈匹配优", "disadvantage": ""},
            ensure_ascii=False,
        )
    if "项目经验" in prompt:
        return json.dumps(
            {"score": 80, "advantage": "项目较深", "disadvantage": "缺架构经验"},
            ensure_ascii=False,
        )
    return "{}"


@contextmanager
def _patch_llm() -> Iterator[None]:
    """patch evaluation_graph 内部的 async_llm_complete。"""
    with patch.object(evaluation_graph, "async_llm_complete", side_effect=_fake_async_llm_complete):
        yield


@pytest.mark.asyncio
async def test_evaluation_graph_full_run_returns_weighted_and_comprehensive() -> None:
    """评估子图在 mock LLM 下应输出聚合后的维度结果与综合评估。"""
    with _patch_llm():
        result = await arun(_state())

    assert result.application_id == 10
    assert len(result.dimensions) == 2
    by_name = {item.dimension_name: item for item in result.dimensions}
    assert by_name["技术栈匹配"].score == 90.0
    assert by_name["项目经验"].score == 80.0
    # 加权分 = (90*0.6 + 80*0.4) / 1.0 * 1.0 = 86
    assert round(result.weighted_score, 2) == 86.0
    assert result.final_score == 87.0
    assert result.final_label == "良好"
    assert {item.skill: item.is_hit for item in result.skill_hits} == {
        "Python": True,
        "MySQL": False,
    }


@pytest.mark.asyncio
async def test_evaluation_graph_skip_skills_when_no_template_skills() -> None:
    """模板技能为空时，子图直接跳过 skill_match，仍能返回综合结果。"""
    state = _state().model_copy(update={"skills": []})
    with _patch_llm():
        result = await arun(state)
    assert result.skill_hits == []
    assert result.final_score == 87.0


def test_evaluation_graph_run_sync_in_event_loop_raises() -> None:
    """run_sync 在事件循环内调用必须抛错，避免误用。"""
    import asyncio

    async def _wrapper() -> None:
        evaluation_graph.run_sync(_state())

    with pytest.raises(RuntimeError):
        asyncio.run(_wrapper())