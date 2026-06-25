# Agent 进度持久化与 UI 修复 Implementation Plan（Spec A）

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 修复 Agent 工作台"刷新即丢进度"的命门 bug（session.progress 等元数据 flush 未 commit），并顺带完成进度节点序号、会话按创建时间排序两个 UI 项；Bug B 与权限移出本计划。

**Architecture:** 后端在 `AgentRuntimeService` 的四条执行路径末尾补显式 `commit()`，让 `_persist_progress`/`_persist_block_index`/`_advance_task_id` 的 flush 真正落库；落库失败改为 emit `run.error(persist_failed)` 而非静默。前端补进度节点序号（pending 空圈内显示数字）、会话排序/分组改用 `create_time`。

**Tech Stack:** Python 3.12 + FastAPI + SQLAlchemy 2.0 async + aiomysql（后端）；React 19 + TypeScript + Zustand + vitest + @testing-library/react（前端）。

## Global Constraints

- 所有注释、日志、文档说明必须使用中文；变量名/函数名/类名用英文。
- 源码文件 UTF-8 无 BOM，行尾 LF，文件末尾保留一个换行符。
- 后端命名：文件/目录小写下划线；类大驼峰；函数/变量 snake_case。
- 前端命名：组件文件 PascalCase；变量/函数 small camelCase；类型/接口以 `I` 或 `T` 开头。
- 禁止 `except Exception` 吞异常（本项目 `core/exceptions.py` 统一处理；落库失败按现有 `logger.exception` + 本计划新增的 `run.error` 信令处理）。
- 后端测试命令：`cd backend && python -m pytest tests/services/test_agent_runtime_service.py -v`（单文件）或 `cd backend && python -m pytest -v`（全量）。
- 前端测试命令：`cd frontend && npx vitest run <相对 frontend 的路径>`；类型检查 `cd frontend && npx tsc --noEmit`。
- 精准改动：只改必须改的；不顺手优化相邻代码；只清理本次改动产生的冗余。

---

## File Structure

**修改（后端）：**
- `backend/app/services/agent_runtime_service.py` — 四条路径补 commit（Task 1）+ persist_failed 信令（Task 2）
- `backend/app/repositories/agent_repository.py` — `list_sessions` 排序改 `create_time`（Task 4）

**修改（前端）：**
- `frontend/src/components/employee/agent/progress-tracker/step-row.tsx` — pending 空圈显示序号（Task 3）
- `frontend/src/components/employee/agent/progress-tracker/progress-panel.tsx` — 传 `i+1`（Task 3）
- `frontend/src/store/agent.ts` — `refreshSessions` 移除 `last_message_time` 重排（Task 5）
- `frontend/src/components/employee/agent/layout/agent-sidebar-drawer.tsx` — `sortSessionsByTime`/`groupSessionsByTime` 改 `create_time`（Task 5）

**测试（修改/新增）：**
- `backend/tests/services/test_agent_runtime_service.py` — 4 条 commit 回归 + persist_failed 信介试（Task 1/2）
- `frontend/src/components/employee/agent/progress-tracker/__tests__/step-row.test.tsx` — 新建，序号渲染（Task 3）
- `frontend/src/components/employee/agent/layout/__tests__/agent-sidebar-grouping.test.ts` — 改 `create_time` 语义（Task 5）
- `frontend/src/components/employee/agent/layout/__tests__/agent-sidebar-sort.test.ts` — 改 `create_time` 语义（Task 5）

---

## Task 1: Cluster 1 — 持久化 commit 修复（4 条路径）

**Files:**
- Modify: `backend/app/services/agent_runtime_service.py`（`stream_message` finally 约 254-299；`resolve_interaction` finally 约 397-440；`resume_run` finally 约 526-572；`abort_pending_interaction` 约 848-888）
- Test: `backend/tests/services/test_agent_runtime_service.py`

**Interfaces:**
- Consumes: `self._repo.commit()`（既有 `AgentRepository.commit`，`agent_repository.py:111`）。
- Produces: 四条路径完成后 `session.progress` / `current_task_id` / `last_block_index` 真正落库（议题 2 全局进度丢失由本任务解决）。

**根因（spec §1.1）**：`get_db` 用 `mysql_manager.session()` 不自动 commit；四条路径里 `_persist_agent_message` 内部 commit 只覆盖 agent 消息，其后 `_advance_task_id`/`_persist_block_index`/`_persist_progress` 的 flush 在新事务中、无 commit → 响应结束回滚 → DB 里 NULL/旧值。

- [ ] **Step 1: 写失败测试（stream_message）**

在 `backend/tests/services/test_agent_runtime_service.py` 末尾追加：

```python
@pytest.mark.asyncio
async def test_stream_message_commits_after_persisting_progress():
    """Cluster 1 回归：stream_message 的 finally 必须在 _persist_progress 后再 commit 一次。

    _persist_agent_message 内部已 commit（覆盖 agent 消息）；其后 _advance_task_id /
    _persist_block_index / _persist_progress 的 flush 在新事务中，必须在 finally 末尾再
    commit 一次，否则 session.progress 等被回滚（DB NULL）。
    """
    calls: list[str] = []
    svc = _build_svc()

    async def _track_commit():
        calls.append("commit")

    async def _track_update(session_id, **kwargs):
        if "progress" in kwargs:
            calls.append("progress")
        return session

    svc._repo.commit = _track_commit
    svc._repo.update_session = _track_update

    session = _make_session()
    session.progress = None
    body = AgentMessageCreate(content="hi", workflow_type="interview_questions")
    async for _env in svc.stream_message(session=session, body=body, runtime_config=_runtime_cfg()):
        pass

    # 最后一次 progress 写入之后必须存在 commit
    assert "progress" in calls, f"未观察到 progress 写入：{calls}"
    last_progress_idx = max(i for i, c in enumerate(calls) if c == "progress")
    assert "commit" in calls[last_progress_idx + 1:], (
        f"progress 写入后未 commit（session.progress 会被回滚）：{calls}"
    )
```

