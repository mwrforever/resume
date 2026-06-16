"""_resolve_resume_ref 单测：context_refs 取 file_path，无 Redis fallback。"""

import pytest

from app.core.exceptions import ValidationError
from app.schemas.agent.request import AgentMessageCreate
from app.services.agent_runtime_service import AgentRuntimeService


def _make_service() -> AgentRuntimeService:
    """构造 AgentRuntimeService 跳过 __init__（仅测纯函数 _resolve_resume_ref）。"""
    return AgentRuntimeService.__new__(AgentRuntimeService)


def _body(context_refs: list[dict]) -> AgentMessageCreate:
    return AgentMessageCreate(content="hi", context_refs=context_refs)


@pytest.mark.asyncio
async def test_resolve_returns_file_path_from_context_refs():
    """context_refs 带 resume+file_path → 返回 {file_path, file_name}。"""
    svc = _make_service()
    body = _body([{"type": "resume", "file_path": "a/b.pdf", "file_name": "x.pdf"}])
    ref = await svc._resolve_resume_ref(session_id=1, body=body)
    assert ref == {"file_path": "a/b.pdf", "file_name": "x.pdf"}


@pytest.mark.asyncio
async def test_resolve_missing_file_path_raises():
    """resume 引用缺 file_path → ValidationError。"""
    svc = _make_service()
    body = _body([{"type": "resume", "file_name": "x.pdf"}])
    with pytest.raises(ValidationError):
        await svc._resolve_resume_ref(session_id=1, body=body)


@pytest.mark.asyncio
async def test_resolve_no_resume_ref_returns_none():
    """无 resume 引用 → None（无 Redis fallback）。"""
    svc = _make_service()
    body = _body([])
    ref = await svc._resolve_resume_ref(session_id=1, body=body)
    assert ref is None
