"""ResumeLoader：缓存命中优先，未命中走 Repository。"""

from unittest.mock import AsyncMock, MagicMock

import pytest

from app.services.resume_loader import ResumeLoader


@pytest.mark.asyncio
async def test_load_returns_cached_text_when_hit():
    cache = MagicMock()
    cache.get = AsyncMock(return_value="cached resume text")
    cache.set = AsyncMock()
    repo = MagicMock()
    loader = ResumeLoader(cache=cache, resume_repo=repo)
    text = await loader.load(resume_id=42)
    assert text == "cached resume text"
    repo.get_by_id.assert_not_called()


@pytest.mark.asyncio
async def test_load_fetches_repo_and_caches_on_miss():
    cache = MagicMock()
    cache.get = AsyncMock(return_value=None)
    cache.set = AsyncMock()
    resume = MagicMock(parsed_text="parsed resume content")
    repo = MagicMock()
    repo.get_by_id = AsyncMock(return_value=resume)
    loader = ResumeLoader(cache=cache, resume_repo=repo)
    text = await loader.load(resume_id=42)
    assert text == "parsed resume content"
    cache.set.assert_awaited_once()


@pytest.mark.asyncio
async def test_load_raises_when_resume_missing():
    cache = MagicMock()
    cache.get = AsyncMock(return_value=None)
    repo = MagicMock()
    repo.get_by_id = AsyncMock(return_value=None)
    loader = ResumeLoader(cache=cache, resume_repo=repo)
    with pytest.raises(LookupError):
        await loader.load(resume_id=42)
