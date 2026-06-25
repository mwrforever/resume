# Agent 会话 4 个 Bug 修复 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 修复 Agent 工作台 4 个前端 bug：新会话串入历史消息（高风险）、刷新后进度回退、新空会话误显进度栏、中断/发送按钮不互斥且 interrupt 态无法发送。

**Architecture:** 全部为纯前端改动（后端已核查支持，无需改动）。核心在 Zustand store (`store/agent.ts`) 收敛 activeId 初始化路径、resume 进度基线、发送前自动中断；外加一个纯函数模块 `interaction-utils.ts` 供 store 与 Composer 复用 pending interaction 判定；以及两处组件级条件渲染/按钮显隐调整。

**Tech Stack:** React 19 + TypeScript + Vite + Zustand + framer-motion + lucide-react；测试用 vitest + @testing-library/react。

## Global Constraints

- 所有注释、日志、文档说明必须使用中文；变量名/函数名/类名用英文。
- 源码文件 UTF-8 无 BOM，行尾 LF，文件末尾保留一个换行符。
- 前端命名：组件文件 PascalCase；普通文件/目录小写中划线分隔；变量/函数 small camelCase；类型/接口以 `I` 或 `T` 开头。
- 禁止在组件内直接调用 axios，接口调用必须经 `src/api/`。
- 精准改动：只改必须改的，不顺手优化相邻代码；只清理本次改动产生的冗余。
- 后端不改动（design 文档已核查 `/sessions/{id}/abort` 支持发送前自动中断）。
- 不改动 `runs` 多会话缓存机制；不重构 Composer 整体。
- 测试命令统一：`cd frontend && npx vitest run <相对 frontend 的路径>`。

---

## File Structure

**新建：**
- `frontend/src/components/employee/agent/interaction-utils.ts` — 纯函数 `hasPendingInteraction(messages)`，判定"最近一条 agent 消息是否含 pending 的 interaction block"。store 与 Composer/Workspace 共用，消除重复实现（Bug4）。

**修改：**
- `frontend/src/store/agent.ts` — refreshSessions 不再写 activeId、新增 `bootstrap` 幂等 action（Bug1）；resumeRun 进度基线（Bug2）；sendMessage 发送前自动 abort（Bug4）。
- `frontend/src/components/employee/agent/layout/agent-standalone-layout.tsx` — 自动新建会话改用 store 幂等入口 `bootstrap`，移除组件 `useRef` 判定（Bug1）。
- `frontend/src/components/employee/agent/agent-workspace.tsx` — FloatingProgress 条件挂载 `messages.length > 0`（Bug3）；`hasPendingInteraction` 改用共享纯函数（Bug4）。
- `frontend/src/components/employee/agent/agent-composer.tsx` — 按钮互斥（sending 仅显示暂停、非 sending 仅显示发送）+ `sendDisabled` 移除 `hasPendingInteraction` 拦截（Bug4）。

**测试（新建）：**
- `frontend/src/components/employee/agent/__tests__/interaction-utils.test.ts`
- `frontend/src/store/__tests__/agent-bootstrap.test.ts`
- `frontend/src/store/__tests__/agent-resume-baseline.test.ts`
- `frontend/src/components/employee/agent/__tests__/agent-workspace-progress.test.tsx`
- `frontend/src/components/employee/agent/__tests__/agent-composer-buttons.test.tsx`
- `frontend/src/store/__tests__/agent-send-abort.test.ts`

---

## Task 1: interaction-utils 纯函数（Bug4 基础）

**Files:**
- Create: `frontend/src/components/employee/agent/interaction-utils.ts`
- Test: `frontend/src/components/employee/agent/__tests__/interaction-utils.test.ts`

**Interfaces:**
- Consumes: `AgentMessage`、`AgentBlock` 类型（来自 `@/types/agent`）。`AgentMessage.role` 为 `'user' | 'agent'`，`AgentMessage.content.blocks: AgentBlock[]`，interaction block 形如 `{ type: 'interaction'; status: BlockStatus; ... }`，pending 态 `status === 'pending'`。
- Produces: `export function hasPendingInteraction(messages: AgentMessage[]): boolean` — 后续 Task 4（Workspace）、Task 5（Composer 测试 + store sendMessage）复用此函数。

- [ ] **Step 1: 写失败测试**

创建 `frontend/src/components/employee/agent/__tests__/interaction-utils.test.ts`：

```ts
/**
 * hasPendingInteraction 纯函数单测。
 *
 * 覆盖：无消息 / 末条为 user / 末条 agent 含 pending interaction /
 * 含 submitted（已提交）/ 含 expired（已过期）/ 无 interaction block。
 */
import { describe, it, expect } from 'vitest';
import { hasPendingInteraction } from '../interaction-utils';
import type { AgentMessage } from '@/types/agent';

// 构造一条 agent 消息，blocks 由入参指定
function agentMsg(blocks: AgentMessage['content']['blocks']): AgentMessage {
  return {
    id: 1, session_id: 1, parent_message_id: null, role: 'agent',
    workflow_type: 'interview_questions', run_id: null,
    content: { blocks }, model_name: null, token_count: null,
    sort_order: 0, create_time: null,
  };
}

// 构造一条 user 消息（纯文本 block）
function userMsg(): AgentMessage {
  return {
    id: 2, session_id: 1, parent_message_id: null, role: 'user',
    workflow_type: 'interview_questions', run_id: null,
    content: { blocks: [{ type: 'text', index: 0, text: '你好', status: 'success' }] },
    model_name: null, token_count: null, sort_order: 0, create_time: null,
  };
}

// 构造一个 interaction block，status 由入参指定
function interactionBlock(status: 'pending' | 'submitted' | 'expired') {
  return {
    type: 'interaction' as const, index: 0,
    request_id: 'r1', interaction_type: 'resume_upload' as const,
    title: '上传简历', prompt: '请上传', data: {}, status,
  };
}

describe('hasPendingInteraction', () => {
  it('空消息列表返回 false', () => {
    expect(hasPendingInteraction([])).toBe(false);
  });

  it('最近一条 agent 含 pending interaction 返回 true', () => {
    expect(hasPendingInteraction([agentMsg([interactionBlock('pending')])])).toBe(true);
  });

  it('interaction 已 submitted 返回 false', () => {
    expect(hasPendingInteraction([agentMsg([interactionBlock('submitted')])])).toBe(false);
  });

  it('interaction 已 expired 返回 false', () => {
    expect(hasPendingInteraction([agentMsg([interactionBlock('expired')])])).toBe(false);
  });

  it('agent 消息无 interaction block 返回 false', () => {
    expect(hasPendingInteraction([agentMsg([{ type: 'text', index: 0, text: '答复', status: 'success' }])])).toBe(false);
  });

  it('最近一条是 user 消息（即便更早 agent 有 pending）返回 false', () => {
    // 判定基于"最近一条 agent 消息"，末条 user 时仍回看最近 agent；
    // 这里最近 agent 是 pending，所以应为 true（验证"找最近 agent 而非末条"）
    expect(hasPendingInteraction([agentMsg([interactionBlock('pending')]), userMsg()])).toBe(true);
  });
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `cd frontend && npx vitest run src/components/employee/agent/__tests__/interaction-utils.test.ts`
Expected: FAIL，报 `hasPendingInteraction` 未定义 / 模块不存在。

- [ ] **Step 3: 实现纯函数**

创建 `frontend/src/components/employee/agent/interaction-utils.ts`：

```ts
/**
 * interaction 判定工具（纯函数，无副作用）。
 *
 * 供 store.sendMessage（发送前自动中断判定）与 AgentWorkspace（按钮态判定）复用，
 * 避免在多处重复实现"最近一条 agent 消息是否含未提交 interaction"逻辑。
 */

