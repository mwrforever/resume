# Agent 工作台体验强化 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 为 Agent 工作台实现四项体验强化——A1 简历缺失时上传组件、A2 中断后续接（不重跑）、A3 岗位分页+手动搜索、B1 右侧进度追踪栏。

**Architecture:** 后端在既有 `endpoint→service→repository→db` 分层内改造：LangGraph `load_resume` 节点内加 `interrupt` 弹上传卡（A1）；`current_task_id` 仅工作流 END 时推进，新增 `resume_run` + `POST /resume` 续接被中断的 run（A2）；`agent_session` 加 `progress` JSON 列持久化步骤进度。前端引入 `framer-motion` 构建右侧 `ProgressTracker`（B1，替代内联 StepStrip），`JobSelection` 加分页+手动搜索+节流（A3），`InterruptBar` 重试改恢复语义（A2）。

**Tech Stack:** Python 3.12 / FastAPI / LangGraph / SQLAlchemy 2.x async / pytest-asyncio；React 19 / TypeScript / Vite / Tailwind v3 / Zustand / vitest + @testing-library/react / framer-motion（新增）。

**Spec:** `docs/superpowers/specs/2026-06-20-agent-workbench-enhance-design.md`

**关键约束：** Checkpointer 是 `InMemorySaver`（进程内），A2 续接仅在同一服务进程存活期可用；服务重启后降级为 `no_resumable_checkpoint`。`current_task_id` 仅 END 推进，不支持放弃（ii），错误/状态丢失除外。

---

## 文件结构总览

**后端（Create/Modify）：**
- Modify `backend/app/models/agent_session.py` — 加 `progress` JSON 列
- Modify `backend/app/schemas/agent/response.py` — `AgentSessionItem.progress`
- Modify `backend/app/schemas/agent/stream/events.py` — `InteractionType` 加 `resume_upload`
- Modify `backend/app/services/interview_question_service.py` — A1 load_resume interrupt + helper
- Modify `backend/app/services/resume_evaluation_service.py` — A1 load_resume interrupt + helper
- Modify `backend/app/services/agent_runtime_service.py` — progress 持久化；client_aborted 不推进；`resume_run`
- Modify `backend/app/api/v1/endpoints/agent.py` — `POST /sessions/{id}/resume`
- Modify `backend/app/repositories/agent_repository.py` — 加 `get_session`（progress 读取用，若不存在）
- Test `backend/tests/services/test_agent_runtime_service.py` — 续接/progress 用例
- Test `backend/tests/services/test_interview_question_service_errors.py`（或新建）— A1 用例

**前端（Create/Modify）：**
- Modify `frontend/package.json` — 加 `framer-motion`
- Modify `frontend/src/types/agent.ts` — `InteractionType` + `WorkspaceSession.progress`
- Modify `frontend/src/api/employee/agent.ts` — `resumeSession`
- Modify `frontend/src/store/agent.ts` — `resumeRun` action
- Modify `frontend/src/components/employee/agent/blocks/interaction-block.tsx` — ResumeUpload 分支 + JobSelection 分页搜索
- Create `frontend/src/components/employee/agent/progress-tracker/progress-tracker.tsx` — 右侧进度栏主体
- Create `frontend/src/components/employee/agent/progress-tracker/step-row.tsx` — 单步行
- Create `frontend/src/components/employee/agent/progress-tracker/progress-tooltip.tsx` — 收起态 tooltip
- Modify `frontend/src/components/employee/agent/layout/agent-standalone-layout.tsx` — 三栏 + 挂 ProgressTracker
- Modify `frontend/src/components/employee/agent/agent-message-card.tsx` — 移除 StepStrip
- Modify `frontend/src/components/employee/agent/interrupt-bar.tsx` — 重试→恢复
- Modify `frontend/src/components/employee/agent/agent-composer.tsx` — 未完成禁用发送 + 移除 interaction abort
- Modify `frontend/src/components/employee/agent/agent-workspace.tsx` — 透传 resumeRun
- Modify `frontend/src/index.css` — 光波/脉冲 keyframes（若 keyframes 未定义）

---

# 期一：后端基础 + A1 + A3（低风险，可独立验收）

## Task 1: 后端 — agent_session 加 progress 列

**Files:**
- Modify: `backend/app/models/agent_session.py`
- Modify: `backend/app/schemas/agent/response.py`
- DDL: 数据库执行（按项目既有 DDL 管理方式）

- [ ] **Step 1: 加 ORM 列**

修改 `backend/app/models/agent_session.py`，在 `last_block_index` 行后加 `progress` 列，并在 import 中加 `JSON`：

```python
from sqlalchemy import BigInteger, DateTime, Index, Integer, JSON, String, UniqueConstraint
```

```python
    # 本会话已分配的最大 block index（跨 run 全局递增，保证 block index 不冲突）
    last_block_index: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    # 累积步骤进度 {workflow_type, steps:[{step_id,title,status,detail?}]}，支撑进度栏持久化展示
    progress: Mapped[dict | None] = mapped_column(JSON, nullable=True)
```

- [ ] **Step 2: 加 schema 字段**

修改 `backend/app/schemas/agent/response.py` 的 `AgentSessionItem`，在 `last_block_index` 相关字段区（`enable_thinking` 后）加：

```python
    enable_thinking: bool = False
    # 累积步骤进度（进度栏持久化展示用；None 表示尚无运行记录）
    progress: dict[str, Any] | None = None
    last_message_time: datetime | None = None
```

（`Any` 已在文件顶部 `from typing import Any` 导入。）

- [ ] **Step 3: 执行 DDL**

```sql
ALTER TABLE agent_session ADD COLUMN progress JSON NULL COMMENT '累积步骤进度（支撑进度栏持久化展示）';
```

按项目既有方式应用（Alembic 迁移或手工 SQL）。确认列已加：

Run: `mysql -e "SHOW COLUMNS FROM agent_session LIKE 'progress';"`（或项目用的连接方式）
Expected: 一行 `progress | json | YES`

- [ ] **Step 4: 验证 schema 序列化含 progress**

Run（worktree 根目录）: `cd backend && python -c "from app.schemas.agent.response import AgentSessionItem; print('progress' in AgentSessionItem.model_fields)"`
Expected: `True`

- [ ] **Step 5: Commit**

```bash
git add backend/app/models/agent_session.py backend/app/schemas/agent/response.py
git commit -m "feat(agent): agent_session 加 progress JSON 列（进度栏持久化）"
```

---

## Task 2: 后端 — InteractionType 加 resume_upload

**Files:**
- Modify: `backend/app/schemas/agent/stream/events.py`
- Test: `backend/tests/services/test_agent_stream_events.py`

- [ ] **Step 1: 写失败测试**

在 `backend/tests/services/test_agent_stream_events.py` 末尾加（若无该文件则新建并复用既有 import 风格）：

```python
def test_interaction_type_includes_resume_upload():
    """InteractionType 应包含 resume_upload（A1 简历缺失上传卡）。"""
    from app.schemas.agent.stream.events import InteractionType
    # Literal 的 __args__ 即成员元组
    assert "resume_upload" in InteractionType.__args__
```

- [ ] **Step 2: 运行测试确认失败**

Run: `cd backend && python -m pytest tests/services/test_agent_stream_events.py::test_interaction_type_includes_resume_upload -v`
Expected: FAIL（`resume_upload` 不在成员中）

- [ ] **Step 3: 改 events.py**

修改 `backend/app/schemas/agent/stream/events.py`：

```python
InteractionType = Literal["dimension_selection", "plan_approval", "job_selection", "resume_upload"]
```

- [ ] **Step 4: 运行测试确认通过**

Run: `cd backend && python -m pytest tests/services/test_agent_stream_events.py::test_interaction_type_includes_resume_upload -v`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add backend/app/schemas/agent/stream/events.py backend/tests/services/test_agent_stream_events.py
git commit -m "feat(agent): InteractionType 加 resume_upload（A1）"
```

---

## Task 3: 后端 — A1 interview_service load_resume 缺简历 interrupt

**Files:**
- Modify: `backend/app/services/interview_question_service.py`
- Test: `backend/tests/services/test_interview_question_service_errors.py`（追加；若不便挂载则新建 `test_interview_load_resume.py`）

- [ ] **Step 1: 写失败测试**

在 `backend/tests/services/test_interview_question_service_errors.py` 末尾追加（需 `import uuid`、`from unittest.mock import AsyncMock, MagicMock, patch`）：

```python
@pytest.mark.asyncio
async def test_build_resume_upload_interaction_payload():
    """build_resume_upload_interaction 返回 resume_upload 类型 + request_id 前缀。"""
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
    from app.services.interview_question_service import InterviewQuestionService
    loader = MagicMock()
    loader.load_by_path = AsyncMock(return_value="简历原文")
    svc = InterviewQuestionService(model_router=MagicMock(), resume_loader=loader)
    state = {"resume_ref": {}}  # 无 file_path
    ctx = MagicMock()
    ctx.emitter.next_block_index.return_value = 0
    ctx.emitter.emit_block_start.return_value = MagicMock()
    ctx.emitter.emit_block_stop.return_value = MagicMock()
    # patch interrupt：第一次调用（缺简历）返回用户上传值
    with patch("app.services.interview_question_service.interrupt",
               return_value={"file_path": "/uploaded/resume.pdf", "file_name": "r.pdf"}) as mock_int:
        with patch("app.services.interview_question_service.get_stream_writer", return_value=lambda _env: None):
            result = await svc.load_resume(state, ctx)
    mock_int.assert_called_once()  # 缺简历 → interrupt 一次
    loader.load_by_path.assert_awaited_once_with(file_path="/uploaded/resume.pdf")
    assert result["resume_text"] == "简历原文"
    assert result["resume_ref"]["file_path"] == "/uploaded/resume.pdf"


@pytest.mark.asyncio
async def test_load_resume_no_interrupt_when_file_path_present():
    """已附简历时不 interrupt，直接解析。"""
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
    mock_int.assert_not_called()  # 有简历 → 不 interrupt
    assert result["resume_text"] == "简历原文"
