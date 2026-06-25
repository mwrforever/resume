# Agent 工作台 3 处 Bug 修复 实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 修复 Agent 工作台 3 处前端 bug：刷新中断提示卡（bug 1）、侧栏分组标签调整 + 新会话首条消息置顶今日（bug 3）、StepStrip 步数 N/M（bug 4）。

**Architecture:** 全部纯前端改动，三个 bug 互相独立、可分别合入。bug 1 通过检测最后一条 agent 消息是否含 `status='streaming'` 的 block 识别"被中断"消息，渲染单行 pill 中断条 + 重发按钮（重发 = 用最后一条 user 消息内容重新调 sendMessage）；bug 3 仅替换 `groupSessionsByTime` 的 label 字段 + 在 `sendMessage` 内乐观写入 `last_message_time`；bug 4 新增 `workflow-step-templates.ts` 常量提供 workflow → 节点清单，StepStrip 用模板 merge runtime steps 后取 `successCount / template.length`。

**Tech Stack:** React 19、TypeScript、Vite、Vitest、Tailwind、Zustand、lucide-react。测试框架已就绪（`frontend/package.json:scripts.test = "vitest run"`），现有测试目录 `frontend/src/components/employee/agent/layout/__tests__/`、`frontend/src/components/employee/agent/blocks/__tests__/`。

**Spec：** `docs/superpowers/specs/2026-06-19-agent-bugs-fix-design.md`

**测试命令统一格式：**
```bash
cd frontend && npm run test -- <test_path>     # 单文件运行
cd frontend && npm run test                     # 全部运行
```

---

## 文件清单

| 类型 | 路径 | 责任 |
|---|---|---|
| 新建 | `frontend/src/components/employee/agent/workflow-step-templates.ts` | bug 4：workflow → 节点清单常量 + mergeStepsWithTemplate 函数 |
| 新建 | `frontend/src/components/employee/agent/__tests__/workflow-step-templates.test.ts` | bug 4：merge 函数单测 |
| 新建 | `frontend/src/components/employee/agent/interrupt-bar.tsx` | bug 1：单行 pill 中断条组件 |
| 修改 | `frontend/src/components/employee/agent/step-strip.tsx` | bug 4：分子分母改用模板，新增 workflowType prop |
| 修改 | `frontend/src/components/employee/agent/agent-message-card.tsx:86` | bug 4：StepStrip 调用处传入 `workflowType={runState.workflow_type}` |
| 修改 | `frontend/src/components/employee/agent/agent-message-list.tsx` | bug 1：导出判定函数 `isLastAgentMessageInterrupted`、渲染 InterruptBar、新增 `onRetryFromLastUser` 回调 prop |
| 修改 | `frontend/src/components/employee/agent/agent-workspace.tsx` | bug 1：新增 `handleRetryFromLastUser` 回调（用最后一条 user 消息内容重发） |
| 修改 | `frontend/src/components/employee/agent/layout/agent-sidebar-drawer.tsx` | bug 3：分组 label 字符串「今天/本周更早」→「今日/本周」+ TS 联合类型同步 |
| 修改 | `frontend/src/components/employee/agent/layout/__tests__/agent-sidebar-grouping.test.ts` | bug 3：6 个用例的预期 label 字符串同步 |
| 修改 | `frontend/src/store/agent.ts:419-431` | bug 3：sendMessage 乐观写入 `last_message_time = now()` |

---

## Bug 4：StepStrip 步数 N/M（独立子项目，先做）

### Task 1：创建 workflow-step-templates.ts 常量与 merge 函数

**Files:**
- Create: `frontend/src/components/employee/agent/workflow-step-templates.ts`

- [ ] **Step 1：编写常量与函数（一次落地，无中间步骤）**

