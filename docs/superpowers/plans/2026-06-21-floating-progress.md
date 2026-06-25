# 悬浮进度条重设计 + 进度 Bug 修复 实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 修复 Agent 进度展示的 3 个 bug，并将右侧常驻第三栏 `ProgressTracker` 替换为右上角悬浮岛（方案 A）。

**Architecture:** 逻辑先行——先修共享的进度合并/计数/数据源逻辑（bug 修复），再在其上构建悬浮岛 UI（复用修好的逻辑与现有 `step-row`/`WaveText` 动画）。数据流不变：SSE → reducer → store.runState.steps → workspace 选源 → `mergeStepsWithTemplate` → 渲染。

**Tech Stack:** React 19 + TypeScript + Vite + Tailwind CSS + framer-motion(^12) + lucide-react + Zustand；测试 vitest + @testing-library/react。

## Global Constraints

- 所有注释/日志用中文，变量/函数英文；文件 UTF-8 无 BOM，LF 行尾。
- 前端命名：组件文件大驼峰例外按现有目录约定用 kebab-case（如 `floating-progress.tsx`）；组件名大驼峰；变量小驼峰；类型以 `I`/`T` 开头或沿用现有 `AgentStep` 等既有类型。
- 不改后端 graph/SSE 协议；不改 `step_labels.py` 语义（仅 bug3 确认 key 不一致时同步 key）。
- 蓝色体系：sky `#0EA5E9` / `#0369A1`，中性 slate；玻璃面板用 backdrop-blur + 1px 内描边 + inset 高光。
- 保留现有动画：WaveText 波浪、`progress-icon-pulse` 呼吸、`progress-flow-dot` 流光线、framer-motion spring/layout。
- 测试命令：`cd frontend && npm run test`（vitest run）。单文件：`npx vitest run <path>`。
- 工作目录：`D:\code\py\project\resume\.claude\worktrees\floating-progress`，前端在其 `frontend/` 子目录。

---

## 文件结构

**修改：**
- `frontend/src/components/employee/agent/workflow-step-templates.ts` — `mergeStepsWithTemplate` 改模板顺序（Bug 2）
- `frontend/src/components/employee/agent/agent-workspace.tsx` — 移除第三栏、改用悬浮岛、数据源改用 `selectProgressSource`
- `frontend/src/components/employee/agent/agent-message-list.tsx` — 滚动容器加 `thin-scroll`

**新建：**
- `frontend/src/components/employee/agent/progress-source.ts` — `selectProgressSource` 纯函数（Bug 1）
- `frontend/src/components/employee/agent/progress-tracker/floating-progress.tsx` — 悬浮岛容器
- `frontend/src/components/employee/agent/progress-tracker/progress-pill.tsx` — 收起态胶囊
- `frontend/src/components/employee/agent/progress-tracker/progress-panel.tsx` — 展开态玻璃面板

**删除：**
- `frontend/src/components/employee/agent/progress-tracker/progress-tracker.tsx`
- `frontend/src/components/employee/agent/progress-tracker/progress-tooltip.tsx`
- `frontend/src/components/employee/agent/progress-tracker/__tests__/progress-tracker.test.tsx`

**保留复用：** `progress-tracker/step-row.tsx`、`wave-text.tsx`、`index.css` 的 `.thin-scroll`/keyframes。

**新建测试：**
- `frontend/src/components/employee/agent/progress-tracker/__tests__/merge-steps.test.ts`
- `frontend/src/components/employee/agent/progress-tracker/__tests__/progress-source.test.ts`
- `frontend/src/components/employee/agent/progress-tracker/__tests__/progress-panel.test.tsx`
- `frontend/src/components/employee/agent/progress-tracker/__tests__/floating-progress.test.tsx`

---

## Task 1: mergeStepsWithTemplate 改为模板顺序（Bug 2）

**Files:**
- Modify: `frontend/src/components/employee/agent/workflow-step-templates.ts:66-98`
- Test: `frontend/src/components/employee/agent/progress-tracker/__tests__/merge-steps.test.ts`

**Interfaces:**
- Consumes: `WORKFLOW_STEP_TEMPLATES`、`AgentStep`、`WorkflowType`（现有）。
- Produces: `mergeStepsWithTemplate(workflow: WorkflowType, runtimeSteps: AgentStep[]): AgentStep[]`，签名不变；**新语义**：输出顺序恒等于模板拓扑顺序，状态/detail 取自 runtime，未知 step_id 追加末尾。

- [ ] **Step 1: 写失败测试**