```

- [ ] **Step 2: 运行测试确认失败**

Run: `cd backend && python -m pytest tests/services/test_interview_question_service_errors.py -k "resume" -v`
Expected: FAIL（`build_resume_upload_interaction` 不存在 / interrupt 未触发等）

- [ ] **Step 3: 实现 — import + helper + load_resume 改造**

修改 `backend/app/services/interview_question_service.py`：

顶部 import 区加（若缺）：

```python
import uuid
from langgraph.types import interrupt
from app.core.exceptions import ValidationError
```

在 `InterviewQuestionService` 类内、`load_resume` 方法前加 helper：

```python
    def build_resume_upload_interaction(self) -> dict:
        """构造简历上传 interaction payload（缺简历时 interrupt 用）。

        用户上传后提交 {file_path, file_name}，由 graph resume 回到 load_resume
        节点重跑，interrupt() 第二次调用直接返回该值，随后走正常解析。
        """
        return {
            "request_id": f"resume_{uuid.uuid4().hex[:8]}",
            "interaction_type": "resume_upload",
            "title": "需要先上传一份简历",
            "prompt": "检测到尚未附带简历文件。面试题生成需要基于简历内容，请上传后继续（上传后自动续接，无需重新发送）。",
            "data": {},
        }
```

替换既有 `load_resume` 方法体为（保留方法签名与 docstring 语义）：

```python
    async def load_resume(self, state, ctx: WorkflowRuntimeContext) -> dict:
        """按 file_path 解析简历原文；缺简历时 interrupt 弹上传卡，上传后续接解析。

        解析结果进 state.resume_text，同 task 内由 checkpoint 复用（无 Redis 缓存）。
        """
        writer = get_stream_writer()
        idx = ctx.emitter.next_block_index()
        file_path = str((state.get("resume_ref") or {}).get("file_path") or "")
        # 缺简历 → interrupt 弹上传卡（LangGraph resume 时本节点重跑，
        # interrupt() 第二次调用直接返回用户提交值，随后走正常解析）
        if not file_path:
            user_values = interrupt(self.build_resume_upload_interaction())
            file_path = str(user_values.get("file_path") or "")
            if not file_path:
                raise ValidationError("未收到简历文件路径，无法继续")
        writer(ctx.emitter.emit_block_start(index=idx, block={
            "type": "tool_use", "tool_name": "load_resume",
            "display_name": "读取简历", "input": {"file_path": file_path}, "status": "running",
        }))
        try:
            text = await self._loader.load_by_path(file_path=file_path)
        finally:
            writer(ctx.emitter.emit_block_stop(index=idx))
        return {"resume_text": text, "resume_ref": {"file_path": file_path}}
```

- [ ] **Step 4: 运行测试确认通过**

Run: `cd backend && python -m pytest tests/services/test_interview_question_service_errors.py -k "resume" -v`
Expected: 3 PASS

- [ ] **Step 5: Commit**

```bash
git add backend/app/services/interview_question_service.py backend/tests/services/test_interview_question_service_errors.py
git commit -m "feat(agent): A1 interview load_resume 缺简历 interrupt 弹上传卡"
```

---

## Task 4: 后端 — A1 evaluation_service load_resume 同步改造

**Files:**
- Modify: `backend/app/services/resume_evaluation_service.py`
- Test: `backend/tests/services/test_resume_evaluation_service_errors.py`（若无则新建）

- [ ] **Step 1: 写失败测试**

新建或追加 `backend/tests/services/test_resume_evaluation_service_errors.py`：

```python
"""ResumeEvaluationService：A1 load_resume 缺简历 interrupt。"""
from unittest.mock import AsyncMock, MagicMock, patch
import pytest


@pytest.mark.asyncio
async def test_eval_build_resume_upload_interaction_payload():
    from app.services.resume_evaluation_service import ResumeEvaluationService
    svc = ResumeEvaluationService(
        model_router=MagicMock(), resume_loader=MagicMock(),
        job_repo=MagicMock(), eval_repo=MagicMock(), cache=MagicMock(),
    )
    payload = svc.build_resume_upload_interaction()
    assert payload["interaction_type"] == "resume_upload"
    assert payload["request_id"].startswith("resume_")


@pytest.mark.asyncio
async def test_eval_load_resume_interrupts_when_file_path_missing():
    from app.services.resume_evaluation_service import ResumeEvaluationService
    loader = MagicMock()
    loader.load_by_path = AsyncMock(return_value="简历原文")
    svc = ResumeEvaluationService(
        model_router=MagicMock(), resume_loader=loader,
        job_repo=MagicMock(), eval_repo=MagicMock(), cache=MagicMock(),
    )
    state = {"resume_ref": {}}
    ctx = MagicMock()
    ctx.emitter.next_block_index.return_value = 0
    with patch("app.services.resume_evaluation_service.interrupt",
               return_value={"file_path": "/u/r.pdf", "file_name": "r.pdf"}) as mock_int:
        with patch("app.services.resume_evaluation_service.get_stream_writer", return_value=lambda _e: None):
            result = await svc.load_resume(state, ctx)
    mock_int.assert_called_once()
    assert result["resume_text"] == "简历原文"
    assert result["resume_ref"]["file_path"] == "/u/r.pdf"
```

> **注意：** `ResumeEvaluationService.__init__` 的真实参数名以现有代码为准（`job_repo`/`eval_repo`/`cache` 等若不同，按实际构造签名调整 mock 入参）。先读 `resume_evaluation_service.py` 的 `__init__` 确认形参名再写测试。

- [ ] **Step 2: 运行测试确认失败**

Run: `cd backend && python -m pytest tests/services/test_resume_evaluation_service_errors.py -v`
Expected: FAIL（helper 不存在）

- [ ] **Step 3: 实现（与 Task 3 同构）**

修改 `backend/app/services/resume_evaluation_service.py`：import 加 `uuid`、`interrupt`、`ValidationError`；加 `build_resume_upload_interaction`（文案改为评估场景）：

```python
    def build_resume_upload_interaction(self) -> dict:
        """构造简历上传 interaction payload（缺简历时 interrupt 用）。"""
        return {
            "request_id": f"resume_{uuid.uuid4().hex[:8]}",
            "interaction_type": "resume_upload",
            "title": "需要先上传一份简历",
            "prompt": "检测到尚未附带简历文件。简历评估需要基于简历内容，请上传后继续（上传后自动续接，无需重新发送）。",
            "data": {},
        }
```

替换 `load_resume` 方法体为（与 Task 3 同逻辑）：

```python
    async def load_resume(self, state, ctx: WorkflowRuntimeContext) -> dict:
        """按 file_path 解析简历原文；缺简历时 interrupt 弹上传卡，上传后续接解析。"""
        writer = get_stream_writer()
        idx = ctx.emitter.next_block_index()
        file_path = str((state.get("resume_ref") or {}).get("file_path") or "")
        if not file_path:
            user_values = interrupt(self.build_resume_upload_interaction())
            file_path = str(user_values.get("file_path") or "")
            if not file_path:
                raise ValidationError("未收到简历文件路径，无法继续")
        writer(ctx.emitter.emit_block_start(index=idx, block={
            "type": "tool_use", "tool_name": "load_resume",
            "display_name": "读取简历", "input": {"file_path": file_path}, "status": "running",
        }))
        try:
            text = await self._loader.load_by_path(file_path=file_path) if file_path else ""
        finally:
            writer(ctx.emitter.emit_block_stop(index=idx))
        return {"resume_text": text, "resume_ref": {"file_path": file_path}}
```

- [ ] **Step 4: 运行测试确认通过**

Run: `cd backend && python -m pytest tests/services/test_resume_evaluation_service_errors.py -v`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add backend/app/services/resume_evaluation_service.py backend/tests/services/test_resume_evaluation_service_errors.py
git commit -m "feat(agent): A1 evaluation load_resume 缺简历 interrupt 弹上传卡"
```

---

## Task 5: 后端 — progress 持久化（runtime_service）

**Files:**
- Modify: `backend/app/services/agent_runtime_service.py`
- Modify: `backend/app/repositories/agent_repository.py`（加 `get_session`，若不存在）
- Test: `backend/tests/services/test_agent_runtime_service.py`

- [ ] **Step 1: 确认 repo 有 get_session（若无则加）**

先读 `backend/app/repositories/agent_repository.py` 看是否有按 id 取 session 的方法。若无，加：

```python
    async def get_session(self, session_id: int) -> AgentSession | None:
        """按 id 取会话（progress 持久化读取用）。"""
        result = await self._db.execute(select(AgentSession).where(AgentSession.id == session_id))
        return result.scalar_one_or_none()
```

（`select` / `AgentSession` 已在该文件 import。）

- [ ] **Step 2: 写失败测试**

在 `backend/tests/services/test_agent_runtime_service.py` 末尾追加。需在 `_make_session()` 增 `progress=None` 属性（MagicMock 默认有任意属性，但显式设 None 更准）：

```python
@pytest.mark.asyncio
async def test_stream_message_persists_progress_reset_for_new_task():
    """stream_message（新 task）持久化 progress：reset=True，仅含本 run 的 steps。"""
    captured = {}
    svc = _build_svc()
    # 让 runner 产出一个 step.update
    async def _astream(*, thread_id, graph_input, ctx):
        yield ctx.emitter.emit_step(step_id="load_resume", title="读取简历", status="success")
    svc._runner_factory = lambda graph: MagicMock(astream=_astream)
    session = _make_session()
    session.progress = {"workflow_type": "interview_questions", "steps": [
        {"step_id": "old_step", "title": "旧", "status": "success"}]}
    # 捕获 update_session 调用的 progress 入参
    async def _capture_update(session_id, **kwargs):
        if "progress" in kwargs:
            captured["progress"] = kwargs["progress"]
        return session
    svc._repo.update_session = _capture_update
    body = AgentMessageCreate(content="hi", workflow_type="interview_questions")
    async for _env in svc.stream_message(session=session, body=body, runtime_config=_runtime_cfg()):
        pass
    assert "progress" in captured
    steps = captured["progress"]["steps"]
    assert captured["progress"]["workflow_type"] == "interview_questions"
    # reset：旧 task 的 old_step 不应残留
    assert all(s["step_id"] != "old_step" for s in steps)
    assert any(s["step_id"] == "load_resume" for s in steps)


@pytest.mark.asyncio
async def test_resolve_interaction_merges_progress_without_reset():
    """resolve_interaction（续接）持久化 progress：reset=False，合并已有 steps。"""
    captured = {}
    svc = _build_svc()
    async def _astream(*, thread_id, graph_input, ctx):
        yield ctx.emitter.emit_step(step_id="suggest_dimensions", title="分析维度", status="success")
    svc._runner_factory = lambda graph: MagicMock(astream=_astream)
    session = _make_session()
    session.progress = {"workflow_type": "interview_questions", "steps": [
        {"step_id": "load_resume", "title": "读取简历", "status": "success"}]}
    async def _capture_update(session_id, **kwargs):
        if "progress" in kwargs:
            captured["progress"] = kwargs["progress"]
        return session
    svc._repo.update_session = _capture_update
    body = AgentInteractionSubmit(values={"selected_dimensions": []}, workflow_type="interview_questions")
    async for _env in svc.resolve_interaction(
        session=session, request_id="req1", body=body,
        runtime_config=_runtime_cfg(), workflow_type="interview_questions",
    ):
        pass
    steps = captured["progress"]["steps"]
    # 合并：既有 load_resume + 新增 suggest_dimensions 都在
    ids = [s["step_id"] for s in steps]
    assert "load_resume" in ids and "suggest_dimensions" in ids
```

