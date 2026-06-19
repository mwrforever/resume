# Agent 工作台 4 处 Bug 修复 Round 2 实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 修复 round1 后用户回报的 4 个 bug：步骤进度跳回（bug 1）、驳回反馈被 LLM 忽略（bug 2）、侧栏会话计数误导（bug 3）、侧栏收起动画过短（bug 4）。

**Architecture:**
- bug 1：纯前端 — 改 reducer.upsertStep 重入移到末尾 + workflow-step-templates 按 runtime 顺序输出 + step-strip activeStep 用 runtime 末位
- bug 2：后端 prompt 模板 + service 节点 — dimension_suggest.yaml / question_plan.yaml 加 user_feedback / previous_* 占位符；强转指令；suggest_dimensions / build_question_plan 节点拼 prompt 时传入；前端 JobSelection 移除驳回 textarea+按钮
- bug 3：纯前端 — sidebar-drawer 计数 chip 替换为运行中徽标（复用 useRunningSessionIds）
- bug 4：纯 CSS — 升级 transition duration / delay / curve 实现分段层次感

**Tech Stack:** React 19、TypeScript、Vitest、Tailwind、Zustand、lucide-react；FastAPI、Jinja2 prompt 模板、LangGraph

**Spec：** `docs/superpowers/specs/2026-06-19-agent-bugs-round2-design.md`

**测试命令统一：**
```bash
cd frontend && npm run test -- <pattern>      # 前端单测
cd backend && pytest <path> -v                # 后端单测（如需）
cd frontend && npx tsc --noEmit               # 类型检查
cd frontend && npm run build                  # 全量 build
```

---

## 文件清单

| 类型 | 路径 | 责任 |
|---|---|---|
| 修改 | `frontend/src/utils/agent-run-reducer.ts:79-85` | bug 1：upsertStep 重入移到末尾 |
| 修改 | `frontend/src/components/employee/agent/workflow-step-templates.ts` | bug 1：mergeStepsWithTemplate 改为 runtime 顺序优先 |
| 修改 | `frontend/src/components/employee/agent/__tests__/workflow-step-templates.test.ts` | bug 1：测试预期重写 |
| 修改 | `frontend/src/components/employee/agent/step-strip.tsx` | bug 1：activeStep 改用 runtime 末位 |
| 修改 | `frontend/src/components/employee/agent/blocks/interaction-block.tsx:348-357` | bug 2：DimensionSelection 驳回按钮携带 accepted/rejected 分类 |
| 修改 | `backend/app/llm/graphs/workflows/state.py` | bug 2：state schema 加 accepted_dimensions / rejected_dimensions（如缺）|
| 修改 | `backend/app/llm/graphs/workflows/interview_questions.py:46-49` | bug 2：_request_dimension_selection 节点写入分类反馈到 state |
| 修改 | `backend/app/llm/prompts/templates/interview_questions/dimension_suggest.yaml` | bug 2：升级到 v1.2，5 变量 + 分类指令 |
| 修改 | `backend/app/services/interview_question_service.py:78-101` | bug 2：suggest_dimensions 节点接收分类反馈 + 防御性兜底 |
| 修改 | `backend/app/llm/prompts/templates/interview_questions/question_plan.yaml` | bug 2：加 previous_plan + 强化 review_feedback 措辞 |
| 修改 | `backend/app/services/interview_question_service.py:113-140` | bug 2：build_question_plan 节点新增 previous_plan 传参 |
| 修改 | `frontend/src/components/employee/agent/blocks/interaction-block.tsx:516-583` | bug 2：JobSelection 移除驳回 textarea+按钮 |
| 修改 | `frontend/src/components/employee/agent/layout/agent-sidebar-drawer.tsx:194-201` | bug 3：会话计数 chip → 运行中徽标 |
| 修改 | `frontend/src/components/employee/agent/layout/agent-sidebar-drawer.tsx:170-180, 179, 305` | bug 4：transition duration/delay/curve 升级 |

---

## Bug 1：步骤进度跳回（顺手重构语义）

### Task 1：reducer.upsertStep 重入移到末尾

**Files:**
- Modify: `frontend/src/utils/agent-run-reducer.ts:78-85`
- Test: `frontend/src/utils/__tests__/agent-run-reducer.test.ts`（新建）

- [ ] **Step 1：写失败测试 — 验证重入时 step 移到末尾**

创建 `frontend/src/utils/__tests__/agent-run-reducer.test.ts`：

```ts
/**
 * agent-run-reducer 单测：
 * 重点验证 upsertStep 在驳回循环（同 step_id 重入）时把该项移到 steps 数组末尾，
 * 让 steps[steps.length - 1] 始终是"最后到达 = 当前活跃"的语义信号。
 */

import { describe, it, expect } from 'vitest';
import { agentRunReducer, INITIAL_RUN_STATE } from '../agent-run-reducer';
import type { AgentEnvelope, AgentRunState } from '@/types/agent';

function makeStepEnv(stepId: string, title: string, status = 'success' as const): AgentEnvelope {
  return {
    v: 1, seq: 0, ts: 0, run_id: 'r1', session_id: 1,
    type: 'step.update',
    data: { step_id: stepId, title, status },
  };
}

describe('agent-run-reducer · upsertStep 重入语义', () => {
  it('首次到达 step 追加到末尾', () => {
    let s: AgentRunState = INITIAL_RUN_STATE;
    s = agentRunReducer(s, makeStepEnv('load_resume', '读取简历'));
    s = agentRunReducer(s, makeStepEnv('suggest_dimensions', '分析维度'));
    expect(s.steps.map(x => x.step_id)).toEqual(['load_resume', 'suggest_dimensions']);
  });

  it('重入相同 step_id：移到末尾，长度不变，状态用最新', () => {
    let s: AgentRunState = INITIAL_RUN_STATE;
    s = agentRunReducer(s, makeStepEnv('load_resume', '读取简历'));
    s = agentRunReducer(s, makeStepEnv('suggest_dimensions', '分析维度'));
    s = agentRunReducer(s, makeStepEnv('request_dimension_selection', '选择维度'));
    // 用户驳回 → graph 回 suggest_dimensions 重做并产出 step.update
    s = agentRunReducer(s, makeStepEnv('suggest_dimensions', '分析维度'));
    // 顺序：load_resume, request_dimension_selection, suggest_dimensions（重入移到末尾）
    expect(s.steps.map(x => x.step_id)).toEqual([
      'load_resume', 'request_dimension_selection', 'suggest_dimensions',
    ]);
    expect(s.steps).toHaveLength(3);  // 不重复
  });

  it('重入更新 detail 字段', () => {
    let s: AgentRunState = INITIAL_RUN_STATE;
    s = agentRunReducer(s, {
      v: 1, seq: 0, ts: 0, run_id: 'r1', session_id: 1,
      type: 'step.update',
      data: { step_id: 'suggest_dimensions', title: '分析维度', status: 'success', detail: '第一次' },
    });
    s = agentRunReducer(s, {
      v: 1, seq: 0, ts: 0, run_id: 'r1', session_id: 1,
      type: 'step.update',
      data: { step_id: 'suggest_dimensions', title: '分析维度', status: 'success', detail: '重做' },
    });
    expect(s.steps).toHaveLength(1);
    expect(s.steps[0].detail).toBe('重做');
  });
});
```