```ts
/**
 * Workflow 节点清单（与后端 backend/app/llm/graphs/workflows/step_labels.py 保持一致）。
 *
 * 用途：StepStrip 的「N / M 步」分母 = 该 workflow 的静态节点数。
 * step.update envelope 到达时按 step_id 匹配模板项替换状态；
 * 重入相同 step_id（驳回循环）→ 取该 step_id 最后一次出现的状态，长度恒定。
 *
 * **同步约束**：后端 step_labels.py 增删节点时必须同步本文件。
 */

import type { AgentStep, WorkflowType } from '@/types/agent';

/** 节点模板项：仅含静态信息（step_id + 标题），状态由运行时填入 */
export interface StepTemplate {
  step_id: string;
  title: string;
}

/**
 * Workflow → 节点清单（拓扑顺序）。
 *
 * - interview_questions 共 8 步；
 * - resume_evaluation 共 8 步。
 *
 * 节点 ID 与后端 step_labels.STEP_LABELS 的 key 完全一致。
 */
export const WORKFLOW_STEP_TEMPLATES: Record<WorkflowType, StepTemplate[]> = {
  interview_questions: [
    { step_id: 'load_resume',                 title: '读取简历' },
    { step_id: 'suggest_dimensions',          title: '分析维度' },
    { step_id: 'request_dimension_selection', title: '选择维度' },
    { step_id: 'build_question_plan',         title: '规划出题' },
    { step_id: 'request_plan_approval',       title: '确认计划' },
    { step_id: 'fanout_generate_questions',   title: '生成题目' },
    { step_id: 'reduce_questions',            title: '汇总整理' },
    { step_id: 'finalize_question_set',       title: '输出题库' },
  ],
  resume_evaluation: [
    { step_id: 'load_resume',                title: '读取简历' },
    { step_id: 'analyze_resume_profile',     title: '分析画像' },
    { step_id: 'load_job_candidates',        title: '加载岗位' },
    { step_id: 'request_job_selection',      title: '选择岗位' },
    { step_id: 'validate_job_full_name',     title: '校验岗位' },
    { step_id: 'run_evaluation_subgraph',    title: '多维评估' },
    { step_id: 'build_visualization_report', title: '组装报告' },
    { step_id: 'finalize_evaluation_report', title: '输出报告' },
  ],
};

/**
 * 把模板与运行时 step.update 序列合并为完整步骤数组。
 *
 * 规则：
 * - 模板项按拓扑顺序输出，runtime 命中的项替换 status / detail，未命中保持 pending；
 * - 重入相同 step_id（runtime 中多次出现）→ 取**最后一次**出现的状态作为该模板项的当前状态，
 *   保证"驳回循环"不增加分母也不重置已完成；
 * - 模板里没出现的 runtime step_id（异常分支或新节点未同步）→ 追加到末尾，分母 = 模板长度 + 异常项数；
 *   这是防御性兜底，正常情况下不应发生。
 *
 * @param workflow workflow_type；未在 WORKFLOW_STEP_TEMPLATES 中的值走 fallback（直接返回 runtimeSteps）
 * @param runtimeSteps runState.steps，按 step.update 到达顺序累积
 * @returns 合并后的步骤数组（长度 ≥ 模板长度）
 */
export function mergeStepsWithTemplate(
  workflow: WorkflowType,
  runtimeSteps: AgentStep[],
): AgentStep[] {
  const template = WORKFLOW_STEP_TEMPLATES[workflow];
  if (!template) return runtimeSteps;  // fallback：未知 workflow

  // runtime steps 按 step_id 取**最后一次**出现的状态
  const lastByStepId = new Map<string, AgentStep>();
  for (const s of runtimeSteps) {
    lastByStepId.set(s.step_id, s);
  }

  // 按模板顺序输出：命中 → runtime 状态；未命中 → pending 占位
  const merged: AgentStep[] = template.map(t => {
    const runtime = lastByStepId.get(t.step_id);
    if (runtime) return runtime;
    return { step_id: t.step_id, title: t.title, status: 'pending' };
  });

  // 模板未覆盖的 runtime step（防御性追加，分母会变大）
  const templateIds = new Set(template.map(t => t.step_id));
  for (const s of runtimeSteps) {
    if (!templateIds.has(s.step_id) && !merged.find(m => m.step_id === s.step_id)) {
      merged.push(s);
    }
  }

  return merged;
}
```

- [ ] **Step 2：TypeScript 编译检查**

Run: `cd frontend && npx tsc --noEmit`
Expected：无错误（项目其它处也参与编译，应该已通过）

- [ ] **Step 3：Commit**

```bash
git add frontend/src/components/employee/agent/workflow-step-templates.ts
git commit -m "feat(agent-fe): 新增 workflow 步骤模板常量与 merge 函数"
```

---

### Task 2：单测覆盖 mergeStepsWithTemplate

**Files:**
- Create: `frontend/src/components/employee/agent/__tests__/workflow-step-templates.test.ts`

- [ ] **Step 1：写失败测试**