- [ ] **Step 2: 写失败测试（resolve_interaction）**

继续追加：

```python
@pytest.mark.asyncio
async def test_resolve_interaction_commits_after_persisting_progress():
    """Cluster 1 回归：resolve_interaction 的 finally 必须在 _persist_progress 后再 commit。"""
    calls: list[str] = []
    svc = _build_svc()

    async def _astream(*, thread_id, graph_input, ctx):
        yield ctx.emitter.emit_step(step_id="suggest_dimensions", title="分析维度", status="success")
    svc._runner_factory = lambda graph: MagicMock(astream=_astream)

    async def _track_commit():
        calls.append("commit")

    async def _track_update(session_id, **kwargs):
        if "progress" in kwargs:
            calls.append("progress")
        return session

    svc._repo.commit = _track_commit
    svc._repo.update_session = _track_update

    session = _make_session()
    session.progress = None
    body = AgentInteractionSubmit(values={"selected_dimensions": []}, workflow_type="interview_questions")
    async for _env in svc.resolve_interaction(
        session=session, request_id="req1", body=body,
        runtime_config=_runtime_cfg(), workflow_type="interview_questions",
    ):
        pass

    assert "progress" in calls, f"未观察到 progress 写入：{calls}"
    last_progress_idx = max(i for i, c in enumerate(calls) if c == "progress")
    assert "commit" in calls[last_progress_idx + 1:], (
        f"progress 写入后未 commit：{calls}"
    )
```

- [ ] **Step 3: 写失败测试（resume_run）**

继续追加：

```python
@pytest.mark.asyncio
async def test_resume_run_commits_after_persisting_progress():
    """Cluster 1 回归：resume_run 的 finally 必须在 _persist_progress 后再 commit。"""
    calls: list[str] = []
    svc = _build_svc()

    async def _astream(*, thread_id, graph_input, ctx):
        yield ctx.emitter.emit_step(step_id="suggest_dimensions", title="分析维度", status="success")
    svc._runner_factory = lambda graph: MagicMock(astream=_astream)

    async def _track_commit():
        calls.append("commit")

    async def _track_update(session_id, **kwargs):
        if "progress" in kwargs:
            calls.append("progress")
        return session

    svc._repo.commit = _track_commit
    svc._repo.update_session = _track_update

    session = _make_session()
    session.progress = None
    async for _env in svc.resume_run(
        session=session, runtime_config=_runtime_cfg(), workflow_type="interview_questions",
    ):
        pass

    assert "progress" in calls, f"未观察到 progress 写入：{calls}"
    last_progress_idx = max(i for i, c in enumerate(calls) if c == "progress")
    assert "commit" in calls[last_progress_idx + 1:], (
        f"progress 写入后未 commit：{calls}"
    )
```

- [ ] **Step 4: 写失败测试（abort_pending_interaction）**

继续追加。注意 `abort_pending_interaction` 不是生成器、是普通 `async` 方法，且推进 `task_id` 走 `update_session(current_task_id=...)`：

```python
@pytest.mark.asyncio
async def test_abort_pending_interaction_commits_after_advancing_task_id():
    """Cluster 1 回归：abort_pending_interaction 推进 task_id 后必须 commit。

    现状：过期标记的 commit（行内）已落库，但其后 _advance_task_id 的 flush 无 commit，
    DB 仍是旧 task_id → 下次发送无法正确隔离。
    """
    calls: list[str] = []
    svc = AgentRuntimeService.__new__(AgentRuntimeService)  # 跳过 __init__
    svc._repo = MagicMock()

    # 一条含 pending interaction block 的 agent 消息
    pending_msg = MagicMock()
    pending_msg.id = 5
    pending_msg.content = {"blocks": [
        {"type": "interaction", "request_id": "r1", "status": "pending"}
    ]}
    svc._repo.list_messages = AsyncMock(return_value=[pending_msg])

    async def _track_commit():
        calls.append("commit")

    async def _track_update(session_id, **kwargs):
        if "current_task_id" in kwargs:
            calls.append("task_id")
        return MagicMock()

    async def _track_update_msg(mid, content):
        calls.append("msg_content")

    svc._repo.commit = _track_commit
    svc._repo.update_session = _track_update
    svc._repo.update_message_content = _track_update_msg

    session = _make_session()
    await svc.abort_pending_interaction(session=session)

    # task_id 推进之后必须存在 commit
    assert "task_id" in calls, f"未观察到 task_id 推进：{calls}"
    last_task_idx = max(i for i, c in enumerate(calls) if c == "task_id")
    assert "commit" in calls[last_task_idx + 1:], (
        f"task_id 推进后未 commit（DB 仍是旧 task_id）：{calls}"
    )
```

- [ ] **Step 5: 运行测试确认失败**