- [ ] **Step 3: 运行测试确认失败**

Run: `cd backend && python -m pytest tests/services/test_agent_runtime_service.py -k "progress" -v`
Expected: FAIL（`progress` 未被持久化）

- [ ] **Step 4: 实现 _persist_progress + 接入三处 finally**

在 `backend/app/services/agent_runtime_service.py` 加方法（放在 `_persist_block_index` 之后）：

```python
    async def _persist_progress(
        self, session, run_steps: list[dict], workflow_type: str, *, reset: bool,
    ) -> None:
        """把本 run 的 step.update 序列合并进 session.progress 并落库。

        @param reset: True=新 task（stream_message），丢弃已有 steps；False=续接（resolve/
                      resume），合并已有 steps（跨 interaction 段累积）。
        """
        existing: list[dict] = []
        if not reset:
            prog = getattr(session, "progress", None) or {}
            existing = (prog.get("steps") or []) if isinstance(prog, dict) else []
        # 按 step_id upsert：新覆盖旧（状态更新），保留首次出现顺序
        by_id: dict[str, dict] = {}
        for s in existing:
            sid = str(s.get("step_id") or "")
            if sid:
                by_id[sid] = s
        for s in run_steps:
            sid = str(s.get("step_id") or "")
            if not sid:
                continue
            entry: dict = {"step_id": sid, "title": s.get("title", ""), "status": s.get("status", "pending")}
            if s.get("detail"):
                entry["detail"] = s["detail"]
            by_id[sid] = entry
        merged = list(by_id.values())
        progress = {"workflow_type": workflow_type, "steps": merged}
        try:
            await self._repo.update_session(session.id, progress=progress)
            session.progress = progress  # 保持内存对象新鲜，供同请求后续读取
        except Exception:
            logger.exception("持久化 progress 失败：session_id=%s", session.id)
```

在三处 run 循环里收集 step.update，并在 finally 持久化。

**stream_message**：在 `async for env in runner.astream(...)` 循环内，`envelope_buffer.append(env)` 之后加：

```python
                    if env.type == "step.update":
                        run_steps.append(env.data)
```

循环前声明 `run_steps: list[dict] = []`（与 `envelope_buffer` 同处）。finally 块内、`_persist_block_index` 调用旁加：

```python
            try:
                await self._persist_progress(
                    session, run_steps, body.workflow_type, reset=True,
                )
            except Exception:
                logger.exception("stream_message 持久化 progress 失败：session_id=%s", session.id)
```

**resolve_interaction**：同样声明 `run_steps`、循环内收集、finally 调用 `reset=False`：

```python
                await self._persist_progress(
                    session, run_steps, workflow_type, reset=False,
                )
```

- [ ] **Step 5: 运行测试确认通过**

Run: `cd backend && python -m pytest tests/services/test_agent_runtime_service.py -k "progress" -v`
Expected: 2 PASS

- [ ] **Step 6: 回归既有 runtime 测试**

Run: `cd backend && python -m pytest tests/services/test_agent_runtime_service.py -v`
Expected: 全 PASS（无回归）

- [ ] **Step 7: Commit**

```bash
git add backend/app/services/agent_runtime_service.py backend/app/repositories/agent_repository.py backend/tests/services/test_agent_runtime_service.py
git commit -m "feat(agent): runtime_service 持久化累积步骤进度到 session.progress"
```

---

## Task 6: 前端 — 类型补充（InteractionType + WorkspaceSession.progress）

**Files:**
- Modify: `frontend/src/types/agent.ts`

- [ ] **Step 1: 写失败测试**

新建 `frontend/src/types/__tests__/agent-types.test.ts`：

```typescript
import { describe, it, expectTypeOf } from 'vitest';
import type { InteractionType, WorkspaceSession } from '../agent';

describe('agent types', () => {
  it('InteractionType 含 resume_upload', () => {
    const t: InteractionType = 'resume_upload';
    expectTypeOf(t).toEqualTypeOf<InteractionType>();
  });
  it('WorkspaceSession 有可选 progress', () => {
    const s: WorkspaceSession = {} as WorkspaceSession;
    s.progress = { workflow_type: 'interview_questions', steps: [] };
    expectTypeOf(s.progress).toMatchTypeOf<{ workflow_type: string; steps: unknown[] } | undefined>();
  });
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `cd frontend && npx vitest run src/types/__tests__/agent-types.test.ts`
Expected: FAIL（`resume_upload` 不能赋值 / progress 不存在）

- [ ] **Step 3: 改 types/agent.ts**

修改 `frontend/src/types/agent.ts`：

```typescript
export type InteractionType =
  | 'dimension_selection' | 'plan_approval' | 'job_selection' | 'resume_upload';
```

`WorkspaceSession` interface 加：

```typescript
  /** 累积步骤进度（进度栏持久化展示；后端 agent_session.progress） */
  progress?: { workflow_type: WorkflowType; steps: AgentStep[] };
```

（放在 `status: number;` 之前或之后均可。）

- [ ] **Step 4: 运行测试确认通过**

Run: `cd frontend && npx vitest run src/types/__tests__/agent-types.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add frontend/src/types/agent.ts frontend/src/types/__tests__/agent-types.test.ts
git commit -m "feat(agent-fe): 类型补充 resume_upload + WorkspaceSession.progress"
```

---

## Task 7: 前端 — A3 JobSelection 分页 + 手动搜索 + 节流

**Files:**
- Modify: `frontend/src/components/employee/agent/blocks/interaction-block.tsx`
- Test: `frontend/src/components/employee/agent/blocks/__tests__/job-selection.test.tsx`（新建）

- [ ] **Step 1: 写失败测试**

新建 `frontend/src/components/employee/agent/blocks/__tests__/job-selection.test.tsx`：

```typescript
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { InteractionBlock } from '../interaction-block';

const candidates = Array.from({ length: 12 }, (_, i) => ({
  name: `岗位${i + 1}`, description: `描述${i + 1}`,
}));

function renderPending() {
  return render(
    <InteractionBlock
      block={{
        type: 'interaction', index: 0, request_id: 'job_1',
        interaction_type: 'job_selection', title: '请选择岗位',
        prompt: '', data: { candidates }, status: 'pending',
      }}
      submitting={false}
      onSubmit={vi.fn()}
    />,
  );
}

describe('JobSelection 分页+手动搜索', () => {
  it('初始仅渲染 5 条（第一页）', () => {
    renderPending();
    expect(screen.getByRole('button', { name: '岗位1' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '岗位6' })).not.toBeInTheDocument();
  });

  it('输入不触发过滤（手动搜索）', () => {
    renderPending();
    fireEvent.change(screen.getByPlaceholderText(/点击搜索/), { target: { value: '岗位1' } });
    // 仍渲染第一页 5 条，未过滤
    expect(screen.getByRole('button', { name: '岗位2' })).toBeInTheDocument();
  });

  it('点击搜索按钮触发过滤', async () => {
    renderPending();
    fireEvent.change(screen.getByPlaceholderText(/点击搜索/), { target: { value: '岗位1' } });
    fireEvent.click(screen.getByRole('button', { name: '搜索' }));
    await waitFor(() => {
      expect(screen.getByRole('button', { name: '岗位1' })).toBeInTheDocument();
      expect(screen.queryByRole('button', { name: '岗位2' })).not.toBeInTheDocument();
    });
  });

  it('节流：300ms 内连点搜索只生效首次', async () => {
    const { container } = renderPending();
    vi.useFakeTimers({ shouldAdvanceTime: true });
    fireEvent.change(screen.getByPlaceholderText(/点击搜索/), { target: { value: '岗位' } });
    fireEvent.click(screen.getByRole('button', { name: '搜索' }));
    // 立即再点（应被节流忽略）
    fireEvent.change(screen.getByPlaceholderText(/点击搜索/), { target: { value: '岗位1' } });
    fireEvent.click(screen.getByRole('button', { name: '搜索' }));
    // 第一次生效（过滤"岗位"→12条→第一页5条含岗位2）；第二次被节流
    expect(screen.getByRole('button', { name: '岗位2' })).toBeInTheDocument();
    vi.useRealTimers();
  });

  it('翻页：下一页展示 6-10', () => {
    renderPending();
    fireEvent.click(screen.getByRole('button', { name: /下一页|▶/ }) || screen.getAllByRole('button').slice(-1)[0]);
    // 页码点第 2 个或下一页按钮
  });
});
```

> 注：测试中"下一页"按钮的 accessible name 以实际渲染为准（`aria-label`），实现时给翻页按钮加 `aria-label="下一页"` / `aria-label="上一页"` 以稳定定位。

- [ ] **Step 2: 运行测试确认失败**

Run: `cd frontend && npx vitest run src/components/employee/agent/blocks/__tests__/job-selection.test.tsx`
Expected: FAIL（当前一次性渲染全部 candidates）

- [ ] **Step 3: 重写 JobSelection 组件**

在 `frontend/src/components/employee/agent/blocks/interaction-block.tsx` 中替换 `JobSelection` 函数（保留 `ReadOnlyJobSelection` 不变），并在文件顶部 import 加 `useRef`：

```typescript
import { useRef, useState } from 'react';
```

```typescript
const JOB_PAGE_SIZE = 5;
const JOB_SEARCH_THROTTLE_MS = 300;

/** 岗位选择卡：分页（5/页）+ 手动搜索（按钮/Enter 触发，leading-edge 节流）。
 *  提交 { selected_job_name }。不随输入自动过滤；节流防连点。 */
