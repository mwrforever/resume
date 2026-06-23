"""续接判断与 update 注入的纯逻辑单测（覆盖 _should_continue_workflow / _build_resume_update）。

判断依据从"遍历 blocks 找 pending interaction"简化为"最近 agent message.task_id ==
session.current_task_id"，覆盖中断暂停 / 客户端中断 / graph 异常 / persist 失败等全部
"task_id 未推进"的场景。节点对 None resume 的容忍属 LangGraph 运行时行为，集成测试覆盖。
"""
import pytest

from app.services.agent_runtime_service import AgentRuntimeService


class _FakeMsg:
    def __init__(self, task_id):
        self.task_id = task_id


class _FakeRepo:
    def __init__(self, latest):
        self._latest = latest

    async def get_latest_agent_message(self, session_id):
        return self._latest


def _service_with_repo(repo):
    # 仅 _should_continue_workflow / _build_resume_update 用到 repo / 纯逻辑，其余依赖置 None
    return AgentRuntimeService(
        repo=repo, cache=None, workflow_graphs={}, runner_factory=None,
        interview_service=None, evaluation_service=None, resume_loader=None,
    )


def _session(task_id):
    return type("S", (), {"id": 1, "current_task_id": task_id})()


@pytest.mark.asyncio
async def test_build_resume_update_injects_user_intent_for_interview():
    update = AgentRuntimeService._build_resume_update("interview_questions", "更侧重算法")
    assert update == {"user_intent": "更侧重算法"}


@pytest.mark.asyncio
async def test_build_resume_update_injects_job_feedback_for_evaluation():
    update = AgentRuntimeService._build_resume_update("resume_evaluation", "Java 后端")
    assert update == {"job_feedback": "Java 后端"}


def test_build_resume_command_value_carries_reject_flags_and_feedback():
    """resume 值同时携带 regenerate / approved=False / feedback，
    覆盖三类中断节点（维度选择 / 岗位选择 / 计划审批）的驳回判定，避免续接弹回原表单。
    """
    value = AgentRuntimeService._build_resume_command_value("更聚焦算法工程")
    assert value == {"regenerate": True, "approved": False, "feedback": "更聚焦算法工程"}


@pytest.mark.asyncio
async def test_should_continue_when_task_id_matches():
    """task_id 与 session.current_task_id 相等 → 上一段未 END → 续接。
    覆盖：interaction 暂停、客户端中断流式、graph 异常、persist 失败等全部场景。
    """
    repo = _FakeRepo(_FakeMsg(task_id="t-abc"))
    svc = _service_with_repo(repo)
    assert await svc._should_continue_workflow(_session("t-abc")) is True


@pytest.mark.asyncio
async def test_should_not_continue_when_task_id_advanced():
    """task_id 已被 advance（END 后）→ 全新 run。"""
    repo = _FakeRepo(_FakeMsg(task_id="t-old"))
    svc = _service_with_repo(repo)
    assert await svc._should_continue_workflow(_session("t-new")) is False


@pytest.mark.asyncio
async def test_should_not_continue_for_new_session():
    """会话无 agent 消息 → 全新 run。"""
    repo = _FakeRepo(None)
    svc = _service_with_repo(repo)
    assert await svc._should_continue_workflow(_session("t-xxx")) is False


@pytest.mark.asyncio
async def test_should_not_continue_when_legacy_message_has_null_task_id():
    """历史数据 task_id=NULL → 视为已完成，不续接（避免对无 checkpoint 的旧消息硬续）。"""
    repo = _FakeRepo(_FakeMsg(task_id=None))
    svc = _service_with_repo(repo)
    assert await svc._should_continue_workflow(_session("t-xxx")) is False