- [ ] **Step 2：运行测试，确认失败**

```bash
cd D:/code/py/project/resume/.claude/worktrees/fix-agent-bugs-round2/frontend && npm run test -- agent-run-reducer
```

预期：第二个测试失败（期待 `suggest_dimensions` 在末尾，但当前实现是原地替换，`suggest_dimensions` 仍在 index 1）

- [ ] **Step 3：修改 upsertStep 实现**

打开 `frontend/src/utils/agent-run-reducer.ts`，找到第 78-85 行：

```ts
/** 更新或追加步骤 */
function upsertStep(steps: AgentStep[], data: AgentStep): AgentStep[] {
  const idx = steps.findIndex(s => s.step_id === data.step_id);
  if (idx === -1) return [...steps, data];
  const next = [...steps];
  next[idx] = { ...steps[idx], ...data };
  return next;
}
```

替换为：

```ts
/** 更新或追加步骤。
 *
 * 重入相同 step_id（驳回循环时同一节点再次产出 update）→ **移到末尾**，
 * 让 steps[steps.length - 1] 始终代表"最后到达 = 当前活跃"的语义。
 * 状态/detail 用最新一次到达的为准。
 *
 * 重要：此行为是 step.update 协议的语义基石，consumer（StepStrip / mergeStepsWithTemplate）
 * 依赖该顺序判断当前活跃步骤，不可改回原地替换。
 */
function upsertStep(steps: AgentStep[], data: AgentStep): AgentStep[] {
  const filtered = steps.filter(s => s.step_id !== data.step_id);
  return [...filtered, data];
}
```

- [ ] **Step 4：测试通过**

```bash
cd D:/code/py/project/resume/.claude/worktrees/fix-agent-bugs-round2/frontend && npm run test -- agent-run-reducer
```

预期：3 个测试全过。

- [ ] **Step 5：Commit**

```bash
cd D:/code/py/project/resume/.claude/worktrees/fix-agent-bugs-round2 && git add frontend/src/utils/agent-run-reducer.ts frontend/src/utils/__tests__/agent-run-reducer.test.ts && git commit -m "fix(agent-fe): upsertStep 重入移到末尾，恢复 runtime 顺序语义（bug 1）"
```

---

### Task 2：mergeStepsWithTemplate 改为 runtime 顺序优先

**Files:**
- Modify: `frontend/src/components/employee/agent/workflow-step-templates.ts`
- Modify: `frontend/src/components/employee/agent/__tests__/workflow-step-templates.test.ts`

- [ ] **Step 1：先改测试预期（TDD 红）**

打开 `frontend/src/components/employee/agent/__tests__/workflow-step-templates.test.ts`，替换"重入相同 step_id"测试用例（找到 `重入相同 step_id → 取最后一次出现的状态`）：

```ts
  it('重入相同 step_id → 该项移到 merged 末尾，长度不变，状态用最新', () => {
    // 模拟驳回循环：suggest_dimensions 出现两次
    const runtime: AgentStep[] = [
      { step_id: 'load_resume',                 title: '读取简历', status: 'success' },
      { step_id: 'request_dimension_selection', title: '选择维度', status: 'success' },
      // 用户驳回 → 跳回 suggest_dimensions 重做（runtime 顺序，由 reducer.upsertStep 移到末尾保证）
      { step_id: 'suggest_dimensions',          title: '分析维度', status: 'success', detail: '重新分析' },
    ];
    const merged = mergeStepsWithTemplate('interview_questions', runtime);
    // 长度仍 = 模板 8 项；前 3 项按 runtime 顺序，后 5 项是模板未到达项
    expect(merged).toHaveLength(8);
    // runtime 顺序：load_resume → request_dimension_selection → suggest_dimensions（重入末位）
    expect(merged[0].step_id).toBe('load_resume');
    expect(merged[1].step_id).toBe('request_dimension_selection');
    expect(merged[2].step_id).toBe('suggest_dimensions');
    expect(merged[2].detail).toBe('重新分析');  // 最新状态生效
    // 后续 5 项是模板未到达项（pending），按模板拓扑顺序
    expect(merged[3].status).toBe('pending');
    expect(merged[3].step_id).toBe('build_question_plan');
  });
```

同时在该测试文件最后追加一条新测试：

```ts
  it('runtime 包含模板节点 + activeStep 跟 runtime 末位走', () => {
    // 模拟 graph 跑到 suggest_dimensions（驳回循环重做）
    const runtime: AgentStep[] = [
      { step_id: 'load_resume',                 title: '读取简历', status: 'success' },
      { step_id: 'suggest_dimensions',          title: '分析维度', status: 'success' },
      { step_id: 'request_dimension_selection', title: '选择维度', status: 'success' },
      { step_id: 'suggest_dimensions',          title: '分析维度', status: 'success', detail: '重做' },
    ];
    const merged = mergeStepsWithTemplate('interview_questions', runtime);
    // runtime 重入由 reducer 移到末尾——但 merge 接收的 runtime 已是去重后的（reducer 处理）
    // 这里测试 merge 接收已去重的 runtime 是什么形态
    // 此用例下 reducer 输出的 runtime 是：[load_resume, request_dimension_selection, suggest_dimensions]
    const fromReducer: AgentStep[] = [
      { step_id: 'load_resume',                 title: '读取简历', status: 'success' },
      { step_id: 'request_dimension_selection', title: '选择维度', status: 'success' },
      { step_id: 'suggest_dimensions',          title: '分析维度', status: 'success', detail: '重做' },
    ];
    const m2 = mergeStepsWithTemplate('interview_questions', fromReducer);
    expect(m2[2].step_id).toBe('suggest_dimensions');
    expect(m2[2].detail).toBe('重做');
  });
```

注意：原"未知 workflow → fallback"和"模板未覆盖的 runtime step → 追加到末尾"两个测试不需要改，保持。

- [ ] **Step 2：运行测试，确认失败**

```bash
cd D:/code/py/project/resume/.claude/worktrees/fix-agent-bugs-round2/frontend && npm run test -- workflow-step-templates
```

预期：新增/修改的测试用例失败（当前 mergeStepsWithTemplate 按模板顺序输出，suggest_dimensions 在 merged[1] 而非 merged[2]）。

- [ ] **Step 3：重写 mergeStepsWithTemplate 实现**

打开 `frontend/src/components/employee/agent/workflow-step-templates.ts`，找到 `mergeStepsWithTemplate` 函数，整体替换为：