function JobSelection({ title, prompt, data, submitting, onSubmit }: SectionProps) {
  const candidates = (data?.candidates ?? []) as Array<{ name?: unknown; description?: unknown }>;
  const [selected, setSelected] = useState<string | null>(null);
  const [query, setQuery] = useState('');        // 输入框文本
  const [appliedQuery, setAppliedQuery] = useState(''); // 已应用的搜索词
  const [page, setPage] = useState(0);
  const lastSearchRef = useRef(0);               // 节流时间戳（不进 state）

  // 过滤后的候选（按已应用的 appliedQuery，非输入中的 query）
  const filtered = appliedQuery.trim()
    ? candidates.filter(c => {
        const q = appliedQuery.trim().toLowerCase();
        return String(c.name ?? '').toLowerCase().includes(q)
            || String(c.description ?? '').toLowerCase().includes(q);
      })
    : candidates;
  const totalPages = Math.max(1, Math.ceil(filtered.length / JOB_PAGE_SIZE));
  const safePage = Math.min(page, totalPages - 1);
  const pageJobs = filtered.slice(safePage * JOB_PAGE_SIZE, safePage * JOB_PAGE_SIZE + JOB_PAGE_SIZE);

  /** 执行搜索：读输入框当前值 → 应用过滤 → 重置第 1 页。
   *  节流：距上次执行不足 300ms 忽略（防连点/Enter+点击叠加）。 */
  const applySearch = () => {
    const now = Date.now();
    if (now - lastSearchRef.current < JOB_SEARCH_THROTTLE_MS) return;
    lastSearchRef.current = now;
    setAppliedQuery(query);
    setPage(0);
    // 已选岗被过滤掉则清空
    if (selected && !filtered.some(c => String(c.name ?? '') === selected)) {
      // filtered 基于 appliedQuery 旧值，用 query 预判
      const q = query.trim().toLowerCase();
      const stillIn = candidates.some(c => String(c.name ?? '').toLowerCase().includes(q)
        && String(c.name ?? '') === selected);
      if (!stillIn) setSelected(null);
    }
  };
  const clearSearch = () => {
    setQuery(''); setAppliedQuery(''); setPage(0); lastSearchRef.current = 0;
  };

  return (
    <div className="rounded-md border border-[#0EA5E9]/40 bg-white shadow-sm px-4 py-3">
      <p className="text-sm font-semibold text-[#020617]">{title}</p>
      {prompt && <p className="text-xs text-[#64748B] mt-1 mb-3">{prompt}</p>}

      {/* 搜索框 + 搜索按钮（手动触发） */}
      <div className={`flex items-center gap-2 px-3 py-2 mb-3 rounded-lg border bg-[#F1F5F9]
                       focus-within:border-[#0EA5E9] focus-within:bg-white focus-within:shadow-[0_0_0_3px_rgba(14,165,233,0.18)]
                       transition-all ${query ? '' : ''}`}>
        <svg className="w-4 h-4 text-[#94A3B8]" viewBox="0 0 24 24" fill="none" stroke="currentColor"><circle cx="11" cy="11" r="7"/><path d="M21 21l-4.3-4.3" strokeLinecap="round"/></svg>
        <input
          type="text"
          value={query}
          onChange={e => setQuery(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); applySearch(); } }}
          placeholder="输入岗位名称或技能方向，点击搜索"
          className="flex-1 min-w-0 bg-transparent border-none outline-none text-sm text-[#020617] placeholder:text-[#94A3B8]"
        />
        {query && (
          <button type="button" onClick={clearSearch} aria-label="清除搜索"
                  className="text-[#94A3B8] hover:text-[#DC2626] text-xs px-1">×</button>
        )}
        <button type="button" onClick={applySearch} aria-label="搜索"
                className="px-3 py-1 rounded-md bg-gradient-to-b from-[#0EA5E9] to-[#0369A1]
                           text-white text-xs font-semibold active:scale-95 transition-transform">
          搜索
        </button>
      </div>

      {/* 岗位列表（当前页） */}
      {pageJobs.length === 0 ? (
        <p className="text-xs text-[#94A3B8] mb-3 py-4 text-center">未找到匹配「{appliedQuery}」的岗位</p>
      ) : (
        <div className="space-y-1.5 mb-3">
          {pageJobs.map((c, i) => {
            const name = String(c.name ?? `岗位 ${i + 1}`);
            const desc = c.description ? String(c.description) : null;
            const isSelected = selected === name;
            return (
              <button key={name} type="button"
                className={`w-full flex flex-col items-start px-3 py-2 rounded-md border text-left text-sm transition-all
                  ${isSelected ? 'border-[#0EA5E9] bg-[#0EA5E9]/5 text-[#0369A1]' : 'border-[#E2E8F0] bg-white hover:bg-[#F8FAFC] text-[#020617]'}`}
                onClick={() => setSelected(name)}>
                <span className="font-medium">{name}</span>
                {desc && <span className="text-[#94A3B8] text-xs mt-0.5">{desc}</span>}
              </button>
            );
          })}
        </div>
      )}

      {/* 分页器 */}
      <div className="flex items-center justify-between pt-2 border-t border-[#E2E8F0] mb-3">
        <span className="text-[11px] text-[#94A3B8] font-mono">
          第 {safePage + 1} / {totalPages} 页 · 共 {filtered.length} 条
        </span>
        <div className="flex items-center gap-1.5">
          <button type="button" aria-label="上一页" disabled={safePage === 0}
                  onClick={() => setPage(p => Math.max(0, p - 1))}
                  className="w-7 h-7 rounded-md border border-[#E2E8F0] bg-white text-[#64748B]
                             disabled:opacity-35 hover:border-[#0EA5E9] hover:text-[#0369A1] flex items-center justify-center">
            ‹
          </button>
          {Array.from({ length: totalPages }).map((_, i) => (
            <span key={i} className={`rounded-full transition-all ${i === safePage
              ? 'w-4 h-1.5 bg-gradient-to-r from-[#0EA5E9] to-[#0369A1]' : 'w-1.5 h-1.5 bg-[#E2E8F0]'}`} />
          ))}
          <button type="button" aria-label="下一页" disabled={safePage >= totalPages - 1}
                  onClick={() => setPage(p => Math.min(totalPages - 1, p + 1))}
                  className="w-7 h-7 rounded-md border border-[#E2E8F0] bg-white text-[#64748B]
                             disabled:opacity-35 hover:border-[#0EA5E9] hover:text-[#0369A1] flex items-center justify-center">
            ›
          </button>
        </div>
      </div>

      <button type="button"
        className="px-4 py-1.5 rounded-md bg-[#0369A1] text-white text-sm font-medium hover:bg-[#0EA5E9] transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
        disabled={!selected || submitting}
        onClick={() => selected && onSubmit({ selected_job_name: selected })}>
        {submitting ? '提交中…' : '确认选择'}
      </button>
    </div>
  );
}
```

- [ ] **Step 4: 运行测试确认通过**

Run: `cd frontend && npx vitest run src/components/employee/agent/blocks/__tests__/job-selection.test.tsx`
Expected: PASS（4-5 用例）

- [ ] **Step 5: 类型检查 + 构建**

Run: `cd frontend && npx tsc --noEmit`
Expected: 无错误

- [ ] **Step 6: Commit**

```bash
git add frontend/src/components/employee/agent/blocks/interaction-block.tsx frontend/src/components/employee/agent/blocks/__tests__/job-selection.test.tsx
git commit -m "feat(agent-fe): A3 岗位选择分页(5/页)+手动搜索+节流"
```

---

# 期二：A2 + B1

## Task 8: 后端 — A2 client_aborted 不推进 task_id

**Files:**
- Modify: `backend/app/services/agent_runtime_service.py`
- Test: `backend/tests/services/test_agent_runtime_service.py`

- [ ] **Step 1: 写失败测试**

在 `test_agent_runtime_service.py` 追加：

```python
@pytest.mark.asyncio
async def test_stream_message_client_abort_does_not_advance_task_id():
    """client_aborted 不再推进 task_id（A2：保留 checkpoint 供续接）。"""
    svc = _build_svc()
    # runner 抛 GeneratorExit 模拟客户端断开
    async def _astream(*, thread_id, graph_input, ctx):
        yield ctx.emitter.emit_step(step_id="load_resume", title="读取简历", status="running")
        raise GeneratorExit
    svc._runner_factory = lambda graph: MagicMock(astream=_astream)
    advance_calls = []
    async def _update(session_id, **kwargs):
        if "current_task_id" in kwargs:
            advance_calls.append(kwargs["current_task_id"])
        return _make_session()
    svc._repo.update_session = _update
    session = _make_session()
    session.progress = None
    body = AgentMessageCreate(content="hi", workflow_type="interview_questions")
    try:
        async for _env in svc.stream_message(session=session, body=body, runtime_config=_runtime_cfg()):
            pass
    except GeneratorExit:
        pass
    # task_id 不应被推进（无 current_task_id 写入）
    assert advance_calls == []
```

- [ ] **Step 2: 运行测试确认失败**

Run: `cd backend && python -m pytest tests/services/test_agent_runtime_service.py::test_stream_message_client_abort_does_not_advance_task_id -v`
Expected: FAIL（当前 `advance = graph_completed or client_aborted` 会推进）

- [ ] **Step 3: 改 advance 逻辑**

`backend/app/services/agent_runtime_service.py` 的 `stream_message` finally 块：

```python
            # 仅 graph 真正走到 END 才推进 task_id（A2：client_aborted 保留 thread 供续接）。
            # ii 模型：不支持放弃，新问题只在 END 后发生。
            advance = graph_completed
            next_task_id = await self._advance_task_id(session) if advance else None
```

`resolve_interaction` finally 块同样改：

```python
            advance = graph_completed
            next_task_id = await self._advance_task_id(session) if advance else None
```

- [ ] **Step 4: 运行测试确认通过 + 回归**

Run: `cd backend && python -m pytest tests/services/test_agent_runtime_service.py -v`
Expected: 全 PASS

- [ ] **Step 5: Commit**

```bash
git add backend/app/services/agent_runtime_service.py backend/tests/services/test_agent_runtime_service.py
git commit -m "fix(agent): A2 client_aborted 不推进 task_id，保留 checkpoint 供续接"
```

---

## Task 9: 后端 — A2 resume_run 方法 + progress 接入

**Files:**
- Modify: `backend/app/services/agent_runtime_service.py`
- Test: `backend/tests/services/test_agent_runtime_service.py`

- [ ] **Step 1: 写失败测试**

追加：

```python
@pytest.mark.asyncio
async def test_resume_run_uses_none_input_on_same_thread():
    """resume_run 以 graph_input=None 在同 thread 续接，不推进 task_id。"""
    svc = _build_svc()
    captured = {}
    async def _astream(*, thread_id, graph_input, ctx):
        captured["thread_id"] = thread_id
        captured["graph_input"] = graph_input
        yield ctx.emitter.emit_step(step_id="suggest_dimensions", title="分析维度", status="running")
    svc._runner_factory = lambda graph: MagicMock(astream=_astream)
    session = _make_session()  # current_task_id="existing-task-id"
    session.progress = None
    async for _env in svc.resume_run(
        session=session, runtime_config=_runtime_cfg(), workflow_type="interview_questions",
    ):
        pass
    assert captured["graph_input"] is None          # None 续接，非新 input
    assert captured["thread_id"] == "existing-task-id"  # 同 thread，未推进