import type { AgentMessage } from '@/types/agent';

/**
 * 判断会话是否处于人机交互等待态（pending interaction）。
 *
 * 语义：倒序找到最近一条 agent 消息，若其 blocks 中存在 type==='interaction'
 * 且 status==='pending' 的块，则流程正暂停等用户输入，返回 true。
 * interaction 的终态（submitted/rejected/expired）不算 pending。
 *
 * @param messages 当前会话的消息列表（含 user 与 agent，按时间升序）
 * @returns true 表示存在未完成的人机交互（流程已暂停）
 */
export function hasPendingInteraction(messages: AgentMessage[]): boolean {
  // 倒序找最近一条 agent 消息（interaction 只可能出现在 agent 消息里）
  const lastAgent = [...messages].reverse().find(m => m.role === 'agent');
  if (!lastAgent) return false;
  // 该 agent 消息中存在 pending 的 interaction block 即为等待态
  return (lastAgent.content.blocks ?? []).some(
    b => b.type === 'interaction' && b.status === 'pending',
  );
}
```

- [ ] **Step 4: 运行测试确认通过**

Run: `cd frontend && npx vitest run src/components/employee/agent/__tests__/interaction-utils.test.ts`
Expected: PASS（6 个用例全过）。

- [ ] **Step 5: 提交**

```bash
git add frontend/src/components/employee/agent/interaction-utils.ts frontend/src/components/employee/agent/__tests__/interaction-utils.test.ts
git commit -m "feat(agent-fe): 新增 hasPendingInteraction 纯函数（Bug4 基础）"
```

---

## Task 2: Bug1 — refreshSessions 不写 activeId + bootstrap 幂等

**Files:**
- Modify: `frontend/src/store/agent.ts:200-225`（refreshSessions）、`:46-85`（接口声明区，加 `bootstrap`）、`createSession` 后新增 `bootstrap` action
- Modify: `frontend/src/components/employee/agent/layout/agent-standalone-layout.tsx:35-43`（移除 useRef，改调 bootstrap）
- Test: `frontend/src/store/__tests__/agent-bootstrap.test.ts`

**Interfaces:**
- Consumes: store 现有 `createSession()`、`activeId`、`sessions`、`runs`。`isEmptyVirtual(session)`（已存在，判定空虚拟会话：`session.id < 0 && (session.last_message_time ?? '') === ''`）。
- Produces: `bootstrap: () => void`（store action，幂等：仅当当前无激活的空虚拟会话时才新建一个）。layout 改为 mount 时调用 `bootstrap`。

**根因（design 已确证）：** `refreshSessions` 第 210 行 `const activeId = s.activeId ?? (items.length ? items[0].id : null)` 把最近历史会话设为 activeId，与自动新建竞争，导致 activeId 短暂指向历史会话 A → ensureLoaded 拉取 A 的历史消息闪现。修复：refreshSessions 不写 activeId（仅当当前 activeId 已不在新列表中才置 null 兜底）；自动新建上移到 store 幂等 `bootstrap`。

- [ ] **Step 1: 写失败测试**

创建 `frontend/src/store/__tests__/agent-bootstrap.test.ts`：

```ts
/**
 * Bug1 修复单测：activeId 初始化收敛 + bootstrap 幂等。
 *
 * 1. refreshSessions 不把 items[0] 设为 activeId（防止短暂指向历史会话→串史）。
 * 2. refreshSessions 在 activeId 指向的会话已不在新列表时，置为 null 交由兜底。
 * 3. bootstrap 幂等：连续调用只产生一个空虚拟会话。
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { useAgentStore } from '../agent';

vi.mock('@/api/employee/agent', () => ({
  employeeAgentApi: {
    listSessions: vi.fn(async () => ({
      data: { data: { items: [
        { id: 10, last_message_time: '2026-06-20T10:00:00Z' },
        { id: 11, last_message_time: '2026-06-19T10:00:00Z' },
      ] } },
    })),
  },
}));

describe('Bug1 activeId 收敛 + bootstrap 幂等', () => {
  beforeEach(() => useAgentStore.setState({
    sessions: [], activeId: null, runs: {}, creating: false,
  }));

  it('refreshSessions 不把 items[0] 设为 activeId', async () => {
    await useAgentStore.getState().refreshSessions();
    // 修复前这里会是 10；修复后保持 null（交由 bootstrap 自动新建兜底）
    expect(useAgentStore.getState().activeId).toBeNull();
    // 列表照常加载
    expect(useAgentStore.getState().sessions.map(s => s.id)).toEqual([10, 11]);
  });

  it('当前 activeId 不在新列表中时置 null', async () => {
    useAgentStore.setState({ activeId: 999 }); // 999 已被删/失效
    await useAgentStore.getState().refreshSessions();
    expect(useAgentStore.getState().activeId).toBeNull();
  });

  it('当前 activeId 仍在新列表中时保持不变', async () => {
    useAgentStore.setState({ activeId: 11 });
    await useAgentStore.getState().refreshSessions();
    expect(useAgentStore.getState().activeId).toBe(11);
  });

  it('bootstrap 幂等：连续调用只建一个空虚拟会话', () => {
    const { bootstrap } = useAgentStore.getState();
    bootstrap();
    bootstrap();
    bootstrap();
    const virtuals = useAgentStore.getState().sessions.filter(s => s.id < 0);
    expect(virtuals).toHaveLength(1);
    // activeId 指向该虚拟会话（负 id），绝不指向历史会话
    expect(useAgentStore.getState().activeId).toBe(virtuals[0].id);
  });
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `cd frontend && npx vitest run src/store/__tests__/agent-bootstrap.test.ts`
Expected: FAIL — 第一个用例 activeId 为 10 而非 null；`bootstrap` 未定义。

- [ ] **Step 3: 改 refreshSessions（不写 activeId）**

修改 `frontend/src/store/agent.ts` 的 `refreshSessions`（约 200-225 行），把 `set` 内的 activeId 计算替换为"仅失效兜底"：

```ts
  refreshSessions: async (keyword) => {
    const resp = await employeeAgentApi.listSessions({
      page: 1, page_size: 50, keyword: keyword || undefined,
    });
    const data = resp.data?.data ?? resp.data;
    const items = (data?.items ?? []) as WorkspaceSession[];
    // 兜底降序：即便后端未排序，前端也保证新的在上（按 last_message_time）
    items.sort((a, b) => (b.last_message_time ?? '').localeCompare(a.last_message_time ?? ''));
    set((s) => {
      // Bug1 根因修复：refreshSessions 不再自动选 items[0] 为 activeId。
      // activeId 的初始化收敛为单一路径（bootstrap 自动新建空虚拟会话），
      // 避免与自动新建竞争时 activeId 短暂指向历史会话 A → ensureLoaded 拉到 A 的历史消息串史。
      // 唯一例外：当前 activeId 指向的会话已不在新列表（被删/失效），置 null 交由 bootstrap 兜底。
      // 注意虚拟会话（负 id）不在后端列表中，需排除以免被误置 null。
      const stillExists =
        s.activeId === null
        || s.activeId < 0
        || items.some(it => it.id === s.activeId);
      const activeId = stillExists ? s.activeId : null;
      // 同步 sessions 列表里的最新字段到 runs[id].session（若已加载）。
      // 思考开关/模型名是前端会话级状态，后端值是 DB 默认值，必须保留本地值不覆盖。
      const runs = { ...s.runs };
      for (const sess of items) {
        const existing = runs[sess.id];
        if (existing?.session) {
          runs[sess.id] = {
            ...existing,
            session: mergeLocalRuntime(sess, existing.session),
          };
        }
      }
      return { sessions: items, activeId, runs };
    });
  },
```

- [ ] **Step 4: 在接口声明里加 bootstrap**

修改 `frontend/src/store/agent.ts` 的 `AgentStoreState` 接口（约 58-85 行 actions 区），在 `createSession` 声明后加：

```ts
  createSession: (workflow?: WorkflowType) => Promise<void>;
  /** 幂等引导：进入工作台时确保存在一个空虚拟会话作为 activeId（StrictMode 双跑/HMR 重挂载不重复建）。
   *  Bug1：activeId 初始化收敛到此单一路径，refreshSessions 不再写 activeId。 */
  bootstrap: () => void;
