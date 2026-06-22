# Agent 工作台中断提示优化 实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让用户主动点击「暂停」按钮中断流式任务后，可靠显示「任务已中断」提示 + RefreshCw/「重试」图标按钮，并保留中断前已展示的内容。

**Architecture:** 双信号 OR 兜底 —— 前端 `runState.aborted`（点击瞬间置 true，立即响应）+ 后端 `agent_message.content.interrupted`（client_aborted 时落库，刷新后可靠恢复）。移除依赖 streaming-block 状态的旧判定 `isLastAgentMessageInterrupted`。

**Tech Stack:** 后端 Python 3.12 / FastAPI / anyio；前端 React 19 / TypeScript / Zustand / vitest。

**Spec:** `docs/superpowers/specs/2026-06-22-agent-interrupt-prompt-design.md`

## Global Constraints

- 所有注释、日志、文档使用中文；变量/函数/类名用英文。
- 源码 UTF-8 无 BOM，行尾 LF。
- 后端分层：`endpoint → service → repository`，不越层。
- 前端接口调用必须经过 `src/api/`，类型与后端 schemas 对齐（snake_case，前端不做 camelCase 转换）。
- 视觉沿用项目 sky/orange 体系，不引入新 design token。
- 按钮行为保持 `onResume` 续接 LangGraph checkpoint（A2 决策不变），仅改文案/图标。
- worktree 分支：`worktree-agent-interrupt-prompt-design`（基于 dev）。

## File Structure

### 后端
| 文件 | 职责 | 改动 |
|---|---|---|
| `backend/app/services/agent_runtime_service.py` | Agent 流式运行时 | `_persist_agent_message` 加 `client_aborted` 入参；三条流式入口 finally 调用点透传 |
| `backend/tests/services/test_agent_runtime_service.py` | 运行时单测 | 新增中断标记落库测试 |

### 前端
| 文件 | 职责 | 改动 |
|---|---|---|
| `frontend/src/types/agent.ts` | 类型定义 | `AgentRunState.aborted`、`AgentMessage.content.interrupted` |
| `frontend/src/utils/agent-run-reducer.ts` | envelope → runState reducer | `INITIAL_RUN_STATE.aborted`、`run.start` 清除 aborted |
| `frontend/src/store/agent.ts` | 全局状态（多会话并发） | `resolveRunStateAfterFinish` 保留 aborted；`abort` 置标志；三入口清标志 |
| `frontend/src/components/employee/agent/interrupt-bar.tsx` | 中断提示 UI | 简化为仅中断态；移除 `isError`/`onRetry`/`retrying`/`resuming`；文案「任务已中断」+ RefreshCw/「重试」 |
| `frontend/src/components/employee/agent/agent-message-list.tsx` | 消息列表 | 删除 `isLastAgentMessageInterrupted`、删除 `onRetryFromLastUser` prop、触发判定改双信号 |
| `frontend/src/components/employee/agent/agent-workspace.tsx` | 工作台主区 | 删除 `handleRetryFromLastUser` 及 prop 传递 |
| `frontend/src/utils/__tests__/agent-run-reducer.test.ts` | reducer 单测 | 新增 aborted 字段测试 |
| `frontend/src/store/__tests__/agent-aborted.test.ts`（新增） | store aborted 生命周期单测 | 新建 |
| `frontend/src/components/employee/agent/__tests__/interrupt-bar.test.tsx`（新增） | InterruptBar 单测 | 新建 |
| `frontend/src/store/__tests__/agent-{resume,resume-baseline,send-abort,submit-baseline}.test.ts` | 现有 store 单测 | 连带：runState 对象补 `aborted: false` |

### 任务依赖
Task 1（后端）与 Task 2（前端类型+reducer）相互独立。Task 3 依赖 Task 2 的类型。Task 4 依赖 Task 2 + Task 3。

---

## Task 1: 后端 — `_persist_agent_message` 支持 `client_aborted` 标记

**Files:**
- Modify: `backend/app/services/agent_runtime_service.py:773`（`_persist_agent_message` 签名与函数体）、`:266`（stream_message finally 调用）、`:426`（resolve_interaction finally 调用）、`:572`（resume_run finally 调用）
- Test: `backend/tests/services/test_agent_runtime_service.py`

**Interfaces:**
- Consumes: 三条流式入口已有的局部变量 `client_aborted: bool`
- Produces: `agent_message.content["interrupted"] = True`（仅 client_aborted=True 时），供前端 `AgentMessage.content.interrupted` 消费

- [ ] **Step 1: 写失败测试 —— 客户端中断时 agent 消息 content 含 interrupted=True**

在 `backend/tests/services/test_agent_runtime_service.py` 末尾追加（复用文件已有的 `_build_svc` / `_make_session` / `_runtime_cfg` / `_runtime_cfg` 辅助与 `anyio` cancel scope 模式，参照同文件 `test_stream_message_persists_under_anyio_cancel_scope`）：

