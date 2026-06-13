"""AgentResumeService：会话内简历上传 + Redis 会话级引用。"""

from __future__ import annotations

from unittest.mock import AsyncMock, MagicMock

import pytest

from app.core.exceptions import ValidationError
from app.services.agent_resume_service import AgentResumeService, SESSION_RESUME_REF_KEY


def _make_resume_service(*, resume_id: int = 7, file_name: str = "x.pdf"):
    """构造一个 ResumeService mock：upload_resume 返回带 id/file_name/file_path 的简历对象。"""
    resume = MagicMock(id=resume_id, file_name=file_name, file_path=f"/tmp/{file_name}")
    svc = MagicMock()
    svc.upload_resume = AsyncMock(return_value=resume)
    return svc


@pytest.mark.asyncio
async def test_upload_resume_caches_session_ref():
    """上传简历后应写入 Redis 会话级引用。"""
    cache = MagicMock()
    cache.set_json = AsyncMock()
    resume_service = _make_resume_service(resume_id=7)
    job_repo = MagicMock()
    svc = AgentResumeService(resume_service=resume_service, job_repo=job_repo, cache=cache)

    out = await svc.upload(session_id=1, file=MagicMock(), job_id=None, employee_id=2)

    # 委托给底层 ResumeService.upload_resume(employee_id, file)
    resume_service.upload_resume.assert_awaited_once()
    assert out["resume_id"] == 7
    assert out["file_name"] == "x.pdf"
    cache.set_json.assert_awaited_once()
    args = cache.set_json.call_args[0]
    assert args[0] == SESSION_RESUME_REF_KEY.format(session_id=1)


@pytest.mark.asyncio
async def test_get_session_ref_returns_cached_value():
    """从 Redis 缓存中读取简历引用。"""
    cache = MagicMock()
    cache.get_json = AsyncMock(return_value={"resume_id": 7, "file_name": "x.pdf", "job_id": None})
    svc = AgentResumeService(
        resume_service=_make_resume_service(), job_repo=MagicMock(), cache=cache,
    )
    ref = await svc.get_session_ref(session_id=1)
    assert ref["resume_id"] == 7


@pytest.mark.asyncio
async def test_get_session_ref_returns_none_on_miss():
    """Redis 缓存未命中时返回 None。"""
    cache = MagicMock()
    cache.get_json = AsyncMock(return_value=None)
    svc = AgentResumeService(
        resume_service=_make_resume_service(), job_repo=MagicMock(), cache=cache,
    )
    ref = await svc.get_session_ref(session_id=1)
    assert ref is None


@pytest.mark.asyncio
async def test_upload_rejects_unowned_job_id():
    """上传时 job_id 不属于当前员工应抛 ValidationError。"""
    job_repo = MagicMock()
    job_repo.get_by_employee = AsyncMock(return_value=[MagicMock(id=10)])
    svc = AgentResumeService(
        resume_service=_make_resume_service(), job_repo=job_repo, cache=MagicMock(),
    )
    with pytest.raises(ValidationError):
        await svc.upload(session_id=1, file=MagicMock(), job_id=999, employee_id=2)