```

- [ ] **Step 2: 运行测试确认失败**

Run: `cd backend && python -m pytest tests/services/test_agent_runtime_service.py::test_resume_run_uses_none_input_on_same_thread -v`
Expected: FAIL（`resume_run` 不存在）

- [ ] **Step 3: 实现 resume_run**

在 `agent_runtime_service.py` 的 `resolve_interaction` 方法后加（结构镜像 resolve_interaction，去掉 interaction 回执，graph_input=None）：

```python
    async def resume_run(
        self, *, session, runtime_config: LLMRuntimeConfigDTO, workflow_type: str,
    ) -> AsyncIterator[AgentStreamEnvelope]:
        """从 checkpoint 续接被中断的 run（A2）。

        graph_input=None → LangGraph 从该 thread 最近 checkpoint 继续：被中断节点重跑
        （部分输出已在历史消息，本次作为新 agent 消息追加），后续节点正常执行。
        不推进 task_id（ii：不支持放弃，仅 END 推进）。
        """
        run_id = f"run_{uuid.uuid4().hex[:12]}"
        index_start = await self._resolve_block_index_start(session)
        emitter = AgentStreamEmitter(
            session_id=session.id, run_id=run_id, workflow_type=workflow_type,
            index_start=index_start,
        )
        ctx = WorkflowRuntimeContext(
            emitter=emitter, runtime_config=runtime_config,
            interview_service=self._interview_service,
            evaluation_service=self._evaluation_service,
            resume_loader=self._resume_loader,
            session_id=session.id, employee_id=session.employee_id, run_id=run_id,
        )
        # 续接 run：resume=True 让前端不清空 current_blocks
        start_env = emitter.emit_run_start(
            enable_thinking=runtime_config.enable_thinking, user_message_id=None, resume=True,
        )
        await self._buffer_append(session.id, run_id, start_env)
        yield start_env

        envelope_buffer: list[AgentStreamEnvelope] = [start_env]
        run_steps: list[dict] = []
        runner = self._runner_factory(self._workflow_graphs[workflow_type])
        thread_id = await self._resolve_thread_id(session)
        graph_completed = False
        client_aborted = False
        try:
            try:
                async for env in runner.astream(
                    thread_id=thread_id, graph_input=None, ctx=ctx,
                ):
                    envelope_buffer.append(env)
                    if env.type == "step.update":
                        run_steps.append(env.data)
                    await self._buffer_append(session.id, run_id, env)
                    yield env
            except (GeneratorExit, asyncio.CancelledError):
                client_aborted = True
                logger.info("客户端中断 resume run：session_id=%s run_id=%s", session.id, run_id)
                raise
            except Exception as exc:
                graph_completed = False
                # checkpoint 丢失（服务重启）→ 专属错误码，前端降级
                code = "no_resumable_checkpoint" if _is_missing_checkpoint_error(exc) else "graph_execution_failed"
                logger.exception("resume run 失败：session_id=%s run_id=%s", session.id, run_id)
                err_env = emitter.emit_run_error(code=code, message=str(exc), retriable=False)
                envelope_buffer.append(err_env)
                await self._buffer_append(session.id, run_id, err_env)
                yield err_env
            else:
                graph_completed = not self._has_interrupt(envelope_buffer)
        finally:
            try:
                agent_message = await self._persist_agent_message(
                    session=session, user_message=None, run_id=run_id,
                    envelopes=envelope_buffer, runtime_config=runtime_config,
                    workflow_type=workflow_type,
                )
            except Exception:
                logger.exception("resume 收尾落库失败：session_id=%s run_id=%s", session.id, run_id)
                agent_message = None
            advance = graph_completed  # 仅 END 推进；中断/错误保留 thread
            next_task_id = await self._advance_task_id(session) if advance else None
            try:
                await self._persist_block_index(session.id, emitter.max_block_index_used)
            except Exception:
                logger.exception("延时落库 block index 失败：session_id=%s", session.id)
            try:
                await self._persist_progress(session, run_steps, workflow_type, reset=False)
            except Exception:
                logger.exception("resume 持久化 progress 失败：session_id=%s", session.id)
            if not client_aborted and agent_message is not None:
                finish_env = emitter.emit_run_finish(
                    agent_message_id=agent_message.id, next_task_id=next_task_id,
                )
                await self._buffer_append(session.id, run_id, finish_env)
                yield finish_env
            try:
                await self._cache.client.delete(STREAM_BUFFER_KEY.format(session_id=session.id, run_id=run_id))
            except Exception:
                logger.exception("清理 stream buffer 失败：session_id=%s run_id=%s", session.id, run_id)
```

在文件模块级加 checkpoint 丢失判定 helper：

```python
def _is_missing_checkpoint_error(exc: Exception) -> bool:
    """判定是否为 checkpoint 丢失错误（InMemorySaver 服务重启后 resume）。

    LangGraph 在 thread 无 checkpoint 时以 None 输入续接会抛 KeyError/ValueError，
    含 "checkpoint" 或 "thread" 相关信息。宽松匹配避免漏判。
    """
    msg = str(exc).lower()
    return "checkpoint" in msg or "no state" in msg or ("thread" in msg and "not found" in msg)
```

- [ ] **Step 4: 运行测试确认通过**

Run: `cd backend && python -m pytest tests/services/test_agent_runtime_service.py::test_resume_run_uses_none_input_on_same_thread -v`
Expected: PASS

- [ ] **Step 5: 回归**

Run: `cd backend && python -m pytest tests/services/test_agent_runtime_service.py -v`
Expected: 全 PASS

- [ ] **Step 6: Commit**

```bash
git add backend/app/services/agent_runtime_service.py backend/tests/services/test_agent_runtime_service.py
git commit -m "feat(agent): A2 resume_run 从 checkpoint 续接被中断的 run"
```

---

## Task 10: 后端 — A2 POST /sessions/{id}/resume 端点

**Files:**
- Modify: `backend/app/api/v1/endpoints/agent.py`
- Test: 手工/集成（端点薄壳，复用 resume_run 已测逻辑）

- [ ] **Step 1: 加端点**

在 `backend/app/api/v1/endpoints/agent.py` 的 `submit_interaction` 之后、`abort_session` 之前加：

```python
@agent_router.post("/sessions/{session_id}/resume")
async def resume_session(
    body: AgentInteractionSubmit,
    session_id: int = Path(..., ge=1),
    current_user: dict = Depends(get_current_user),
    session_svc: AgentSessionService = Depends(_get_session_service),
    runtime_svc: AgentRuntimeService = Depends(_get_runtime_service),
    llm_svc: LlmConfigService = Depends(_get_llm_service),
):
    """续接被中断的 run（A2）。

    场景：流式 run 被 client_aborted 打断（刷新/断网/点中断），task_id 未推进、
    checkpoint 完好。本端点以 graph_input=None 在同 thread 续接，从断点继续。
    服务重启后 checkpoint 丢失 → 返回 run.error(no_resumable_checkpoint)。
    """
    session = await session_svc._require_session(session_id, current_user)
    workflow_type = body.workflow_type
    model_name = (
        body.runtime_options.model_name
        if body.runtime_options and body.runtime_options.model_name
        else session.selected_model_name
    )
    runtime_config = await llm_svc.get_runtime_config(current_user, model_name)
    enable_thinking = bool(
        body.runtime_options and body.runtime_options.enable_thinking is not None
        and body.runtime_options.enable_thinking
    )
    runtime_config = runtime_config.model_copy(update={"enable_thinking": enable_thinking})

    async def _generator():
        async for env in runtime_svc.resume_run(
            session=session, runtime_config=runtime_config, workflow_type=workflow_type,
        ):
            yield {"event": "agent", "data": env.model_dump_json()}

    return EventSourceResponse(_generator())
```

> 复用 `AgentInteractionSubmit` 作为请求体（含 `workflow_type` + `runtime_options`，字段契合；`values` 续接场景不用但保留）。

- [ ] **Step 2: 启动后端确认路由注册无报错**

Run: `cd backend && python -c "from app.api.v1.endpoints.agent import agent_router; print([r.path for r in agent_router.routes if 'resume' in r.path])"`
Expected: `['/employee/agent/sessions/{session_id}/resume']`

- [ ] **Step 3: Commit**

```bash
git add backend/app/api/v1/endpoints/agent.py
git commit -m "feat(agent): A2 POST /sessions/{id}/resume 续接端点"
```

---

## Task 11: 前端 — A2 resumeSession API + resumeRun store action

**Files:**
- Modify: `frontend/src/api/employee/agent.ts`
- Modify: `frontend/src/store/agent.ts`
- Test: `frontend/src/store/__tests__/agent-resume.test.ts`（新建）

- [ ] **Step 1: 加 API 方法**

`frontend/src/api/employee/agent.ts` 的 `employeeAgentApi` 内，`submitInteraction` 后加：

```typescript
  /** 续接被中断的 run（A2）。返回 SSE AsyncIterableIterator。 */
  resumeSession: (
    sessionId: number,
    workflowType: WorkflowType,
    runtimeOptions: { enableThinking: boolean; modelName: string | null },
    signal?: AbortSignal,
  ): AsyncIterableIterator<AgentEnvelope> => {
    return openAgentStream(
      `/api/v1/employee/agent/sessions/${sessionId}/resume`,
      {
        values: {}, workflow_type: workflowType,
        runtime_options: {
          enable_thinking: runtimeOptions.enableThinking,
          ...(runtimeOptions.modelName ? { model_name: runtimeOptions.modelName } : {}),
        },
      },
      { signal },
    );
  },
```

- [ ] **Step 2: 加 store action**

`frontend/src/store/agent.ts`：在 `AgentStoreState` interface 加签名（`submitInteraction` 旁）：

```typescript
  resumeRun: (sessionId: number) => Promise<void>;