```ts
/**
 * 把模板与运行时 step.update 序列合并为完整步骤数组。
 *
 * 新语义（与 agent-run-reducer.upsertStep 配合）：
 * - 输入的 runtimeSteps 已由 reducer 保证「同 step_id 不重复 + 重入移到末尾」
 * - 第一遍：按 runtime 顺序输出已到达的 step（保留模板 title 标准化）
 * - 第二遍：把模板里**未在 runtime 出现**的 step 按模板拓扑顺序追加到末尾，状态 pending
 * - 结果数组前 N 项 = runtime 已到达节点（按到达顺序），后 M 项 = 模板未到达节点（按模板顺序）
 *
 * 这让 StepStrip 的"当前活跃步骤" = mergedSteps 中最后一个非 pending 项 = runtime 末位节点。
 *
 * @param workflow workflow_type；未在 WORKFLOW_STEP_TEMPLATES 中的值走 fallback（直接返回 runtimeSteps）
 * @param runtimeSteps runState.steps，由 reducer 保证去重后按 runtime 顺序
 * @returns 合并后的步骤数组（长度 = 模板长度，runtime 含未知 step_id 时会变长）
 */
export function mergeStepsWithTemplate(
  workflow: WorkflowType,
  runtimeSteps: AgentStep[],
): AgentStep[] {
  const template = WORKFLOW_STEP_TEMPLATES[workflow];
  if (!template) return runtimeSteps;  // fallback：未知 workflow

  // 模板的 title 索引：用于命中时保留模板权威 title
  const tmplTitleByStepId = new Map(template.map(t => [t.step_id, t.title]));
  const runtimeStepIds = new Set(runtimeSteps.map(s => s.step_id));

  const merged: AgentStep[] = [];

  // 第一遍：按 runtime 顺序输出，命中模板时取模板 title
  for (const s of runtimeSteps) {
    const tmplTitle = tmplTitleByStepId.get(s.step_id);
    merged.push({
      step_id: s.step_id,
      title: tmplTitle ?? s.title,
      status: s.status,
      ...(s.detail !== undefined ? { detail: s.detail } : {}),
    });
  }

  // 第二遍：模板里未出现在 runtime 的，按模板顺序追加 pending 占位
  for (const t of template) {
    if (!runtimeStepIds.has(t.step_id)) {
      merged.push({ step_id: t.step_id, title: t.title, status: 'pending' });
    }
  }

  return merged;
}
```

- [ ] **Step 4：测试通过**

```bash
cd D:/code/py/project/resume/.claude/worktrees/fix-agent-bugs-round2/frontend && npm run test -- workflow-step-templates
```

预期：所有测试全过（含新增和修改的）。

- [ ] **Step 5：Commit**

```bash
cd D:/code/py/project/resume/.claude/worktrees/fix-agent-bugs-round2 && git add frontend/src/components/employee/agent/workflow-step-templates.ts frontend/src/components/employee/agent/__tests__/workflow-step-templates.test.ts && git commit -m "fix(agent-fe): mergeStepsWithTemplate 改为 runtime 顺序优先（bug 1）"
```

---

### Task 3：StepStrip activeStep 改用 runtime 末位

**Files:**
- Modify: `frontend/src/components/employee/agent/step-strip.tsx`

- [ ] **Step 1：替换 activeStep 计算逻辑**

打开 `frontend/src/components/employee/agent/step-strip.tsx`，找到 `activeStep` 定义：

```tsx
  // 当前活跃步骤：第一个非 success 项；全部 success 时取最后一项（运行结束态）
  const activeStep =
    mergedSteps.find(s => s.status !== 'success') ?? mergedSteps[mergedSteps.length - 1];
```

替换为：

```tsx
  // 当前活跃步骤：取 runtime 中最后到达的 step（reducer.upsertStep 保证它在 runtime 末位）。
  // 后端 step.update 在节点完成后触发，所以"最后到达 = 刚完成、即将转交下一节点 / 等用户输入"。
  // mergedSteps 前 N 项 = runtime（按 reducer 输出顺序）+ 后 M 项 = 模板 pending 占位；
  // 因此 mergedSteps 中最后一个非 pending 的就是 runtime 末位。
  // 兜底：runtime 为空（流式刚开始）→ 用模板第一项作为活跃占位。
  const lastNonPending = [...mergedSteps].reverse().find(s => s.status !== 'pending');
  const activeStep = lastNonPending ?? mergedSteps[0];
```

同时找到 `isActive` 判定（约第 84 行）：

```tsx
            const isActive = running && s.step_id === activeStep?.step_id && s.status !== 'success';
```

替换为：

```tsx
            // 高亮当前活跃步骤；运行中状态下即使活跃步骤本身已 success（节点刚完成）
            // 也保留波浪动画，因为 graph 正在转交下一节点。
            const isActive = running && s.step_id === activeStep?.step_id;
```

- [ ] **Step 2：tsc 检查**

```bash
cd D:/code/py/project/resume/.claude/worktrees/fix-agent-bugs-round2/frontend && npx tsc --noEmit
```

预期 0 错。

- [ ] **Step 3：跑相关测试**

```bash
cd D:/code/py/project/resume/.claude/worktrees/fix-agent-bugs-round2/frontend && npm run test -- step-strip workflow-step-templates agent-run-reducer
```

预期所有测试通过（step-strip 没单测，但 templates 与 reducer 不应受影响）。

- [ ] **Step 4：Commit（bug 1 完成）**

```bash
cd D:/code/py/project/resume/.claude/worktrees/fix-agent-bugs-round2 && git add frontend/src/components/employee/agent/step-strip.tsx && git commit -m "fix(agent-fe): StepStrip activeStep 改用 runtime 末位（bug 1）"
```

---

## Bug 2：驳回反馈语义传到 LLM

### Task 4：DimensionSelection 驳回按钮升级（前端）

**Files:**
- Modify: `frontend/src/components/employee/agent/blocks/interaction-block.tsx:348-357`

- [ ] **Step 1：定位现有驳回按钮**

打开 `frontend/src/components/employee/agent/blocks/interaction-block.tsx`，找到 line 348-357 附近的 `DimensionSelection` 组件中"驳回重新建议"按钮：

```tsx
        <button
          type="button"
          className="px-3 py-1.5 rounded-md border border-[#E2E8F0] text-[#64748B] text-sm
                     hover:bg-[#F8FAFC] transition-colors
                     disabled:opacity-50 disabled:cursor-not-allowed"
          disabled={submitting}
          onClick={() => onSubmit({ regenerate: true, feedback: feedback.trim() })}
        >
          驳回重新建议
        </button>
```

- [ ] **Step 2：替换为新版（携带 accepted/rejected 分类）**

整体替换上面那段为：

```tsx
        <button
          type="button"
          className="px-3 py-1.5 rounded-md border border-[#E2E8F0] text-[#64748B] text-sm
                     hover:bg-[#F8FAFC] transition-colors
                     disabled:opacity-50 disabled:cursor-not-allowed"
          disabled={submitting}
          onClick={() => {
            // 已勾选维度 = 用户采纳的，必须保留
            const accepted = candidates
              .filter(c => selected.has(String(c.name ?? '')))
              .map(c => ({
                name: String(c.name ?? ''),
                reason: c.reason ? String(c.reason) : '',
              }));
            // 未勾选维度 = 用户否决的，必须替换
            const rejected = candidates
              .filter(c => !selected.has(String(c.name ?? '')))
              .map(c => ({
                name: String(c.name ?? ''),
                reason: c.reason ? String(c.reason) : '',
              }));
            onSubmit({
              regenerate: true,
              feedback: feedback.trim(),
              accepted_dimensions: accepted,
              rejected_dimensions: rejected,
            });
          }}
        >
          {selected.size === 0 ? '全部驳回，重新建议' : `保留已选 ${selected.size} 个，调整其余`}
        </button>
```