Run: `cd backend && python -m pytest tests/services/test_agent_runtime_service.py::test_stream_message_commits_after_persisting_progress tests/services/test_agent_runtime_service.py::test_resolve_interaction_commits_after_persisting_progress tests/services/test_agent_runtime_service.py::test_resume_run_commits_after_persisting_progress tests/services/test_agent_runtime_service.py::test_abort_pending_interaction_commits_after_advancing_task_id -v`
Expected: 4 个 FAIL（progress/task_id 写入后无 commit）。

- [ ] **Step 6: 给 stream_message 的 finally 补 commit**

`backend/app/services/agent_runtime_service.py` 的 `stream_message` `finally` 块（约 278-284 行 `_persist_progress` 的 try/except 之后、`if not client_aborted` 之前），插入：

```python
            # 持久化累积进度到 session.progress（reset=True：新 task 丢弃旧 steps）
            try:
                await self._persist_progress(
                    session, run_steps, body.workflow_type, reset=True,
                )
            except Exception:
                logger.exception("stream_message 持久化 progress 失败：session_id=%s", session.id)
            # Cluster 1：提交本 run 的 task_id / block_index / progress 更新。
            # _persist_agent_message 的内部 commit 只覆盖 agent 消息；以上三项 flush 在新事务中，
            # 必须显式 commit 才不会被响应结束时回滚（否则 session.progress 等在 DB 里为 NULL）。
            try:
                await self._repo.commit()
            except Exception:
                logger.exception("stream_message 收尾 commit 失败：session_id=%s", session.id)
```

- [ ] **Step 7: 给 resolve_interaction 的 finally 补 commit**

同文件 `resolve_interaction` `finally`（约 419-427 行 `_persist_progress` 的 try/except 之后、`if not client_aborted` 之前），插入同样模式的 commit：

```python
            # 持久化累积进度（reset=False：续接，合并已有 steps）
            try:
                await self._persist_progress(
                    session, run_steps, workflow_type, reset=False,
                )
            except Exception:
                logger.exception(
                    "resolve_interaction 持久化 progress 失败：session_id=%s", session.id,
                )
            # Cluster 1：提交续接 run 的 task_id / block_index / progress 更新（同 stream_message）
            try:
                await self._repo.commit()
            except Exception:
                logger.exception("resolve_interaction 收尾 commit 失败：session_id=%s", session.id)
```

- [ ] **Step 8: 给 resume_run 的 finally 补 commit**

同文件 `resume_run` `finally`（约 549-557 行 `_persist_progress` 的 try/except 之后、`if not client_aborted` 之前），插入：

```python
            # 持久化累积进度（reset=False：续接同 task，合并已有 steps）
            try:
                await self._persist_progress(
                    session, run_steps, workflow_type, reset=False,
                )
            except Exception:
                logger.exception(
                    "resume_run 持久化 progress 失败：session_id=%s", session.id,
                )
            # Cluster 1：提交续接 run 的 task_id / block_index / progress 更新（同 stream_message）
            try:
                await self._repo.commit()
            except Exception:
                logger.exception("resume_run 收尾 commit 失败：session_id=%s", session.id)
```

- [ ] **Step 9: 给 abort_pending_interaction 补 commit**

同文件 `abort_pending_interaction`（约 883-888 行 `_advance_task_id` 的 try 块内），在 `_advance_task_id` 之后加 commit：

```python
        # 2) 推进 task_id，下一轮新问题走全新 LangGraph thread
        try:
            await self._advance_task_id(session)
            # Cluster 1：推进 task_id 后必须 commit，否则 DB 仍是旧 task_id、下次发送无法隔离
            await self._repo.commit()
            logger.info("用户中断 interrupt：session_id=%s 已推进 task_id", session.id)
        except Exception:
            logger.exception("中断后推进 task_id 失败：session_id=%s", session.id)
```

- [ ] **Step 10: 运行 4 个新测试确认通过**

Run: `cd backend && python -m pytest tests/services/test_agent_runtime_service.py -k "commits_after" -v`
Expected: 4 个 PASS。

- [ ] **Step 11: 回归既有 runtime 测试**

Run: `cd backend && python -m pytest tests/services/test_agent_runtime_service.py -v`
Expected: 全部 PASS（既有用例不受补 commit 影响——`_build_svc` 的 `repo.commit = AsyncMock()` 本就接受多次调用）。

- [ ] **Step 12: 提交**

```bash
git add backend/app/services/agent_runtime_service.py backend/tests/services/test_agent_runtime_service.py
git commit -m "fix(agent): Cluster 1 四条 run 路径补 commit，progress/task_id/block_index 不再被回滚"
```

---

## Task 2: persist_failed → run.error 信令（落库失败不再静默）

**Files:**
- Modify: `backend/app/services/agent_runtime_service.py`（`stream_message` / `resolve_interaction` / `resume_run` 的 `_persist_agent_message` try/except 处）
- Test: `backend/tests/services/test_agent_runtime_service.py`

**Interfaces:**
- Consumes: `emitter.emit_run_error(code, message, retriable)`（既有，`AgentStreamEmitter`）。
- Produces: 落库失败时发 `run.error(code='persist_failed', retriable=True)`，前端复用既有红色 callout 显示，不再静默丢数据（spec §3.6）。

**根因（spec §1.3）**：`_persist_agent_message` 失败被 `finally` 的 try/except 吞掉（置 `agent_message=None`）→ 跳过 `run.finish` → 前端 reload 找不到新消息 → 数据静默消失。

- [ ] **Step 1: 写失败测试（stream_message 落库失败时发 persist_failed）**