```python
@pytest.mark.asyncio
async def test_stream_message_marks_interrupted_on_client_abort():
    """客户端中断时落库的 agent 消息 content 必须含 interrupted=True。

    验证 _persist_agent_message 在 client_aborted=True 时给 content 打显式标记，
    供前端 reload 后识别中断态（根除依赖 block streaming 状态的「碰运气式」判定）。
    """
    import anyio

    svc = _build_svc()
    started = anyio.Event()

    async def _astream(*, thread_id, graph_input, ctx):
        # 产出一个 step 让 envelope_buffer 非空，然后模拟长 LLM 调用等被 cancel
        yield ctx.emitter.emit_step(step_id="load_resume", title="读取简历", status="running")
        started.set()
        await anyio.sleep(30)

    svc._runner_factory = lambda graph: MagicMock(astream=_astream)
    svc._repo.next_message_order = AsyncMock(side_effect=[1, 2])

    # 捕获 create_message 每次 content 参数，断言 agent 消息（第 2 次）被打 interrupted 标记
    created_contents: list[dict] = []

    async def _capture_create(**kwargs):
        created_contents.append(kwargs.get("content"))
        return MagicMock(id=10 + len(created_contents))

    svc._repo.create_message = _capture_create
    svc._repo.commit = AsyncMock()
    svc._repo.update_session = AsyncMock()
    svc._cache.client.delete = AsyncMock()
    svc._cache.client.append = AsyncMock()
    svc._cache.client.expire = AsyncMock()

    session = _make_session()
    session.progress = None
    body = AgentMessageCreate(content="hi", workflow_type="interview_questions")

    async def _run():
        async for _ in svc.stream_message(session=session, body=body, runtime_config=_runtime_cfg()):
            pass

    async with anyio.create_task_group() as tg:
        tg.start_soon(_run)
        await started.wait()
        tg.cancel_scope.cancel()

    # user + agent 两条消息；agent（第 2 条）必须含 interrupted=True
    assert len(created_contents) >= 2, "agent 消息未落库"
    agent_content = created_contents[1]
    assert agent_content.get("interrupted") is True, (
        f"client_aborted 时 agent 消息 content 缺少 interrupted=True：{agent_content}"
    )


@pytest.mark.asyncio
async def test_stream_message_no_interrupted_mark_on_normal_end():
    """正常 END 时落库的 agent 消息 content 不应含 interrupted 字段。"""

    svc = _build_svc()

    async def _astream(*, thread_id, graph_input, ctx):
        yield ctx.emitter.emit_step(step_id="load_resume", title="读取简历", status="success")
        yield ctx.emitter.emit_block_start(index=0, block={"type": "text", "text": "", "status": "streaming"})
        yield ctx.emitter.emit_block_stop(index=0)

    svc._runner_factory = lambda graph: MagicMock(astream=_astream)
    svc._repo.next_message_order = AsyncMock(side_effect=[1, 2])

    created_contents: list[dict] = []

    async def _capture_create(**kwargs):
        created_contents.append(kwargs.get("content"))
        return MagicMock(id=10 + len(created_contents))

    svc._repo.create_message = _capture_create
    svc._repo.commit = AsyncMock()
    svc._repo.update_session = AsyncMock()
    svc._cache.client.delete = AsyncMock()
    svc._cache.client.append = AsyncMock()
    svc._cache.client.expire = AsyncMock()
    svc._repo.advance_task_id = AsyncMock(return_value="next_task") if hasattr(svc._repo, "advance_task_id") else None

    session = _make_session()
    session.progress = None
    body = AgentMessageCreate(content="hi", workflow_type="interview_questions")

    async for _ in svc.stream_message(session=session, body=body, runtime_config=_runtime_cfg()):
        pass

    assert len(created_contents) >= 2
    agent_content = created_contents[1]
    assert "interrupted" not in agent_content, (
        f"正常 END 不应打 interrupted 标记：{agent_content}"
    )
```

- [ ] **Step 2: 运行测试验证失败**

Run: `cd backend && python -m pytest tests/services/test_agent_runtime_service.py::test_stream_message_marks_interrupted_on_client_abort tests/services/test_agent_runtime_service.py::test_stream_message_no_interrupted_mark_on_normal_end -v`

Expected: 两个测试 FAIL（`interrupted` 字段不存在 / 当前 `_persist_agent_message` 未透传 `client_aborted`）。

- [ ] **Step 3: 改 `_persist_agent_message` 签名与函数体**

编辑 `backend/app/services/agent_runtime_service.py`，定位 `async def _persist_agent_message`（约 773 行），改为：

```python
    async def _persist_agent_message(
        self, *, session, user_message, run_id: str,
        envelopes: list[AgentStreamEnvelope],
        runtime_config: LLMRuntimeConfigDTO, workflow_type: str,
        client_aborted: bool = False,
    ):
        """把 envelope 序列折叠为 blocks 并落库 agent 消息。

        client_aborted=True 时在 content 写入 interrupted=True 显式标记，
        供前端 reload 后识别中断态（不依赖 block 的 streaming 状态）。
        """
        blocks = self._envelopes_to_blocks(envelopes)
        content: dict[str, Any] = {"blocks": blocks}
        if client_aborted:
            content["interrupted"] = True
        try:
            msg = await self._repo.create_message(
                session_id=session.id,
                parent_message_id=user_message.id if user_message else None,
                role="agent",
                workflow_type=workflow_type,
                run_id=run_id,
                content=content,
                model_name=runtime_config.model_name,
                sort_order=await self._repo.next_message_order(session.id),
            )
            await self._repo.update_session(
                session.id, status=1, last_message_time=datetime.now(),
            )
            await self._repo.commit()
            return msg
        except Exception:
            await self._repo.rollback()
            logger.exception("agent_message 落库失败")
            raise
```