- [ ] **Step 3：tsc 检查**

```bash
cd D:/code/py/project/resume/.claude/worktrees/fix-agent-bugs-round2/frontend && npx tsc --noEmit
```

预期 0 错。

- [ ] **Step 4：Commit**

```bash
cd D:/code/py/project/resume/.claude/worktrees/fix-agent-bugs-round2 && git add frontend/src/components/employee/agent/blocks/interaction-block.tsx && git commit -m "feat(agent-fe): DimensionSelection 驳回按钮携带 accepted/rejected 分类（bug 2）"
```

---

### Task 5：state.py 加 accepted/rejected 字段（如缺失）+ _request_dimension_selection 节点写入

**Files:**
- Read: `backend/app/llm/graphs/workflows/state.py`（先读现状）
- Modify: `backend/app/llm/graphs/workflows/state.py`（如缺字段）
- Modify: `backend/app/llm/graphs/workflows/interview_questions.py:46-49`

- [ ] **Step 1：读取 state schema 确认字段是否已存在**

```bash
cd D:/code/py/project/resume/.claude/worktrees/fix-agent-bugs-round2 && grep -n "accepted_dimensions\|rejected_dimensions\|dimension_feedback\|suggested_dimensions" backend/app/llm/graphs/workflows/state.py
```

预期：现有 `dimension_feedback` 与 `suggested_dimensions` 都已存在；`accepted_dimensions` 与 `rejected_dimensions` **可能不存在**。

- [ ] **Step 2：如果缺失字段，在 InterviewQuestionState TypedDict 里新增**

打开 `backend/app/llm/graphs/workflows/state.py`，找到 `InterviewQuestionState` TypedDict 定义。在 `dimension_feedback: str` 字段附近追加：

```python
    # 驳回循环过程态（用户分类反馈）：
    # accepted_dimensions = 用户已勾选的维度，suggest_dimensions 节点必须 1:1 保留
    # rejected_dimensions = 用户未勾选的维度，suggest_dimensions 节点必须替换为新建议
    # 进入下一轮成功提交后，由 suggest_dimensions 节点重置为空列表
    accepted_dimensions: list[dict[str, Any]]
    rejected_dimensions: list[dict[str, Any]]
```

注意：state.py 用 TypedDict + total=False 还是 NotRequired，需依据现有定义模式。如果文件用 `total=False` 总开关，新字段无需 NotRequired。如果用 NotRequired 包裹，则新字段也用 NotRequired。**实施时遵循文件现有模式**。

如果 state.py 已有这两个字段（grep 命中），跳过 Step 2。

- [ ] **Step 3：修改 _request_dimension_selection 节点**

打开 `backend/app/llm/graphs/workflows/interview_questions.py`，找到第 47-49 行：

```python
    if user_values.get("regenerate"):
        # 驳回：记录标志 + feedback，由条件边 _route_after_dimension_selection 决定回 suggest_dimensions
        return {"dimension_rejected": True, "dimension_feedback": feedback}
```

替换为：

```python
    if user_values.get("regenerate"):
        # 驳回：记录标志 + feedback + 用户分类反馈（已采纳保留、已否决替换），
        # 由条件边 _route_after_dimension_selection 决定回 suggest_dimensions
        return {
            "dimension_rejected": True,
            "dimension_feedback": feedback,
            "accepted_dimensions": user_values.get("accepted_dimensions", []),
            "rejected_dimensions": user_values.get("rejected_dimensions", []),
        }
```

- [ ] **Step 4：Python 语法检查**

```bash
cd D:/code/py/project/resume/.claude/worktrees/fix-agent-bugs-round2 && python -m py_compile backend/app/llm/graphs/workflows/interview_questions.py backend/app/llm/graphs/workflows/state.py
```

预期：无输出 = 通过。

- [ ] **Step 5：Commit**

```bash
cd D:/code/py/project/resume/.claude/worktrees/fix-agent-bugs-round2 && git add backend/app/llm/graphs/workflows/state.py backend/app/llm/graphs/workflows/interview_questions.py && git commit -m "feat(agent-be): state schema 加 accepted/rejected_dimensions + 节点写入分类反馈（bug 2）"
```

---

### Task 6：dimension_suggest.yaml 模板升级（5 变量 + 分类指令）

**Files:**
- Modify: `backend/app/llm/prompts/templates/interview_questions/dimension_suggest.yaml`

- [ ] **Step 1：用 Write 整文件覆盖**

完整新版内容如下（5 变量 + 分类保留/替换指令）：

```yaml
name: dimension_suggest
version: "1.2"
description: "基于候选人简历建议面试评估维度（支持驳回循环：已采纳保留 + 已否决替换 + 反馈调整）"
variables:
  - name: resume_text
    required: true
    description: "候选人简历全文（Markdown 格式）"
  - name: user_intent
    required: false
    description: "用户指定的分析方向或关注点"
  - name: user_feedback
    required: false
    description: "上一轮驳回时用户对未采纳部分的反馈文本"
  - name: accepted_dimensions
    required: false
    description: "上一轮用户已勾选（采纳）的维度（JSON 数组），必须 1:1 完整保留"
  - name: rejected_dimensions
    required: false
    description: "上一轮用户未勾选（否决）的维度（JSON 数组），必须替换为新建议，不可重复"
template: |-
  # 角色
  你是资深企业招聘面试设计专家，负责根据候选人简历推荐面试评估维度。

  # 约束
  {% include "agent/constraints.yaml" %}

  # 输入
  - 候选人简历：
    ```{{ resume_text }}```
  {% if user_intent %}
  - 用户指定的分析方向：{{ user_intent }}
  {% endif %}
  {% if accepted_dimensions %}
  - 上一轮用户**已采纳**的维度（**必须 1:1 完整保留**到新一轮，name 与 reason 不得改动）：
    {{ accepted_dimensions }}
  {% endif %}
  {% if rejected_dimensions %}
  - 上一轮用户**已否决**的维度（**必须替换为新建议**，新维度的 name 不得与下列任一相同或近义）：
    {{ rejected_dimensions }}
  {% endif %}
  {% if user_feedback %}
  - 用户对未采纳部分的反馈（**最高优先级，必须严格按反馈调整未采纳维度**）：
    {{ user_feedback }}
  {% endif %}

  # 指令
  请输出 4-6 个面试维度{% if accepted_dimensions or rejected_dimensions %}，按以下规则：

  1. **保留约束**：{% if accepted_dimensions %}上述「已采纳的维度」必须 1:1 出现在输出 dimensions 数组里（顺序可自定，但 name 与 reason 严格不变）{% else %}本轮无已采纳维度{% endif %}
  2. **替换约束**：{% if rejected_dimensions %}上述「已否决的维度」**严禁出现**在输出里（包括同义改写）{% else %}本轮无已否决维度{% endif %}
  3. **反馈优先**：{% if user_feedback %}基于上述用户反馈生成新维度填充剩余位置（若反馈要求新增某维度必须包含；若反馈否决某方向必须避开）{% else %}基于简历给出最稳妥的新维度填充剩余位置{% endif %}
  4. **总数控制**：accepted + 新维度 = 4-6 个；不足则补充与简历相关的新维度，超出则仅保留最相关的{% else %}（首轮：维度数量在 4-6 个之间）{% endif %}

  ## 通用要求
  - 每个维度必须给出推荐理由
  - 维度名称具体明确（如"项目深度"而非"综合能力"），不得超过 8 个字
  - 维度之间应覆盖不同评估角度，避免重叠
  - 所有维度名称必须填写，不得为空

  # 输出格式
  只输出 JSON，不要输出 Markdown、解释或代码块：
  {
    "dimensions": [
      {
        "name": "项目深度",
        "reason": "候选人有 3 个核心项目经历，需核实真实贡献与技术决策能力"
      }
    ]
  }
```