在 `test_agent_runtime_service.py` 末尾追加。让 `create_message`（agent 消息落库）抛异常，断言收到 `run.error(persist_failed)`：

```python
@pytest.mark.asyncio
async def test_stream_message_emits_persist_failed_on_agent_message_save_error():
    """agent 消息落库失败时必须发 run.error(persist_failed)，而非静默跳过 finish。

    模拟 _persist_agent_message 内部 create_message 抛异常（如 DB 不可写），
    断言 SSE 流里收到 run.error 且 code='persist_failed'、retriable=True。
    """
    svc = _build_svc()
    # create_message 第三次调用（agent 消息）抛异常；前两次（user 消息 + next_message_order）正常
    svc._repo.create_message = AsyncMock(side_effect=[
        MagicMock(id=10),  # user message
        RuntimeError("db write failed"),  # agent message 落库失败
    ])
    svc._repo.next_message_order = AsyncMock(side_effect=[1, 2])
    svc._repo.rollback = AsyncMock()

    session = _make_session()
    session.progress = None
    body = AgentMessageCreate(content="hi", workflow_type="interview_questions")
    error_envs = []
    async for env in svc.stream_message(session=session, body=body, runtime_config=_runtime_cfg()):
        if env.type == "run.error":
            error_envs.append(env)

    assert len(error_envs) >= 1, "落库失败未发出 run.error"
    assert error_envs[-1].data["code"] == "persist_failed"
    assert error_envs[-1].data["retriable"] is True
```

- [ ] **Step 2: 运行确认失败**

Run: `cd backend && python -m pytest tests/services/test_agent_runtime_service.py::test_stream_message_emits_persist_failed_on_agent_message_save_error -v`
Expected: FAIL（当前落库失败静默，无 run.error）。

- [ ] **Step 3: stream_message 落库失败时发 persist_failed**

`backend/app/services/agent_runtime_service.py` 的 `stream_message` `finally`。当前 `_persist_agent_message` 的 try/except（约 257-268 行）改为：

```python
            persist_failed = False
            try:
                agent_message = await self._persist_agent_message(
                    session=session, user_message=user_message, run_id=run_id,
                    envelopes=envelope_buffer, runtime_config=runtime_config,
                    workflow_type=body.workflow_type,
                )
            except Exception:
                logger.exception(
                    "收尾落库失败：session_id=%s run_id=%s aborted=%s",
                    session.id, run_id, client_aborted,
                )
                agent_message = None
                persist_failed = True
```

然后在 finally 末尾、原本 `if not client_aborted and agent_message is not None:` 的 finish 分支之前，加 persist_failed 分支：

```python
            # 落库失败：发 run.error(persist_failed) 让前端显式报错，不静默丢数据
            if persist_failed and not client_aborted:
                err_env = emitter.emit_run_error(
                    code="persist_failed", message="消息落库失败，请重试", retriable=True,
                )
                envelope_buffer.append(err_env)
                await self._buffer_append(session.id, run_id, err_env)
                yield err_env
            elif not client_aborted and agent_message is not None:
                finish_env = emitter.emit_run_finish(
                    agent_message_id=agent_message.id, next_task_id=next_task_id,
                )
                await self._buffer_append(session.id, run_id, finish_env)
                yield finish_env
```

（把原来 `if not client_aborted and agent_message is not None:` 改为 `elif`，前面加 persist_failed 分支。）

- [ ] **Step 4: resolve_interaction 与 resume_run 同构改造**

`resolve_interaction`（约 397-433 行）与 `resume_run`（约 526-564 行）的 `finally` 里，对各自的 `_persist_agent_message` try/except 加同样的 `persist_failed` 标志，并在 finish 分支前加 persist_failed 分支。两处的 finish 分支条件同样由 `if not client_aborted and agent_message is not None:` 改为 `elif`，前面加：

```python
            if persist_failed and not client_aborted:
                err_env = emitter.emit_run_error(
                    code="persist_failed", message="消息落库失败，请重试", retriable=True,
                )
                envelope_buffer.append(err_env)
                await self._buffer_append(session.id, run_id, err_env)
                yield err_env
            elif not client_aborted and agent_message is not None:
                finish_env = emitter.emit_run_finish(
                    agent_message_id=agent_message.id, next_task_id=next_task_id,
                )
                await self._buffer_append(session.id, run_id, finish_env)
                yield finish_env
```

- [ ] **Step 5: 运行测试确认通过**

Run: `cd backend && python -m pytest tests/services/test_agent_runtime_service.py::test_stream_message_emits_persist_failed_on_agent_message_save_error -v`
Expected: PASS。

- [ ] **Step 6: 回归全部 runtime 测试**

Run: `cd backend && python -m pytest tests/services/test_agent_runtime_service.py -v`
Expected: 全部 PASS（既有成功路径不受影响——`persist_failed` 仅在异常时置 True）。

- [ ] **Step 7: 提交**

```bash
git add backend/app/services/agent_runtime_service.py backend/tests/services/test_agent_runtime_service.py
git commit -m "fix(agent): 落库失败发 run.error(persist_failed) 而非静默丢数据"
```

---

## Task 3: 议题 4 — 进度节点序号（pending 空圈内显示数字）

**Files:**
- Modify: `frontend/src/components/employee/agent/progress-tracker/step-row.tsx`
- Modify: `frontend/src/components/employee/agent/progress-tracker/progress-panel.tsx:53-61`
- Test: `frontend/src/components/employee/agent/progress-tracker/__tests__/step-row.test.tsx`（新建）