- [ ] **Step 4: 三条流式入口 finally 调用透传 `client_aborted`**

同一文件，定位三处 `_persist_agent_message(...)` 调用（约 `:266` stream_message、`:426` resolve_interaction、`:572` resume_run），在每处调用的参数列表末尾加 `client_aborted=client_aborted,`。示例（stream_message）：

```python
                    agent_message = await self._persist_agent_message(
                        session=session, user_message=user_message, run_id=run_id,
                        envelopes=envelope_buffer, runtime_config=runtime_config,
                        workflow_type=body.workflow_type,
                        client_aborted=client_aborted,
                    )
```

resolve_interaction（user_message=None）与 resume_run（user_message=None）同样补 `client_aborted=client_aborted,`。

- [ ] **Step 5: 运行测试验证通过**

Run: `cd backend && python -m pytest tests/services/test_agent_runtime_service.py::test_stream_message_marks_interrupted_on_client_abort tests/services/test_agent_runtime_service.py::test_stream_message_no_interrupted_mark_on_normal_end -v`

Expected: 两个测试 PASS。

- [ ] **Step 6: 跑后端全量回归**

Run: `cd backend && python -m pytest tests/services/test_agent_runtime_service.py -v`

Expected: 全部 PASS（新参数默认值 `False`，对正常路径无影响）。

- [ ] **Step 7: 提交**

```bash
git add backend/app/services/agent_runtime_service.py backend/tests/services/test_agent_runtime_service.py
git commit -m "feat(agent): _persist_agent_message 支持 client_aborted 标记，落库 content.interrupted"
```

---

## Task 2: 前端类型 + reducer 基础（`aborted` 字段与 `run.start` 清除）

**Files:**
- Modify: `frontend/src/types/agent.ts`（`AgentRunState`、`AgentMessage.content`）
- Modify: `frontend/src/utils/agent-run-reducer.ts`（`INITIAL_RUN_STATE`、`run.start` 分支）
- Modify: 4 个现有 store 测试补 `aborted: false`（连带，TS 必填字段报错）
- Test: `frontend/src/utils/__tests__/agent-run-reducer.test.ts`

**Interfaces:**
- Produces: `AgentRunState.aborted: boolean`（供 Task 3 store 与 Task 4 UI 消费）；`INITIAL_RUN_STATE.aborted = false`

- [ ] **Step 1: 写失败测试 —— reducer 的 aborted 字段行为**

在 `frontend/src/utils/__tests__/agent-run-reducer.test.ts` 末尾追加：

```typescript
describe('agent-run-reducer · aborted 标志', () => {
  it('INITIAL_RUN_STATE.aborted 默认 false', () => {
    expect(INITIAL_RUN_STATE.aborted).toBe(false);
  });

  function makeRunStart(resume = false): AgentEnvelope {
    return {
      v: 1, seq: 0, ts: 0, run_id: 'r1', session_id: 1,
      type: 'run.start',
      data: {
        run_id: 'r1', workflow_type: 'interview_questions',
        enable_thinking: false, user_message_id: null,
        ...(resume ? { resume: true } : {}),
      },
    };
  }

  it('run.start（非 resume）清除 aborted', () => {
    const abortedState: AgentRunState = { ...INITIAL_RUN_STATE, aborted: true };
    const next = agentRunReducer(abortedState, makeRunStart(false));
    expect(next.aborted).toBe(false);
  });

  it('run.start（resume）清除 aborted', () => {
    const abortedState: AgentRunState = { ...INITIAL_RUN_STATE, aborted: true };
    const next = agentRunReducer(abortedState, makeRunStart(true));
    expect(next.aborted).toBe(false);
  });
});
```

- [ ] **Step 2: 运行测试验证失败**

Run: `cd frontend && npx vitest run src/utils/__tests__/agent-run-reducer.test.ts`

Expected: FAIL —— `INITIAL_RUN_STATE.aborted` 是 `undefined`（字段不存在），TS 编译错误。

- [ ] **Step 3: 改 `types/agent.ts` 加字段**

编辑 `frontend/src/types/agent.ts`。

`AgentRunState` 接口（约 131 行）末尾加字段：

```typescript
export interface AgentRunState {
  running: boolean;
  run_id: string | null;
  workflow_type: WorkflowType;
  enable_thinking: boolean;
  steps: AgentStep[];
  current_blocks: AgentBlock[];
  error: { code: string; message: string } | null;
  aborted: boolean;  // 用户主动中断标志（前端即时信号；run.start 清除）
}
```

`AgentMessage.content`（约 93 行）加可选字段：

```typescript
  content: {
    blocks: AgentBlock[];
    context_refs?: Array<Record<string, unknown>>;
    interrupted?: boolean;  // 后端 client_aborted 时落库的持久化中断标记
  };
```