```ts
/**
 * workflow-step-templates 单测：
 * - 空 runtime → 全 pending
 * - 部分命中 → 命中变 success，未命中保持 pending
 * - 重入相同 step_id → 取最后一次状态，长度不变
 * - 未知 workflow → fallback 返回 runtime steps 原样
 */

import { describe, it, expect } from 'vitest';
import type { AgentStep } from '@/types/agent';
import {
  WORKFLOW_STEP_TEMPLATES,
  mergeStepsWithTemplate,
} from '../workflow-step-templates';

describe('WORKFLOW_STEP_TEMPLATES', () => {
  it('interview_questions 共 8 步', () => {
    expect(WORKFLOW_STEP_TEMPLATES.interview_questions).toHaveLength(8);
  });
  it('resume_evaluation 共 8 步', () => {
    expect(WORKFLOW_STEP_TEMPLATES.resume_evaluation).toHaveLength(8);
  });
});

describe('mergeStepsWithTemplate', () => {
  it('空 runtime → 模板全部 pending，长度 = 模板长度', () => {
    const merged = mergeStepsWithTemplate('interview_questions', []);
    expect(merged).toHaveLength(8);
    expect(merged.every(s => s.status === 'pending')).toBe(true);
    expect(merged[0].step_id).toBe('load_resume');
    expect(merged[0].title).toBe('读取简历');
  });

  it('部分 runtime 命中 → 命中变实际状态，未命中保持 pending', () => {
    const runtime: AgentStep[] = [
      { step_id: 'load_resume',        title: '读取简历', status: 'success' },
      { step_id: 'suggest_dimensions', title: '分析维度', status: 'success' },
    ];
    const merged = mergeStepsWithTemplate('interview_questions', runtime);
    expect(merged).toHaveLength(8);
    expect(merged[0].status).toBe('success');
    expect(merged[1].status).toBe('success');
    expect(merged[2].status).toBe('pending');
    expect(merged[7].status).toBe('pending');
  });

  it('重入相同 step_id → 取最后一次出现的状态，长度仍 = 模板长度', () => {
    // 模拟驳回循环：suggest_dimensions 出现两次（第二次是重做后再次 success）
    const runtime: AgentStep[] = [
      { step_id: 'load_resume',                 title: '读取简历', status: 'success' },
      { step_id: 'suggest_dimensions',          title: '分析维度', status: 'success' },
      { step_id: 'request_dimension_selection', title: '选择维度', status: 'success' },
      // 用户驳回 → 跳回 suggest_dimensions 重做
      { step_id: 'suggest_dimensions',          title: '分析维度', status: 'success', detail: '重新分析' },
    ];
    const merged = mergeStepsWithTemplate('interview_questions', runtime);
    expect(merged).toHaveLength(8);
    // suggest_dimensions 在模板第 2 项，应取最后一次状态
    expect(merged[1].step_id).toBe('suggest_dimensions');
    expect(merged[1].detail).toBe('重新分析');
  });

  it('未知 workflow → fallback 返回 runtime steps 原样', () => {
    const runtime: AgentStep[] = [
      { step_id: 'foo', title: '未知节点', status: 'success' },
    ];
    // @ts-expect-error 故意传入非法 workflow
    const merged = mergeStepsWithTemplate('unknown_workflow', runtime);
    expect(merged).toEqual(runtime);
  });

  it('模板未覆盖的 runtime step → 追加到末尾（防御性兜底）', () => {
    const runtime: AgentStep[] = [
      { step_id: 'load_resume', title: '读取简历', status: 'success' },
      { step_id: 'unexpected', title: '意外节点', status: 'success' },
    ];
    const merged = mergeStepsWithTemplate('interview_questions', runtime);
    // 模板 8 项 + 追加 1 项 = 9
    expect(merged).toHaveLength(9);
    expect(merged[8].step_id).toBe('unexpected');
  });
});
```

- [ ] **Step 2：运行测试，确认通过**

Run: `cd frontend && npm run test -- workflow-step-templates`
Expected: 5 pass

- [ ] **Step 3：Commit**

```bash
git add frontend/src/components/employee/agent/__tests__/workflow-step-templates.test.ts
git commit -m "test(agent-fe): workflow-step-templates 单测覆盖 5 个场景"
```

---

### Task 3：StepStrip 改造为模板驱动

**Files:**
- Modify: `frontend/src/components/employee/agent/step-strip.tsx`（全文改写，文件 107 行）

- [ ] **Step 1：替换 StepStrip 实现**

```tsx
/**
 * StepStrip：运行步骤条
 *
 * 数据来源：runState.steps（运行时 step.update 累积）+ workflow 静态节点模板
 * （workflow-step-templates.ts）。展示「已完成 N / 总 M 步」，分母恒为模板长度，
 * 驳回循环（同 step_id 重入）不增加分母。
 *
 * 默认折叠为单行；展开后显示水平时间线，含未到达的 pending 项。
 * 步骤状态：待执行(灰圈) → 进行中(蓝旋转) → 已完成(绿勾) → 失败(红X)。
 *
 * 注意：思考过程不在步骤条展示——阶段/维度思考统一走 tool_use 块（可持久化），
 * 由 ToolUseBlock 内的 ReasoningSection 承载。
 */

import { useState } from 'react';
import { ChevronDown, Check, X, Loader2 } from 'lucide-react';
import type { AgentStep, WorkflowType } from '@/types/agent';
import { WaveText } from './wave-text';
import { mergeStepsWithTemplate } from './workflow-step-templates';

export interface StepStripProps {
  /** 运行时累积的 step.update（来自 runState.steps），按到达顺序 */
  steps: AgentStep[];
  /** 当前是否在跑流式 run（影响图标 / 文案 / 波浪动画） */
  running: boolean;
  /** workflow 类型（用于查模板拿到总步数与未到达步骤标题） */
  workflowType: WorkflowType;
}

export function StepStrip({ steps, running, workflowType }: StepStripProps) {
  const [expanded, setExpanded] = useState(false);

  // 模板合并：runtime steps 按 step_id 替换模板项，长度 = 模板长度
  const mergedSteps = mergeStepsWithTemplate(workflowType, steps);
  const successCount = mergedSteps.filter(s => s.status === 'success').length;
  const totalCount = mergedSteps.length;

  // 当前活跃步骤：第一个非 success 项；全部 success 时取最后一项（运行结束态）
  const activeStep =
    mergedSteps.find(s => s.status !== 'success') ?? mergedSteps[mergedSteps.length - 1];

  // 模板长度永远 ≥ 1（WORKFLOW_STEP_TEMPLATES 不允许空），但 fallback / 未来扩展时仍兜底
  if (mergedSteps.length === 0) return null;

  return (
    <div className="px-4 py-2 text-xs">
      {/* 折叠头部 */}
      <button
        type="button"
        onClick={() => setExpanded(v => !v)}
        className="flex w-full items-center gap-2 text-[#64748B] hover:text-[#020617] transition-colors"
      >
        {/* 全局状态图标 */}
        {running ? (
          <Loader2 size={14} className="text-[#0EA5E9] animate-spin" />
        ) : (
          <Check size={14} className="text-[#16A34A]" />
        )}
        <span>
          {running ? (
            <>
              运行中 · {successCount} / {totalCount} 步
              {activeStep && (
                <>
                  <span className="text-[#64748B]"> · </span>
                  <WaveText text={activeStep.title} />
                </>
              )}
            </>
          ) : (
            `已完成 ${successCount} / ${totalCount} 步`
          )}
        </span>
        <ChevronDown size={14} className={`ml-auto transition-transform duration-150 ${expanded ? 'rotate-180' : ''}`} />
      </button>

      {/* 展开步骤时间线（含未到达的 pending 项） */}
      <div className={`overflow-hidden transition-all duration-220 ${
        expanded ? 'max-h-60 opacity-100 mt-2' : 'max-h-0 opacity-0'
      }`}>
        <ul className="flex flex-wrap gap-x-4 gap-y-1.5">
          {mergedSteps.map((s) => {
            // 当前活跃步骤（且整体 running）用 WaveText 高亮，其余静态
            const isActive = running && s.step_id === activeStep?.step_id && s.status !== 'success';
            return (
              <li key={s.step_id} className="flex items-center gap-1.5">
                <StepIcon status={s.status} />
                <span className={s.status === 'pending' ? 'text-[#94A3B8]' : 'text-[#334155]'}>
                  {isActive ? <WaveText text={s.title} /> : s.title}
                </span>
                {s.detail && <span className="text-[#94A3B8] ml-0.5">{s.detail}</span>}
              </li>
            );
          })}
        </ul>
      </div>
    </div>
  );
}

function StepIcon({ status }: { status: AgentStep['status'] }) {
  if (status === 'pending') {
    return <span className="w-3 h-3 inline-block rounded-full border-2 border-[#CBD5E1]" />;
  }
  if (status === 'running') {
    return <span className="w-3 h-3 inline-block rounded-full border-2 border-[#0EA5E9] border-t-transparent animate-spin" />;
  }
  if (status === 'success') {
    return (
      <span className="w-3 h-3 inline-flex items-center justify-center rounded-full bg-[#DCFCE7]">
        <Check size={8} className="text-[#16A34A]" />
      </span>
    );
  }
  // failed
  return (
    <span className="w-3 h-3 inline-flex items-center justify-center rounded-full bg-[#FEE2E2]">
      <X size={8} className="text-[#DC2626]" />
    </span>
  );
}
```