```ts
// merge-steps.test.ts
import { describe, it, expect } from 'vitest';
import { mergeStepsWithTemplate } from '../../workflow-step-templates';
import type { AgentStep } from '@/types/agent';

describe('mergeStepsWithTemplate（模板顺序）', () => {
  it('乱序 runtime 输入仍按模板拓扑顺序输出', () => {
    // runtime 到达顺序故意打乱（模拟 upsertStep 重入移末尾）
    const runtime: AgentStep[] = [
      { step_id: 'build_question_plan', title: 'X', status: 'running', detail: '出题中' },
      { step_id: 'load_resume', title: 'X', status: 'success' },
      { step_id: 'suggest_dimensions', title: 'X', status: 'success' },
      { step_id: 'request_dimension_selection', title: 'X', status: 'success' },
    ];
    const merged = mergeStepsWithTemplate('interview_questions', runtime);
    // 顺序必须等于模板顺序
    expect(merged.map(s => s.step_id)).toEqual([
      'load_resume', 'suggest_dimensions', 'request_dimension_selection',
      'build_question_plan', 'request_plan_approval', 'fanout_generate_questions',
      'reduce_questions', 'finalize_question_set',
    ]);
    // 标题用模板权威值
    expect(merged[0].title).toBe('读取简历');
    expect(merged[3].title).toBe('规划出题');
    // 状态取自 runtime；detail 透传
    expect(merged[3].status).toBe('running');
    expect(merged[3].detail).toBe('出题中');
    // 已完成节点不因乱序变 pending
    expect(merged.slice(0, 3).every(s => s.status === 'success')).toBe(true);
    // 未到达节点 pending
    expect(merged[4].status).toBe('pending');
  });

  it('未知 workflow 走 fallback 返回原数组', () => {
    const runtime: AgentStep[] = [{ step_id: 'x', title: 'x', status: 'running' }];
    // @ts-expect-error 故意传未知 workflow
    expect(mergeStepsWithTemplate('unknown', runtime)).toEqual(runtime);
  });

  it('runtime 含模板外 step_id 时追加到末尾', () => {
    const runtime: AgentStep[] = [
      { step_id: 'load_resume', title: 'x', status: 'success' },
      { step_id: 'mystery_node', title: '异常节点', status: 'failed' },
    ];
    const merged = mergeStepsWithTemplate('interview_questions', runtime);
    expect(merged.length).toBe(9); // 模板 8 + 未知 1
    expect(merged[merged.length - 1].step_id).toBe('mystery_node');
  });
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `cd frontend && npx vitest run src/components/employee/agent/progress-tracker/__tests__/merge-steps.test.ts`
Expected: FAIL（首例顺序断言不通过——旧实现按 runtime 顺序）

- [ ] **Step 3: 改写 mergeStepsWithTemplate**

替换 `workflow-step-templates.ts:66-98` 的函数体（保留上方 JSDoc，更新其描述为"模板顺序"语义）：

```ts
export function mergeStepsWithTemplate(
  workflow: WorkflowType,
  runtimeSteps: AgentStep[],
): AgentStep[] {
  const template = WORKFLOW_STEP_TEMPLATES[workflow];
  if (!template) return runtimeSteps;  // fallback：未知 workflow

  // runtime 状态索引：step_id → 运行时步骤（提供 status / detail）
  const runtimeByStepId = new Map(runtimeSteps.map(s => [s.step_id, s]));

  // 按模板拓扑顺序产出：命中 runtime 用其 status/detail，否则 pending 占位。
  // 渲染顺序只由模板决定，状态只由 runtime 决定 —— 两者解耦，根治"跳顶 / 已完成变未完成"。
  const merged: AgentStep[] = template.map(t => {
    const r = runtimeByStepId.get(t.step_id);
    if (r) {
      return {
        step_id: t.step_id,
        title: t.title,
        status: r.status,
        ...(r.detail !== undefined ? { detail: r.detail } : {}),
      };
    }
    return { step_id: t.step_id, title: t.title, status: 'pending' };
  });

  // 兜底：runtime 出现但不在模板内的未知 step_id，按到达顺序追加末尾（异常分支可观测）
  for (const s of runtimeSteps) {
    if (!template.some(t => t.step_id === s.step_id)) merged.push(s);
  }

  return merged;
}
```

- [ ] **Step 4: 运行测试确认通过**

Run: `cd frontend && npx vitest run src/components/employee/agent/progress-tracker/__tests__/merge-steps.test.ts`
Expected: PASS（3 例全过）

- [ ] **Step 5: 提交**

```bash
git add frontend/src/components/employee/agent/workflow-step-templates.ts frontend/src/components/employee/agent/progress-tracker/__tests__/merge-steps.test.ts
git commit -m "fix(agent-fe): mergeStepsWithTemplate 改模板顺序，修复进度节点跳顶/已完成变未完成(Bug2)"
```

---

## Task 2: selectProgressSource 数据源选择（Bug 1）

**Files:**
- Create: `frontend/src/components/employee/agent/progress-source.ts`
- Test: `frontend/src/components/employee/agent/progress-tracker/__tests__/progress-source.test.ts`

**Interfaces:**
- Consumes: `AgentStep`、`WorkflowType`、`WorkspaceSession`、`AgentRunState`（来自 `@/types/agent`）。
- Produces: `selectProgressSource(args): { steps: AgentStep[]; workflowType: WorkflowType }`
  - 入参：`{ runStateSteps: AgentStep[]; runStateWorkflow: WorkflowType; sessionProgress?: { steps: AgentStep[]; workflow_type: WorkflowType } | null; lastMessageWorkflow?: WorkflowType }`
  - Task 6 会调用它替换 workspace 内联逻辑。

- [ ] **Step 1: 写失败测试**

```ts
// progress-source.test.ts
import { describe, it, expect } from 'vitest';
import { selectProgressSource } from '../../progress-source';
import type { AgentStep } from '@/types/agent';

const rt: AgentStep[] = [{ step_id: 'load_resume', title: '读取简历', status: 'success' }];