- [ ] **Step 2：Commit**

```bash
cd D:/code/py/project/resume/.claude/worktrees/fix-agent-bugs-round2 && git add backend/app/llm/prompts/templates/interview_questions/dimension_suggest.yaml && git commit -m "feat(agent-be): dimension_suggest 模板升级到 v1.2（accepted/rejected 分类指令，bug 2）"
```

---

### Task 7：suggest_dimensions 节点拼 prompt + 防御性兜底

**Files:**
- Modify: `backend/app/services/interview_question_service.py:78-101`

- [ ] **Step 1：替换 suggest_dimensions 实现**

打开 `backend/app/services/interview_question_service.py`，找到第 78-101 行的 `suggest_dimensions`。整体替换为：

```python
    async def suggest_dimensions(self, state, ctx: WorkflowRuntimeContext) -> dict:
        """AI 提议维度；支持驳回循环（已采纳保留 + 已否决替换 + 反馈优先）。

        驳回循环过程态字段（来自 _request_dimension_selection 写入）：
        - state.dimension_feedback: 用户对未采纳部分的文本反馈
        - state.accepted_dimensions: 用户已勾选的维度（必须 1:1 保留）
        - state.rejected_dimensions: 用户未勾选的维度（必须替换为新建议）

        返回时重置上述三个过程态字段为空，避免下一轮误用。
        """
        # 取驳回过程态
        user_feedback = (state.get("dimension_feedback") or "").strip() or None
        accepted = state.get("accepted_dimensions") or []
        rejected = state.get("rejected_dimensions") or []
        accepted_json = (
            json.dumps(
                [{"name": d.get("name"), "reason": d.get("reason")} for d in accepted],
                ensure_ascii=False,
            )
            if accepted else None
        )
        rejected_json = (
            json.dumps(
                [{"name": d.get("name"), "reason": d.get("reason")} for d in rejected],
                ensure_ascii=False,
            )
            if rejected else None
        )

        prompt = _pm.render(
            "interview_questions/dimension_suggest",
            resume_text=state.get("resume_text") or "",
            user_intent=self._extract_user_intent(state),
            user_feedback=user_feedback,
            accepted_dimensions=accepted_json,
            rejected_dimensions=rejected_json,
        )
        text = await self._stream_with_thinking(
            prompt, ctx, stage_label="分析维度",
        )
        dims = self._parse_dimensions(text)
        if not dims:
            logger.warning(
                "AI 维度提议失败/为空，使用内置维度兜底；原始返回前 200 字：%s",
                text[:200].replace("\n", " "),
            )
            dims = BUILTIN_DIMENSIONS

        # 防御性兜底：LLM 偶尔不遵守"保留 accepted"约束 → 后端强制注入
        # 检查 accepted 中每一项是否在 dims 里出现，未出现则插入到队首
        if accepted:
            dim_names = {d.get("name") for d in dims}
            for acc in accepted:
                acc_name = acc.get("name")
                if acc_name and acc_name not in dim_names:
                    dims.insert(0, {
                        "name": acc_name,
                        "reason": acc.get("reason", ""),
                        "source": "ai",
                    })
                    logger.info("LLM 漏保留已采纳维度，强制注入：%s", acc_name)

        # 重置驳回过程态：用过即清，避免下一轮误用
        return {
            "suggested_dimensions": dims,
            "dimension_feedback": "",
            "accepted_dimensions": [],
            "rejected_dimensions": [],
        }
```

- [ ] **Step 2：Python 语法检查**

```bash
cd D:/code/py/project/resume/.claude/worktrees/fix-agent-bugs-round2 && python -m py_compile backend/app/services/interview_question_service.py
```

预期：无输出 = 通过。

- [ ] **Step 3：Commit**

```bash
cd D:/code/py/project/resume/.claude/worktrees/fix-agent-bugs-round2 && git add backend/app/services/interview_question_service.py && git commit -m "fix(agent-be): suggest_dimensions 节点接受分类反馈 + 防御性兜底已采纳维度（bug 2）"
```

---
### Task 8：question_plan.yaml 加 previous_plan + 强化措辞

**Files:**
- Modify: `backend/app/llm/prompts/templates/interview_questions/question_plan.yaml`

- [ ] **Step 1：用 Write 整文件覆盖**

完整内容如下：