- [ ] **Step 2：TypeScript 编译检查（StepStrip 接口变更，调用方未更新会报错）**

Run: `cd frontend && npx tsc --noEmit 2>&1 | head -20`
Expected: 报错 `agent-message-card.tsx` 调用 StepStrip 时缺 `workflowType` prop（这是预期，下一 task 修复）

---

### Task 4：AgentMessageCard 调用 StepStrip 时透传 workflowType

**Files:**
- Modify: `frontend/src/components/employee/agent/agent-message-card.tsx:79-87`

- [ ] **Step 1：替换 StepStrip 调用块**

把当前 79-87 行：
```tsx
        {/* StepStrip：仅流式且有 steps 时渲染；max-height 折叠过渡避免直接 unmount 跳动 */}
        <div
          className={`overflow-hidden transition-[max-height,opacity] duration-300 ease-[cubic-bezier(0.16,1,0.3,1)]
                      ${streaming && runState && runState.steps.length > 0
                        ? 'max-h-[200px] opacity-100 mb-2'
                        : 'max-h-0 opacity-0'}`}
        >
          {runState && runState.steps.length > 0 && (
            <StepStrip steps={runState.steps} running={runState.running} />
          )}
        </div>
```

改为（**仅 StepStrip 调用行追加 workflowType prop**）：
```tsx
        {/* StepStrip：仅流式且有 steps 时渲染；max-height 折叠过渡避免直接 unmount 跳动 */}
        <div
          className={`overflow-hidden transition-[max-height,opacity] duration-300 ease-[cubic-bezier(0.16,1,0.3,1)]
                      ${streaming && runState && runState.steps.length > 0
                        ? 'max-h-[200px] opacity-100 mb-2'
                        : 'max-h-0 opacity-0'}`}
        >
          {runState && runState.steps.length > 0 && (
            <StepStrip
              steps={runState.steps}
              running={runState.running}
              workflowType={runState.workflow_type}
            />
          )}
        </div>
```

- [ ] **Step 2：TypeScript 编译检查通过**

Run: `cd frontend && npx tsc --noEmit`
Expected: 无错误

- [ ] **Step 3：运行 step-strip 相关测试和 workflow-step-templates 测试**

Run: `cd frontend && npm run test -- workflow-step-templates`
Expected: 5 pass

- [ ] **Step 4：Commit（bug 4 完成）**

```bash
git add frontend/src/components/employee/agent/step-strip.tsx \
        frontend/src/components/employee/agent/agent-message-card.tsx
git commit -m "feat(agent-fe): StepStrip 步数改为 N/M 模板驱动（bug 4）"
```

---

## Bug 3：侧栏分组（标签替换 + 乐观时间）

### Task 5：单测断言改为新 label

**Files:**
- Modify: `frontend/src/components/employee/agent/layout/__tests__/agent-sidebar-grouping.test.ts:42-46, 75-77`（断言）

- [ ] **Step 1：替换 label 字符串**