```

- [ ] **Step 5: 实现 bootstrap action**

在 `frontend/src/store/agent.ts` 的 `createSession` 实现之后（约 285 行 `},` 后）新增 `bootstrap`：

```ts
  bootstrap: () => {
    // 幂等：已存在空虚拟会话（负 id 且未发送过消息）则不再新建。
    // 用 isEmptyVirtual 判定，覆盖 StrictMode 双跑 / HMR 重挂载场景，
    // 替代原 layout 组件里不可靠的 useRef 守护。
    const { sessions, activeId } = get();
    const existingVirtual = sessions.find(isEmptyVirtual);
    if (existingVirtual) {
      // 已有空虚拟会话：仅在 activeId 未指向它时纠正，绝不新建第二个
      if (activeId !== existingVirtual.id) set({ activeId: existingVirtual.id });
      return;
    }
    // 已有激活的真实会话则不打扰（用户可能正在某会话里）
    if (activeId !== null) return;
    // 无任何激活会话 → 新建一个空虚拟会话（复用 createSession 的虚拟会话逻辑）
    void get().createSession();
  },
```

- [ ] **Step 6: layout 改用 bootstrap，移除 useRef**

修改 `frontend/src/components/employee/agent/layout/agent-standalone-layout.tsx`：

把 import 行（第 11 行）改为不再需要 `useRef`：

```tsx
import { useEffect } from 'react';
```

把第 23 行 `createSession` 选择器替换为 `bootstrap`：

```tsx
  const bootstrap = useAgentStore((s) => s.bootstrap);
```

把第 35-43 行的 `didAutoCreate` ref + effect 替换为：

```tsx
  // 进入工作台默认打开「新建会话页」：
  // 调用 store 幂等 bootstrap，确保存在一个空虚拟会话作为 activeId。
  // 幂等判定收敛到 store（isEmptyVirtual），不再依赖组件 useRef——
  // 后者在 StrictMode 双跑 / HMR 重挂载下会失效，是 Bug1 串史的加固缺口。
  useEffect(() => {
    bootstrap();
  }, [bootstrap]);
```

注意：侧栏「新建会话」按钮（第 76 行 `onCreate={() => void createSession()}`）仍用 `createSession`——那是用户显式点击，不走幂等。需保留第 23 行附近的 `createSession` 选择器：

```tsx
  const createSession = useAgentStore((s) => s.createSession);
  const bootstrap = useAgentStore((s) => s.bootstrap);