```yaml
name: question_plan
version: "1.1"
description: "基于简历和已选维度规划面试题生成计划（支持驳回反馈循环）"
variables:
  - name: resume_text
    required: true
    description: "候选人简历全文（Markdown 格式）"
  - name: selected_dimensions
    required: true
    description: "用户已选择的面试维度列表（JSON 数组字符串）"
  - name: user_intent
    required: false
    description: "用户指定的分析方向或关注点"
  - name: review_feedback
    required: false
    description: "上一轮人工批阅的反馈，非空时表示需要按反馈重新规划（必须严格采纳）"
  - name: previous_plan
    required: false
    description: "上一轮被驳回的计划（JSON 字符串，作为对比基线，避免原样复用）"
template: |-
  # 角色
  你是资深企业招聘面试题规划专家，负责根据候选人简历和已选维度制定结构化的面试题生成计划。

  # 约束
  {% include "agent/constraints.yaml" %}

  # 输入
  - 候选人简历：
    {{ resume_text }}
  - 已选面试维度：
    {{ selected_dimensions }}
  {% if user_intent %}
  - 用户指定的分析方向：{{ user_intent }}
  {% endif %}
  {% if previous_plan %}
  - 上一轮被驳回的计划（仅作对比基线，不要原样复用）：
    {{ previous_plan }}
  {% endif %}
  {% if review_feedback %}
  - 上一轮人工批阅反馈（**必须严格按反馈调整，不可忽略；驳回反馈优先级高于其它规划逻辑**）：
    {{ review_feedback }}
  {% endif %}

  # 指令
  请规划 8-12 道面试题，覆盖所有已选维度。
  每个维度给出题目数量、难度和追问重点。
  维度的重要性应根据简历内容和{% if user_intent %}用户指定的分析方向{% else %}岗位匹配需求{% endif %}动态调整。
  题目数量按维度重要性分配，重要维度可分配 3-4 题，次要维度 1-2 题。
  每个维度的 focus 必须具体、可操作，说明该维度追问的核心考察点。
  {% if review_feedback %}
  **驳回反馈处理**：仔细解析反馈意图（要求增加题量？调整难度？换 focus 方向？），逐项落实到对应维度的 question_count / difficulty / focus 字段；若反馈与简历客观情况冲突，优先反馈。
  {% endif %}

  # 输出格式
  只输出 JSON，不要输出 Markdown、解释或代码块：
  {
    "total_questions": 10,
    "summary": "本轮面试重点验证……（30 字以内概括整体考察方向）",
    "items": [
      {
        "dimension": "项目深度",
        "question_count": 3,
        "difficulty": "中等",
        "focus": "核实真实贡献和技术取舍"
      }
    ]
  }

  ## 字段约束
  - total_questions：必须等于所有 items 的 question_count 之和
  - question_count：每个维度至少 1 题，最多 4 题
  - difficulty：只能是"较低"、"中等"、"较高"之一
  - focus：20 字以内，描述该维度追问的核心考察点
  - dimension：必须与已选维度名称完全一致
```

- [ ] **Step 2：Commit**

```bash
cd D:/code/py/project/resume/.claude/worktrees/fix-agent-bugs-round2 && git add backend/app/llm/prompts/templates/interview_questions/question_plan.yaml && git commit -m "feat(agent-be): question_plan 模板加 previous_plan + 强化 review_feedback 措辞（bug 2）"
```

---

### Task 9：build_question_plan 节点新增 previous_plan 传参

**Files:**
- Modify: `backend/app/services/interview_question_service.py:113-140`

- [ ] **Step 1：替换 build_question_plan 实现**

打开 `backend/app/services/interview_question_service.py`，找到第 113-140 行的 `build_question_plan`：

```python
    async def build_question_plan(self, state, ctx: WorkflowRuntimeContext) -> dict:
        """AI 生成出题计划。

        review_feedback 来自上一轮 plan_approval 驳回时透传的反馈；
        user_intent 透传维度卡片提交时的"补充意见"或首条用户消息。
        """
        question_plan = state.get("question_plan") or {}
        review_feedback = str(question_plan.get("_feedback") or "").strip() or None
        prompt = _pm.render(
            "interview_questions/question_plan",
            resume_text=state.get("resume_text") or "",
            selected_dimensions=json.dumps(
                state.get("selected_dimensions") or [], ensure_ascii=False,
            ),
            user_intent=(
                state.get("dimension_feedback")
                or self._extract_user_intent(state)
                or None
            ),
            review_feedback=review_feedback,
        )
```

把 `_pm.render(...)` 调用整体替换（保留外层注释和 question_plan/review_feedback 提取逻辑），新增 `previous_plan` 参数：

```python
    async def build_question_plan(self, state, ctx: WorkflowRuntimeContext) -> dict:
        """AI 生成出题计划。

        review_feedback 来自上一轮 plan_approval 驳回时透传的反馈；
        previous_plan 是上一轮被驳回的计划本体（去掉 _feedback 字段后的 JSON），
        作为对比基线让 LLM 知道"哪个被驳回了"，避免原样复用；
        user_intent 透传维度卡片提交时的"补充意见"或首条用户消息。
        """
        question_plan = state.get("question_plan") or {}
        review_feedback = str(question_plan.get("_feedback") or "").strip() or None
        # 上一轮计划作对比基线（去掉 _feedback，仅取业务字段）
        previous_plan_json = None
        if review_feedback and question_plan:
            clean_plan = {k: v for k, v in question_plan.items() if k != "_feedback"}
            if clean_plan:
                previous_plan_json = json.dumps(clean_plan, ensure_ascii=False)

        prompt = _pm.render(
            "interview_questions/question_plan",
            resume_text=state.get("resume_text") or "",
            selected_dimensions=json.dumps(
                state.get("selected_dimensions") or [], ensure_ascii=False,
            ),
            user_intent=(
                state.get("dimension_feedback")
                or self._extract_user_intent(state)
                or None
            ),
            review_feedback=review_feedback,
            previous_plan=previous_plan_json,
        )
```

后续行（`text = await self._stream_with_thinking(...)`、`plan = self._parse_plan(...)` 等）保持不变。

- [ ] **Step 2：Python 语法检查**

```bash
cd D:/code/py/project/resume/.claude/worktrees/fix-agent-bugs-round2 && python -c "import ast; ast.parse(open('backend/app/services/interview_question_service.py', encoding='utf-8').read()); print('OK')"
```

预期：`OK`

- [ ] **Step 3：Commit**

```bash
cd D:/code/py/project/resume/.claude/worktrees/fix-agent-bugs-round2 && git add backend/app/services/interview_question_service.py && git commit -m "fix(agent-be): build_question_plan 节点注入 previous_plan（bug 2）"
```

---

### Task 10：JobSelection 移除驳回 textarea + 按钮

**Files:**
- Modify: `frontend/src/components/employee/agent/blocks/interaction-block.tsx:516-583`

- [ ] **Step 1：替换 JobSelection 组件**

打开 `frontend/src/components/employee/agent/blocks/interaction-block.tsx`，找到 `function JobSelection` 整段（约第 516-583 行）：