**Interfaces:**
- Consumes: `AgentStep`（`@/types/agent`）。
- Produces: `StepRow` 新增可选 prop `index?: number`；提供时在 pending 态空圈内渲染序号；未提供保持空圈（向后兼容）。

- [ ] **Step 1: 写失败测试**

创建 `frontend/src/components/employee/agent/progress-tracker/__tests__/step-row.test.tsx`：

```tsx
/**
 * StepRow 序号渲染单测（议题 4）。
 *
 * - pending 态 + index：空圈内显示序号
 * - success/running/failed：仍渲染状态图标，不显示序号
 * - 未传 index：pending 空圈不显示数字（向后兼容）
 */
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { StepRow } from '../step-row';
import type { AgentStep } from '@/types/agent';

const pendingStep: AgentStep = { step_id: 's1', title: '读取简历', status: 'pending' };
const successStep: AgentStep = { step_id: 's2', title: '分析维度', status: 'success' };

describe('StepRow 序号（议题 4）', () => {
  it('pending 态传入 index=1 时显示序号 1', () => {
    render(<StepRow step={pendingStep} isLast={false} index={1} />);
    expect(screen.getByText('1')).toBeInTheDocument();
  });

  it('pending 态传入 index=3 时显示序号 3', () => {
    render(<StepRow step={pendingStep} isLast={false} index={3} />);
    expect(screen.getByText('3')).toBeInTheDocument();
  });

  it('success 态不显示序号（仍是成功图标）', () => {
    render(<StepRow step={successStep} isLast={false} index={1} />);
    expect(screen.queryByText('1')).toBeNull();
  });

  it('未传 index 时 pending 空圈不显示数字（向后兼容）', () => {
    render(<StepRow step={pendingStep} isLast={false} />);
    expect(screen.queryByText('1')).toBeNull();
  });
});
```

- [ ] **Step 2: 运行确认失败**

Run: `cd frontend && npx vitest run src/components/employee/agent/progress-tracker/__tests__/step-row.test.tsx`
Expected: FAIL（`index` prop 不存在；pending 空圈未渲染数字）。

- [ ] **Step 3: StepRow 新增 index prop 并在 pending 空圈渲染**

`frontend/src/components/employee/agent/progress-tracker/step-row.tsx`：

接口加 `index`：

```tsx
interface StepRowProps {
  /** 该行的步骤数据 */
  step: AgentStep;
  /** 是否最后一行（最后一行不渲染下方连接线） */
  isLast: boolean;
  /** 节点序号（1-based）。提供时在 pending 空圈内显示数字，未提供则空圈（向后兼容） */
  index?: number;
}

/** 单行步骤渲染 */
export function StepRow({ step, isLast, index }: StepRowProps) {
```

把 `<StepIcon status={step.status} />` 改为 `<StepIcon status={step.status} index={index} />`。

`StepIcon` 函数签名加 `index`，pending 分支渲染数字：

```tsx
/** 步骤图标：按状态返回四种样式；pending 态提供 index 时圈内显示序号 */
function StepIcon({ status, index }: { status: AgentStep['status']; index?: number }) {
  if (status === 'success') {
    return (
      <span className="w-7 h-7 rounded-[9px] bg-[#DCFCE7] text-[#16A34A] flex items-center justify-center relative z-[2]">
        <Check size={14} strokeWidth={2.5} />
      </span>
    );
  }
  if (status === 'running') {
    return (
      <span className="w-7 h-7 rounded-[9px] bg-[linear-gradient(135deg,#0EA5E9,#0369A1)] text-white flex items-center justify-center relative z-[2] progress-icon-pulse">
        <motion.span
          animate={{ rotate: 360 }}
          transition={{ repeat: Infinity, duration: 1, ease: 'linear' }}
          className="block w-3 h-3 border-2 border-white/40 border-t-white rounded-full"
        />
      </span>
    );
  }
  if (status === 'failed') {
    return (
      <span className="w-7 h-7 rounded-[9px] bg-[#FEE2E2] text-[#DC2626] flex items-center justify-center relative z-[2]">
        <X size={14} strokeWidth={2.5} />
      </span>
    );
  }
  // pending：白底灰边圈；提供 index 时圈内显示序号（议题 4）
  return (
    <span className="w-7 h-7 rounded-[9px] bg-white border-2 border-[#CBD5E1] flex items-center justify-center relative z-[2] text-[12px] font-semibold text-[#64748B]">
      {index}
    </span>
  );
}
```

- [ ] **Step 4: ProgressPanel 把 i+1 传给 StepRow**

`frontend/src/components/employee/agent/progress-tracker/progress-panel.tsx` 第 53-61 行，`visible.map((s, i) => ...)` 内 `<StepRow>` 调用加 `index`：

```tsx
              <StepRow step={s} isLast={i === visible.length - 1} index={i + 1} />
```

- [ ] **Step 5: 运行测试确认通过**

Run: `cd frontend && npx vitest run src/components/employee/agent/progress-tracker/__tests__/step-row.test.tsx`
Expected: 4 个用例 PASS。

- [ ] **Step 6: 类型检查 + 回归既有进度组件测试**

Run: `cd frontend && npx tsc --noEmit`
Expected: 无新增类型错误（`index` 可选，向后兼容）。

Run: `cd frontend && npx vitest run src/components/employee/agent/progress-tracker/`
Expected: 既有 `floating-progress.test.tsx` / `progress-panel.test.tsx` / `merge-steps.test.ts` 全过。

- [ ] **Step 7: 提交**