```

- [ ] **Step 7: 运行测试确认通过 + 类型检查**

Run: `cd frontend && npx vitest run src/store/__tests__/agent-bootstrap.test.ts`
Expected: PASS（4 个用例全过）。

Run: `cd frontend && npx tsc --noEmit`
Expected: 无新增类型错误（layout 移除 useRef 后无未用 import）。

- [ ] **Step 8: 回归现有 store/layout 测试**

Run: `cd frontend && npx vitest run src/store/ src/components/employee/agent/layout/`
Expected: PASS（既有用例不被破坏）。

- [ ] **Step 9: 提交**

```bash
git add frontend/src/store/agent.ts frontend/src/components/employee/agent/layout/agent-standalone-layout.tsx frontend/src/store/__tests__/agent-bootstrap.test.ts
git commit -m "fix(agent-fe): Bug1 收敛 activeId 初始化（refreshSessions 不写 activeId + bootstrap 幂等），切断新会话串史"
```

---

## Task 3: Bug2 — resumeRun 进度基线

**Files:**
- Modify: `frontend/src/store/agent.ts:503-531`（resumeRun）
- Test: `frontend/src/store/__tests__/agent-resume-baseline.test.ts`

**Interfaces:**
- Consumes: store `resumeRun(sessionId)`；`runs[id].runState`（`AgentRunState`，含 `steps: AgentStep[]`、`workflow_type`）；`runs[id].session.progress`（`{ workflow_type: WorkflowType; steps: AgentStep[] } | undefined`）。
- Produces: resumeRun 在调 `resumeSession` API 前，把 `runState.steps` 用 `session.progress.steps` 初始化为基线，`runState.workflow_type` 用 `session.progress.workflow_type` 兜底。

**根因（design）：** 刷新后内存 `runState.steps=[]`，点继续 → resumeRun → reducer `run.start.resume` 分支只设 running，不回写持久化 steps。第一条新 `step.update` 到达时 `selectProgressSource` 优先取 runState.steps（仅 1 步），进度从持久化 N 步回退。修复：resumeRun 发起前用 `session.progress.steps` 设基线。

- [ ] **Step 1: 写失败测试**

创建 `frontend/src/store/__tests__/agent-resume-baseline.test.ts`：

```ts
/**
 * Bug2 修复单测：resumeRun 进度基线。
 *
 * 模拟刷新后 runState.steps=[] 但 session.progress.steps 有 N 步，
 * 调 resumeRun 后断言 runState.steps 被初始化为持久化 N 步基线，
 * workflow_type 同步取 progress.workflow_type。
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { useAgentStore } from '../agent';
import type { AgentStep } from '@/types/agent';

// resumeSession 返回一个永不产出的挂起迭代器，让我们能在 await 前断言基线已写入
let releaseStream: () => void;
vi.mock('@/api/employee/agent', () => ({
  employeeAgentApi: {
    resumeSession: vi.fn(() => (async function* () {
      // 挂起直到测试释放，确保断言发生在流消费前
      await new Promise<void>((resolve) => { releaseStream = resolve; });
    })()),
    getSession: vi.fn(async () => ({ data: { data: { session: { id: 1 }, messages: [] } } })),
  },
}));

const persistedSteps: AgentStep[] = [
  { step_id: 'load_resume', title: '读取简历', status: 'success' },
  { step_id: 'suggest_dimensions', title: '分析维度', status: 'success' },
  { step_id: 'generate', title: '生成', status: 'running' },
];

describe('Bug2 resumeRun 进度基线', () => {
  beforeEach(() => useAgentStore.setState({
    activeId: 1,
    runs: {
      1: {
        session: {
          id: 1, enable_thinking: false, selected_model_name: null,
          progress: { workflow_type: 'interview_questions', steps: persistedSteps },
        } as never,
        messages: [{ id: 5, role: 'agent', workflow_type: 'interview_questions' } as never],
        runState: { workflow_type: 'interview_questions', steps: [] } as never,
        sending: false, loaded: true,
      },
    },
  }));

  it('resumeRun 发起前用 session.progress.steps 初始化 runState.steps 基线', async () => {
    const p = useAgentStore.getState().resumeRun(1);
    // 此刻流挂起在 resumeSession 内，基线应已在发起前写入
    const steps = useAgentStore.getState().runs[1].runState.steps;
    expect(steps.map(s => s.step_id)).toEqual(['load_resume', 'suggest_dimensions', 'generate']);
    expect(useAgentStore.getState().runs[1].runState.workflow_type).toBe('interview_questions');
    // 释放流让 run promise 收尾，避免悬挂
    releaseStream();
    await p;
  });
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `cd frontend && npx vitest run src/store/__tests__/agent-resume-baseline.test.ts`
Expected: FAIL — steps 为 `[]`（基线未写入）。

- [ ] **Step 3: 在 resumeRun 写基线**

修改 `frontend/src/store/agent.ts` 的 `resumeRun`（约 503-512 行），在 `const ac = new AbortController();` 之前插入基线写入：

```ts
  resumeRun: async (sessionId) => {
    // 续接被中断的 run：从历史消息/runState 取 workflow_type（与 submitInteraction 同源逻辑），
    // 复用其 AbortController + runPromise 结构，保证可被中断 / finally 清理。
    const entry = get().runs[sessionId];
    const lastMsg = entry?.messages?.[entry.messages.length - 1];
    const workflowType: WorkflowType =
      lastMsg?.workflow_type ?? entry?.runState.workflow_type ?? 'interview_questions';
    // Bug2 修复：刷新后内存 runState.steps=[]，resume 前用持久化 session.progress.steps
    // 初始化为基线。这样 resume 后到达的 step.update 经 upsertStep 在已有 N 步上累积更新，
    // 不再因 selectProgressSource 优先取仅含 1 步的 runState.steps 而从完整 N 步回退。
    const persisted = entry?.session?.progress;
    if (persisted && persisted.steps.length > 0) {
      set((s) => ({
        runs: {
          ...s.runs,
          [sessionId]: {
            ...getRun(s.runs, sessionId),
            runState: {
              ...getRun(s.runs, sessionId).runState,
              steps: persisted.steps,
              workflow_type: persisted.workflow_type,
            },
          },
        },
      }));
    }
    const ac = new AbortController();
    abortControllers.set(sessionId, ac);
    // ...（以下保持原样）
```

注意：仅在 `set` 内插入基线，`workflowType` 局部变量仍用于 API 调用，不改其计算。

- [ ] **Step 4: 运行测试确认通过**

Run: `cd frontend && npx vitest run src/store/__tests__/agent-resume-baseline.test.ts`
Expected: PASS。

- [ ] **Step 5: 回归 resume 相关既有测试**

Run: `cd frontend && npx vitest run src/store/__tests__/agent-resume.test.ts src/store/__tests__/resolve-run-state-after-finish.test.ts`
Expected: PASS（既有 resumeRun 行为不被破坏）。

- [ ] **Step 6: 提交**

```bash
git add frontend/src/store/agent.ts frontend/src/store/__tests__/agent-resume-baseline.test.ts
git commit -m "fix(agent-fe): Bug2 resumeRun 用持久化 progress 初始化进度基线，刷新后继续不回退"
```

---

## Task 4: Bug3 — FloatingProgress 条件挂载

**Files:**
- Modify: `frontend/src/components/employee/agent/agent-workspace.tsx:161-166`（FloatingProgress 条件挂载）
- Test: `frontend/src/components/employee/agent/__tests__/agent-workspace-progress.test.tsx`

**Interfaces:**
- Consumes: 无（仅用现有 `messages`、`progress`、`runState`）。
- Produces: 无新导出；行为变更——`messages.length === 0` 时不渲染 FloatingProgress。

**根因（design）：** workspace 无条件挂载 FloatingProgress；空 steps 经 mergeStepsWithTemplate 填成 pending 节点，`active` 非空故空会话也显示。修复：加 `messages.length > 0` 条件。

**范围边界：** 本任务**只**做条件挂载，**不**触碰第 70-76 行的 `hasPendingInteraction` useMemo（那部分由 Task 5 统一重构为复用纯函数并移除）。

- [ ] **Step 1: 写失败测试**

创建 `frontend/src/components/employee/agent/__tests__/agent-workspace-progress.test.tsx`：

```tsx
/**
 * Bug3 修复单测：新空会话不渲染右侧进度岛，发首条消息后渲染。
 *
 * 用 store mock 提供 runs：messages=[] vs messages 非空，断言进度岛存在性。
 * 进度岛特征文案："流程进度"（展开面板）或胶囊节点标题；这里用 FloatingProgress
 * 内部稳定文案做存在性断言——胶囊默认渲染当前节点标题，模板兜底会渲染首个 pending 节点标题。
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { AgentWorkspace } from '../agent-workspace';
import { useAgentStore } from '@/store/agent';
import type { AgentMessage } from '@/types/agent';

// 真实 store，但 mock 掉网络层，避免 useAgentRun 内 ensureLoaded 触发真实请求
vi.mock('@/api/employee/agent', () => ({
  employeeAgentApi: {
    getSession: vi.fn(async () => ({ data: { data: { session: { id: 1 }, messages: [] } } })),
  },
}));

// 一条 user 消息，使 messages 非空
const userMessage: AgentMessage = {
  id: 100, session_id: 1, parent_message_id: null, role: 'user',
  workflow_type: 'interview_questions', run_id: null,
  content: { blocks: [{ type: 'text', index: 0, text: '帮我出题', status: 'success' }] },
  model_name: null, token_count: null, sort_order: 0, create_time: null,
};

function seedSession(messages: AgentMessage[]) {
  useAgentStore.setState({
    activeId: 1,
    runs: {
      1: {
        session: { id: 1, enable_thinking: false, selected_model_name: null } as never,
        messages,
        runState: { running: false, workflow_type: 'interview_questions', steps: [], current_blocks: [], error: null, run_id: null, enable_thinking: false },
        sending: false, loaded: true,
      },
    },
  });
}

describe('Bug3 FloatingProgress 条件挂载', () => {
  beforeEach(() => useAgentStore.setState({ sessions: [], activeId: null, runs: {} }));

  it('空会话（messages=[]）不渲染进度岛', () => {
    seedSession([]);
    const { container } = render(<AgentWorkspace sessionId={1} onSessionUpdate={() => {}} />);
    // 进度岛根节点带 data-testid（实现步骤会给 FloatingProgress 外层包裹加上）
    expect(container.querySelector('[data-testid="floating-progress"]')).toBeNull();
  });

  it('messages 非空时渲染进度岛', () => {
    seedSession([userMessage]);
    render(<AgentWorkspace sessionId={1} onSessionUpdate={() => {}} />);
    expect(screen.getByTestId('floating-progress')).toBeInTheDocument();
  });
});
```

注意：`floating-progress` testid 需在实现步骤里挂到 FloatingProgress 的根容器。若 FloatingProgress 已有可断言的稳定根节点，可改用它；为稳妥本计划在 Step 3 给 workspace 的挂载包一层带 testid 的 wrapper（最小改动，不动 FloatingProgress 内部）。

- [ ] **Step 2: 运行测试确认失败**

Run: `cd frontend && npx vitest run src/components/employee/agent/__tests__/agent-workspace-progress.test.tsx`
Expected: FAIL — 空会话用例失败（进度岛被无条件渲染，testid 也还没加）。

- [ ] **Step 3: 改 Workspace FloatingProgress 条件挂载**

修改 `frontend/src/components/employee/agent/agent-workspace.tsx` 第 161-166 行的 FloatingProgress 挂载，改为条件渲染并加 testid wrapper：

```tsx
      {/* 右上角悬浮进度岛（替换旧侧边第三栏）。
          Bug3：仅在已有消息（已发送到后端）时渲染；新建/空会话不显示，
          避免空 steps 经模板填充成 pending 节点后误显一串灰节点。 */}
      {messages.length > 0 && (
        <div data-testid="floating-progress">
          <FloatingProgress
            steps={progress.steps}
            running={runState.running}
            workflowType={progress.workflowType}
          />
        </div>
      )}