把 42-46 行的"返回三组"测试用例：
```ts
  it('返回三组：today / thisWeek / earlier，顺序固定', () => {
    const groups = groupSessionsByTime([], NOW);
    expect(groups.map(g => g.key)).toEqual(['today', 'thisWeek', 'earlier']);
    expect(groups.map(g => g.label)).toEqual(['今天', '本周更早', '更早']);
  });
```

改为：
```ts
  it('返回三组：today / thisWeek / earlier，顺序固定', () => {
    const groups = groupSessionsByTime([], NOW);
    expect(groups.map(g => g.key)).toEqual(['today', 'thisWeek', 'earlier']);
    expect(groups.map(g => g.label)).toEqual(['今日', '本周', '更早']);
  });
```

把同文件 8-9 行的注释里的标签描述同步：
```ts
 * - 今天：last_message_time >= 本地今天 00:00
 * - 本周更早：本周一 00:00 <= last_message_time < 今天 00:00
 * - 更早：last_message_time < 本周一 00:00 或解析失败 / 为空
```

改为：
```ts
 * - 今日：last_message_time >= 本地今天 00:00
 * - 本周：本周一 00:00 <= last_message_time < 今日 00:00
 * - 更早：last_message_time < 本周一 00:00 或解析失败 / 为空
```

把 61 行注释 `「本周更早」=本周一 00:00 ~ 今天 00:00` 改为 `「本周」=本周一 00:00 ~ 今日 00:00`；
75 行注释 `「更早」=本周一之前 + 空时间 + 解析失败` 不变。

- [ ] **Step 2：运行测试，确认失败**

Run: `cd frontend && npm run test -- agent-sidebar-grouping`
Expected: 第一个用例失败（label 字符串不匹配），其它通过

---

### Task 6：实现侧栏 label 替换让测试通过

**Files:**
- Modify: `frontend/src/components/employee/agent/layout/agent-sidebar-drawer.tsx:52-69, 115-119`

- [ ] **Step 1：更新 SessionGroup label 联合类型**

把 64-69 行：
```ts
export type SessionGroupKey = 'today' | 'thisWeek' | 'earlier';
export interface SessionGroup {
  key: SessionGroupKey;
  label: '今天' | '本周更早' | '更早';
  items: WorkspaceSession[];
}
```

改为：
```ts
export type SessionGroupKey = 'today' | 'thisWeek' | 'earlier';
export interface SessionGroup {
  key: SessionGroupKey;
  label: '今日' | '本周' | '更早';
  items: WorkspaceSession[];
}
```

- [ ] **Step 2：更新 groupSessionsByTime return 里的 label 字符串**

把 115-119 行：
```ts
  return [
    { key: 'today',    label: '今天',     items: today },
    { key: 'thisWeek', label: '本周更早', items: thisWeek },
    { key: 'earlier',  label: '更早',     items: [...earlierValid.map(x => x.s), ...earlierInvalid] },
  ];
```

改为：
```ts
  return [
    { key: 'today',    label: '今日', items: today },
    { key: 'thisWeek', label: '本周', items: thisWeek },
    { key: 'earlier',  label: '更早', items: [...earlierValid.map(x => x.s), ...earlierInvalid] },
  ];
```

- [ ] **Step 3：同步注释（文件 52-63 行）**

把 52-63 行的注释里的"今天 / 本周更早 / 更早"换成"今日 / 本周 / 更早"，规则描述同步。具体替换：

第 52 行：`/** 会话时间分组：今天 / 本周更早 / 更早。` → `/** 会话时间分组：今日 / 本周 / 更早。`
第 56 行：`* - 今天：` → `* - 今日：`
第 57 行：`* - 本周更早：本周一 00:00 <= last_message_time < 今天 00:00` → `* - 本周：本周一 00:00 <= last_message_time < 今日 00:00`
第 58 行：`* - 更早：本周一之前 / 空时间 / 解析失败` 不变
第 59 行：`* - 同组内按时间降序；空 / 无效时间项追加到「更早」末尾，按 id 升序稳定` 不变

- [ ] **Step 4：运行测试，确认通过**

Run: `cd frontend && npm run test -- agent-sidebar-grouping`
Expected: all pass

- [ ] **Step 5：TypeScript 编译检查**

Run: `cd frontend && npx tsc --noEmit`
Expected: 无错误

- [ ] **Step 6：Commit**

```bash
git add frontend/src/components/employee/agent/layout/agent-sidebar-drawer.tsx \
        frontend/src/components/employee/agent/layout/__tests__/agent-sidebar-grouping.test.ts
git commit -m "feat(agent-fe): 侧栏分组标签改为 今日/本周/更早（bug 3）"
```

---

### Task 7：sendMessage 乐观写入 last_message_time

**Files:**
- Modify: `frontend/src/store/agent.ts:412-431`

- [ ] **Step 1：替换乐观 set 块**

把 412-431 行：
```ts
    // 标题乐观更新：首条消息且会话为默认空标题时，本地算标题立即同步
    const optimisticTitle = (() => {
      const entry = get().runs[realSessionId];
      const cur = entry?.session?.title;
      if (cur && !isDefaultTitle(cur)) return null;
      return makeTitleFromContent(input.content);
    })();
    set((s) => {
      const entry = getRun(s.runs, realSessionId);
      const messages = [...entry.messages, optimisticUserMessage];
      const session = optimisticTitle && entry.session
        ? { ...entry.session, title: optimisticTitle }
        : entry.session;
      const sessions = optimisticTitle
        ? s.sessions.map((sess) =>
            sess.id === realSessionId ? { ...sess, title: optimisticTitle } : sess,
          )
        : s.sessions;
      return { runs: { ...s.runs, [realSessionId]: { ...entry, messages, session } }, sessions };
    });
```

