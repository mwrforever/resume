"""InterviewQuestionService 错误传播：核心节点 LLM 失败即上抛（不再静默兜底）。

回归点：旧实现 _stream_with_thinking 用 except Exception 吞掉 LLM 调用失败并返回
空串，导致 build_question_plan / suggest_dimensions 走 _fallback_plan / 内置维度，
给用户一份"伪造"的计划/维度继续往下走，错误被完全掩盖。
修复后核心节点 raise_on_error=True，失败即上抛 → graph 冒泡 → Service emit run.error。
"""

from __future__ import annotations

from collections.abc import AsyncIterator

import pytest
from pydantic import SecretStr

from app.schemas.agent.dto import LLMRuntimeConfigDTO
from app.services.interview_question_service import InterviewQuestionService


class _BoomRouter:
    """模拟 LLM 路由器：stream 调用即抛异常（重试+fallback 全失败的终态）。"""

    async def stream(self, prompt, runtime_config) -> AsyncIterator:
        raise RuntimeError("LLM 网关错误：所有模型不可用")
        yield  # pragma: no cover - 使其成为 async generator


class _EmptyRouter:
    """模拟 LLM 路由器：stream 正常但不产出任何 chunk（调用成功、内容为空）。"""

    async def stream(self, prompt, runtime_config) -> AsyncIterator:
        return
        yield  # pragma: no cover


def _runtime_cfg(*, enable_thinking: bool = False) -> LLMRuntimeConfigDTO:
    """构造测试用 LLM 配置（默认关闭思考，避免 get_stream_writer 依赖图上下文）。"""
    return LLMRuntimeConfigDTO(
        provider="deepseek", base_url="x", api_key=SecretStr("sk"), model_name="m",
        enable_thinking=enable_thinking,
    )


def _make_ctx(router, *, enable_thinking: bool = False):
    """构造仅含 runtime_config 的轻量 ctx（非思考分支不触碰 emitter/writer）。"""
    class _Ctx:
        def __init__(self) -> None:
            self.runtime_config = _runtime_cfg(enable_thinking=enable_thinking)
    return _Ctx()


@pytest.mark.asyncio
async def test_stream_with_thinking_raises_on_error_when_flag_set():
    """raise_on_error=True 且 LLM 调用失败（非思考分支）→ 上抛异常。"""
    svc = InterviewQuestionService(model_router=_BoomRouter(), resume_loader=None)
    ctx = _make_ctx(_BoomRouter())
    with pytest.raises(RuntimeError, match="LLM 网关错误"):
        await svc._stream_with_thinking(
            "p", ctx, stage_label="规划出题", raise_on_error=True,
        )


@pytest.mark.asyncio
async def test_stream_with_thinking_swallows_when_flag_not_set():
    """raise_on_error=False（默认）→ 吞异常返回空串（保留旧兜底行为）。"""
    svc = InterviewQuestionService(model_router=_BoomRouter(), resume_loader=None)
    ctx = _make_ctx(_BoomRouter())
    text = await svc._stream_with_thinking("p", ctx, stage_label="规划出题")
    assert text == ""


@pytest.mark.asyncio
async def test_build_question_plan_propagates_llm_failure():
    """build_question_plan：LLM 失败时上抛，不再返回伪造的 _fallback_plan。"""
    svc = InterviewQuestionService(model_router=_BoomRouter(), resume_loader=None)
    ctx = _make_ctx(_BoomRouter())
    state = {"selected_dimensions": [{"name": "算法"}], "question_plan": {}}
    with pytest.raises(RuntimeError, match="LLM 网关错误"):
        await svc.build_question_plan(state, ctx)


@pytest.mark.asyncio
async def test_suggest_dimensions_propagates_llm_failure():
    """suggest_dimensions：LLM 失败时上抛，不再返回内置兜底维度。"""
    svc = InterviewQuestionService(model_router=_BoomRouter(), resume_loader=None)
    ctx = _make_ctx(_BoomRouter())
    state = {"resume_text": "简历内容", "user_intent": "后端岗位"}
    with pytest.raises(RuntimeError, match="LLM 网关错误"):
        await svc.suggest_dimensions(state, ctx)


@pytest.mark.asyncio
async def test_suggest_dimensions_falls_back_on_empty_but_successful():
    """LLM 调用成功但内容为空（解析为空）→ 仍用内置维度兜底（非调用失败，不上抛）。"""
    svc = InterviewQuestionService(model_router=_EmptyRouter(), resume_loader=None)
    ctx = _make_ctx(_EmptyRouter())
    state = {"resume_text": "简历内容", "user_intent": "后端岗位"}
    result = await svc.suggest_dimensions(state, ctx)
    # 调用成功但空内容 → 走内置兜底维度（区别于调用失败的上抛）
    assert len(result["suggested_dimensions"]) > 0


@pytest.mark.asyncio
async def test_build_resume_upload_interaction_payload():
    """build_resume_upload_interaction 返回 resume_upload 类型 + request_id 前缀。"""
    from unittest.mock import MagicMock
    from app.services.interview_question_service import InterviewQuestionService
    svc = InterviewQuestionService(model_router=MagicMock(), resume_loader=MagicMock())
    payload = svc.build_resume_upload_interaction()
    assert payload["interaction_type"] == "resume_upload"
    assert payload["request_id"].startswith("resume_")
    assert payload["title"]
    assert payload["data"] == {}


@pytest.mark.asyncio
async def test_load_resume_interrupts_when_file_path_missing():
    """缺简历时 load_resume 调 interrupt，用其返回的 file_path 解析。"""
    from unittest.mock import AsyncMock, MagicMock, patch
    from app.services.interview_question_service import InterviewQuestionService
    loader = MagicMock()
    loader.load_by_path = AsyncMock(return_value="简历原文")
    svc = InterviewQuestionService(model_router=MagicMock(), resume_loader=loader)
    state = {"resume_ref": {}}  # 无 file_path
    ctx = MagicMock()
    ctx.emitter.next_block_index.return_value = 0
    ctx.emitter.emit_block_start.return_value = MagicMock()
    ctx.emitter.emit_block_stop.return_value = MagicMock()
    with patch("app.services.interview_question_service.interrupt",
               return_value={"file_path": "/uploaded/resume.pdf", "file_name": "r.pdf"}) as mock_int:
        with patch("app.services.interview_question_service.get_stream_writer", return_value=lambda _env: None):
            result = await svc.load_resume(state, ctx)
    mock_int.assert_called_once()
    loader.load_by_path.assert_awaited_once_with(file_path="/uploaded/resume.pdf")
    assert result["resume_text"] == "简历原文"
    assert result["resume_ref"]["file_path"] == "/uploaded/resume.pdf"


@pytest.mark.asyncio
async def test_load_resume_no_interrupt_when_file_path_present():
    """已附简历时不 interrupt，直接解析。"""
    from unittest.mock import AsyncMock, MagicMock, patch
    from app.services.interview_question_service import InterviewQuestionService
    loader = MagicMock()
    loader.load_by_path = AsyncMock(return_value="简历原文")
    svc = InterviewQuestionService(model_router=MagicMock(), resume_loader=loader)
    state = {"resume_ref": {"file_path": "/attached/resume.pdf"}}
    ctx = MagicMock()
    ctx.emitter.next_block_index.return_value = 0
    with patch("app.services.interview_question_service.interrupt") as mock_int:
        with patch("app.services.interview_question_service.get_stream_writer", return_value=lambda _env: None):
            result = await svc.load_resume(state, ctx)
    mock_int.assert_not_called()
    assert result["resume_text"] == "简历原文"