```

实现（在 `submitInteraction` 实现后，结构镜像）：

```typescript
  resumeRun: async (sessionId) => {
    const entry = get().runs[sessionId];
    const lastMsg = entry?.messages?.[entry.messages.length - 1];
    const workflowType: WorkflowType =
      lastMsg?.workflow_type ?? entry?.runState.workflow_type ?? 'interview_questions';
    const ac = new AbortController();
    abortControllers.set(sessionId, ac);
    set((s) => ({ runs: { ...s.runs, [sessionId]: { ...getRun(s.runs, sessionId), sending: true } } }));
    const runPromise = (async () => {
      try {
        const enableThinking = !!entry?.session?.enable_thinking;
        const modelName = entry?.session?.selected_model_name ?? null;
        const iter = employeeAgentApi.resumeSession(sessionId, workflowType, { enableThinking, modelName }, ac.signal);
        await runEnvelopes(sessionId, iter);
      } finally {
        set((s) => ({ runs: { ...s.runs, [sessionId]: { ...getRun(s.runs, sessionId), sending: false } } }));
        abortControllers.delete(sessionId);
        runningRunPromises.delete(sessionId);
      }
    })();
    runningRunPromises.set(sessionId, runPromise);
    await runPromise;
  },
```

- [ ] **Step 3: 写测试（验证 action 调用 API + 注册 promise）**

新建 `frontend/src/store/__tests__/agent-resume.test.ts`：

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { useAgentStore } from '../agent';

vi.mock('@/api/employee/agent', () => ({
  employeeAgentApi: {
    resumeSession: vi.fn(() => (async function* () { /* 空 SSE */ })()),
    getSession: vi.fn(async () => ({ data: { data: { session: { id: 1 }, messages: [] } } })),
  },
}));

describe('resumeRun action', () => {
  beforeEach(() => useAgentStore.setState({ runs: { 1: {
    session: { id: 1, enable_thinking: false, selected_model_name: null } as never,
    messages: [{ id: 5, workflow_type: 'interview_questions' } as never],
    runState: { workflow_type: 'interview_questions' } as never,
    sending: false, loaded: true,
  } }, activeId: 1 }));

  it('resumeRun 调用 resumeSession 并置 sending', async () => {
    const { employeeAgentApi } = await import('@/api/employee/agent');
    await useAgentStore.getState().resumeRun(1);
    expect(employeeAgentApi.resumeSession).toHaveBeenCalledWith(
      1, 'interview_questions', { enableThinking: false, modelName: null }, expect.any(AbortSignal),
    );
    expect(useAgentStore.getState().runs[1].sending).toBe(false); // finally 后归 false
  });
});
```

- [ ] **Step 4: 运行测试确认通过**

Run: `cd frontend && npx vitest run src/store/__tests__/agent-resume.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add frontend/src/api/employee/agent.ts frontend/src/store/agent.ts frontend/src/store/__tests__/agent-resume.test.ts
git commit -m "feat(agent-fe): A2 resumeSession API + resumeRun store action"
```

---

## Task 12: 前端 — A2 InterruptBar 恢复语义 + Composer 未完成禁用

**Files:**
- Modify: `frontend/src/components/employee/agent/interrupt-bar.tsx`
- Modify: `frontend/src/components/employee/agent/agent-composer.tsx`
- Modify: `frontend/src/components/employee/agent/agent-workspace.tsx`

- [ ] **Step 1: InterruptBar 增恢复回调**

`interrupt-bar.tsx`：props 加 `onResume`，按钮区分"恢复"（中断态）/"重试"（错误态）：

```typescript
export interface InterruptBarProps {
  /** 重试触发（错误态用：放弃当前 task 重发） */
  onRetry: () => void;
  /** 恢复触发（中断态用：续接 checkpoint）。提供时显示"恢复"按钮 */
  onResume?: () => void;
  /** 是否错误态（true=重试语义；false/缺省=中断态恢复语义） */
  isError?: boolean;
  retrying?: boolean;
  resuming?: boolean;
}

export function InterruptBar({ onRetry, onResume, isError, retrying, resuming }: InterruptBarProps) {
  const isResumeMode = !isError && onResume;
  return (
    <div role="status" aria-label={isResumeMode ? '本次任务已中断' : '运行出错'}
         className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-[#FFF7ED] border border-[#FB923C]/40 text-[12.5px] text-[#9A3412] font-medium mt-3">
      <span aria-hidden="true" className="inline-flex w-4 h-4 rounded-full bg-[#FED7AA] text-[#EA580C] text-[11px] font-bold items-center justify-center">!</span>
      <span>{isResumeMode ? '本次任务已中断' : '运行出错了'}</span>
      {/* 中断态：恢复（续接）；错误态：重试（放弃重发） */}
      <button type="button"
        onClick={isResumeMode ? onResume : onRetry}
        disabled={isResumeMode ? resuming : retrying}
        title={isResumeMode ? '恢复运行' : '重试'}
        className="inline-flex items-center gap-1 h-6 px-2 rounded-full ml-1 text-[#EA580C] hover:bg-[#EA580C]/10 disabled:opacity-60 transition-colors">
        {isResumeMode ? (resuming ? '恢复中…' : '恢复') : (retrying ? '重试中…' : '重试')}
      </button>
    </div>
  );
}
```

- [ ] **Step 2: agent-message-list 透传 onResume + isError**

`agent-message-list.tsx` 的 props 加 `onResume?: () => void`。InterruptBar 渲染处：

```typescript
        {!runState.running && onRetryFromLastUser && onResume && (
          <InterruptBar
            onResume={onResume}
            onRetry={onRetryFromLastUser}
            isError={false}
            resuming={sending}
          />
        )}
```

（`runState.error` 红色 callout 内的"重试"按钮保持不变，仍调 `onRetry`。）

- [ ] **Step 3: agent-workspace 透传 resumeRun**

`agent-workspace.tsx`：从 store 取 `resumeRun`：

```typescript
  const resumeRun = useAgentStore((s) => s.resumeRun);
```

传给 `AgentMessageList`：

```typescript
      <AgentMessageList
        ...既有 props...
        onResume={() => void resumeRun(session.id)}
      />
```

- [ ] **Step 4: Composer 未完成禁用 + 移除 interaction abort**

`agent-composer.tsx`：发送按钮在"工作流未完成"时禁用。判定未完成 = `sending`（流式中）或 `hasPendingInteraction`（interaction 暂停）。修改 `submit` 与按钮：

```typescript
  // ii 模型：工作流未完成期间禁用发送（流式中 / interaction 暂停 / 中断态均禁用）
  const sendDisabled = sending || hasPendingInteraction;
```

`submit` 开头加 `if (sendDisabled) return;`。发送按钮：