- [ ] **Step 4: 改 `agent-run-reducer.ts`**

编辑 `frontend/src/utils/agent-run-reducer.ts`。

`INITIAL_RUN_STATE`（约 18 行）加默认值：

```typescript
export const INITIAL_RUN_STATE: AgentRunState = {
  running: false,
  run_id: null,
  workflow_type: 'interview_questions',
  enable_thinking: false,
  steps: [],
  current_blocks: [],
  error: null,
  aborted: false,
};
```

`run.start` case（约 37 行）两个分支都加 `aborted: false`：

```typescript
    case 'run.start': {
      const data = env.data;
      if (data.resume) {
        return { ...state, running: true, error: null, aborted: false };
      }
      return {
        running: true,
        run_id: data.run_id,
        workflow_type: data.workflow_type as WorkflowType,
        enable_thinking: data.enable_thinking,
        steps: [],
        current_blocks: [],
        error: null,
        aborted: false,
      };
    }
```

- [ ] **Step 5: 修现有 store 测试 runState 对象补 `aborted: false`**

`AgentRunState.aborted` 现在是必填字段。4 个现有 store 测试手写了 runState 对象（缺 `aborted`），TS 会报错。逐一补上。

文件与定位（每个文件 `runState: {` 对象内补 `aborted: false`）：
- `frontend/src/store/__tests__/agent-resume.test.ts`
- `frontend/src/store/__tests__/agent-resume-baseline.test.ts`
- `frontend/src/store/__tests__/agent-send-abort.test.ts`（约 42 行）
- `frontend/src/store/__tests__/agent-submit-baseline.test.ts`

示例（agent-send-abort.test.ts:42）：

```typescript
          runState: { running: false, workflow_type: 'interview_questions', steps: [], current_blocks: [], error: null, run_id: null, enable_thinking: false, aborted: false },
```

其余三个文件同理，在 `runState: { ... }` 对象末尾加 `aborted: false`。

- [ ] **Step 6: 运行测试验证通过**

Run: `cd frontend && npx vitest run src/utils/__tests__/agent-run-reducer.test.ts src/store/__tests__/`

Expected: 全部 PASS（新 reducer 测试通过 + 现有 store 测试 TS 编译通过）。

- [ ] **Step 7: 提交**

```bash
git add frontend/src/types/agent.ts frontend/src/utils/agent-run-reducer.ts frontend/src/utils/__tests__/agent-run-reducer.test.ts frontend/src/store/__tests__/
git commit -m "feat(agent-fe): AgentRunState.aborted 字段 + run.start 清除中断态"
```

---

## Task 3: 前端 store — `resolveRunStateAfterFinish` 保留 aborted + abort/入口清标志

**Files:**
- Modify: `frontend/src/store/agent.ts`（`resolveRunStateAfterFinish`、`abort`、`sendMessage`、`submitInteraction`、`resumeRun`）
- Test: `frontend/src/store/__tests__/agent-aborted.test.ts`（新建）

**Interfaces:**
- Consumes: Task 2 的 `AgentRunState.aborted` 字段
- Produces: `store.abort(id)` 设置 `runState.aborted=true`；三个 run 入口启动时设置 `runState.aborted=false`；`resolveRunStateAfterFinish` 在客户端 abort 收尾路径保留 `aborted=true`

- [ ] **Step 1: 写失败测试 —— resolveRunStateAfterFinish 4 路径**

新建 `frontend/src/store/__tests__/agent-aborted.test.ts`：

```typescript
/**
 * aborted 标志生命周期单测：
 * - resolveRunStateAfterFinish 在客户端 abort 路径保留 aborted，其它路径清除
 * - store.abort(id) 立即置 aborted=true
 * - sendMessage/submitInteraction/resumeRun 入口立即清 aborted
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { useAgentStore, resolveRunStateAfterFinish } from '../agent';
import { INITIAL_RUN_STATE } from '@/utils/agent-run-reducer';
import type { AgentRunState } from '@/types/agent';

vi.mock('@/api/employee/agent', () => ({
  employeeAgentApi: {
    streamMessage: vi.fn(() => (async function* () {})()),
    submitInteraction: vi.fn(() => (async function* () {})()),
    resumeSession: vi.fn(() => (async function* () {})()),
    getSession: vi.fn(async () => ({ data: { data: { session: { id: 1 }, messages: [] } } })),
    abortSession: vi.fn(async () => ({ data: {} })),
  },
}));

describe('resolveRunStateAfterFinish · aborted 保留逻辑', () => {
  it('正常 END（hasFinish + nextTaskId）：aborted=false', () => {
    const prev: AgentRunState = { ...INITIAL_RUN_STATE, aborted: true };
    const next = resolveRunStateAfterFinish(prev, { hasFinish: true, nextTaskId: 't2', hasError: false });
    expect(next.aborted).toBe(false);
  });

  it('interrupt 暂停（hasFinish + 无 nextTaskId）：aborted=false', () => {
    const prev: AgentRunState = { ...INITIAL_RUN_STATE, aborted: true };
    const next = resolveRunStateAfterFinish(prev, { hasFinish: true, nextTaskId: null, hasError: false });
    expect(next.aborted).toBe(false);
  });

  it('客户端 abort（无 finish + 无 error + prev.aborted）：保留 aborted=true', () => {
    const prev: AgentRunState = { ...INITIAL_RUN_STATE, aborted: true };
    const next = resolveRunStateAfterFinish(prev, { hasFinish: false, nextTaskId: null, hasError: false });
    expect(next.aborted).toBe(true);
  });

  it('错误终态（hasError）：aborted=false', () => {
    const prev: AgentRunState = {
      ...INITIAL_RUN_STATE, aborted: true,
      error: { code: 'graph_execution_failed', message: 'boom' },
    };
    const next = resolveRunStateAfterFinish(prev, { hasFinish: false, nextTaskId: null, hasError: true });
    expect(next.aborted).toBe(false);
  });
});

describe('store.abort · 置 aborted 标志', () => {
  beforeEach(() => {
    useAgentStore.setState({
      activeId: 1,
      runs: {
        1: {
          session: { id: 1, enable_thinking: false, selected_model_name: null } as never,
          messages: [],
          runState: { ...INITIAL_RUN_STATE },
          sending: true,
          loaded: true,
        },
      },
    });
  });

  it('abort(id) 立即置 runState.aborted=true', () => {
    useAgentStore.getState().abort(1);
    expect(useAgentStore.getState().runs[1].runState.aborted).toBe(true);
  });
});
```

