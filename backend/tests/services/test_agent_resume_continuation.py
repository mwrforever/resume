"""Q2 续接同 thread 的纯逻辑单测。

覆盖：
- _build_resume_update：新消息按工作流类型注入对应 state 通道（图一 user_intent / 图二 job_feedback）
- _has_unfinished_interaction：识别最近 agent 消息中的 pending/expired interaction

节点对 None resume 的容忍属 LangGraph 运行时行为，集成测试覆盖，此处不重复。
"""
import pytest

from app.services.agent_runtime_service import AgentRuntimeService


class _FakeMsg:
    def __init__(self, role, content):
        self.role = role
        self.content = content


class _FakeRepo:
    def __init__(self, messages):
        self._messages = messages

    async def list_messages(self, session_id):
        return list(self._messages)


def _service_with_repo(repo):
    # 仅 _has_unfinished_interaction / _build_resume_update用到 repo / 纯逻辑，其余依赖置 None
    return AgentRuntimeService(
        repo=repo, cache=None, workflow_graphs={}, runner_factory=None,
        interview_service=None, evaluation_service=None, resume_loader=None,
    )


@pytest.mark.asyncio
async def test_build_resume_update_injects_user_intent_for_interview():
    update = AgentRuntimeService._build_resume_update("interview_questions", "更侧重算法")
    assert update == {"user_intent": "更侧重算法"}


@pytest.mark.asyncio
async def test_build_resume_update_injects_job_feedback_for_evaluation():
    update = AgentRuntimeService._build_resume_update("resume_evaluation", "Java 后端")
    assert update == {"job_feedback": "Java 后端"}


@pytest.mark.asyncio
async def test_has_unfinished_interaction_true_for_expired():
    repo = _FakeRepo([
        _FakeMsg("user", {"blocks": []}),
        _FakeMsg("agent", {"blocks": [
            {"type": "interaction", "status": "expired"},
        ]}),
    ])
    svc = _service_with_repo(repo)
    assert await svc._has_unfinished_interaction(type("S", (), {"id": 1})()) is True


@pytest.mark.asyncio
async def test_has_unfinished_interaction_false_for_submitted():
    repo = _FakeRepo([
        _FakeMsg("agent", {"blocks": [
            {"type": "interaction", "status": "submitted"},
        ]}),
    ])
    svc = _service_with_repo(repo)
    assert await svc._has_unfinished_interaction(type("S", (), {"id": 1})()) is False


@pytest.mark.asyncio
async def test_has_unfinished_interaction_false_when_no_interaction():
    repo = _FakeRepo([
        _FakeMsg("agent", {"blocks": [{"type": "text", "status": "success"}]}),
    ])
    svc = _service_with_repo(repo)
    assert await svc._has_unfinished_interaction(type("S", (), {"id": 1})()) is False