改为：
```ts
    // 标题乐观更新：首条消息且会话为默认空标题时，本地算标题立即同步
    const optimisticTitle = (() => {
      const entry = get().runs[realSessionId];
      const cur = entry?.session?.title;
      if (cur && !isDefaultTitle(cur)) return null;
      return makeTitleFromContent(input.content);
    })();
    // 乐观 last_message_time：让会话立即进入侧栏「今日」组顶部（bug 3）。
    // 服务端权威值在 run.finish reload 时通过 mergeLocalRuntime 回写覆盖；
    // 客户端时间与服务端可能差几秒，但都在「今日」区间内，分组结果一致，无视觉跳变。
    const optimisticLastMessageTime = new Date().toISOString();
    set((s) => {
      const entry = getRun(s.runs, realSessionId);
      const messages = [...entry.messages, optimisticUserMessage];
      // session 同步乐观更新：标题（仅首条空标题）+ last_message_time（每次都写）
      const sessionPatch: Partial<typeof entry.session> = {
        last_message_time: optimisticLastMessageTime,
        ...(optimisticTitle ? { title: optimisticTitle } : {}),
      };
      const session = entry.session
        ? { ...entry.session, ...sessionPatch }
        : entry.session;
      const sessions = s.sessions.map((sess) =>
        sess.id === realSessionId ? { ...sess, ...sessionPatch } : sess,
      );
      return { runs: { ...s.runs, [realSessionId]: { ...entry, messages, session } }, sessions };
    });
```

- [ ] **Step 2：TypeScript 编译检查**

Run: `cd frontend && npx tsc --noEmit`
Expected: 无错误

- [ ] **Step 3：运行所有 agent 相关测试**

Run: `cd frontend && npm run test -- agent`
Expected: 现有测试全部通过

- [ ] **Step 4：Commit（bug 3 完成）**

```bash
git add frontend/src/store/agent.ts
git commit -m "fix(agent-fe): sendMessage 乐观写入 last_message_time，让新会话首条消息后置顶今日（bug 3）"
```

---

## Bug 1：中断提示卡

### Task 8：创建 InterruptBar 组件

**Files:**
- Create: `frontend/src/components/employee/agent/interrupt-bar.tsx`

- [ ] **Step 1：写组件**

```tsx
/**
 * InterruptBar：中断提示条
 *
 * 用途：刷新页面或后端错误打断流式 run 后，被截断的 agent 消息底部展示
 * 单行 pill：橙色感叹号 + 「本次任务已中断」+ 重试图标按钮。
 *
 * 触发条件由调用方判定（最后一条 agent 消息含 status='streaming' 的 block）。
 * 重试 = 用最后一条 user 消息内容重新调 sendMessage（由父组件处理）。
 *
 * 视觉沿用项目 sky/orange 体系，不引入新 token。
 */

import { Loader2, RotateCw } from 'lucide-react';

export interface InterruptBarProps {
  /** 重试触发回调：父组件用最后一条 user 消息内容重新发送 */
  onRetry: () => void;
  /** 重试是否进行中（true 时按钮禁用 + 图标转 spinner） */
  retrying?: boolean;
}

export function InterruptBar({ onRetry, retrying = false }: InterruptBarProps) {
  return (
    <div
      role="status"
      aria-label="本次任务已中断"
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
      <span>本次任务已中断</span>
      <button
        type="button"
        onClick={onRetry}
        disabled={retrying}
        title={retrying ? '重试中…' : '重试'}
        aria-label={retrying ? '重试中' : '重试'}
        className="inline-flex w-6 h-6 rounded-full ml-1
                   text-[#EA580C]
                   hover:bg-[#EA580C]/12
                   disabled:opacity-60 disabled:cursor-not-allowed
                   items-center justify-center
                   transition-colors"
      >
        {retrying ? (
          <Loader2 size={14} className="animate-spin" />
        ) : (
          <RotateCw size={14} />
        )}
      </button>
    </div>
  );
}
```

- [ ] **Step 2：TypeScript 编译检查**

Run: `cd frontend && npx tsc --noEmit`
Expected: 无错误

- [ ] **Step 3：Commit**

```bash
git add frontend/src/components/employee/agent/interrupt-bar.tsx
git commit -m "feat(agent-fe): 新增 InterruptBar 中断提示条组件（bug 1）"
```

---

### Task 9：AgentMessageList 渲染 InterruptBar + 暴露判定函数

**Files:**
- Modify: `frontend/src/components/employee/agent/agent-message-list.tsx:11-28, 83-141`

- [ ] **Step 1：在文件顶部新增导入与判定函数**

把 11-12 行：
```ts
import { useEffect, useMemo } from 'react';
import { AlertCircle, RefreshCw } from 'lucide-react';
```

改为：
```ts
import { useEffect, useMemo } from 'react';
import { AlertCircle, RefreshCw } from 'lucide-react';
import { InterruptBar } from './interrupt-bar';
```