```

不改动本文件其它部分（import、hasPendingInteraction useMemo 保持原样）。

- [ ] **Step 4: 运行测试确认通过**

Run: `cd frontend && npx vitest run src/components/employee/agent/__tests__/agent-workspace-progress.test.tsx`
Expected: PASS（2 个用例全过）。

- [ ] **Step 5: 类型检查 + 回归**

Run: `cd frontend && npx tsc --noEmit`
Expected: 无新增类型错误。

Run: `cd frontend && npx vitest run src/components/employee/agent/progress-tracker/`
Expected: PASS（FloatingProgress 内部行为未改）。

- [ ] **Step 6: 提交**

```bash
git add frontend/src/components/employee/agent/agent-workspace.tsx frontend/src/components/employee/agent/__tests__/agent-workspace-progress.test.tsx
git commit -m "fix(agent-fe): Bug3 空会话不渲染进度岛（messages 非空才挂载）"
```

---

## Task 5: Bug4 — Composer 按钮互斥 + sendMessage 发送前自动中断

**Files:**
- Modify: `frontend/src/components/employee/agent/agent-composer.tsx:55-61`（sendDisabled）、`:92-104`（submit 守护）、`:251-287`（按钮区显隐）、`:284-285`（发送文案）
- Modify: `frontend/src/store/agent.ts`（sendMessage 发送前自动 abort pending interaction）
- Test: `frontend/src/components/employee/agent/__tests__/agent-composer-buttons.test.tsx`、`frontend/src/store/__tests__/agent-send-abort.test.ts`

**Interfaces:**
- Consumes: Task 1 的 `hasPendingInteraction(messages)`；store 现有 `employeeAgentApi.abortSession(sessionId)`（POST `/sessions/{id}/abort`）、`getSession`。Composer props 现有 `sending`、`hasPendingInteraction`、`onAbort`、`onSend`、`content`（内部 state）。
- Produces: Composer 按钮互斥（sending → 仅暂停；非 sending → 仅发送）；`sendDisabled = sending || !content.trim()`（移除 hasPendingInteraction 拦截）；store.sendMessage 在发现 pending interaction 时先 `await abortSession` 再发新一轮。

**根因（design）：** Composer `sending=true` 时发送按钮只 disabled 未隐藏，与暂停并列；`sendDisabled = sending || hasPendingInteraction` 拦截 interrupt 态发送。后端 `/abort` 标 expired 并推进 task_id，新 thread 隔离——前端"先 abort 再发"两步即可。

- [ ] **Step 1: 写 Composer 按钮失败测试**

创建 `frontend/src/components/employee/agent/__tests__/agent-composer-buttons.test.tsx`：

```tsx
/**
 * Bug4 Composer 三态按钮单测。
 *
 * - 空闲（sending=false, hasPendingInteraction=false）：仅发送，无暂停；有输入则发送可用。
 * - 流式中（sending=true）：仅暂停，无发送。
 * - interrupt 等待（hasPendingInteraction=true）：仅发送（可用，点击触发 onSend），无暂停，
 *   且发送文案不再是"请先完成上方选择"。
 */
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { AgentComposer } from '../agent-composer';
import type { WorkspaceSession } from '@/types/agent';