```typescript
          <button type="button"
            onClick={submit}
            disabled={sendDisabled || !content.trim()}
            className={`h-9 px-5 rounded-lg text-xs font-semibold transition-all active:scale-[0.97] inline-flex items-center gap-1.5
              bg-gradient-to-b from-[#0EA5E9] to-[#0369A1] text-white ring-1 ring-inset ring-white/15
              shadow-[0_4px_12px_-4px_rgba(3,105,161,0.5)]
              disabled:opacity-40 disabled:cursor-not-allowed disabled:shadow-none`}>
            <Send size={13} />
            <span>{hasPendingInteraction ? '请先完成上方选择' : '发送'}</span>
          </button>
```

移除 `showAbortButton` 相关的红色"中断"morph（`sending || hasPendingInteraction` 不再切红按钮）。删除 `onAbort` 在发送按钮处的绑定与 `Square` 图标用法（保留 `onAbort` prop 供流式中仍可暂停？——ii 下流式中断=暂停→之后可 resume，故保留一个"暂停"入口见下）。

> **保留流式暂停入口：** ii 下"中断"语义=暂停（之后可 resume）。把原红色按钮改为流式中显示"暂停"（仍调 `onAbort`=fetch.abort，中断后 InterruptBar 显示"恢复"）：

```typescript
          {sending && (
            <button type="button" onClick={onAbort}
              className="h-9 px-4 rounded-lg text-xs font-semibold border border-[#DC2626] text-[#DC2626]
                         hover:bg-[#FEE2E2] bg-white shadow-[0_2px_8px_-3px_rgba(220,38,38,0.35)] transition-all active:scale-[0.97]
                         inline-flex items-center gap-1.5">
              <Square size={13} className="fill-current" />
              <span>暂停</span>
            </button>
          )}
```

`hasPendingInteraction` 时**不**显示暂停/中断按钮（interaction 暂停无连接可断），仅禁用发送 + 提示"请先完成上方选择"。

- [ ] **Step 5: 类型检查**

Run: `cd frontend && npx tsc --noEmit`
Expected: 无错误（InterruptBar 新 props、composer 改动、workspace 透传类型一致）

- [ ] **Step 6: Commit**

```bash
git add frontend/src/components/employee/agent/interrupt-bar.tsx frontend/src/components/employee/agent/agent-message-list.tsx frontend/src/components/employee/agent/agent-workspace.tsx frontend/src/components/employee/agent/agent-composer.tsx
git commit -m "feat(agent-fe): A2 InterruptBar 恢复语义 + Composer 未完成禁用(ii)"
```

---

## Task 13: 前端 — B1 安装 framer-motion

**Files:**
- Modify: `frontend/package.json`

- [ ] **Step 1: 安装**

Run: `cd frontend && npm install framer-motion`
Expected: `package.json` dependencies 出现 `"framer-motion": "^..."`，无报错。

- [ ] **Step 2: 验证可导入**

Run: `cd frontend && node -e "import('framer-motion').then(m => console.log(typeof m.motion))"`
Expected: `object`（motion 命名空间存在）

- [ ] **Step 3: Commit**

```bash
git add frontend/package.json frontend/package-lock.json
git commit -m "chore(agent-fe): B1 引入 framer-motion"
```

---

## Task 14: 前端 — B1 ProgressTracker 组件骨架 + 步骤渲染 + 收起/展开

**Files:**
- Create: `frontend/src/components/employee/agent/progress-tracker/progress-tracker.tsx`
- Create: `frontend/src/components/employee/agent/progress-tracker/step-row.tsx`
- Test: `frontend/src/components/employee/agent/progress-tracker/__tests__/progress-tracker.test.tsx`

- [ ] **Step 1: 写失败测试**

新建测试文件：

```typescript
import { describe, it, expect } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { ProgressTracker } from '../progress-tracker';
import type { AgentStep } from '@/types/agent';

const steps: AgentStep[] = [
  { step_id: 'load_resume', title: '读取简历', status: 'success' },
  { step_id: 'suggest_dimensions', title: '分析维度', status: 'running', detail: '正在分析…' },
  { step_id: 'build_question_plan', title: '规划出题', status: 'pending' },
];

describe('ProgressTracker', () => {
  it('渲染步骤标题 + 进度计数', () => {
    render(<ProgressTracker steps={steps} running workflowType="interview_questions" />);
    expect(screen.getByText('读取简历')).toBeInTheDocument();
    expect(screen.getByText('分析维度')).toBeInTheDocument();
    expect(screen.getByText(/2.*8/)).toBeInTheDocument(); // 2/8 步
  });

  it('点击收起按钮后标题文字不可见（宽度过渡）', () => {
    render(<ProgressTracker steps={steps} running workflowType="interview_questions" />);
    fireEvent.click(screen.getByTitle('收起'));
    expect(screen.queryByText('读取简历')).not.toBeInTheDocument();
  });
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `cd frontend && npx vitest run src/components/employee/agent/progress-tracker/__tests__/progress-tracker.test.tsx`
Expected: FAIL（组件不存在）

- [ ] **Step 3: 实现 StepRow**

新建 `step-row.tsx`：

```typescript
/**
 * StepRow：进度栏单步行。
 * 状态：pending(灰圈) / running(脉冲渐变球 + 光波) / success(绿勾) / failed(红X)。
 * running 时标题用 WaveText 波浪文字；连接线已完成段带流光点。
 */
import { motion } from 'framer-motion';
import { Check, X } from 'lucide-react';
import type { AgentStep } from '@/types/agent';
import { WaveText } from '../wave-text';

export function StepRow({ step, isLast, running }: { step: AgentStep; isLast: boolean; running: boolean }) {
  const isRunning = step.status === 'running';
  return (
    <motion.div layout className={`relative grid grid-cols-[28px_1fr] gap-x-2.5 gap-y-1 px-2 py-1.5 rounded-[10px]
      ${isRunning ? 'bg-[linear-gradient(90deg,rgba(14,165,233,0.06),rgba(14,165,233,0.02))]' : ''}`}>
      {/* 连接线 */}
      {!isLast && (
        <span className={`absolute left-[21px] top-[30px] bottom-[-6px] w-0.5 rounded
          ${step.status === 'success' ? 'bg-[linear-gradient(180deg,#0EA5E9,#0369A1)] progress-flow-dot' : 'bg-[#E2E8F0]'}`} />
      )}
      {/* 图标 */}
      <StepIcon status={step.status} running={running} />
      {/* 文字 */}
      <div className="pt-[3px] min-w-0">
        <div className="text-[13px] font-medium leading-tight">
          {isRunning ? <WaveText text={step.title} /> : (
            <span className={step.status === 'pending' ? 'text-[#94A3B8]' : step.status === 'failed' ? 'text-[#DC2626]' : 'text-[#334155]'}>
              {step.title}
            </span>
          )}
        </div>
        {step.detail && isRunning && <div className="text-[11px] text-[#0369A1] mt-0.5 font-mono">{step.detail}</div>}
      </div>
    </motion.div>
  );
}

function StepIcon({ status, running }: { status: AgentStep['status']; running: boolean }) {
  if (status === 'success') return (
    <span className="w-7 h-7 rounded-[9px] bg-[#DCFCE7] text-[#16A34A] flex items-center justify-center relative z-[2]">
      <Check size={14} strokeWidth={2.5} />
    </span>
  );
  if (status === 'running') return (
    <span className="w-7 h-7 rounded-[9px] bg-[linear-gradient(135deg,#0EA5E9,#0369A1)] text-white flex items-center justify-center relative z-[2] progress-icon-pulse">
      <motion.span animate={{ rotate: 360 }} transition={{ repeat: Infinity, duration: 1, ease: 'linear' }}
        className="block w-3 h-3 border-2 border-white/40 border-t-white rounded-full" />
    </span>
  );
  if (status === 'failed') return (
    <span className="w-7 h-7 rounded-[9px] bg-[#FEE2E2] text-[#DC2626] flex items-center justify-center relative z-[2]">
      <X size={14} strokeWidth={2.5} />
    </span>
  );
  return <span className="w-7 h-7 rounded-[9px] bg-white border-2 border-[#CBD5E1] flex items-center justify-center relative z-[2]" />;
}
```

- [ ] **Step 4: 实现 ProgressTracker**

新建 `progress-tracker.tsx`：

```typescript
/**
 * ProgressTracker：右侧进度追踪栏（B1）。
 * 自上而下垂直步骤列表，可收起（304px↔60px，framer-motion spring 宽度过渡）。
 * 数据源：流式中用传入 steps；非流式用 session.progress（持久化，由父组件选择后传入）。
 * 收起态悬浮单例 tooltip 显示步骤名（progress-tooltip.tsx）。
 */
import { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import type { AgentStep, WorkflowType } from '@/types/agent';
import { mergeStepsWithTemplate, WORKFLOW_STEP_TEMPLATES } from '../workflow-step-templates';
import { StepRow } from './step-row';
import { ProgressTooltip } from './progress-tooltip';

export interface ProgressTrackerProps {
  steps: AgentStep[];
  running: boolean;
  workflowType: WorkflowType;
}

export function ProgressTracker({ steps, running, workflowType }: ProgressTrackerProps) {
  const [collapsed, setCollapsed] = useState(false);
  const merged = mergeStepsWithTemplate(workflowType, steps);
  const total = WORKFLOW_STEP_TEMPLATES[workflowType]?.length ?? merged.length;
  const reached = merged.filter(s => s.status !== 'pending').length;
  const active = [...merged].reverse().find(s => s.status !== 'pending') ?? merged[0];
  const circumference = 2 * Math.PI * 18;

  return (
    <motion.aside
      animate={{ width: collapsed ? 60 : 304 }}
      transition={{ type: 'spring', stiffness: 120, damping: 20 }}
      className="relative shrink-0 bg-white border-l border-[#E2E8F0] flex flex-col overflow-hidden"
      data-collapsed={collapsed}
    >
      {/* 头部 */}
      <div className="p-3 border-b border-[#E2E8F0]">
        <div className={`flex items-center gap-2 mb-2 ${collapsed ? 'justify-center' : ''}`}>
          {!collapsed && <span className="text-[11px] font-bold tracking-wider uppercase text-[#64748B]">流程进度</span>}
          {!collapsed && (
            <button type="button" title="收起" onClick={() => setCollapsed(true)}
              className="ml-auto w-[26px] h-[26px] rounded-lg border border-[#E2E8F0] bg-white text-[#94A3B8] hover:text-[#0EA5E9] hover:border-[#0EA5E9] flex items-center justify-center">
              <ChevronRight size={14} />
            </button>
          )}
        </div>
        {!collapsed && (
          <div className="flex items-center gap-3 p-2.5 rounded-xl bg-[linear-gradient(135deg,#F0F9FF,#fff)] border border-[#E2E8F0]">
            <svg width="44" height="44" viewBox="0 0 44 44">
              <defs><linearGradient id="ptRing" x1="0" y1="0" x2="1" y2="1">
                <stop offset="0%" stopColor="#0EA5E9" /><stop offset="100%" stopColor="#0369A1" />
              </linearGradient></defs>
              <circle cx="22" cy="22" r="18" fill="none" stroke="#E2E8F0" strokeWidth="4" />
              <circle cx="22" cy="22" r="18" fill="none" stroke="url(#ptRing)" strokeWidth="4" strokeLinecap="round"
                strokeDasharray={circumference}
                strokeDashoffset={circumference * (1 - reached / total)}
                transform="rotate(-90 22 22)"
                style={{ transition: 'stroke-dashoffset 0.6s cubic-bezier(0.16,1,0.3,1)' }} />
            </svg>
            <div>
              <div className="text-[11px] text-[#64748B] font-mono">
                <b className="text-[#0369A1] text-base">{reached}</b> / {total} 步
              </div>
              {active && <div className="text-[12.5px] font-semibold text-[#020617] mt-0.5">{active.title}</div>}
            </div>
          </div>
        )}
        {collapsed && (
          <button type="button" title="展开" onClick={() => setCollapsed(false)}
            className="mx-auto w-9 h-9 rounded-[11px] bg-[linear-gradient(135deg,#0EA5E9,#0369A1)] text-white flex items-center justify-center shadow-lg">
            <ChevronLeft size={16} />
          </button>
        )}
      </div>

      {/* 步骤列表 */}
      <motion.div layout className={`flex-1 overflow-y-auto p-2 ${collapsed ? 'px-0' : ''}`}>
        <AnimatePresence initial={false}>
          {merged.map((s, i) => (
            <motion.div key={s.step_id}
              layout
              initial={{ opacity: 0, x: collapsed ? 0 : -8 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ delay: i * 0.045, type: 'spring', stiffness: 120, damping: 20 }}>
              {collapsed ? (
                <ProgressTooltipRow step={s} />
              ) : (
                <StepRow step={s} isLast={i === merged.length - 1} running={running} />
              )}
            </motion.div>
          ))}
        </AnimatePresence>
      </motion.div>
    </motion.aside>
  );
}

/** 收起态：仅图标 + 悬浮 tooltip。 */
function ProgressTooltipRow({ step }: { step: AgentStep }) {
  return (
    <div className="flex justify-center py-2" data-step-id={step.step_id} data-step-title={step.title} data-step-status={step.status}>
      <span className={`w-[30px] h-[30px] rounded-[9px] flex items-center justify-center
        ${step.status === 'success' ? 'bg-[#DCFCE7] text-[#16A34A]' :
          step.status === 'running' ? 'bg-[linear-gradient(135deg,#0EA5E9,#0369A1)] text-white progress-icon-pulse' :
          step.status === 'failed' ? 'bg-[#FEE2E2] text-[#DC2626]' :
          'bg-white border-2 border-[#CBD5E1] text-[#94A3B8]'}`}>
        {step.status === 'success' ? '✓' : step.status === 'failed' ? '✕' :
          step.status === 'running' ? '' : ''}
      </span>
    </div>
  );
}
```

- [ ] **Step 5: 实现 ProgressTooltip（收起态单例）**

新建 `progress-tooltip.tsx`：

```typescript
/**
 * ProgressTooltip：收起态步骤悬浮提示。单例挂 body，position:fixed 规避栏 overflow:hidden。
 * 由 ProgressTrackerRow 的 data-* 属性驱动（mouseenter 时读取定位）。
 * 本组件导出占位 + 一个 attach 工具；实际绑定在 ProgressTracker 内 useEffect。
 */
import { useEffect, useState } from 'react';

export function ProgressTooltipPortal() {
  const [tip, setTip] = useState<{ x: number; y: number; title: string; status: string } | null>(null);
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      const target = (e.target as HTMLElement)?.closest('[data-step-title]') as HTMLElement | null;
      if (!target) { setTip(null); return; }
      const r = target.getBoundingClientRect();
      setTip({
        x: r.left - 12,  // 定位到图标左侧（具体宽度由渲染后测量，此处近似）
        y: r.top + r.height / 2,
        title: target.dataset.stepTitle || '',
        status: target.dataset.stepStatus || '',
      });
    };
    document.addEventListener('mouseover', handler);
    return () => document.removeEventListener('mouseover', handler);
  }, []);
  if (!tip) return null;
  const statusLabel: Record<string, string> = { success: '已完成', running: '运行中', pending: '待执行', failed: '失败' };
  return (
    <div style={{ position: 'fixed', left: tip.x, top: tip.y, transform: 'translate(-100%,-50%)' }}
      className="z-[200] flex items-center gap-1.5 bg-[#0F172A] text-white px-3 py-1.5 rounded-lg text-xs font-semibold
                 shadow-[0_8px_20px_-6px_rgba(15,23,42,0.45)] pointer-events-none whitespace-nowrap">
      <span className={`w-1.5 h-1.5 rounded-full ${tip.status === 'success' ? 'bg-[#16A34A]' : tip.status === 'running' ? 'bg-[#0EA5E9]' : tip.status === 'failed' ? 'bg-[#DC2626]' : 'bg-[#94A3B8]'}`} />
      <span>{tip.title}</span>
      <span className="text-white/50 text-[10px]">{statusLabel[tip.status]}</span>
    </div>
  );
}
```

- [ ] **Step 6: 运行测试确认通过**

Run: `cd frontend && npx vitest run src/components/employee/agent/progress-tracker/__tests__/progress-tracker.test.tsx`
Expected: PASS

- [ ] **Step 7: Commit**

```bash
git add frontend/src/components/employee/agent/progress-tracker/
git commit -m "feat(agent-fe): B1 ProgressTracker 组件骨架 + 步骤渲染 + 收起/展开"
```

---

## Task 15: 前端 — B1 CSS 光波/脉冲 keyframes + 流光点

**Files:**
- Modify: `frontend/src/index.css`

- [ ] **Step 1: 确认既有 keyframes，补齐缺失**

读 `frontend/src/index.css` 确认已有 `wave` / `shimmer`（WaveText 用）。新增 `progress-icon-pulse`（running 图标呼吸光圈）、`progress-flow-dot`（连接线流光点）、`.progress-flow-dot::after`。在 index.css 末尾加：

```css
/* ===== B1 ProgressTracker 光波效果 ===== */