```tsx
/** 岗位选择卡：提交 { selected_job_name: string } */
function JobSelection({ title, prompt, data, submitting, onSubmit }: SectionProps) {
  const candidates = (data?.candidates ?? []) as Array<{ name?: unknown; description?: unknown }>;
  const [selected, setSelected] = useState<string | null>(null);
  const [feedback, setFeedback] = useState('');

  return (
    <div className="rounded-md border border-[#0EA5E9]/40 bg-white shadow-sm px-4 py-3">
      <p className="text-sm font-semibold text-[#020617]">{title}</p>
      {prompt && <p className="text-xs text-[#64748B] mt-1 mb-3">{prompt}</p>}

      <div className="space-y-1.5 mb-3">
        {candidates.map((c, i) => {
          const name = String(c.name ?? `岗位 ${i + 1}`);
          const desc = c.description ? String(c.description) : null;
          const isSelected = selected === name;
          return (
            <button
              key={name}
              type="button"
              className={`w-full flex flex-col items-start px-3 py-2 rounded-md border text-left text-sm transition-all
                ${isSelected
                  ? 'border-[#0EA5E9] bg-[#0EA5E9]/5 text-[#0369A1]'
                  : 'border-[#E2E8F0] bg-white hover:bg-[#F8FAFC] text-[#020617]'}`}
              onClick={() => setSelected(name)}
            >
              <span className="font-medium">{name}</span>
              {desc && <span className="text-[#94A3B8] text-xs mt-0.5">{desc}</span>}
            </button>
          );
        })}
      </div>

      {/* 驳回反馈输入框（与维度/计划卡统一） */}
      <textarea
        value={feedback}
        onChange={e => setFeedback(e.target.value)}
        placeholder="如需驳回重新选岗，可填写反馈意见（可选）"
        rows={2}
        className="w-full text-xs border border-[#E2E8F0] rounded px-2 py-1.5 mb-2
                   outline-none focus:border-[#0EA5E9] resize-none"
      />

      <div className="flex items-center gap-2">
        <button
          type="button"
          className="px-4 py-1.5 rounded-md bg-[#0369A1] text-white text-sm font-medium
                     hover:bg-[#0EA5E9] transition-colors
                     disabled:opacity-50 disabled:cursor-not-allowed"
          disabled={!selected || submitting}
          onClick={() => selected && onSubmit({ selected_job_name: selected })}
        >
          {submitting ? '提交中…' : '确认选择'}
        </button>
        <button
          type="button"
          className="px-3 py-1.5 rounded-md border border-[#E2E8F0] text-[#64748B] text-sm
                     hover:bg-[#F8FAFC] transition-colors
                     disabled:opacity-50 disabled:cursor-not-allowed"
          disabled={submitting}
          onClick={() => onSubmit({ regenerate: true, feedback: feedback.trim() })}
        >
          驳回重新选岗
        </button>
      </div>
    </div>
  );
}
```

整体替换为：

```tsx
/** 岗位选择卡：提交 { selected_job_name: string }
 *
 * 注意：本卡不含驳回 textarea + 按钮——岗位候选源是员工绑定岗位 DB 列表（`load_job_candidates`
 * 节点不调 LLM，候选岗固定），驳回重生成在后端无 LLM 支撑，feedback 字段会被丢弃。
 * 移除驳回入口避免误导用户。如需切换岗位，直接点选其它候选项即可。
 */
function JobSelection({ title, prompt, data, submitting, onSubmit }: SectionProps) {
  const candidates = (data?.candidates ?? []) as Array<{ name?: unknown; description?: unknown }>;
  const [selected, setSelected] = useState<string | null>(null);

  return (
    <div className="rounded-md border border-[#0EA5E9]/40 bg-white shadow-sm px-4 py-3">
      <p className="text-sm font-semibold text-[#020617]">{title}</p>
      {prompt && <p className="text-xs text-[#64748B] mt-1 mb-3">{prompt}</p>}

      <div className="space-y-1.5 mb-3">
        {candidates.map((c, i) => {
          const name = String(c.name ?? `岗位 ${i + 1}`);
          const desc = c.description ? String(c.description) : null;
          const isSelected = selected === name;
          return (
            <button
              key={name}
              type="button"
              className={`w-full flex flex-col items-start px-3 py-2 rounded-md border text-left text-sm transition-all
                ${isSelected
                  ? 'border-[#0EA5E9] bg-[#0EA5E9]/5 text-[#0369A1]'
                  : 'border-[#E2E8F0] bg-white hover:bg-[#F8FAFC] text-[#020617]'}`}
              onClick={() => setSelected(name)}
            >
              <span className="font-medium">{name}</span>
              {desc && <span className="text-[#94A3B8] text-xs mt-0.5">{desc}</span>}
            </button>
          );
        })}
      </div>

      <button
        type="button"
        className="px-4 py-1.5 rounded-md bg-[#0369A1] text-white text-sm font-medium
                   hover:bg-[#0EA5E9] transition-colors
                   disabled:opacity-50 disabled:cursor-not-allowed"
        disabled={!selected || submitting}
        onClick={() => selected && onSubmit({ selected_job_name: selected })}
      >
        {submitting ? '提交中…' : '确认选择'}
      </button>
    </div>
  );
}
```

- [ ] **Step 2：tsc 检查**

```bash
cd D:/code/py/project/resume/.claude/worktrees/fix-agent-bugs-round2/frontend && npx tsc --noEmit
```

预期 0 错。

- [ ] **Step 3：Commit（bug 2 完成）**

```bash
cd D:/code/py/project/resume/.claude/worktrees/fix-agent-bugs-round2 && git add frontend/src/components/employee/agent/blocks/interaction-block.tsx && git commit -m "fix(agent-fe): JobSelection 移除驳回 textarea+按钮（避免误导，bug 2）"
```

---

## Bug 3：侧栏会话计数 chip → 运行中徽标

### Task 11：替换计数 chip 为运行中徽标

**Files:**
- Modify: `frontend/src/components/employee/agent/layout/agent-sidebar-drawer.tsx:194-201`

- [ ] **Step 1：替换 chip 渲染**

打开 `frontend/src/components/employee/agent/layout/agent-sidebar-drawer.tsx`，找到第 193-201 行：

```tsx
              {/* 计数 chip：仅在有可见会话时渲染；空态保持简洁 */}
              {visible.length > 0 && (
                <span className="px-1.5 py-px rounded-full text-[10px] font-semibold tabular-nums
                                 text-[#0369A1]
                                 bg-[rgba(14,165,233,0.10)]
                                 ring-1 ring-inset ring-[rgba(14,165,233,0.18)]">
                  {visible.length}
                </span>
              )}
```

替换为：

```tsx
              {/* 运行中徽标：仅在有运行任务时渲染；空闲不打扰，与计数 chip 是替换关系（bug 3） */}
              {runningIds.size > 0 && (
                <span className="inline-flex items-center gap-1 px-1.5 py-px rounded-full text-[10px] font-semibold tabular-nums
                                 text-[#0369A1]
                                 bg-[rgba(14,165,233,0.10)]
                                 ring-1 ring-inset ring-[rgba(14,165,233,0.18)]"
                      title={`${runningIds.size} 个会话正在运行`}>
                  <span className="w-1.5 h-1.5 rounded-full bg-[#0EA5E9] animate-pulse" aria-hidden />
                  <span>{runningIds.size} 运行中</span>
                </span>
              )}
```

- [ ] **Step 2：tsc 检查**

```bash
cd D:/code/py/project/resume/.claude/worktrees/fix-agent-bugs-round2/frontend && npx tsc --noEmit
```

预期 0 错（runningIds 已通过 `const runningIds = useRunningSessionIds();` 获取）。

- [ ] **Step 3：Commit**

```bash
cd D:/code/py/project/resume/.claude/worktrees/fix-agent-bugs-round2 && git add frontend/src/components/employee/agent/layout/agent-sidebar-drawer.tsx && git commit -m "feat(agent-fe): 侧栏顶部 计数 chip 替换为 运行中徽标（bug 3）"
```

---

## Bug 4：侧栏 0.5s 分段层次感动画

### Task 12：升级 transition duration / delay / curve

**Files:**
- Modify: `frontend/src/components/employee/agent/layout/agent-sidebar-drawer.tsx`

- [ ] **Step 1：升级外层宽度过渡（170-180 行附近）**