```bash
git add frontend/src/components/employee/agent/progress-tracker/step-row.tsx frontend/src/components/employee/agent/progress-tracker/progress-panel.tsx frontend/src/components/employee/agent/progress-tracker/__tests__/step-row.test.tsx
git commit -m "feat(agent-fe): 议题 4 进度节点 pending 空圈内显示序号"
```

---

## Task 4: 排序 — 后端 list_sessions 改 create_time

**Files:**
- Modify: `backend/app/repositories/agent_repository.py:54`
- Test: `backend/tests/repositories/test_agent_repository.py`（若不存在则新建）

**Interfaces:**
- Consumes: `AgentSession.create_time`（`models/agent_session.py:35`）。
- Produces: `list_sessions` 按 `create_time DESC, id DESC` 返回（前端 Task 5 信任此后端排序）。

- [ ] **Step 1: 写失败测试**

若 `backend/tests/repositories/test_agent_repository.py` 不存在则新建。加一个用内存 SQLite 校验排序的测试（项目用 aiomysql，但 repository 层是纯 SQLAlchemy，可用 aiosqlite 测排序语义）：

```python
"""AgentRepository.list_sessions 排序回归。"""
from __future__ import annotations

import pytest
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine

from app.models import Base
from app.models.agent_session import AgentSession
from app.repositories.agent_repository import AgentRepository


@pytest.fixture
async def session_factory():
    """内存 SQLite session 工厂（仅用于排序语义测试，不依赖 MySQL）。"""
    engine = create_async_engine("sqlite+aiosqlite:///:memory:")
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
    factory = async_sessionmaker(engine, class_=AsyncSession, expire_on_commit=False)
    yield factory
    await engine.dispose()


@pytest.mark.asyncio
async def test_list_sessions_orders_by_create_time_desc(session_factory):
    """list_sessions 必须按 create_time 降序返回（议题：会话排序统一用创建时间）。"""
    async with session_factory() as db:
        # 故意让 update_time / last_message_time 与 create_time 不一致，
        # 确保排序真的读 create_time 而非其它时间字段
        older = AgentSession(
            session_key="k1", current_task_id="t1", employee_id=1,
            create_time="2026-06-01 10:00:00", update_time="2026-06-22 10:00:00",
        )
        newer = AgentSession(
            session_key="k2", current_task_id="t2", employee_id=1,
            create_time="2026-06-20 10:00:00", update_time="2026-06-19 10:00:00",
        )
        db.add_all([older, newer])
        await db.commit()

        repo = AgentRepository(db)
        items = await repo.list_sessions(employee_id=1, skip=0, limit=10)
        ids = [s.id for s in items]
        # newer（create_time 更晚）应排在前
        assert ids[0] == newer.id
        assert ids[1] == older.id
```

若 `aiosqlite` 不在依赖中，先 `cd backend && pip install aiosqlite`（仅测试用）。若团队不接受新测试依赖，改为手工验证（见 Step 5）并跳过本测试。

- [ ] **Step 2: 运行确认失败**

Run: `cd backend && python -m pytest tests/repositories/test_agent_repository.py::test_list_sessions_orders_by_create_time_desc -v`
Expected: FAIL（当前按 `update_time` 排序，`older` 的 update_time 更晚 → older 排在前，断言失败）。

- [ ] **Step 3: 改 list_sessions 排序键**

`backend/app/repositories/agent_repository.py` 第 53-55 行：

```python
        result = await self._db.execute(
            query.order_by(
                AgentSession.create_time.desc(), AgentSession.id.desc(),
            ).offset(skip).limit(limit)
        )
        return result.scalars().all()
```

（原 `AgentSession.update_time.desc(), AgentSession.id.desc()` 改为 `create_time`。）

- [ ] **Step 4: 运行测试确认通过**

Run: `cd backend && python -m pytest tests/repositories/test_agent_repository.py::test_list_sessions_orders_by_create_time_desc -v`
Expected: PASS。

- [ ] **Step 5: 手工验证（可选，若无 aiosqlite）**

若跳过了 Step 1-4 的自动测试，启动后端后查库确认：

```sql
SELECT id, title, create_time, update_time, last_message_time
FROM agent_session WHERE employee_id=? AND status=1
ORDER BY create_time DESC;
```

对比接口 `GET /employee/agent/sessions` 返回顺序应与上面 SQL 一致。

- [ ] **Step 6: 提交**

```bash
git add backend/app/repositories/agent_repository.py backend/tests/repositories/test_agent_repository.py
git commit -m "fix(agent): list_sessions 排序改 create_time 降序（议题：会话按创建时间排序）"
```

---

## Task 5: 排序 — 前端 refreshSessions / 侧栏分组改 create_time

**Files:**
- Modify: `frontend/src/store/agent.ts:204-211`（refreshSessions）
- Modify: `frontend/src/components/employee/agent/layout/agent-sidebar-drawer.tsx:39-120`（sortSessionsByTime / groupSessionsByTime）
- Test: `frontend/src/components/employee/agent/layout/__tests__/agent-sidebar-grouping.test.ts`
- Test: `frontend/src/components/employee/agent/layout/__tests__/agent-sidebar-sort.test.ts`

**Interfaces:**
- Consumes: `WorkspaceSession.create_time`（`@/types/agent:116`，已存在）。
- Produces: 侧栏分组/折叠态排序、以及 store 不再二次重排，全部以 `create_time` 为准。

- [ ] **Step 1: 改 groupSessionsByTime 与 sortSessionsByTime 用 create_time**