注意：`store.abort` 内部访问模块级 `abortControllers` Map。测试中 abort 入口走「ac 存在」路径需要预先往 Map 里塞一个 AbortController。由于 `abortControllers` 不是 export 的，测试通过 `sending=true` 的语义间接验证即可；若直接调用 `abort(1)` 时 Map 为空会走路径2（调后端），可在测试中只验证「不抛错 + store 状态一致」。

更严谨的做法是让 `store.abort` 在 ac 不存在时也置 aborted（见 Step 3 实现，两条路径都置 aborted），这样测试不需要触碰模块级 Map。**采用此方案**：Step 1 测试如上即可通过。

- [ ] **Step 2: 运行测试验证失败**

Run: `cd frontend && npx vitest run src/store/__tests__/agent-aborted.test.ts`

Expected: FAIL —— `resolveRunStateAfterFinish` 返回的对象 `aborted` 为 `undefined`（INITIAL 重置后无该字段保留逻辑）；`store.abort` 未置 aborted。

- [ ] **Step 3: 改 `resolveRunStateAfterFinish` 保留 aborted**

编辑 `frontend/src/store/agent.ts`，定位 `export function resolveRunStateAfterFinish`（约 801 行）。在 `isInterruptPause` 之后加 `preserveAborted`，并在返回对象中带上：

```typescript
export function resolveRunStateAfterFinish(
  prev: AgentRunState,
  finish: { hasFinish: boolean; nextTaskId: string | null; hasError?: boolean },
): AgentRunState {
  // 错误终态：保留 steps（失败步可见）+ error（红色提示），优先于中断段判定
  if (finish.hasError) {
    return {
      ...INITIAL_RUN_STATE,
      workflow_type: prev.workflow_type,
      steps: prev.steps,
      error: prev.error,
    };
  }
  // 中断段：收到 finish 且未推进 task_id → 保留 steps 让进度跨段累积
  const isInterruptPause = finish.hasFinish && !finish.nextTaskId;
  // 客户端主动中断（无 finish、无 error、前端已置 aborted）→ 保留 aborted 让 InterruptBar 显示
  const preserveAborted = !finish.hasFinish && !finish.hasError && prev.aborted;
  return {
    ...INITIAL_RUN_STATE,
    workflow_type: prev.workflow_type,
    ...(isInterruptPause ? { steps: prev.steps } : {}),
    ...(preserveAborted ? { aborted: true } : {}),
  };
}
```

- [ ] **Step 4: 改 `store.abort` 两条路径都置 aborted**

同文件，定位 `abort: (sessionId) => {`（约 641 行）。两条路径（ac 存在 / interrupt 态）都加 set aborted。改为：

```typescript
  abort: (sessionId) => {
    // 中断分两路径，都立即置 aborted=true 让 InterruptBar 瞬间显示（不等 reload）：
    // 1) 流式 run 进行中（ac 存在）→ fetch.abort() 切断流，后端 finally 落库（含中断前内容 + content.interrupted）
    // 2) interrupt 暂停态（ac 已 delete）→ 调后端 /abort 端点标记 pending interaction 为 expired
    const ac = abortControllers.get(sessionId);
    set((s) => ({
      runs: {
        ...s.runs,
        [sessionId]: {
          ...getRun(s.runs, sessionId),
          runState: { ...getRun(s.runs, sessionId).runState, aborted: true },
        },
      },
    }));
    if (ac) {
      ac.abort();
      return;
    }
    // 路径 2：interrupt 态。fire-and-forget 调后端，再 reload 同步前端 UI。
    void (async () => {
      try {
        await employeeAgentApi.abortSession(sessionId);
      } catch (err) {
        console.error('中断 interrupt 失败', err);
        return;
      }
      try {
        const resp = await employeeAgentApi.getSession(sessionId);
        const detail = resp.data?.data ?? resp.data;
        useAgentStore.setState((s) => {
          const entry = getRun(s.runs, sessionId);
          const remoteSession = (detail?.session ?? entry.session) as WorkspaceSession | null;
          const session = remoteSession
            ? mergeLocalRuntime(remoteSession, entry.session)
            : entry.session;
          return {
            runs: {
              ...s.runs,
              [sessionId]: {
                ...entry,
                session,
                messages: detail?.messages ?? entry.messages,
                loaded: true,
              },
            },
          };
        });
      } catch (err) {
        console.error('中断后 reload 会话失败', err);
      }
    })();
  },
```

