"""Interview question graph tests."""

from types import SimpleNamespace

import pytest

from app.llm.graphs.workflows.interview_questions import build_interview_question_graph


def test_build_interview_question_graph_compiles() -> None:
    """面试题工作流图可以编译。"""
    graph = build_interview_question_graph()

    assert graph is not None


@pytest.mark.asyncio
async def test_lifespan_registers_workflow_graphs(monkeypatch: pytest.MonkeyPatch) -> None:
    """FastAPI lifespan 启动时注册双工作流图单例。"""
    from app import main as main_module

    async def _noop() -> None:
        """测试用异步空操作。"""
        return None

    monkeypatch.setattr(main_module.mysql_manager, "init_pool", _noop)
    monkeypatch.setattr(main_module.mysql_manager, "close_pool", _noop)
    monkeypatch.setattr(main_module.redis_manager, "init_client", _noop)
    monkeypatch.setattr(main_module.redis_manager, "close_client", _noop)
    monkeypatch.setattr(main_module.mysql_manager, "_engine", object())
    monkeypatch.setattr(main_module.redis_manager, "_client", object())
    monkeypatch.setattr(main_module, "CacheService", lambda redis_client: SimpleNamespace(redis=redis_client))

    async with main_module.lifespan(main_module.app):
        assert set(main_module.app.state.agent_workflow_graphs) == {"interview_questions", "resume_evaluation"}