// uploadResume 不会在按钮测试里触发，但 import 链需要 mock api
vi.mock('@/api/employee/agent', () => ({ employeeAgentApi: { uploadResume: vi.fn() } }));

const baseSession = {
  id: 1, session_key: '', current_task_id: '', employee_id: 0, title: null,
  selected_model_name: null, enable_thinking: false, status: 0,
  last_message_time: null, create_time: null, update_time: null,
} as WorkspaceSession;

function renderComposer(over: Partial<React.ComponentProps<typeof AgentComposer>>) {
  const props: React.ComponentProps<typeof AgentComposer> = {
    session: baseSession, sending: false, hasPendingInteraction: false,
    lastWorkflow: 'interview_questions', prefill: null,
    onPrefillConsumed: () => {}, onSend: vi.fn(), onAbort: vi.fn(),
    onToggleThinking: () => {}, onPickModel: () => {}, isEmptySession: true,
    ...over,
  };
  return { props, ...render(<AgentComposer {...props} />) };
}

describe('Bug4 Composer 三态按钮', () => {
  it('流式中：仅暂停，无发送', () => {
    renderComposer({ sending: true });
    expect(screen.getByLabelText('暂停')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /发送/ })).toBeNull();
  });

  it('空闲：仅发送，无暂停', () => {
    renderComposer({ sending: false });
    expect(screen.queryByLabelText('暂停')).toBeNull();
    expect(screen.getByRole('button', { name: /发送/ })).toBeInTheDocument();
  });

  it('interrupt 等待：仅发送且文案为"发送"，输入后可点击触发 onSend', () => {
    const { props } = renderComposer({ sending: false, hasPendingInteraction: true });
    // 无暂停按钮
    expect(screen.queryByLabelText('暂停')).toBeNull();
    // 文案是"发送"，不是"请先完成上方选择"
    const sendBtn = screen.getByRole('button', { name: /发送/ });
    expect(sendBtn).toHaveTextContent('发送');
    expect(screen.queryByText('请先完成上方选择')).toBeNull();
    // 输入内容后点击发送，onSend 被调用
    const ta = screen.getByPlaceholderText('输入消息…');
    fireEvent.change(ta, { target: { value: '换个问题' } });
    fireEvent.click(sendBtn);
    expect(props.onSend).toHaveBeenCalledTimes(1);
  });
});
```

- [ ] **Step 2: 运行确认失败**

Run: `cd frontend && npx vitest run src/components/employee/agent/__tests__/agent-composer-buttons.test.tsx`
Expected: FAIL — interrupt 用例：发送被 disabled（sendDisabled 含 hasPendingInteraction），文案为"请先完成上方选择"。

- [ ] **Step 3: 改 Composer sendDisabled + submit + 按钮区**

修改 `frontend/src/components/employee/agent/agent-composer.tsx`：

(a) 第 55-61 行注释块与 `sendDisabled` 改为：

```tsx
  // Bug4：按钮互斥 + interrupt 态可发送。
  // - sending=true（流式中）：仅显示红色"暂停"按钮，隐藏"发送"。
  // - 非 sending：仅显示"发送"按钮（含 interrupt 等待态——此时允许发送，
  //   由 store.sendMessage 在发送前自动中断未完成的 interaction 工作流）。
  // sendDisabled 只看流式中与空输入，不再用 hasPendingInteraction 拦截发送。
  const sendDisabled = sending || !content.trim();
```

注意：`content` 在第 62 行 `useState` 声明，需把 `const [content, setContent] = useState('');` 上移到 `sendDisabled` 之前。调整为：

```tsx
  const [content, setContent] = useState('');
  // Bug4：按钮互斥 + interrupt 态可发送。
  // - sending=true（流式中）：仅显示红色"暂停"按钮，隐藏"发送"。
  // - 非 sending：仅显示"发送"按钮（含 interrupt 等待态——此时允许发送，
  //   由 store.sendMessage 在发送前自动中断未完成的 interaction 工作流）。
  // sendDisabled 只看流式中与空输入，不再用 hasPendingInteraction 拦截发送。
  const sendDisabled = sending || !content.trim();