`frontend/src/components/employee/agent/layout/agent-sidebar-drawer.tsx`：

`sortSessionsByTime`（约 46-50 行）改为：

```tsx
/** 按 create_time 降序排序会话（新的在上）。
 *
 * 仅供折叠态 Popover 复用（折叠态不分组，平铺最近会话）；展开态走 groupSessionsByTime。
 * 空时间视为最早（排到末尾）。
 *
 * 议题：会话排序统一用创建时间（不再用 last_message_time）。
 *
 * 导出供单测与折叠态 Popover 复用。
 */
export function sortSessionsByTime(sessions: WorkspaceSession[]): WorkspaceSession[] {
  return [...sessions].sort((a, b) =>
    (b.create_time ?? '').localeCompare(a.create_time ?? ''),
  );
}
```

`groupSessionsByTime`（约 71-120 行）：把所有读 `s.last_message_time` 的地方改为 `s.create_time`。具体三处：

1. 循环里取值：`const t = s.create_time;`（原 `s.last_message_time`）
2. `byTimeDesc` 比较器：

```tsx
  const byTimeDesc = (a: WorkspaceSession, b: WorkspaceSession) =>
    (b.create_time ?? '').localeCompare(a.create_time ?? '');
```

3. 顶部 docstring 的"last_message_time"字样改为"create_time"。

- [ ] **Step 2: 改 refreshSessions 移除 last_message_time 重排**

`frontend/src/store/agent.ts` 的 `refreshSessions`（约 204-211 行），删除这段排序：

```ts
    // 兜底降序：即便后端未排序，前端也保证新的在上（按 last_message_time）
    items.sort((a, b) => (b.last_message_time ?? '').localeCompare(a.last_message_time ?? ''));
```

（后端 Task 4 已按 `create_time` 排序返回，前端不再二次重排，避免两套排序键打架。）

- [ ] **Step 3: 更新 grouping 单测为 create_time 语义**

`frontend/src/components/employee/agent/layout/__tests__/agent-sidebar-grouping.test.ts`。`mk` 工厂函数（约 17-31 行）把 `last_message_time` 与 `create_time` 解耦，让 `create_time` 成为分组依据、`last_message_time` 作为干扰项：

```tsx
/** 构造最小合法 WorkspaceSession。
 *  create_time 决定分组/排序；last_message_time 故意不同以验证函数读的是 create_time。
 */
function mk(id: number, createTime: string, lastMessageTime = '2099-12-31T00:00:00Z'): WorkspaceSession {
  return {
    id,
    session_key: `k${id}`,
    current_task_id: `t${id}`,
    employee_id: 1,
    title: `s${id}`,
    selected_model_name: null,
    enable_thinking: false,
    status: 0,
    last_message_time: lastMessageTime,
    create_time: createTime,
    update_time: createTime,
  };
}
```

然后把所有 `mk(id, isoAt(...))` 调用理解为传 `createTime`（第二个参数）。由于原调用本来就只传两个参数，签名兼容。断言不变（仍按时间分组），但现在真正驱动分组的是 `create_time`。

为保证"确实在读 create_time"被验证，在最末尾追加一个显式用例：

```tsx
  it('以 create_time（非 last_message_time）判定分组', () => {
    // create_time 在上周、last_message_time 在今天 → 应落「更早」而非「今日」
    const sessions = [
      mk(1, isoAt(2026, 5, 14, 12), isoAt(2026, 5, 17, 12)),
    ];
    const groups = groupSessionsByTime(sessions, NOW);
    expect(groups.find(g => g.key === 'today')!.items).toEqual([]);
    expect(groups.find(g => g.key === 'earlier')!.items.map(s => s.id)).toEqual([1]);
  });
```

- [ ] **Step 4: 更新 sort 单测为 create_time 语义**

`frontend/src/components/employee/agent/layout/__tests__/agent-sidebar-sort.test.ts`。若其中 `mk`/fixtures 用 `last_message_time` 排序，改为用 `create_time`，并加一个显式用例证明读的是 `create_time`：

```tsx
  it('sortSessionsByTime 按 create_time 降序（忽略 last_message_time）', () => {
    const sessions = [
      mk(1, '2026-06-01T00:00:00Z', '2026-06-22T00:00:00Z'),
      mk(2, '2026-06-10T00:00:00Z', '2026-06-01T00:00:00Z'),
    ];
    const sorted = sortSessionsByTime(sessions);
    // create_time 更晚的 id=2 在前（尽管 last_message_time 更早）
    expect(sorted.map(s => s.id)).toEqual([2, 1]);
  });
```

（若该测试文件的 `mk` 签名与 grouping 不同，就地调整使其接受 `(id, createTime, lastMessageTime?)`。）

- [ ] **Step 5: 运行测试确认通过**

Run: `cd frontend && npx vitest run src/components/employee/agent/layout/__tests__/agent-sidebar-grouping.test.ts src/components/employee/agent/layout/__tests__/agent-sidebar-sort.test.ts`
Expected: PASS（含新加的"读 create_time"显式用例）。

- [ ] **Step 6: 类型检查 + 回归侧栏整体测试**

Run: `cd frontend && npx tsc --noEmit`
Expected: 无新增类型错误。

Run: `cd frontend && npx vitest run src/components/employee/agent/layout/ src/store/`
Expected: PASS。

- [ ] **Step 7: 提交**