把 19-28 行的 `AgentMessageListProps` 接口：
```ts
export interface AgentMessageListProps {
  messages: AgentMessage[];
  runState: AgentRunState;
  /** 是否正在提交 interaction / 发送消息 → 透传给 interaction 卡片禁用按钮 */
  sending?: boolean;
  onSubmitInteraction: (requestId: string, values: Record<string, unknown>) => void;
  /** 选中空态快捷问答：可同时回填文案与联动切换 workflow 模式 */
  onPickPrompt?: (prompt: string, workflow?: WorkflowType) => void;
  onRetry?: () => void;
}
```

改为：
```ts
export interface AgentMessageListProps {
  messages: AgentMessage[];
  runState: AgentRunState;
  /** 是否正在提交 interaction / 发送消息 → 透传给 interaction 卡片禁用按钮 */
  sending?: boolean;
  onSubmitInteraction: (requestId: string, values: Record<string, unknown>) => void;
  /** 选中空态快捷问答：可同时回填文案与联动切换 workflow 模式 */
  onPickPrompt?: (prompt: string, workflow?: WorkflowType) => void;
  /** 错误重试（仅 runState.error 红色 callout 使用） */
  onRetry?: () => void;
  /** 中断重发（用最后一条 user 消息内容重新发起，bug 1） */
  onRetryFromLastUser?: () => void;
}
```

把签名 30 行：
```ts
export function AgentMessageList({ messages, runState, sending, onSubmitInteraction, onPickPrompt, onRetry }: AgentMessageListProps) {
```

改为：
```ts
export function AgentMessageList({
  messages, runState, sending, onSubmitInteraction, onPickPrompt, onRetry, onRetryFromLastUser,
}: AgentMessageListProps) {
```

- [ ] **Step 2：在文件末尾（`function MessageRow` 上方）追加导出判定函数**

在第 142 行（`/** 单条消息渲染 */` 之前）插入：
```ts
/**
 * 判定最后一条 agent 消息是否被中断。
 *
 * 后端在客户端断开 / 后端 error 时，finally 块仍把已生成的 envelopes 折叠落库
 * （agent_runtime_service._persist_agent_message），但部分 block 来不及发 block.stop，
 * 落库时 status 仍为 'streaming'。
 *
 * 其它结束路径不会留 streaming：
 * - 正常 END：全 success
 * - interrupt 暂停（人机交互卡）：interaction block 是 pending（runner.py:107 emit 时就是 pending）
 *   text/tool_use 都是 success
 * - 用户 abort：interaction 是 expired
 *
 * 因此 'streaming' 是「被中断」的精确信号，pending interaction 不会误命中。
 *
 * @param messages 落库消息数组
 * @returns true 表示最后一条 agent 消息被中断（应渲染 InterruptBar）
 */
export function isLastAgentMessageInterrupted(messages: AgentMessage[]): boolean {
  if (messages.length === 0) return false;
  const last = messages[messages.length - 1];
  if (last.role !== 'agent') return false;
  return (last.content.blocks ?? []).some(b => b.status === 'streaming');
}
```

- [ ] **Step 3：在 `runState.error` callout 块下方追加 InterruptBar 渲染**

把当前 110-138 行（`{runState.error && (...)}` 整块）下方追加（在第 138 行 `)}` 之后、139 行 `</div>` 之前）：
```tsx
        {/* 中断提示（bug 1）：刷新打断或后端 error 后，最后一条 agent 消息含 streaming block 时显示。
            仅在没有正在跑的 run 时显示（避免和流式状态条同屏）；
            runState.error 红色 callout 与本 pill 不会同屏（前者依赖 runState.error，后者依赖 !runState.running 且无 runState.error）。 */}
        {!runState.running && !runState.error && isLastAgentMessageInterrupted(messages) && onRetryFromLastUser && (
          <InterruptBar
            onRetry={onRetryFromLastUser}
            retrying={sending}
          />
        )}
```

- [ ] **Step 4：TypeScript 编译检查**

Run: `cd frontend && npx tsc --noEmit`
Expected: 无错误

- [ ] **Step 5：Commit**

```bash
git add frontend/src/components/employee/agent/agent-message-list.tsx
git commit -m "feat(agent-fe): AgentMessageList 暴露中断判定 + 渲染 InterruptBar（bug 1）"
```

---

### Task 10：AgentWorkspace 提供重发回调

**Files:**
- Modify: `frontend/src/components/employee/agent/agent-workspace.tsx:75-127`

- [ ] **Step 1：新增 handleRetryFromLastUser 回调**

在文件中找到现有 80-83 行的 `handleRetry`：
```tsx
  // 重试 = 重新发送最近一条用户消息
  const handleRetry = useCallback(() => {
    if (lastInputRef.current) void sendMessage(lastInputRef.current);
  }, [sendMessage]);
```

在其下方追加：
```tsx
  // 中断重发（bug 1）：用 messages 数组里最后一条 user 消息内容重新发起。
  // 与 handleRetry 区别：handleRetry 用 lastInputRef（内存中的本次 send 入参），
  // 刷新后内存丢失但 messages 还有落库的 user 消息，所以中断重发必须从 messages 取。
  const handleRetryFromLastUser = useCallback(() => {
    // 倒序找最近一条 user 消息
    const lastUser = [...messages].reverse().find(m => m.role === 'user');
    if (!lastUser) return;
    const userText =
      (lastUser.content.blocks?.[0] as { type: 'text'; text: string } | undefined)?.text ?? '';
    if (!userText) return;
    handleSend({
      content: userText,
      workflow_type: lastUser.workflow_type,
      context_refs: lastUser.content.context_refs,
    });
  }, [messages, handleSend]);
```