```

（删除原第 62 行重复的 `const [content, setContent] = useState('');`）

(b) `submit` 函数（约 92-104 行）：原有 `if (sendDisabled) return;` 因 sendDisabled 现含 `!content.trim()`，下方 `if (!trimmed) return;` 冗余但无害——保留 `if (sendDisabled) return;` 即可，移除冗余的二次 trim 判断：

```tsx
  const submit = () => {
    // 流式中或空输入禁止发送（sendDisabled 已含两者）
    if (sendDisabled) return;
    const trimmed = content.trim();
    const ctxRefs = upload.kind === 'success'
      ? [{ type: 'resume', file_path: upload.file_path, file_name: upload.fileName }]
      : undefined;
    onSend({ content: trimmed, workflow_type: workflow, context_refs: ctxRefs });
    setContent('');
    // 发送后清除附件展示，避免脏携带到下一条消息
    setUpload({ kind: 'idle' });
  };
```

(c) 按钮区（约 251-287 行）改为互斥 + 文案恢复"发送"：

```tsx
          {/* Bug4：按钮互斥。流式中仅显示红色"暂停"（调 onAbort=fetch.abort）；
              非 sending 仅显示蓝色"发送"。interrupt 等待态也走发送分支，
              由 store.sendMessage 在发送前自动中断未完成工作流。 */}
          <div className="flex items-center gap-2">
            {sending ? (
              <button
                type="button"
                onClick={onAbort}
                title="暂停流式（之后可恢复）"
                aria-label="暂停"
                className="h-9 px-4 rounded-lg text-xs font-semibold
                           border border-[#DC2626] text-[#DC2626]
                           hover:bg-[#FEE2E2] bg-white
                           shadow-[0_2px_8px_-3px_rgba(220,38,38,0.35)]
                           active:scale-[0.97] transition-all
                           inline-flex items-center gap-1.5"
              >
                <Square size={13} className="fill-current" />
                <span>暂停</span>
              </button>
            ) : (
              <button
                type="button"
                onClick={submit}
                disabled={sendDisabled}
                className="h-9 px-5 rounded-lg text-xs font-semibold transition-all active:scale-[0.97]
                           inline-flex items-center gap-1.5
                           bg-gradient-to-b from-[#0EA5E9] to-[#0369A1] text-white
                           ring-1 ring-inset ring-white/15
                           shadow-[0_4px_12px_-4px_rgba(3,105,161,0.5)]
                           hover:shadow-[0_6px_16px_-4px_rgba(3,105,161,0.55)]
                           disabled:opacity-40 disabled:cursor-not-allowed disabled:shadow-none"
              >
                <Send size={13} />
                <span>发送</span>
              </button>
            )}
          </div>
```

注意：`hasPendingInteraction` prop 仍在签名中（store/Workspace 仍传入），但 Composer 内不再用于禁用/文案。它现已无消费点——保留 prop 以免改动上层调用契约会留下未用变量告警。处理：在解构处用下划线忽略或删除该 prop 的使用并从解构移除。**采用移除**：从第 52 行解构移除 `hasPendingInteraction`，并从 `AgentComposerProps`（第 21-23 行）移除该字段，同时删除 Workspace 第 146 行 `hasPendingInteraction={hasPendingInteraction}` 传参。

修改第 18-41 行 `AgentComposerProps`：删除第 21-23 行的 `hasPendingInteraction` 字段及其注释。
修改第 51-54 行解构：移除 `hasPendingInteraction,`。

- [ ] **Step 4: 同步清理 Workspace 的 pending 判定与传参**

Composer 移除 `hasPendingInteraction` prop 后，Workspace 第 70-76 行的 `hasPendingInteraction` useMemo 失去唯一消费者，需一并移除。

修改 `frontend/src/components/employee/agent/agent-workspace.tsx`：

(a) 删除第 70-76 行整段 `hasPendingInteraction` useMemo（含其上方注释块，约 65-76 行）。

(b) 删除第 143-146 行 AgentComposer 调用中的 `hasPendingInteraction={hasPendingInteraction}` 这一行传参。

(c) 检查 `useMemo` 是否仍被本文件其它代码使用：`progress` 用的是 `selectProgressSource`（普通调用，非 useMemo），删除 useMemo 后若 import 行 `import { useCallback, useMemo, useRef, useState }` 的 `useMemo` 不再被使用，则从该 import 移除 `useMemo`，避免未用 import 告警。删除后 import 行应为：

```tsx
import { useCallback, useRef, useState } from 'react';
```

> 判定逻辑最终只活在 `interaction-utils.ts`（纯函数），由 store.sendMessage 消费（Step 8）。Workspace/Composer 不再各自计算——Composer 按钮互斥只看 `sending`，无需 pending 判定。这是 design 文档"判定逻辑抽为纯函数复用"的落地。

- [ ] **Step 5: 运行 Composer 测试确认通过**

Run: `cd frontend && npx vitest run src/components/employee/agent/__tests__/agent-composer-buttons.test.tsx`
Expected: PASS（3 个用例全过）。

- [ ] **Step 6: 写 sendMessage 自动中断失败测试**

创建 `frontend/src/store/__tests__/agent-send-abort.test.ts`：

```ts
/**
 * Bug4 store 单测：sendMessage 在存在 pending interaction 时，
 * 先调 abortSession（标 expired + 推进 task_id）再发新一轮（streamMessage）。
 * 断言调用顺序：abortSession 早于 streamMessage。
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { useAgentStore } from '../agent';
import type { AgentMessage } from '@/types/agent';

const callOrder: string[] = [];
vi.mock('@/api/employee/agent', () => ({
  employeeAgentApi: {
    abortSession: vi.fn(async () => { callOrder.push('abort'); return { data: {} }; }),
    streamMessage: vi.fn(() => {
      callOrder.push('stream');
      return (async function* () { /* 空流，立即结束 */ })();
    }),
    getSession: vi.fn(async () => ({ data: { data: { session: { id: 1 }, messages: [] } } })),
  },
}));

// 一条含 pending interaction 的 agent 消息
const pendingAgentMsg: AgentMessage = {
  id: 9, session_id: 1, parent_message_id: null, role: 'agent',
  workflow_type: 'interview_questions', run_id: null,
  content: { blocks: [{
    type: 'interaction', index: 0, request_id: 'r1',
    interaction_type: 'resume_upload', title: '上传简历', prompt: '', data: {}, status: 'pending',
  }] },
  model_name: null, token_count: null, sort_order: 0, create_time: null,
};

