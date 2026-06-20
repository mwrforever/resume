"""ResumeEvaluationService：A1 load_resume 缺简历 interrupt（与 T3 同构）。

回归点：旧 load_resume 无 interrupt，缺简历时直接走解析分支（text=""），
后续 analyze_resume_profile 走空简历短路，导致评估流程无简历内容也跑下去。
修复后缺简历时 interrupt 弹 resume_upload 上传卡，用户上传后续接解析。
"""

from __future__ import annotations

from unittest.mock import AsyncMock, MagicMock, patch

import pytest


def _make_service(loader=None):
    """构造 ResumeEvaluationService（构造参数名与生产 __init__ 一致）。"""
    from app.services.resume_evaluation_service import ResumeEvaluationService
    return ResumeEvaluationService(
        model_router=MagicMock(),
        resume_loader=loader or MagicMock(),
        job_repo=MagicMock(),
        eval_repo=MagicMock(),
        cache=MagicMock(),
    )


@pytest.mark.asyncio
async def test_eval_build_resume_upload_interaction_payload():
    """build_resume_upload_interaction 返回 resume_upload 类型 + request_id 前缀。"""
    svc = _make_service()
    payload = svc.build_resume_upload_interaction()
    assert payload["interaction_type"] == "resume_upload"
    assert payload["request_id"].startswith("resume_")
    assert payload["title"]
    assert payload["data"] == {}


@pytest.mark.asyncio
async def test_eval_load_resume_interrupts_when_file_path_missing():
    """缺简历时 load_resume 调 interrupt，用其返回的 file_path 解析。"""
    loader = MagicMock()
    loader.load_by_path = AsyncMock(return_value="简历原文")
    svc = _make_service(loader=loader)
    state = {"resume_ref": {}}  # 无 file_path
    ctx = MagicMock()
    ctx.emitter.next_block_index.return_value = 0
    with patch(
        "app.services.resume_evaluation_service.interrupt",
        return_value={"file_path": "/u/r.pdf", "file_name": "r.pdf"},
    ) as mock_int:
        with patch(
            "app.services.resume_evaluation_service.get_stream_writer",
            return_value=lambda _e: None,
        ):
            result = await svc.load_resume(state, ctx)
    mock_int.assert_called_once()
    loader.load_by_path.assert_awaited_once_with(file_path="/u/r.pdf")
    assert result["resume_text"] == "简历原文"
    assert result["resume_ref"]["file_path"] == "/u/r.pdf"


@pytest.mark.asyncio
async def test_eval_load_resume_no_interrupt_when_file_path_present():
    """已附简历时不 interrupt，直接解析。"""
    loader = MagicMock()
    loader.load_by_path = AsyncMock(return_value="简历原文")
    svc = _make_service(loader=loader)
    state = {"resume_ref": {"file_path": "/attached/r.pdf"}}
    ctx = MagicMock()
    ctx.emitter.next_block_index.return_value = 0
    with patch("app.services.resume_evaluation_service.interrupt") as mock_int:
        with patch(
            "app.services.resume_evaluation_service.get_stream_writer",
            return_value=lambda _e: None,
        ):
            result = await svc.load_resume(state, ctx)
    mock_int.assert_not_called()
    assert result["resume_text"] == "简历原文"


@pytest.mark.asyncio
async def test_eval_load_resume_raises_when_interrupt_returns_no_path():
    """interrupt 返回值缺 file_path → ValidationError 中断流程。"""
    from app.core.exceptions import ValidationError
    loader = MagicMock()
    loader.load_by_path = AsyncMock(return_value="")
    svc = _make_service(loader=loader)
    state = {"resume_ref": {}}
    ctx = MagicMock()
    ctx.emitter.next_block_index.return_value = 0
    with patch(
        "app.services.resume_evaluation_service.interrupt",
        return_value={"file_name": "r.pdf"},  # 没有 file_path
    ):
        with patch(
            "app.services.resume_evaluation_service.get_stream_writer",
            return_value=lambda _e: None,
        ):
            with pytest.raises(ValidationError):
                await svc.load_resume(state, ctx)