- [ ] **Step 5: 三个 run 入口启动时立即清 aborted**

同文件，定位 `sendMessage`（约 368 行）、`submitInteraction`（约 513 行）、`resumeRun`（约 565 行）。在各自设置 `sending: true` 的 setState 调用中，同时把 `runState.aborted` 置为 `false`。

`sendMessage` 中虚拟会话段（约 395 行）和真实会话段（约 436 行）的 `sending: true` set 都改，例如：

```typescript
    set((s) => ({ runs: { ...s.runs, [realSessionId]: { ...getRun(s.runs, realSessionId), sending: true, runState: { ...getRun(s.runs, realSessionId).runState, aborted: false } } } }));
```

`submitInteraction`（约 543 行）：

```typescript
    set((s) => ({ runs: { ...s.runs, [sessionId]: { ...getRun(s.runs, sessionId), sending: true, runState: { ...getRun(s.runs, sessionId).runState, aborted: false } } } }));
```

`resumeRun`（约 593 行）：

```typescript
    set((s) => ({ runs: { ...s.runs, [sessionId]: { ...getRun(s.runs, sessionId), sending: true, runState: { ...getRun(s.runs, sessionId).runState, aborted: false } } } }));
```

注意保留各处原有的 `persisted progress` 基线载入逻辑（submitInteraction / resumeRun 在 set sending 之前可能已有 persisted steps 写入）—— 本步只改 `sending: true` 的那处 set，不动其它。

- [ ] **Step 6: 运行测试验证通过**

Run: `cd frontend && npx vitest run src/store/__tests__/agent-aborted.test.ts src/store/__tests__/`

Expected: 全部 PASS。

- [ ] **Step 7: 跑 store 全量回归**

Run: `cd frontend && npx vitest run src/store/ src/utils/`

Expected: 全部 PASS。

- [ ] **Step 8: 提交**

```bash
git add frontend/src/store/agent.ts frontend/src/store/__tests__/agent-aborted.test.ts
git commit -m "feat(agent-fe): store abort 置 aborted 标志 + 三入口立即清除（瞬间响应）"
```

---

## Task 4: 前端 UI — InterruptBar 简化 + 双信号触发判定

**Files:**
- Modify: `frontend/src/components/employee/agent/interrupt-bar.tsx`（简化 props + 改文案图标）
- Modify: `frontend/src/components/employee/agent/agent-message-list.tsx`（删 `isLastAgentMessageInterrupted`、删 `onRetryFromLastUser` prop、提取 `shouldShowInterruptBar` 纯函数 + JSX 调用）
- Modify: `frontend/src/components/employee/agent/agent-workspace.tsx`（删 `handleRetryFromLastUser` 及 prop 传递）
- Test: `frontend/src/components/employee/agent/__tests__/interrupt-bar.test.tsx`（新建）
- Test: `frontend/src/components/employee/agent/__tests__/interrupt-bar-predicate.test.ts`（新建，判定纯函数）

**Interfaces:**
- Consumes: Task 2 `AgentRunState.aborted` + `AgentMessage.content.interrupted`；Task 3 `store.abort/resumeRun`
- Produces: InterruptBar 仅接收 `onResume`；`shouldShowInterruptBar(runState, messages, sending): boolean` 纯函数封装双信号判定（spec 4.1 逻辑），便于单测；触发判定 `shouldShowInterruptBar(...) && onResume`

**设计偏离说明：** spec 4.6.1 写的是「内联判定」，实现时提取为 `shouldShowInterruptBar` 纯函数 —— 同样的逻辑，但可单测（满足 spec 7.1 对判定逻辑的测试要求）。这是对 spec 的轻微优化，不改变判定语义。

- [ ] **Step 1: 写失败测试 —— InterruptBar 渲染与交互 + 判定纯函数**

新建两个测试文件。

文件一 `frontend/src/components/employee/agent/__tests__/interrupt-bar.test.tsx`：

```typescript
/**
 * InterruptBar 单测：仅中断态，文案「任务已中断」+ RefreshCw 图标 + 「重试」按钮。
 * 点击触发 onResume（续接 checkpoint，A2 决策不变）。
 */
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { InterruptBar } from '../interrupt-bar';

describe('InterruptBar', () => {
  it('渲染「任务已中断」文案与「重试」按钮', () => {
    render(<InterruptBar onResume={() => {}} />);
    expect(screen.getByText('任务已中断')).toBeInTheDocument();
    expect(screen.getByText('重试')).toBeInTheDocument();
  });

  it('点击「重试」触发 onResume', () => {
    const onResume = vi.fn();
    render(<InterruptBar onResume={onResume} />);
    fireEvent.click(screen.getByText('重试'));
    expect(onResume).toHaveBeenCalledOnce();
  });
});
```