describe('Bug4 sendMessage 发送前自动中断', () => {
  beforeEach(() => {
    callOrder.length = 0;
    useAgentStore.setState({
      activeId: 1,
      runs: {
        1: {
          session: { id: 1, enable_thinking: false, selected_model_name: null } as never,
          messages: [pendingAgentMsg],
          runState: { running: false, workflow_type: 'interview_questions', steps: [], current_blocks: [], error: null, run_id: null, enable_thinking: false },
          sending: false, loaded: true,
        },
      },
    });
  });

  it('pending interaction 时先 abort 再 stream', async () => {
    await useAgentStore.getState().sendMessage(1, { content: '换个问题', workflow_type: 'interview_questions' });
    expect(callOrder).toEqual(['abort', 'stream']);
  });

  it('无 pending interaction 时不调 abort', async () => {
    useAgentStore.setState((s) => ({
      runs: { ...s.runs, 1: { ...s.runs[1], messages: [] } },
    }));
    await useAgentStore.getState().sendMessage(1, { content: '你好', workflow_type: 'interview_questions' });
    expect(callOrder).toEqual(['stream']);
  });
});
```

- [ ] **Step 7: 运行确认失败**

Run: `cd frontend && npx vitest run src/store/__tests__/agent-send-abort.test.ts`
Expected: FAIL — `callOrder` 为 `['stream']`（未先 abort）。

- [ ] **Step 8: 在 sendMessage 加发送前自动中断**

修改 `frontend/src/store/agent.ts`：

(a) 文件顶部 import 区（约 14-21 行）加入纯函数：

```ts
import { useMemo } from 'react';
import { create } from 'zustand';
import { employeeAgentApi } from '@/api/employee/agent';
import { INITIAL_RUN_STATE, agentRunReducer } from '@/utils/agent-run-reducer';
import { isDefaultTitle, makeTitleFromContent } from '@/utils/title';
import { hasPendingInteraction } from '@/components/employee/agent/interaction-utils';
import type {
  AgentEnvelope, AgentMessage, AgentRunState, WorkflowType, WorkspaceSession,
} from '@/types/agent';
```

(b) `sendMessage`（约 339 行）：在已有"先 abort 进行中的 run"之后、虚拟会话处理之前，插入 pending interaction 自动中断。原 343-347 行处理的是流式 run（`runningRunPromises`），interrupt 暂停态没有进行中的 promise，需单独走 `/abort` 端点：

在第 347 行 `}` 之后插入：

```ts
    // Bug4：interrupt 人机交互等待态发送——此时无进行中的流式 run（上方 prevRun 为空），
    // 但工作流停在未完成的 interaction。先调 /abort 标记该 interaction 为 expired 并推进
    // task_id（后端新开 LangGraph thread 隔离，不会误续接旧 checkpoint），再发新一轮。
    // 仅对真实会话（正 id）执行；虚拟会话 / 无 pending 时跳过。
    if (sessionId >= 0 && hasPendingInteraction(get().runs[sessionId]?.messages ?? [])) {
      try {
        await employeeAgentApi.abortSession(sessionId);
      } catch (err) {
        // 中断失败仍继续发送：后端新 thread 隔离，旧 pending 最坏停留为未过期，不阻断主流程
        console.error('发送前自动中断 pending interaction 失败，继续发送', err);
      }
    }
```

- [ ] **Step 9: 运行 store 测试确认通过**

Run: `cd frontend && npx vitest run src/store/__tests__/agent-send-abort.test.ts`
Expected: PASS（2 个用例全过）。

- [ ] **Step 10: 类型检查 + 全量回归**

Run: `cd frontend && npx tsc --noEmit`
Expected: 无新增类型错误（Composer 移除 prop、Workspace 移除 useMemo 后无未用变量/ import）。

Run: `cd frontend && npx vitest run src/store/ src/components/employee/agent/`
Expected: PASS（全部 agent 相关测试通过）。

- [ ] **Step 11: 提交**

```bash
git add frontend/src/components/employee/agent/agent-composer.tsx frontend/src/components/employee/agent/agent-workspace.tsx frontend/src/store/agent.ts frontend/src/components/employee/agent/__tests__/agent-composer-buttons.test.tsx frontend/src/store/__tests__/agent-send-abort.test.ts
git commit -m "fix(agent-fe): Bug4 中断/发送按钮互斥 + interrupt 态可发送（发送前自动 abort）"
```

---

## Self-Review

**1. Spec coverage（对照 design 五节 bug）：**
- Bug1（串史，高风险）→ Task 2：refreshSessions 不写 activeId + bootstrap 幂等 + layout 移除 useRef。✅
- Bug2（刷新进度回退）→ Task 3：resumeRun 进度基线。✅
- Bug3（新会话误显进度栏）→ Task 4：FloatingProgress 条件挂载 `messages.length > 0`。✅
- Bug4（按钮互斥 + interrupt 可发送）→ Task 5：Composer 互斥 + sendDisabled + sendMessage 发送前 abort + interaction-utils 纯函数（Task 1）。✅
- design 七"文件改动清单"逐项映射：store/agent.ts（Task2/3/5）、agent-standalone-layout.tsx（Task2）、agent-workspace.tsx（Task4/5）、agent-composer.tsx（Task5）、interaction-utils.ts（Task1）。✅

**2. Placeholder scan：** 无 TBD/TODO；每个改代码步骤均含完整代码块与确切测试命令、预期。✅

**3. Type consistency：**
- `hasPendingInteraction(messages: AgentMessage[]): boolean` — Task 1 定义，Task 5 store 消费，签名一致。✅
- `bootstrap: () => void` — Task 2 接口声明与实现一致；layout 用 `useAgentStore((s) => s.bootstrap)`。✅
- `isEmptyVirtual`、`getRun`、`mergeLocalRuntime`、`employeeAgentApi.abortSession` 均为现有真实符号（已核对 agent.ts:108/113/180、api/employee/agent.ts:151）。✅
- `session.progress` 类型 `{ workflow_type; steps }`（types/agent.ts:114）与 Task 3 用法一致。✅
- Composer prop 移除 `hasPendingInteraction` 与 Workspace 传参移除在 Task 5 同步，无悬空引用。✅