- [ ] **Step 2：把 handleRetryFromLastUser 透传给 AgentMessageList**

找到 100-107 行的 `<AgentMessageList ... />`：
```tsx
      <AgentMessageList
        messages={messages}
        runState={runState}
        sending={sending}
        onSubmitInteraction={submit}
        onPickPrompt={(prompt, workflow) => setPrefill({ prompt, workflow })}
        onRetry={handleRetry}
      />
```

改为（追加 `onRetryFromLastUser`）：
```tsx
      <AgentMessageList
        messages={messages}
        runState={runState}
        sending={sending}
        onSubmitInteraction={submit}
        onPickPrompt={(prompt, workflow) => setPrefill({ prompt, workflow })}
        onRetry={handleRetry}
        onRetryFromLastUser={handleRetryFromLastUser}
      />
```

- [ ] **Step 3：TypeScript 编译检查**

Run: `cd frontend && npx tsc --noEmit`
Expected: 无错误

- [ ] **Step 4：运行所有 agent 相关测试**

Run: `cd frontend && npm run test -- agent`
Expected: all pass（含 grouping 与 step-templates）

- [ ] **Step 5：Commit（bug 1 完成）**

```bash
git add frontend/src/components/employee/agent/agent-workspace.tsx
git commit -m "feat(agent-fe): AgentWorkspace 提供 handleRetryFromLastUser 中断重发回调（bug 1）"
```

---

## 联调与验收

### Task 11：全量构建 + 测试 + 手动验证

- [ ] **Step 1：全量 build 检查**

Run: `cd frontend && npm run build`
Expected: build 成功（包含 tsc 检查 + vite 构建）

- [ ] **Step 2：全量测试**

Run: `cd frontend && npm run test`
Expected: 所有现有测试通过 + 新增 5 个 workflow-step-templates 测试通过

- [ ] **Step 3：（可选）手动联调清单**

启动后端与前端开发服务（项目已有 `scripts/local-dev.sh` 一键脚本）。在浏览器打开工作台，按以下场景验证：

| 场景 | 操作 | 预期 |
|---|---|---|
| **bug 4-A** | 发起新会话首条消息（简历问答） | StepStrip 显示 1/8 → 2/8 → … → 8/8（不再永远 1/1） |
| **bug 4-B** | 在维度选择卡上点"驳回重做" | 分母仍 8，活跃步骤标题切换、波浪重启 |
| **bug 4-C** | 切到简历评估 workflow | StepStrip 显示 X/8（resume_evaluation 也是 8 步） |
| **bug 3-A** | 点"新建会话" | 侧栏不出现该会话 |
| **bug 3-B** | 在新会话发首条消息 | 该会话立即出现在侧栏「今日」组顶部 |
| **bug 3-C** | 侧栏组头文字 | 显示「今日 / 本周 / 更早」 |
| **bug 1-A** | 流式中刷新页面 | 重新进入会话后，被截断 agent 消息底部出现橙色 pill「本次任务已中断 ↻」 |
| **bug 1-B** | 点 pill 上的 ↻ 按钮 | 按钮变 spinner，立即开始新一轮 run；run 完成后 pill 自然消失 |
| **bug 1-C** | interrupt 暂停态（看到选维度卡）刷新 | 仅显示 interaction 卡片，**无** pill |
| **bug 1-D** | 用户主动 abort interaction 后刷新 | 显示 expired 状态的 interaction，**无** pill |

- [ ] **Step 4：（可选）合入 dev 分支前的回归**

如有 CI/lint 检查（如 `npm run lint`），运行：
```bash
cd frontend && npm run lint 2>/dev/null || echo "（项目无 lint script，跳过）"
```

---

## 自检与提交摘要

至此，11 个 task 完成后产生 7 个 commit：

1. `feat(agent-fe): 新增 workflow 步骤模板常量与 merge 函数`（Task 1）
2. `test(agent-fe): workflow-step-templates 单测覆盖 5 个场景`（Task 2）
3. `feat(agent-fe): StepStrip 步数改为 N/M 模板驱动（bug 4）`（Task 3-4）
4. `feat(agent-fe): 侧栏分组标签改为 今日/本周/更早（bug 3）`（Task 5-6）
5. `fix(agent-fe): sendMessage 乐观写入 last_message_time，让新会话首条消息后置顶今日（bug 3）`（Task 7）
6. `feat(agent-fe): 新增 InterruptBar 中断提示条组件（bug 1）`（Task 8）
7. `feat(agent-fe): AgentMessageList 暴露中断判定 + 渲染 InterruptBar（bug 1）`（Task 9）
8. `feat(agent-fe): AgentWorkspace 提供 handleRetryFromLastUser 中断重发回调（bug 1）`（Task 10）

实际是 8 个 commit。每个 bug 独立可回退（spec §八）：

- bug 4 回退：reset commits #1-#3
- bug 3 回退：reset commits #4-#5
- bug 1 回退：reset commits #6-#8