找到 `<nav>` 元素：

```tsx
    <nav
      className={`relative flex-shrink-0 bg-white border-r border-[#E2E8F0]
                  transition-[width] duration-300 ease-[cubic-bezier(0.16,1,0.3,1)]
                  ${expanded ? 'w-[280px]' : 'w-[64px]'}
                  overflow-hidden`}
    >
```

把 `duration-300 ease-[cubic-bezier(0.16,1,0.3,1)]` 改为：

```tsx
    <nav
      className={`relative flex-shrink-0 bg-white border-r border-[#E2E8F0]
                  transition-[width] duration-500 ease-[cubic-bezier(0.65,0,0.35,1)]
                  motion-reduce:transition-none
                  ${expanded ? 'w-[280px]' : 'w-[64px]'}
                  overflow-hidden`}
    >
```

- [ ] **Step 2：升级展开态内容过渡（约 179-180 行）**

找到展开态内容容器：

```tsx
      <div className={`h-full flex flex-col transition-opacity duration-200
                       ${expanded ? 'opacity-100' : 'opacity-0 pointer-events-none'}`}>
```

替换为：

```tsx
      <div className={`h-full flex flex-col transition-opacity duration-200 motion-reduce:transition-none
                       ${expanded
                         ? 'opacity-100 [transition-delay:0.25s] [transition-timing-function:cubic-bezier(0,0,0.2,1)]'
                         : 'opacity-0 pointer-events-none [transition-timing-function:cubic-bezier(0.4,0,1,1)]'}`}>
```

- [ ] **Step 3：升级折叠态内容过渡（约 305 行）**

找到折叠态内容容器：

```tsx
      <div className={`absolute inset-0 flex flex-col items-center py-3 gap-2
                       transition-opacity duration-200
                       ${expanded ? 'opacity-0 pointer-events-none' : 'opacity-100'}`}>
```

替换为：

```tsx
      <div className={`absolute inset-0 flex flex-col items-center py-3 gap-2
                       transition-opacity duration-200 motion-reduce:transition-none
                       ${expanded
                         ? 'opacity-0 pointer-events-none [transition-timing-function:cubic-bezier(0.4,0,1,1)]'
                         : 'opacity-100 [transition-delay:0.25s] [transition-timing-function:cubic-bezier(0,0,0.2,1)]'}`}>
```

- [ ] **Step 4：tsc 检查**

```bash
cd D:/code/py/project/resume/.claude/worktrees/fix-agent-bugs-round2/frontend && npx tsc --noEmit
```

预期 0 错。

- [ ] **Step 5：Commit**

```bash
cd D:/code/py/project/resume/.claude/worktrees/fix-agent-bugs-round2 && git add frontend/src/components/employee/agent/layout/agent-sidebar-drawer.tsx && git commit -m "feat(agent-fe): 侧栏收起/展开 0.5s 分段层次感动画（bug 4）"
```

---

## Task 13：联调与全量验证

- [ ] **Step 1：全量 build**

```bash
cd D:/code/py/project/resume/.claude/worktrees/fix-agent-bugs-round2/frontend && npm run build
```

预期：build 成功（含 tsc + vite）。

- [ ] **Step 2：全量测试**

```bash
cd D:/code/py/project/resume/.claude/worktrees/fix-agent-bugs-round2/frontend && npm run test
```

预期：所有 agent 相关测试通过；evaluations.test 既有的 3 fail 是 dev pre-existing，不必管。

- [ ] **Step 3：（可选）后端 Python 语法检查**

```bash
cd D:/code/py/project/resume/.claude/worktrees/fix-agent-bugs-round2 && python -m py_compile backend/app/services/interview_question_service.py
```

预期：无输出 = 通过。

- [ ] **Step 4：（可选）手动联调清单**

启动后端 + 前端 dev 服务，按以下场景验证：

| 场景 | 操作 | 预期 |
|---|---|---|
| **bug 1-A** | 跑简历问答到维度选择卡 → 驳回 | StepStrip 文案：从"运行中 · 3/8 步 · 选择维度"切到"运行中 · 3/8 步 · 分析维度…"，**不再跳回"读取简历"** |
| **bug 1-B** | 驳回循环多次 | 分母恒为 8/8（步数不增加），活跃步骤随后端节点同步 |
| **bug 2-A** | 维度选择卡填"还需要新增团队沟通能力维度"+ 驳回 | 新一轮维度**包含**"团队沟通"相关维度 |
| **bug 2-B** | 驳回时不填反馈 | 新一轮维度**与上一轮有显著差异**（previous_dimensions 作对比基线生效） |
| **bug 2-C** | plan_approval 卡填"建议增加项目深度的题量到 4 题" + 驳回 | 新计划该维度题量真的增加 |
| **bug 2-D** | 简历评估流到岗位选择卡 | **没有驳回 textarea + 按钮**；只能从候选岗中点选 |
| **bug 3-A** | 流式中观察侧栏顶部 | 出现 ⦿ "1 运行中" 徽标；流式结束消失 |
| **bug 3-B** | 空闲状态侧栏顶部 | 仅 sky dot + "会话" 标题；右侧只有搜索/收起按钮 |
| **bug 4** | 点击侧栏收起/展开按钮 | 0.5s 分段层次感动画：旧内容先 fade-out → 宽度切换 → 新内容延迟 fade-in |

---

## 自检与提交摘要

13 个 task → 12 个 commit（Task 11 仅验证不 commit）：

1. `fix(agent-fe): upsertStep 重入移到末尾，恢复 runtime 顺序语义（bug 1）`
2. `fix(agent-fe): mergeStepsWithTemplate 改为 runtime 顺序优先（bug 1）`
3. `fix(agent-fe): StepStrip activeStep 改用 runtime 末位（bug 1）`
4. `feat(agent-fe): DimensionSelection 驳回按钮携带 accepted/rejected 分类（bug 2）`
5. `feat(agent-be): state schema 加 accepted/rejected_dimensions + 节点写入分类反馈（bug 2）`
6. `feat(agent-be): dimension_suggest 模板升级到 v1.2（accepted/rejected 分类指令，bug 2）`
7. `fix(agent-be): suggest_dimensions 节点接受分类反馈 + 防御性兜底已采纳维度（bug 2）`
8. `feat(agent-be): question_plan 模板加 previous_plan + 强化 review_feedback 措辞（bug 2）`
9. `fix(agent-be): build_question_plan 节点注入 previous_plan（bug 2）`
10. `fix(agent-fe): JobSelection 移除驳回 textarea+按钮（避免误导，bug 2）`
11. `feat(agent-fe): 侧栏顶部 计数 chip 替换为 运行中徽标（bug 3）`
12. `feat(agent-fe): 侧栏收起/展开 0.5s 分段层次感动画（bug 4）`

每个 bug 独立可回退（spec §九）：
- bug 1 回退：reset commits #1-#3
- bug 2 回退：reset commits #4-#10
- bug 3 回退：reset commit #11
- bug 4 回退：reset commit #12