```bash
git add frontend/src/store/agent.ts frontend/src/components/employee/agent/layout/agent-sidebar-drawer.tsx frontend/src/components/employee/agent/layout/__tests__/agent-sidebar-grouping.test.ts frontend/src/components/employee/agent/layout/__tests__/agent-sidebar-sort.test.ts
git commit -m "fix(agent-fe): 侧栏排序/分组 + store 改用 create_time，移除前端二次重排"
```

---

## Task 6: 议题 3 + 新 Bug A 复测（Cluster 1 修好后验证）

**Files:**
- 无预先代码改动；本任务为**复测 + 残留登记**。若复测发现残留需要改代码，另起 follow-up 任务（不在此预先写）。

**前提**：Task 1（Cluster 1 commit）已合并并部署到本地环境。

- [ ] **Step 1: 验证议题 2（全局进度刷新不丢）**

启动后端 + 前端，登录员工账号进入 Agent 工作台：
1. 发一条面试题问题，跑到产出面试题（完整 END）。
2. 刷新浏览器。
3. 点侧栏该会话进去。

**预期**：右侧进度岛显示全部 success 节点（不再全 pending）。
查库验证：`SELECT progress FROM agent_session WHERE id=?` → 非 NULL、含完整 steps。

若仍全 pending → Cluster 1 未生效或 `selectProgressSource` 还有问题，登记 follow-up。

- [ ] **Step 2: 验证议题 3（进入被中断会话显示中断提示）**

1. 发一条问题，跑到维度选择卡（pending interaction）→ **不要**点提交。
2. 直接刷新浏览器 → 点侧栏该会话进去。

**预期**：消息区底部出现橙色 `InterruptBar`「本次任务已中断 + 恢复」按钮；点「恢复」后进度从持久化基线续上（节点状态保留）。

若 `InterruptBar` 未显示 → 检查最后一条 agent 消息是否含 `streaming` block（`isLastAgentMessageInterrupted` 判定）；登记 follow-up。

- [ ] **Step 3: 验证新 Bug A 的三个残留症状**

1. **数据消失**：Step 1 已覆盖（应已解决）。
2. **中断按钮常驻**：完成一次"中断 → 恢复 → END"流程，刷新后看 `InterruptBar` 是否消失。
   - 预期：END 后最后一条 agent 消息全 success，`isLastAgentMessageInterrupted=false`，bar 不显示。
   - 若仍常驻 → 说明恢复后旧 `streaming` block 未被覆盖为终态；登记 follow-up（可能需在 `_persist_agent_message` 或前端 reducer 确保恢复 run 的 block.stop 覆盖旧 streaming block）。
3. **假"提交中"**：发问题到出题规划卡（`plan_approval` interaction），**不要**点提交，观察前端是否出现"提交中"字样。
   - 预期：interaction 卡显示 pending（等用户点提交），不应显示"提交中"。
   - 若出现 → 定位 `block.delta` / `interaction.resolve` 的 status 写入路径；可能是前端乐观态或后端某处误发 `submitted`；登记 follow-up。

- [ ] **Step 4: 残留汇总**

把 Step 1-3 中所有"未通过"的项汇总，每项开一个 follow-up 任务（注明复现步骤、预期、实际），转入各自的小 spec 或直接进实现队列。**本 Task 6 不写代码**——残留的根因需个案定位，不在本计划预先臆造修复。

- [ ] **Step 5: 标记 Task 6 完成**

所有 Step 1-3 通过 → Task 6 完成、Spec A 收口；未通过项转 follow-up。

---

## Self-Review

**1. Spec coverage（对照 spec §2 / §3）：**
- Cluster 1 持久化 commit（§3.1）→ Task 1（4 条路径）✅
- 议题 2 全局进度丢（§3.2）→ 由 Task 1 解决 + Task 6 Step 1 验证 ✅
- 议题 3 进入提示（§3.3）→ Task 6 Step 2 验证 ✅
- 议题 4 序号（§3.4）→ Task 3 ✅
- 排序 create_time（§3.5）→ Task 4（后端）+ Task 5（前端）✅
- 新 Bug A 残留 + persist_failed 信令（§3.6）→ Task 2（信令）+ Task 6 Step 3（残留复测）✅
- 执行顺序（§6）→ Task 1 → 2/3/4/5 → 6，一致 ✅

**2. Placeholder scan：** 无 TBD/TODO；每个改代码步骤均含完整代码块、确切命令与预期。Task 6 是验证任务，明确不预写修复代码（残留需个案定位），不算 placeholder。✅

**3. Type consistency：**
- `StepRow` `index?: number` —— Task 3 定义（接口 + StepIcon），`ProgressPanel` Task 3 Step 4 传 `i+1`，一致 ✅
- `sortSessionsByTime` / `groupSessionsByTime` 改 `create_time` —— Task 5 定义；`refreshSessions` Task 5 Step 2 移除重排，不再有 `last_message_time` 排序键残留 ✅
- `persist_failed` code 字符串 —— Task 2 后端 emit 与前端 `agent-message-list.tsx:128` 既有 `runState.error.code` 显示路径一致（前端不需要为 `persist_failed` 特判，落入默认 `[${code}] ${message}` 分支）✅
- `_build_svc` 的 `repo.commit = AsyncMock()` —— Task 1 测试覆盖替换为 `_track_commit`，既有测试不受影响（Task 1 Step 11 回归）✅

**4. 风险已标注：** Task 4 的 `aiosqlite` 测试依赖（可降级为手工验证）；Task 6 的残留为待定性（不扩大范围）。