/* running 图标脉冲呼吸光圈 */
.progress-icon-pulse {
  box-shadow: 0 0 0 0 rgba(14, 165, 233, 0.5);
  animation: pt-icon-pulse 1.8s cubic-bezier(0.4, 0, 0.6, 1) infinite;
}
@keyframes pt-icon-pulse {
  0%   { box-shadow: 0 0 0 0 rgba(14, 165, 233, 0.5); }
  70%  { box-shadow: 0 0 0 9px rgba(14, 165, 233, 0); }
  100% { box-shadow: 0 0 0 0 rgba(14, 165, 233, 0); }
}

/* 已完成连接线流光点（沿线下落） */
.progress-flow-dot::after {
  content: '';
  position: absolute;
  left: -2px;
  top: 0;
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: #7DD3FC;
  box-shadow: 0 0 8px 2px rgba(125, 211, 252, 0.7);
  animation: pt-flow-dot 2.4s cubic-bezier(0.2, 0, 0, 1) infinite;
  pointer-events: none;
}
@keyframes pt-flow-dot {
  0%   { top: -2px; opacity: 0; }
  20%  { opacity: 1; }
  80%  { opacity: 1; }
  100% { top: 100%; opacity: 0; }
}
```

- [ ] **Step 2: 构建确认无 CSS 报错**

Run: `cd frontend && npm run build`
Expected: 构建成功（Tailwind 编译 + 无语法错）

- [ ] **Step 3: Commit**

```bash
git add frontend/src/index.css
git commit -m "feat(agent-fe): B1 进度栏光波/脉冲/流光点 keyframes"
```

---

## Task 16: 前端 — B1 接入 layout 三栏 + 移除 StepStrip + 持久化进度数据源

**Files:**
- Modify: `frontend/src/components/employee/agent/layout/agent-standalone-layout.tsx`
- Modify: `frontend/src/components/employee/agent/agent-message-card.tsx`
- Modify: `frontend/src/components/employee/agent/agent-workspace.tsx`

- [ ] **Step 1: 移除 AgentMessageCard 内 StepStrip**

`agent-message-card.tsx`：删除 `StepStrip` import 与渲染分支（流式段头下方那段 `<div className="overflow-hidden ...">...StepStrip...</div>`）。流式时段头仍显示"生成中…"，进度改由右侧 ProgressTracker 承载。

- [ ] **Step 2: Workspace 选数据源并渲染 ProgressTracker**

`agent-workspace.tsx`：数据源优先级——流式中用 `runState.steps`，非流式用 `session.progress?.steps`。在 `WorkspaceInner` return 的 `<main>` 旁加 `<ProgressTracker>`。先把 `WorkspaceInner` 的 return 改为 fragment 包裹 main + ProgressTracker：

```typescript
  // 进度栏数据源：流式中用 runState.steps（实时），否则用 session.progress.steps（持久化）
  const progressSteps = runState.running
    ? runState.steps
    : (session.progress?.steps ?? []);
  const progressWorkflow = runState.running ? runState.workflow_type : (session.progress?.workflow_type ?? (messages.length > 0 ? messages[messages.length - 1].workflow_type : 'interview_questions'));

  return (
    <div className="flex flex-1 min-w-0">
      <main className="flex flex-1 flex-col min-w-0">
        <AgentMessageList ...既有 props... />
        <AgentComposer ...既有 props... />
      </main>
      <ProgressTracker
        steps={progressSteps}
        running={runState.running}
        workflowType={progressWorkflow}
      />
    </div>
  );
```

import 加 `import { ProgressTracker } from './progress-tracker/progress-tracker';`。

> 空 steps 时 ProgressTracker 内 mergeStepsWithTemplate 会用模板填全 pending 占位（既有契约），无需特殊处理。

- [ ] **Step 3: 持久化 progress 随 getSession 回写**

`store/agent.ts` 的 `ensureLoaded` 与 `runEnvelopes` 收尾里，`mergeLocalRuntime(remoteSession, entry.session)` 已保留本地运行时字段；`progress` 是后端权威字段，会随 remoteSession 带回——确认 `mergeLocalRuntime` 不覆盖 progress（它只保留 enable_thinking/selected_model_name，progress 来自 remote，天然保留）。无需改动，仅需确认。

- [ ] **Step 4: 类型检查 + 构建**

Run: `cd frontend && npx tsc --noEmit && npm run build`
Expected: 无错误，构建成功

- [ ] **Step 5: 前端测试回归**

Run: `cd frontend && npx vitest run`
Expected: 既有测试全 PASS（step-strip 测试若引用已删导出，按需更新或删除）

- [ ] **Step 6: 手工验收（对照 HTML 设计稿）**

启动前后端，在 Agent 工作台：
- 发送带简历的消息 → 右侧进度栏显示 8 步，running 步骤有脉冲+流光+波浪文字。
- 点收起 → 缩为 60px 细栏，悬浮步骤图标显示 tooltip。
- 刷新页面 → 进度栏从 session.progress 恢复显示当前步（B1 持久化）。
- A1：发未附简历的消息 → 对话内弹上传卡；上传后自动续接。
- A2：流式中点"暂停" → InterruptBar 显示"恢复"；点"恢复"续接，不重跑。
- A3：评估流程选岗位 → 分页 5/页 + 搜索按钮（输入不自动搜，点搜索/Enter 才搜，连点节流）。

- [ ] **Step 7: Commit**

```bash
git add frontend/src/components/employee/agent/agent-message-card.tsx frontend/src/components/employee/agent/agent-workspace.tsx
git commit -m "feat(agent-fe): B1 接入三栏布局 + 移除内联 StepStrip + 持久化进度数据源"
```

---

## 收尾：全量回归

- [ ] **后端全量测试**: `cd backend && python -m pytest -q`
- [ ] **前端全量测试**: `cd frontend && npx vitest run`
- [ ] **前端构建**: `cd frontend && npm run build`
- [ ] **端到端手工验收**: 按 Task 16 Step 6 清单逐项确认。

---

## Self-Review 记录

**Spec 覆盖核对：**
- A1（简历缺失上传）→ Task 2（协议）+ Task 3/4（两服务 load_resume interrupt）。✅
- A2（中断续接 B+ii）→ Task 8（不推进）+ Task 9（resume_run）+ Task 10（端点）+ Task 11/12（前端恢复+禁用）。✅
- A3（分页+手动搜索+节流）→ Task 7。✅
- B1（右侧进度栏）→ Task 13（framer-motion）+ Task 14（组件）+ Task 15（光波 CSS）+ Task 16（接入）。✅
- progress 持久化（B1+A2 支撑）→ Task 1（列）+ Task 5（落库）+ Task 6（类型）+ Task 16（数据源）。✅
- 错误/状态丢失降级（no_resumable_checkpoint）→ Task 9（`_is_missing_checkpoint_error`）。✅

**类型/命名一致性：** `resume_run` / `resumeRun` / `resumeSession` / `build_resume_upload_interaction` / `_persist_progress` / `ProgressTracker` / `StepRow` 跨任务命名一致。`InteractionType` 含 `resume_upload` 在 events.py（后端）与 types/agent.ts（前端）同步（Task 2 + Task 6）。

**已知简化（实现期注意）：**
- Task 4 测试中 `ResumeEvaluationService.__init__` 形参名需先读代码核对。
- Task 16 Step 3 的 `mergeLocalRuntime` 保留 progress 为"天然保留"——实现时需实测确认 remote session 的 progress 字段确实透传到前端 store（若被过滤需补）。