文件二 `frontend/src/components/employee/agent/__tests__/interrupt-bar-predicate.test.ts`（覆盖 spec 7.1 判定逻辑测试要求）：

```typescript
/**
 * shouldShowInterruptBar 判定纯函数单测：双信号 OR 兜底。
 *   !error && (aborted || (!running && !sending && last.content.interrupted))
 */
import { describe, it, expect } from 'vitest';
import { shouldShowInterruptBar } from '../agent-message-list';
import { INITIAL_RUN_STATE } from '@/utils/agent-run-reducer';
import type { AgentMessage, AgentRunState } from '@/types/agent';

function makeAgentMsg(interrupted?: boolean): AgentMessage {
  return {
    id: 1, session_id: 1, parent_message_id: null, role: 'agent',
    workflow_type: 'interview_questions', run_id: null,
    content: { blocks: [], ...(interrupted !== undefined ? { interrupted } : {}) },
    model_name: null, token_count: null, sort_order: 0, create_time: null,
  };
}

describe('shouldShowInterruptBar · 双信号判定', () => {
  it('aborted=true：立即显示（不限 running，中断瞬间与 pseudoStreamingMessage 同屏）', () => {
    const rs: AgentRunState = { ...INITIAL_RUN_STATE, running: true, aborted: true };
    expect(shouldShowInterruptBar(rs, [], false)).toBe(true);
  });

  it('content.interrupted=true + !running + !sending：显示（刷新恢复）', () => {
    const rs: AgentRunState = { ...INITIAL_RUN_STATE, running: false };
    expect(shouldShowInterruptBar(rs, [makeAgentMsg(true)], false)).toBe(true);
  });

  it('content.interrupted=true + sending=true：不显示（重试发起窗口避免残留）', () => {
    const rs: AgentRunState = { ...INITIAL_RUN_STATE, running: false };
    expect(shouldShowInterruptBar(rs, [makeAgentMsg(true)], true)).toBe(false);
  });

  it('两者皆 false：不显示（正常结束）', () => {
    const rs: AgentRunState = { ...INITIAL_RUN_STATE, running: false };
    expect(shouldShowInterruptBar(rs, [makeAgentMsg(false)], false)).toBe(false);
  });

  it('error 非空：不显示（互斥，走红色 callout）', () => {
    const rs: AgentRunState = {
      ...INITIAL_RUN_STATE, aborted: true,
      error: { code: 'graph_execution_failed', message: 'boom' },
    };
    expect(shouldShowInterruptBar(rs, [], false)).toBe(false);
  });
});
```

- [ ] **Step 2: 运行测试验证失败**

Run: `cd frontend && npx vitest run src/components/employee/agent/__tests__/interrupt-bar.test.tsx src/components/employee/agent/__tests__/interrupt-bar-predicate.test.ts`

Expected: FAIL —— InterruptBar 文案是「本次任务已中断」+「恢复」、props 要求 `onRetry`；`shouldShowInterruptBar` 未从 `agent-message-list` 导出（函数不存在）。

- [ ] **Step 3: 简化 `interrupt-bar.tsx`**

编辑 `frontend/src/components/employee/agent/interrupt-bar.tsx`，整体替换为：

```typescript
/**
 * InterruptBar：中断态提示条。
 *
 * 用户主动点击「暂停」、或刷新/断网打断流式 run 后展示。
 * 单行 pill：橙色感叹号 + 「任务已中断」+ RefreshCw 图标 + 「重试」按钮。
 *
 * 触发条件由调用方（AgentMessageList）判定：
 *   !error && (runState.aborted || (!running && !sending && last.content.interrupted))
 *
 * 按钮行为 = onResume（续接 LangGraph checkpoint，A2 决策不变）。
 * 点击后 store 立即清 aborted，本条瞬间消失，天然防重入，无需 disabled 态。
 *
 * 视觉沿用项目 sky/orange 体系，不引入新 token。
 */
import { RefreshCw } from 'lucide-react';

export interface InterruptBarProps {
  /** 续接 checkpoint 回调（调 store.resumeRun） */
  onResume: () => void;
}

export function InterruptBar({ onResume }: InterruptBarProps) {
  return (
    <div
      role="status"
      aria-label="任务已中断"
      className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full
                 bg-[#FFF7ED] border border-[#FB923C]/40
                 text-[12.5px] text-[#9A3412] font-medium mt-3"
    >
      {/* 橙色感叹号 chip */}
      <span
        aria-hidden="true"
        className="inline-flex w-4 h-4 rounded-full bg-[#FED7AA]
                   text-[#EA580C] text-[11px] font-bold
                   items-center justify-center"
      >
        !
      </span>
      <span>任务已中断</span>
      <button
        type="button"
        onClick={onResume}
        title="重试"
        aria-label="重试"
        className="inline-flex items-center gap-1 h-6 px-2 rounded-full ml-1 text-[12px]
                   text-[#EA580C]
                   hover:bg-[#EA580C]/10
                   transition-colors"
      >
        <RefreshCw size={12} />
        <span>重试</span>
      </button>
    </div>
  );
}
```

