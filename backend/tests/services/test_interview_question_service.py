"""InterviewQuestionService tests."""

from types import SimpleNamespace

import pytest

from app.schemas.agent.dto import InterviewQuestionItemDTO
from app.services.interview_question_service import InterviewQuestionService


class _RouterThatFails:
    """测试用模型路由器：维度提议失败。"""

    async def complete(self, prompt, runtime_config) -> None:
        """模拟 LLM 失败。"""
        raise RuntimeError("llm failed")


@pytest.mark.asyncio
async def test_suggest_dimensions_falls_back_to_fixed_dimensions() -> None:
    """维度提议失败时返回固定内置维度。"""
    service = InterviewQuestionService(model_router=_RouterThatFails(), resume_pipeline=object())

    dimensions = await service.suggest_dimensions(resume_text="", runtime_config=SimpleNamespace())

    assert [item.name for item in dimensions]
    assert dimensions[0].source == "fallback"


def test_build_question_set_block_has_expected_type() -> None:
    """最终 block 必须使用 interview_question_set 类型。"""
    service = InterviewQuestionService(model_router=object(), resume_pipeline=object())
    block = service.build_question_set_block([
        InterviewQuestionItemDTO(
            question="问题",
            dimension="项目深度",
            difficulty="中等",
            evaluation_points=["贡献"],
        )
    ])

    assert block["type"] == "interview_question_set"
    assert block["question_set"]["total_questions"] == 1