"""ResumeLoader 单测：load(resume_id) 缓存优先 + load_by_path(file_path) 按路径解析。"""

from unittest.mock import AsyncMock, MagicMock

import pytest

from app.services.resume_loader import ResumeLoader


def _storage_mock(full_path: str = "/data/x.pdf") -> MagicMock:
    storage = MagicMock()
    storage.get_full_path = MagicMock(return_value=full_path)
    return storage


@pytest.mark.asyncio
async def test_load_returns_cached_text_when_hit():
    cache = MagicMock()
    cache.get = AsyncMock(return_value="cached resume text")
    cache.set = AsyncMock()
    repo = MagicMock()
    loader = ResumeLoader(cache=cache, resume_repo=repo, storage=_storage_mock())
    text = await loader.load(resume_id=42)
    assert text == "cached resume text"
    repo.get_by_id.assert_not_called()


@pytest.mark.asyncio
async def test_load_fetches_repo_and_caches_on_miss():
    cache = MagicMock()
    cache.get = AsyncMock(return_value=None)
    cache.set = AsyncMock()
    # Resume 模型列名为 raw_text（非 parsed_text，曾误用导致空串）
    resume = MagicMock(raw_text="parsed resume content")
    repo = MagicMock()
    repo.get_by_id = AsyncMock(return_value=resume)
    loader = ResumeLoader(cache=cache, resume_repo=repo, storage=_storage_mock())
    text = await loader.load(resume_id=42)
    assert text == "parsed resume content"
    cache.set.assert_awaited_once()


@pytest.mark.asyncio
async def test_load_raises_when_resume_missing():
    cache = MagicMock()
    cache.get = AsyncMock(return_value=None)
    repo = MagicMock()
    repo.get_by_id = AsyncMock(return_value=None)
    loader = ResumeLoader(cache=cache, resume_repo=repo, storage=_storage_mock())
    with pytest.raises(LookupError):
        await loader.load(resume_id=42)


@pytest.mark.asyncio
async def test_load_by_path_parses_file(monkeypatch):
    """load_by_path 调 extract_resume_text(Path(full_path)) 返回解析文本，不碰 cache/repo。"""
    storage = _storage_mock("/data/x.pdf")
    loader = ResumeLoader(cache=MagicMock(), resume_repo=MagicMock(), storage=storage)
    captured: dict = {}

    def fake_extract(path):
        captured["path"] = path
        return "解析出的简历文本"

    monkeypatch.setattr("app.services.resume_loader.extract_resume_text", fake_extract)
    text = await loader.load_by_path(file_path="x.pdf")
    # extract_resume_text 被调用且收到 Path 对象（内部用 .suffix 判定格式）
    from pathlib import Path
    assert "path" in captured, "extract_resume_text 未被调用"
    assert isinstance(captured["path"], Path)
    assert captured["path"].name == "x.pdf"
    assert text == "解析出的简历文本"


@pytest.mark.asyncio
async def test_load_by_path_empty_on_missing_file(monkeypatch):
    """解析返回空串时 load_by_path 返回空串（graph 兜底处理空简历）。"""
    loader = ResumeLoader(cache=MagicMock(), resume_repo=MagicMock(), storage=_storage_mock("/data/y.pdf"))
    monkeypatch.setattr("app.services.resume_loader.extract_resume_text", lambda path: "")
    text = await loader.load_by_path(file_path="y.pdf")
    assert text == ""