- [ ] **Step 4: 运行测试验证通过**

Run: `cd frontend && npx vitest run src/components/employee/agent/__tests__/interrupt-bar.test.tsx`

Expected: PASS。

- [ ] **Step 5: 改 `agent-message-list.tsx` —— 提取判定纯函数 + 删旧函数**

编辑 `frontend/src/components/employee/agent/agent-message-list.tsx`。

5a. 删除 `isLastAgentMessageInterrupted` 函数（文件末尾，约 188-193 行）及其 export。

5b. 在文件顶部 import 之后、`AgentMessageListProps` 接口之前，新增并 export `shouldShowInterruptBar` 纯函数：

```typescript
/**
 * InterruptBar 显示判定（双信号 OR 兜底）。
 *
 * ① runState.aborted：前端即时信号。用户点击「暂停」瞬间置 true，不限 running 状态，
 *   中断瞬间与 pseudoStreamingMessage 同屏（内容冻结 + 中断提示），不等 reload。
 * ② !running && !sending && last.content.interrupted：后端持久化信号。刷新/断网恢复场景，
 *   aborted 已随内存丢失，靠 DB 标记兜底。!sending 排除重试发起窗口（aborted 已清但
 *   run.start 未到达、上一轮 content.interrupted 仍在）避免残留误导。
 *
 * error 非空时不显示（走红色 callout，互斥）。
 */
export function shouldShowInterruptBar(
  runState: AgentRunState,
  messages: AgentMessage[],
  sending: boolean,
): boolean {
  if (runState.error) return false;
  if (runState.aborted) return true;
  if (!runState.running && !sending) {
    const last = messages[messages.length - 1];
    return last?.content?.interrupted === true;
  }
  return false;
}
```

5c. `AgentMessageListProps` 接口删除 `onRetryFromLastUser?: () => void;`（约 34 行）；`AgentMessageList` 函数参数解构同步删除 `onRetryFromLastUser`（约 38 行）。

5d. 触发判定（约 157-164 行）改为调用纯函数：

```tsx
        {/* 中断提示：双信号 OR（shouldShowInterruptBar 纯函数封装，见文件顶部） */}
        {shouldShowInterruptBar(runState, messages, sending ?? false) && onResume && (
          <InterruptBar onResume={onResume} />
        )}
```

- [ ] **Step 6: 改 `agent-workspace.tsx` 连带清理**

编辑 `frontend/src/components/employee/agent/agent-workspace.tsx`。

6a. 删除 `handleRetryFromLastUser` 函数（约 79-94 行）。

6b. `AgentMessageList` 调用处（约 120-129 行）删除 `onRetryFromLastUser={handleRetryFromLastUser}` 这一行。`onRetry={handleRetry}`（红色 callout 用）与 `onResume={() => void resumeRun(sessionId)}` 保留不动。

- [ ] **Step 7: 运行前端全量测试**

Run: `cd frontend && npx vitest run`

Expected: 全部 PASS。

- [ ] **Step 8: TypeScript 类型检查**

Run: `cd frontend && npx tsc --noEmit`

Expected: 无错误（确认 `onRetryFromLastUser` 删除后无悬空引用、InterruptBar props 简化后调用方一致）。

- [ ] **Step 9: 提交**

```bash
git add frontend/src/components/employee/agent/interrupt-bar.tsx frontend/src/components/employee/agent/agent-message-list.tsx frontend/src/components/employee/agent/agent-workspace.tsx frontend/src/components/employee/agent/__tests__/interrupt-bar.test.tsx frontend/src/components/employee/agent/__tests__/interrupt-bar-predicate.test.ts
git commit -m "feat(agent-fe): InterruptBar 简化为仅中断态 + shouldShowInterruptBar 双信号判定，移除 isLastAgentMessageInterrupted"
```

---

## 完成后的整体验收

按 spec 第八节验收标准逐条核对：

1. 用户主动点击「暂停」→ InterruptBar 立即出现（`aborted=true` 分支 ①）
2. 刷新页面后重进会话 → InterruptBar 仍显示（`content.interrupted` 分支 ②）
3. 点击「重试」→ `resumeRun` 续接 → InterruptBar 立即消失（入口清 aborted）
4. checkpoint 过期 → 红色 callout「流程状态已过期」（现有行为，`!error` 条件使 InterruptBar 不显示）
5. 中断前内容保留（现有 reload 机制不动）
6. `isLastAgentMessageInterrupted` 从代码完全移除
7. 后端三条入口均落库 `content.interrupted=true`
8. 前后端测试全部通过
9. 重试发起窗口（sending=true）InterruptBar 不显示

最终跑一次全量测试确认：

```bash
cd backend && python -m pytest tests/services/test_agent_runtime_service.py -v
cd frontend && npx vitest run
cd frontend && npx tsc --noEmit
```