describe('selectProgressSource（修复 Bug1 结束闪空）', () => {
  it('runState.steps 非空时优先用 runState（含结束后持久化未回写的空窗期）', () => {
    const r = selectProgressSource({
      runStateSteps: rt,
      runStateWorkflow: 'interview_questions',
      sessionProgress: null,           // 持久化尚未回写
      lastMessageWorkflow: 'interview_questions',
    });
    expect(r.steps).toBe(rt);
    expect(r.workflowType).toBe('interview_questions');
  });

  it('runState.steps 为空时回看 session.progress', () => {
    const persisted: AgentStep[] = [{ step_id: 'load_resume', title: '读取简历', status: 'success' }];
    const r = selectProgressSource({
      runStateSteps: [],
      runStateWorkflow: 'interview_questions',
      sessionProgress: { steps: persisted, workflow_type: 'resume_evaluation' },
      lastMessageWorkflow: 'interview_questions',
    });
    expect(r.steps).toBe(persisted);
    expect(r.workflowType).toBe('resume_evaluation');
  });

  it('两者皆空时退化为 lastMessageWorkflow，steps 为空数组', () => {
    const r = selectProgressSource({
      runStateSteps: [],
      runStateWorkflow: 'interview_questions',
      sessionProgress: null,
      lastMessageWorkflow: 'resume_evaluation',
    });
    expect(r.steps).toEqual([]);
    expect(r.workflowType).toBe('resume_evaluation');
  });

  it('全部缺省时兜底 interview_questions', () => {
    const r = selectProgressSource({
      runStateSteps: [],
      runStateWorkflow: 'interview_questions',
      sessionProgress: null,
    });
    expect(r.workflowType).toBe('interview_questions');
  });
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `cd frontend && npx vitest run src/components/employee/agent/progress-tracker/__tests__/progress-source.test.ts`
Expected: FAIL（模块不存在）

- [ ] **Step 3: 实现 progress-source.ts**

```ts
/**
 * 进度栏数据源选择。
 *
 * 修复 Bug1：旧逻辑按 runState.running 硬切，任务结束瞬间 running=false 但
 * session.progress 尚未回写 → 进度全 pending 闪空。改为"取信息更完整的一方"：
 * runState.steps 非空就用它（覆盖结束后持久化回写前的空窗期），否则回看持久化进度。
 * 正常 END 后 reducer 会清空 runState.steps，此时 session.progress 通常已就绪。
 */

import type { AgentStep, WorkflowType } from '@/types/agent';

/** 选源入参 */
export interface ProgressSourceArgs {
  /** 运行态实时步骤（runState.steps） */
  runStateSteps: AgentStep[];
  /** 运行态 workflow（runState.workflow_type） */
  runStateWorkflow: WorkflowType;
  /** 后端回写的持久化进度（session.progress），可能为空 */
  sessionProgress?: { steps: AgentStep[]; workflow_type: WorkflowType } | null;
  /** 最近一条消息的 workflow（持久化也缺失时的回退） */
  lastMessageWorkflow?: WorkflowType;
}

/** 选源结果 */
export interface ProgressSourceResult {
  steps: AgentStep[];
  workflowType: WorkflowType;
}

/** 选择进度展示的数据源与 workflow 类型 */
export function selectProgressSource(args: ProgressSourceArgs): ProgressSourceResult {
  const { runStateSteps, runStateWorkflow, sessionProgress, lastMessageWorkflow } = args;
  // runState.steps 非空 → 优先实时数据（含结束后持久化未回写的空窗期）
  if (runStateSteps.length > 0) {
    return { steps: runStateSteps, workflowType: runStateWorkflow };
  }
  // 否则回看持久化进度
  if (sessionProgress) {
    return { steps: sessionProgress.steps, workflowType: sessionProgress.workflow_type };
  }
  // 皆空：空步骤 + 回退 workflow（由模板填 pending 占位）
  return { steps: [], workflowType: lastMessageWorkflow ?? 'interview_questions' };
}
```

- [ ] **Step 4: 运行测试确认通过**

Run: `cd frontend && npx vitest run src/components/employee/agent/progress-tracker/__tests__/progress-source.test.ts`
Expected: PASS（4 例全过）

- [ ] **Step 5: 提交**

```bash
git add frontend/src/components/employee/agent/progress-source.ts frontend/src/components/employee/agent/progress-tracker/__tests__/progress-source.test.ts
git commit -m "fix(agent-fe): selectProgressSource 取非空源，修复结束瞬间进度闪空(Bug1)"
```

---

## Task 3: Bug3 计数根因核查（静态 key 比对）

**Files:**
- Read only: `frontend/src/components/employee/agent/workflow-step-templates.ts`、`backend/app/llm/graphs/workflows/step_labels.py`

**Interfaces:**
- Consumes: 两份 step_id/key 清单。
- Produces: 结论——计数卡 2/8 是否由"前端模板 step_id 与后端 STEP_LABELS key 不一致"导致；若是则给出需对齐的 key 清单。

- [ ] **Step 1: 抽取后端 STEP_LABELS 的 key**

Run: `cd "D:\code\py\project\resume\.claude\worktrees\floating-progress" && grep -nE '^\s*"[a-z_]+"\s*:' backend/app/llm/graphs/workflows/step_labels.py`
记录两个 workflow 各自的 step_id key 集合。

- [ ] **Step 2: 与前端模板逐一比对**

对照 `workflow-step-templates.ts` 的 `interview_questions`（8 个）与 `resume_evaluation`（8 个）step_id：
- 若**完全一致** → 计数卡 2/8 不是 key 不一致问题，根因为后端推送不全（候选 a）。此时 Task 1（模板顺序化）已让计数稳健，记录结论："计数随后端 step.update 推送自然增长，需 Task 9 实跑确认推送完整性"，本任务无代码改动。
- 若**存在不一致**（候选 b）→ 进入 Step 3 对齐。

- [ ] **Step 3:（仅当不一致）对齐前端模板 key**

将 `workflow-step-templates.ts` 中不匹配的 `step_id` 改为后端 `step_labels.py` 的权威 key（只改 key，不改 title 语义）。改完重跑 Task 1 测试确认未回归：
Run: `cd frontend && npx vitest run src/components/employee/agent/progress-tracker/__tests__/merge-steps.test.ts`
Expected: PASS

- [ ] **Step 4: 提交（仅当有改动）**

```bash
git add frontend/src/components/employee/agent/workflow-step-templates.ts
git commit -m "fix(agent-fe): 对齐前端模板 step_id 与后端 STEP_LABELS，修复进度计数失真(Bug3)"
```

> 若 Step 2 判定为候选 a（无改动），不提交，将结论写入 Task 9 验证项。

---

## Task 4: ProgressPanel 展开态玻璃面板（默认 5 + 加载更多 + 滚动）

**Files:**
- Create: `frontend/src/components/employee/agent/progress-tracker/progress-panel.tsx`
- Test: `frontend/src/components/employee/agent/progress-tracker/__tests__/progress-panel.test.tsx`

**Interfaces:**
- Consumes: `AgentStep`（`@/types/agent`）、`StepRow`（`./step-row`）。
- Produces: `ProgressPanel(props: { steps: AgentStep[]; reached: number; total: number })`——`steps` 为已 merge 的完整数组（模板顺序）。内部维护"是否展开全部"状态，默认仅渲染前 5 个 + "加载更多"按钮。

- [ ] **Step 1: 写失败测试**

```tsx
// progress-panel.test.tsx
import { describe, it, expect } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { ProgressPanel } from '../progress-panel';
import type { AgentStep } from '@/types/agent';

const steps: AgentStep[] = [
  { step_id: 'load_resume', title: '读取简历', status: 'success' },
  { step_id: 'suggest_dimensions', title: '分析维度', status: 'success' },
  { step_id: 'request_dimension_selection', title: '选择维度', status: 'success' },
  { step_id: 'build_question_plan', title: '规划出题', status: 'success' },
  { step_id: 'request_plan_approval', title: '确认计划', status: 'success' },
  { step_id: 'fanout_generate_questions', title: '生成题目', status: 'pending' },
  { step_id: 'reduce_questions', title: '汇总整理', status: 'pending' },
  { step_id: 'finalize_question_set', title: '输出题库', status: 'pending' },
];

describe('ProgressPanel', () => {
  it('默认只渲染前 5 个节点 + 加载更多', () => {
    render(<ProgressPanel steps={steps} reached={5} total={8} />);
    expect(screen.getByText('读取简历')).toBeInTheDocument();
    expect(screen.getByText('确认计划')).toBeInTheDocument();   // 第 5 个
    expect(screen.queryByText('生成题目')).not.toBeInTheDocument(); // 第 6 个隐藏
    expect(screen.getByText(/加载更多/)).toBeInTheDocument();
    // 计数展示 5 / 8
    expect(screen.getByText(/\/ 8 步/)).toBeInTheDocument();
  });

  it('点击加载更多后展示全部且按钮消失', () => {
    render(<ProgressPanel steps={steps} reached={5} total={8} />);
    fireEvent.click(screen.getByText(/加载更多/));
    expect(screen.getByText('生成题目')).toBeInTheDocument();
    expect(screen.getByText('输出题库')).toBeInTheDocument();
    expect(screen.queryByText(/加载更多/)).not.toBeInTheDocument();
  });

  it('节点数 ≤ 5 时不显示加载更多', () => {
    render(<ProgressPanel steps={steps.slice(0, 4)} reached={4} total={8} />);
    expect(screen.queryByText(/加载更多/)).not.toBeInTheDocument();
  });
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `cd frontend && npx vitest run src/components/employee/agent/progress-tracker/__tests__/progress-panel.test.tsx`
Expected: FAIL（模块不存在）

- [ ] **Step 3: 实现 progress-panel.tsx**

```tsx
/**
 * ProgressPanel：悬浮岛展开态玻璃面板。
 *
 * 头部：流程进度标签 + reached/total 计数；
 * 列表：默认仅渲染前 DEFAULT_VISIBLE 个节点，超出显示"加载更多"，点开渲染全部；
 * 最大高度限定在单视窗内（max-h），溢出走精小滚动条 thin-scroll。
 * 单行复用 StepRow（含 WaveText / 流光连接线动画）。
 */
import { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import type { AgentStep } from '@/types/agent';
import { StepRow } from './step-row';

/** 默认展示节点数（超出折叠到"加载更多"） */
const DEFAULT_VISIBLE = 5;

export interface ProgressPanelProps {
  /** 已 merge 的完整步骤数组（模板顺序） */
  steps: AgentStep[];
  /** 已到达步骤数（非 pending） */
  reached: number;
  /** 模板总步数 */
  total: number;
}

/** 展开态面板主体 */
export function ProgressPanel({ steps, reached, total }: ProgressPanelProps) {
  // 是否展开全部节点（默认折叠到前 5 个）
  const [expanded, setExpanded] = useState(false);
  const visible = expanded ? steps : steps.slice(0, DEFAULT_VISIBLE);
  const hiddenCount = steps.length - DEFAULT_VISIBLE;

  return (
    <div
      className="w-72 rounded-[20px] overflow-hidden
                 bg-white/80 backdrop-blur-xl backdrop-saturate-150
                 border border-white/60
                 shadow-[0_20px_48px_-16px_rgba(2,6,23,0.18),inset_0_1px_0_rgba(255,255,255,0.7)]"
    >
      {/* 头部：标签 + 计数 */}
      <div className="flex items-center gap-2 px-3.5 py-3 border-b border-[#E2E8F0]/70">
        <span className="text-[10.5px] font-bold tracking-wider uppercase text-[#64748B]">
          流程进度
        </span>
        <span className="ml-auto text-[11px] text-[#64748B] font-mono">
          <b className="text-[#0369A1] text-sm">{reached}</b> / {total} 步
        </span>
      </div>

      {/* 节点列表：最大高度限定单视窗内，溢出滚动 */}
      <div className="p-2 max-h-[min(70vh,360px)] overflow-y-auto thin-scroll">
        <AnimatePresence initial={false}>
          {visible.map((s, i) => (
            <motion.div
              key={s.step_id}
              layout
              initial={{ opacity: 0, x: -6 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ delay: i * 0.04, type: 'spring', stiffness: 120, damping: 20 }}
            >
              <StepRow step={s} isLast={i === visible.length - 1} />
            </motion.div>
          ))}
        </AnimatePresence>

        {/* 加载更多：节点超过默认数且未展开时显示 */}
        {!expanded && steps.length > DEFAULT_VISIBLE && (
          <button
            type="button"
            onClick={() => setExpanded(true)}
            className="w-full mt-1 py-2 rounded-[9px] text-[11.5px] font-semibold
                       text-[#0369A1] hover:bg-[#0EA5E9]/8 transition-colors"
          >
            加载更多（还有 {hiddenCount} 步）
          </button>
        )}
      </div>
    </div>
  );
}
```

- [ ] **Step 4: 运行测试确认通过**

Run: `cd frontend && npx vitest run src/components/employee/agent/progress-tracker/__tests__/progress-panel.test.tsx`
Expected: PASS（3 例全过）

- [ ] **Step 5: 提交**

```bash
git add frontend/src/components/employee/agent/progress-tracker/progress-panel.tsx frontend/src/components/employee/agent/progress-tracker/__tests__/progress-panel.test.tsx
git commit -m "feat(agent-fe): ProgressPanel 玻璃面板（默认5节点+加载更多+精小滚动）"
```

---

## Task 5: ProgressPill 收起态胶囊

**Files:**
- Create: `frontend/src/components/employee/agent/progress-tracker/progress-pill.tsx`

**Interfaces:**
- Consumes: `AgentStep`、`WaveText`（`../wave-text`）、lucide `ChevronDown`、`Check`、`X`。
- Produces: `ProgressPill(props: { active: AgentStep; reached: number; total: number; open: boolean; onToggle: () => void })`——展示迷你进度环（reached/total）+ 当前节点图标 + 当前节点标题（running 时 WaveText）+ 展开箭头；整体可点击触发 `onToggle`。

> 本任务无独立测试（纯展示，行为由 Task 6 容器测试覆盖）。验收靠 Task 7 实跑视觉确认。

- [ ] **Step 1: 实现 progress-pill.tsx**

```tsx
/**
 * ProgressPill：悬浮岛收起态胶囊。
 *
 * 默认仅展示当前节点：迷你进度环（reached/total）+ 当前节点图标 + 标题
 * （running 时用 WaveText 波浪文字）+ 展开箭头。点击整体触发展开/收起。
 */
import { motion } from 'framer-motion';
import { ChevronDown, Check, X } from 'lucide-react';
import type { AgentStep } from '@/types/agent';
import { WaveText } from '../wave-text';

/** 迷你环半径与周长 */
const R = 13;
const C = 2 * Math.PI * R;

export interface ProgressPillProps {
  /** 当前活跃节点（merged 中最后一个非 pending，无则首项） */
  active: AgentStep;
  /** 已到达步骤数 */
  reached: number;
  /** 模板总步数 */
  total: number;
  /** 面板是否展开（控制箭头旋转） */
  open: boolean;
  /** 点击切换展开/收起 */
  onToggle: () => void;
}

/** 收起态胶囊 */
export function ProgressPill({ active, reached, total, open, onToggle }: ProgressPillProps) {
  const isRunning = active.status === 'running';
  return (
    <button
      type="button"
      onClick={onToggle}
      className="flex items-center gap-2.5 h-11 pl-2 pr-3.5 rounded-full cursor-pointer
                 bg-white/80 backdrop-blur-xl backdrop-saturate-150
                 border border-white/60 active:scale-[0.98] transition-transform
                 shadow-[0_20px_48px_-16px_rgba(2,6,23,0.18),inset_0_1px_0_rgba(255,255,255,0.7)]"
    >
      {/* 迷你进度环 + 居中计数 */}
      <span className="relative shrink-0">
        <svg width="32" height="32" viewBox="0 0 32 32">
          <defs>
            <linearGradient id="pillRing" x1="0" y1="0" x2="1" y2="1">
              <stop offset="0%" stopColor="#0EA5E9" />
              <stop offset="100%" stopColor="#0369A1" />
            </linearGradient>
          </defs>
          <circle cx="16" cy="16" r={R} fill="none" stroke="#E2E8F0" strokeWidth="3" />
          <circle
            cx="16" cy="16" r={R} fill="none" stroke="url(#pillRing)" strokeWidth="3"
            strokeLinecap="round" strokeDasharray={C}
            strokeDashoffset={C * (1 - (total ? reached / total : 0))}
            transform="rotate(-90 16 16)"
            style={{ transition: 'stroke-dashoffset 0.6s cubic-bezier(0.16,1,0.3,1)' }}
          />
        </svg>
        <span className="absolute inset-0 flex items-center justify-center text-[9px] font-bold text-[#0369A1] font-mono">
          {reached}/{total}
        </span>
      </span>

      {/* 当前节点标题：running 用波浪文字，其余纯文本 */}
      <span className="min-w-0 text-left">
        <span className="block text-[12.5px] font-semibold text-[#020617] truncate max-w-[140px]">
          {isRunning ? <WaveText text={active.title} /> : active.title}
        </span>
        <span className="block text-[10px] text-[#64748B]">
          {statusLabel(active.status)}
        </span>
      </span>

      {/* 展开箭头 */}
      <ChevronDown
        size={14}
        className="text-[#94A3B8] transition-transform"
        style={{ transform: open ? 'rotate(180deg)' : 'none' }}
      />
    </button>
  );
}

/** 状态副标题文案 */
function statusLabel(status: AgentStep['status']): string {
  switch (status) {
    case 'running': return '进行中';
    case 'success': return '已完成';
    case 'failed': return '已失败';
    default: return '待处理';
  }
}
```

- [ ] **Step 2: 类型检查通过**

Run: `cd frontend && npx tsc --noEmit`
Expected: 无新增报错（`motion` import 若未用到，删除该行——本文件未用 `motion`，移除 `import { motion } from 'framer-motion';`）

> 注：上方代码确实未使用 `motion`，实现时不要加入该 import（此处提示遵循"删除自身改动产生的冗余 import"）。

- [ ] **Step 3: 提交**

```bash
git add frontend/src/components/employee/agent/progress-tracker/progress-pill.tsx
git commit -m "feat(agent-fe): ProgressPill 收起态胶囊（迷你环+当前节点+波浪标题）"
```

---

## Task 6: FloatingProgress 容器（组装 + 状态）

**Files:**
- Create: `frontend/src/components/employee/agent/progress-tracker/floating-progress.tsx`
- Test: `frontend/src/components/employee/agent/progress-tracker/__tests__/floating-progress.test.tsx`

**Interfaces:**
- Consumes: `AgentStep`、`WorkflowType`、`mergeStepsWithTemplate`、`WORKFLOW_STEP_TEMPLATES`（`../workflow-step-templates`）、`ProgressPill`、`ProgressPanel`。
- Produces: `FloatingProgress(props: { steps: AgentStep[]; running: boolean; workflowType: WorkflowType })`——绝对定位右上角；内部 merge + 计算 total/reached/active；默认收起（仅 pill），点击展开 panel（AnimatePresence 进出动画）。Task 7 在 workspace 挂载它。

- [ ] **Step 1: 写失败测试**

```tsx
// floating-progress.test.tsx
import { describe, it, expect } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { FloatingProgress } from '../floating-progress';
import type { AgentStep } from '@/types/agent';

const steps: AgentStep[] = [
  { step_id: 'load_resume', title: '读取简历', status: 'success' },
  { step_id: 'suggest_dimensions', title: '分析维度', status: 'success' },
];

describe('FloatingProgress', () => {
  it('默认收起：展示当前节点，面板（流程进度标签）不在 DOM', () => {
    render(<FloatingProgress steps={steps} running workflowType="interview_questions" />);
    // 当前节点 = 最后一个非 pending = 分析维度
    expect(screen.getByText('分析维度')).toBeInTheDocument();
    // 面板未展开
    expect(screen.queryByText('流程进度')).not.toBeInTheDocument();
  });

  it('点击胶囊后展开面板', () => {
    render(<FloatingProgress steps={steps} running workflowType="interview_questions" />);
    fireEvent.click(screen.getByText('分析维度'));
    expect(screen.getByText('流程进度')).toBeInTheDocument();
    // 计数 2 / 8
    expect(screen.getByText(/\/ 8 步/)).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `cd frontend && npx vitest run src/components/employee/agent/progress-tracker/__tests__/floating-progress.test.tsx`
Expected: FAIL（模块不存在）

- [ ] **Step 3: 实现 floating-progress.tsx**

```tsx
/**
 * FloatingProgress：右上角悬浮岛容器（替换旧侧边第三栏 ProgressTracker）。
 *
 * 默认收起，仅展示 ProgressPill（当前节点）；点击展开 ProgressPanel 看节点详情。
 * 数据：合并模板与 runtime（模板顺序），派生 total/reached/active 下发子组件。
 * 绝对定位于工作台主区右上角，固定不随会话滚动。
 */
import { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import type { AgentStep, WorkflowType } from '@/types/agent';
import { mergeStepsWithTemplate, WORKFLOW_STEP_TEMPLATES } from '../workflow-step-templates';
import { ProgressPill } from './progress-pill';
import { ProgressPanel } from './progress-panel';

export interface FloatingProgressProps {
  /** 进度步骤（来自 selectProgressSource） */
  steps: AgentStep[];
  /** 是否运行态（保留契约） */
  running: boolean;
  /** workflow 类型（决定模板与分母） */
  workflowType: WorkflowType;
}

/** 悬浮岛主体 */
export function FloatingProgress({ steps, running: _running, workflowType }: FloatingProgressProps) {
  // 面板是否展开（默认收起）
  const [open, setOpen] = useState(false);

  // 合并模板与 runtime（模板顺序），派生计数与当前活跃节点
  const merged = mergeStepsWithTemplate(workflowType, steps);
  const total = WORKFLOW_STEP_TEMPLATES[workflowType]?.length ?? merged.length;
  const reached = merged.filter(s => s.status !== 'pending').length;
  const active = [...merged].reverse().find(s => s.status !== 'pending') ?? merged[0];

  // 无任何节点（异常）时不渲染
  if (!active) return null;

  return (
    <div className="absolute top-4 right-4 z-40 flex flex-col items-end">
      <ProgressPill
        active={active}
        reached={reached}
        total={total}
        open={open}
        onToggle={() => setOpen(v => !v)}
      />
      <AnimatePresence>
        {open && (
          <motion.div
            className="mt-2.5 origin-top-right"
            initial={{ opacity: 0, scale: 0.94, y: -8 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.94, y: -8 }}
            transition={{ type: 'spring', stiffness: 200, damping: 22 }}
          >
            <ProgressPanel steps={merged} reached={reached} total={total} />
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
```

- [ ] **Step 4: 运行测试确认通过**

Run: `cd frontend && npx vitest run src/components/employee/agent/progress-tracker/__tests__/floating-progress.test.tsx`
Expected: PASS（2 例全过）

- [ ] **Step 5: 提交**

```bash
git add frontend/src/components/employee/agent/progress-tracker/floating-progress.tsx frontend/src/components/employee/agent/progress-tracker/__tests__/floating-progress.test.tsx
git commit -m "feat(agent-fe): FloatingProgress 悬浮岛容器（默认收起+点击展开）"
```

---

## Task 7: 接入 workspace + 移除旧第三栏 + 主会话区滚动条

**Files:**
- Modify: `frontend/src/components/employee/agent/agent-workspace.tsx`
- Modify: `frontend/src/components/employee/agent/agent-message-list.tsx:55,92`
- Delete: `progress-tracker/progress-tracker.tsx`、`progress-tracker/progress-tooltip.tsx`、`progress-tracker/__tests__/progress-tracker.test.tsx`

**Interfaces:**
- Consumes: `FloatingProgress`（Task 6）、`selectProgressSource`（Task 2）。
- Produces: workspace 主区占满 + 右上角悬浮岛；主会话区滚动条为 thin-scroll。

- [ ] **Step 1: 改 agent-workspace.tsx——替换 import**

把 `agent-workspace.tsx:11` 的
```ts
import { ProgressTracker } from './progress-tracker/progress-tracker';
```
改为：
```ts
import { FloatingProgress } from './progress-tracker/floating-progress';
import { selectProgressSource } from './progress-source';
```

- [ ] **Step 2: 改数据源逻辑（替换 121-131 行）**

把 `agent-workspace.tsx:121-131` 整段（旧 `progressSteps`/`progressWorkflow` 内联计算）替换为：
```ts
  // 进度数据源（修复 Bug1：取信息更完整的一方，避免结束瞬间闪空）
  const progress = selectProgressSource({
    runStateSteps: runState.steps,
    runStateWorkflow: runState.workflow_type,
    sessionProgress: session.progress ?? null,
    lastMessageWorkflow: messages.length > 0 ? messages[messages.length - 1].workflow_type : undefined,
  });
```

- [ ] **Step 3: 改布局——主区占满 + 挂悬浮岛（替换 133-170 行的 return）**

把外层 `<div className="flex flex-1 min-w-0">` 改为相对定位容器，移除 `<ProgressTracker>`，在末尾挂 `<FloatingProgress>`：
```tsx
  return (
    <div className="relative flex flex-1 min-w-0">
      <main className="flex flex-1 flex-col min-w-0">
        <AgentMessageList
          messages={messages}
          runState={runState}
          sending={sending}
          onSubmitInteraction={submit}
          onPickPrompt={(prompt, workflow) => setPrefill({ prompt, workflow })}
          onRetry={handleRetry}
          onResume={() => void resumeRun(sessionId)}
          onRetryFromLastUser={handleRetryFromLastUser}
        />
        <AgentComposer
          session={session}
          sending={sending}
          hasPendingInteraction={hasPendingInteraction}
          lastWorkflow={messages.length > 0 ? messages[messages.length - 1].workflow_type : 'interview_questions'}
          prefill={prefill}
          onPrefillConsumed={() => setPrefill(null)}
          onSend={(input) => handleSend({
            ...input,
            enable_thinking: session.enable_thinking,
            model_name: session.selected_model_name,
          })}
          onAbort={abort}
          onToggleThinking={() => toggleThinking(sessionId)}
          onPickModel={(modelName) => selectModel(sessionId, modelName)}
          isEmptySession={messages.length === 0}
        />
      </main>
      {/* 右上角悬浮进度岛（替换旧侧边第三栏） */}
      <FloatingProgress
        steps={progress.steps}
        running={runState.running}
        workflowType={progress.workflowType}
      />
    </div>
  );
```

- [ ] **Step 4: 主会话区滚动条改 thin-scroll**

`agent-message-list.tsx` 第 55、92 行的
```tsx
className="flex-1 overflow-y-auto bg-[#F8FAFC]"
```
两处都改为：
```tsx
className="flex-1 overflow-y-auto thin-scroll bg-[#F8FAFC]"
```

- [ ] **Step 5: 删除旧第三栏文件与其测试**

```bash
cd "D:\code\py\project\resume\.claude\worktrees\floating-progress"
git rm frontend/src/components/employee/agent/progress-tracker/progress-tracker.tsx \
       frontend/src/components/employee/agent/progress-tracker/progress-tooltip.tsx \
       frontend/src/components/employee/agent/progress-tracker/__tests__/progress-tracker.test.tsx
```

- [ ] **Step 6: 类型检查 + 全量测试**

Run: `cd frontend && npx tsc --noEmit && npm run test`
Expected: tsc 无报错（确认无残留 `ProgressTracker`/`progress-tooltip` 引用）；vitest 全绿（含既有 `agent-workspace.test.tsx`——若其断言依赖旧第三栏 DOM，按实际失败信息同步更新断言至悬浮岛结构）。

- [ ] **Step 7: 提交**

```bash
git add -A
git commit -m "feat(agent-fe): 接入悬浮进度岛替换侧边第三栏 + 主会话区精小滚动条"
```

---

## Task 8: 构建验证 + 实跑回归（Bug1/2/3 + 视觉）

**Files:** 无（端到端验证）

- [ ] **Step 1: 生产构建**

Run: `cd frontend && npm run build`
Expected: tsc + vite build 成功，无类型/打包错误。

- [ ] **Step 2: 启动前后端实跑**

提示用户在本会话用 `!` 前缀启动（需真实后端 + LLM）：
- 后端：`! cd backend && <项目既有启动命令>`
- 前端：`! cd frontend && npm run dev`

- [ ] **Step 3: 跑一遍 interview_questions 完整流程，逐项核对**

| 验收项 | 期望 |
|---|---|
| Bug1 | 任务结束瞬间悬浮岛不闪空、不全变 pending |
| Bug2 | 节点严格按模板顺序（读取简历→…→输出题库），"规划出题"停在第 4 位不跳顶，已完成节点保持完成 |
| Bug3 | 计数从 1/8 单调递增到 8/8（若 Task 3 判为候选 a，重点确认后端推送是否覆盖全部 step_id；若仍停滞，抓 SSE envelope 的 step_id 序列定位缺失节点并据此修复后端推送或前端 key） |
| 悬浮岛 | 默认收起仅显当前节点；点击展开；默认 5 节点 + 加载更多；超出滚动 |
| 滚动条 | 主会话区 + 面板均精小 thin-scroll |
| 动画 | 波浪文字 / 呼吸光圈 / 流光线均保留 |

- [ ] **Step 4: 截图留档（可选）**

收起态 + 展开态各截一张，确认玻璃质感与蓝色体系。

- [ ] **Step 5: 最终提交（如有实跑修复）**

```bash
git add -A && git commit -m "fix(agent-fe): 实跑回归修复（按 Step 3 结论）"
```

---

## Self-Review

**Spec 覆盖：**
- Bug1 → Task 2 + Task 7-Step2 + Task 8。✓
- Bug2 → Task 1 + Task 8。✓
- Bug3 → Task 3（静态核查）+ Task 8-Step3（实跑确认/修复）。✓
- 悬浮岛（默认收起/当前节点/点击展开/5节点+加载更多/单视窗滚动）→ Task 4/5/6/7。✓
- 保留动画 → 复用 StepRow/WaveText（Task 4/5），Task 8 核对。✓
- 精小滚动条（主会话区 + 面板）→ Task 4（面板）+ Task 7-Step4（主区）。✓
- 移除第三栏 → Task 7。✓

**占位扫描：** 无 TBD/TODO；Bug3 的不确定性以"静态核查 + 实跑确认"两段显式落地，含 fallback。✓

**类型一致性：** `mergeStepsWithTemplate(workflow, runtimeSteps)`、`selectProgressSource(args)`、`ProgressPanel{steps,reached,total}`、`ProgressPill{active,reached,total,open,onToggle}`、`FloatingProgress{steps,running,workflowType}`——跨任务签名一致。✓
