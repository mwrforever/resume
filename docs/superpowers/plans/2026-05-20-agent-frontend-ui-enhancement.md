# Agent Frontend UI 增强实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 修复三个前端问题：事件协议渲染、规划审批无法确认、系统提示词简陋

**Architecture:** 采用集中式 UI 事件总线架构，所有 SSE 事件通过 `agent-stream-handler.ts` 统一分发到对应组件。`lifecycle.*` 事件驱动 AgentStatusTimeline，`ui.render` 事件驱动交互组件（PlanReviewTree、RepairSuggestionsPanel），`tool.call_*` 事件驱动 ToolExecutionCard。

**Tech Stack:** React 19 + TypeScript + Tailwind CSS + Lucide React

---

## 文件结构

```
frontend/src/
├── utils/
│   ├── agent-stream-handler.ts    # 事件分发中心（修改）
│   └── agent-stream-v1.ts          # 组件类型解析（修改）
├── types/
│   └── agent.ts                    # 类型定义（修改）
└── components/employee/agent/
    ├── plan-review-tree.tsx        # 规划审批树（修改）
    ├── agent-message-list.tsx     # 消息列表（修改）
    ├── agent-status-timeline.tsx  # 节点状态时间线（新增）
    ├── tool-execution-card.tsx    # 工具执行卡片（新增）
    ├── repair-suggestions-panel.tsx # 修复建议面板（新增）
    └── thinking-renderer.tsx       # 思考内容渲染器（新增）

backend/app/llm/prompts/templates/
└── agent_system_prompt.yaml       # 系统提示词（修改）
backend/app/llm/graphs/nodes/
└── planner.py                     # 规划节点（修改）
```

---

## Task 1: 扩展 agent-stream-handler.ts 事件分发中心

**Files:**
- Modify: `frontend/src/utils/agent-stream-handler.ts:35-97`
- Modify: `frontend/src/utils/agent-stream-v1.ts:21-28`
- Modify: `frontend/src/types/agent.ts:46`

**Context:** 当前只处理 `ui.render` 的 PlanReviewTree 和 PlanRepairHints，需要扩展支持更多事件类型。

**Steps:**

- [ ] **Step 1: 修改 agent-stream-v1.ts - 扩展 TUiComponentKey 类型**

```typescript
// frontend/src/utils/agent-stream-v1.ts 第 21-28 行
// 找到并替换
export type TUiComponentKey =
  | 'PlanReviewTree'
  | 'PlanRepairHints'
  | 'ActionConfirmCard'
  | 'AgentStatusTimeline'
  | 'ToolExecutionCard'
  | 'ThinkingRenderer'
  | 'RepairSuggestionsPanel';
```

- [ ] **Step 2: 修改 agent-stream-handler.ts - 添加 lifecycle 事件处理**

在 `handleAgentV1Event` 函数中添加：

```typescript
// agent-stream-handler.ts 第 43-97 行之间
// 在 handleAgentV1Event 函数中添加 lifecycle 事件处理

if (eventType === 'lifecycle.node_enter') {
  const nodeId = String(payload.node_id || '');
  deps.setRuntimeFeedItems((prev) => {
    const existing = prev.find((item) => item.id === `node-${nodeId}`);
    if (existing) return prev;
    return [...prev, {
      id: `node-${nodeId}`,
      type: 'node' as const,
      status: 'running' as const,
      title: getNodeDisplayName(nodeId),
      message: null,
    }];
  });
  return;
}

if (eventType === 'lifecycle.node_exit') {
  const nodeId = String(payload.node_id || '');
  const success = payload.error ? false : true;
  deps.setRuntimeFeedItems((prev) =>
    prev.map((item) =>
      item.id === `node-${nodeId}`
        ? { ...item, status: success ? 'success' : 'failed' as const }
        : item
    )
  );
  return;
}
```

- [ ] **Step 3: 添加辅助函数 getNodeDisplayName**

```typescript
// agent-stream-handler.ts 添加辅助函数
function getNodeDisplayName(nodeId: string): string {
  const nameMap: Record<string, string> = {
    'analyst': '理解分析',
    'planner': '规划生成',
    'supervisor': '任务调度',
    'legacy_executor': '执行任务',
    'reporter': '结果汇报',
    'resume_prepare': '简历预处理',
    'resume_extract': '简历提取',
    'resume_markdown': '简历转换',
  };
  return nameMap[nodeId] || nodeId;
}
```

- [ ] **Step 4: 添加 tool.call_* 事件处理**

```typescript
// 在 handleAgentV1Event 中添加

if (eventType === 'tool.call_start') {
  const toolName = String(payload.tool_name || '未知工具');
  const callId = String(payload.call_id || `tool-${Date.now()}`);
  deps.setToolEvents((prev) => [
    ...prev,
    {
      id: callId,
      type: 'call' as const,
      tool_name: toolName,
      display_name: payload.display_name as string || toolName,
      payload: (payload.input_payload as Record<string, unknown>) || {},
    },
  ]);
  deps.setRuntimeFeedItems((prev) => [
    ...prev,
    { id: callId, type: 'tool' as const, status: 'running' as const, title: toolName },
  ]);
  return;
}

if (eventType === 'tool.call_end') {
  const callId = String(payload.call_id || '');
  const success = Boolean(payload.success);
  deps.setToolEvents((prev) =>
    prev.map((item) =>
      item.id === callId
        ? {
            ...item,
            success,
            error_message: payload.error_message as string || null,
            payload: (payload.output_payload as Record<string, unknown>) || {},
          }
        : item
    )
  );
  deps.setRuntimeFeedItems((prev) =>
    prev.map((item) =>
      item.id === callId
        ? { ...item, status: success ? 'success' : 'failed' as const }
        : item
    )
  );
  return;
}
```

- [ ] **Step 5: 添加修复建议面板事件处理**

```typescript
// 在 handleAgentV1Event 中添加

if (eventType === 'plan.repair_suggestions') {
  const suggestions = parseRepairSuggestions(payload);
  if (suggestions.length === 0) return;
  deps.setPlanReview((prev) => (prev ? {
    ...prev,
    repairSuggestions: [...prev.repairSuggestions, ...suggestions],
    editable: true,
  } : null));
  return;
}
```

- [ ] **Step 6: 修复 phase 重置逻辑**

```typescript
// 在 handleAgentV1Event 中添加

if (eventType === 'lifecycle.resume_ack' || eventType === 'stream.text_done') {
  deps.setPlanReview((prev) => prev ? { ...prev, phase: 'pending' } : prev);
  return;
}

if (eventType === 'lifecycle.run_finished' || eventType === 'lifecycle.run_failed') {
  deps.setPlanReview((prev) => prev ? { ...prev, phase: 'pending' } : prev);
  return;
}
```

- [ ] **Step 7: 修改 types/agent.ts 添加新类型**

```typescript
// frontend/src/types/agent.ts
// 在 IAgentRuntimeFeedItem 中添加 'node' 类型

export interface IAgentRuntimeFeedItem {
  id: string;
  type: 'thinking' | 'tool' | 'action' | 'node';
  status: 'running' | 'success' | 'failed' | 'pending';
  title: string;
  message?: string | null;
  action?: IAgentActionStreamItem;
}
```

- [ ] **Step 8: 提交**

```bash
git add frontend/src/utils/agent-stream-handler.ts frontend/src/utils/agent-stream-v1.ts frontend/src/types/agent.ts
git commit -m "feat(agent): 扩展事件分发中心支持 lifecycle 和 tool.call 事件"
```

---

## Task 2: 修复 PlanReviewTree phase 重置逻辑

**Files:**
- Modify: `frontend/src/components/employee/agent/plan-review-tree.tsx`

**Context:** `submitting` 状态后没有重置，导致所有输入框和按钮永久 disabled。

**Steps:**

- [ ] **Step 1: 检查当前 phase 使用方式**

查看 plan-review-tree.tsx 第 47、80、105 行确认 `submitting` 的使用。

- [ ] **Step 2: 确认组件已接收 submitting prop**

当前组件接收 `submitting` prop：`submitting={planReview.phase === 'submitting' || sending}`

这意味着只要父组件正确传递 phase，组件本身不需要修改。

- [ ] **Step 3: 验证 agent.tsx 中的 phase 管理**

查看 agent.tsx 第 263-289 行的 `resumePlanReview` 函数，确认：
1. 点击批准时设置 `phase: 'submitting'`
2. 成功后或失败后 phase 都保持或重置

问题在于 `streamResume` 完成后没有重置 phase。Task 1 已修复此问题。

- [ ] **Step 4: 提交**

```bash
git add frontend/src/components/employee/agent/plan-review-tree.tsx
git commit -m "fix(agent): 确认 PlanReviewTree phase 管理正确（通过 Task1 修复）"
```

---

## Task 3: 创建 AgentStatusTimeline 组件

**Files:**
- Create: `frontend/src/components/employee/agent/agent-status-timeline.tsx`
- Modify: `frontend/src/components/employee/agent/agent-message-list.tsx:60-76`

**Context:** 显示 Agent 节点（analyst/planner/supervisor/executor/reporter）的执行状态时间线。

**Steps:**

- [ ] **Step 1: 创建 AgentStatusTimeline 组件**

```typescript
// frontend/src/components/employee/agent/agent-status-timeline.tsx
import { CheckCircle2, Loader2, Circle } from 'lucide-react';

interface AgentStatusTimelineProps {
  activeNodes: Array<{ id: string; status: 'running' | 'success' | 'failed' | 'pending'; title: string }>;
}

const NODE_ORDER = ['analyst', 'planner', 'supervisor', 'legacy_executor', 'reporter'];
const NODE_LABELS: Record<string, string> = {
  analyst: '理解分析',
  planner: '规划生成',
  supervisor: '任务调度',
  legacy_executor: '执行任务',
  reporter: '结果汇报',
};

export function AgentStatusTimeline({ activeNodes }: AgentStatusTimelineProps) {
  return (
    <div className="ml-0 max-w-3xl rounded-3xl border border-sky-200 bg-sky-50/80 p-4 text-sm shadow-sm shadow-sky-100/70 md:ml-12">
      <div className="mb-3 flex items-center gap-2 font-semibold text-slate-950">
        <Loader2 size={15} className="animate-spin text-sky-600" aria-hidden="true" />
        Agent 执行进度
      </div>
      <div className="flex items-center justify-between">
        {NODE_ORDER.map((nodeId, index) => {
          const node = activeNodes.find((n) => n.id === `node-${nodeId}`);
          const status = node?.status || 'pending';
          const title = NODE_LABELS[nodeId] || nodeId;

          return (
            <div key={nodeId} className="flex flex-col items-center">
              <div
                className={`flex h-10 w-10 items-center justify-center rounded-full border-2 ${
                  status === 'success'
                    ? 'border-emerald-500 bg-emerald-50'
                    : status === 'running'
                    ? 'border-sky-500 bg-sky-50'
                    : status === 'failed'
                    ? 'border-red-500 bg-red-50'
                    : 'border-slate-300 bg-slate-50'
                }`}
              >
                {status === 'success' && <CheckCircle2 size={20} className="text-emerald-600" aria-hidden="true" />}
                {status === 'running' && <Loader2 size={18} className="animate-spin text-sky-600" aria-hidden="true" />}
                {status === 'failed' && <Circle size={18} className="text-red-600 fill-red-100" aria-hidden="true" />}
                {status === 'pending' && <Circle size={18} className="text-slate-400" aria-hidden="true" />}
              </div>
              <span className="mt-2 text-xs text-slate-600">{title}</span>
              {index < NODE_ORDER.length - 1 && (
                <div
                  className={`absolute h-0.5 w-8 ${
                    status === 'success' ? 'bg-emerald-400' : 'bg-slate-200'
                  }`}
                  style={{ left: `${index * 20 + 15}%` }}
                  aria-hidden="true"
                />
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
```

- [ ] **Step 2: 修改 agent-message-list.tsx 集成 AgentStatusTimeline**

在 RuntimeFeedRow 组件之前添加 AgentStatusTimeline：

```typescript
// agent-message-list.tsx
// 在文件顶部 import 后，export function 之前添加

function AgentStatusTimelineRenderer({
  runtimeFeedItems,
}: {
  runtimeFeedItems: IAgentRuntimeFeedItem[];
}) {
  const nodeItems = runtimeFeedItems.filter((item) => item.type === 'node');
  if (nodeItems.length === 0) return null;
  return <AgentStatusTimeline activeNodes={nodeItems} />;
}

// 在 export function 内，找到 insertRuntimeFeedAfterIndex 处（约第 76 行）
// 在 runtimeFeedItems.map 之前添加：
{
  nodeItems.length > 0 && (
    <AgentStatusTimelineRenderer runtimeFeedItems={runtimeFeedItems} />
  )
}
```

- [ ] **Step 3: 提交**

```bash
git add frontend/src/components/employee/agent/agent-status-timeline.tsx frontend/src/components/employee/agent/agent-message-list.tsx
git commit -m "feat(agent): 添加 AgentStatusTimeline 组件显示节点执行状态"
```

---

## Task 4: 创建 ToolExecutionCard 组件

**Files:**
- Create: `frontend/src/components/employee/agent/tool-execution-card.tsx`
- Modify: `frontend/src/components/employee/agent/agent-message-list.tsx:25-58`

**Context:** 显示工具执行状态的卡片组件，支持 running/success/failed 三种动画状态。

**Steps:**

- [ ] **Step 1: 创建 ToolExecutionCard 组件**

```typescript
// frontend/src/components/employee/agent/tool-execution-card.tsx
import { Loader2, CheckCircle2, XCircle, Wrench } from 'lucide-react';
import type { IAgentToolStreamItem } from '@/types/agent';

interface ToolExecutionCardProps {
  tool: IAgentToolStreamItem;
}

export function ToolExecutionCard({ tool }: ToolExecutionCardProps) {
  const isRunning = tool.type === 'call';
  const isSuccess = tool.success === true;
  const isFailed = tool.success === false;

  return (
    <div
      className={`ml-0 max-w-3xl rounded-2xl border p-3 text-sm shadow-sm md:ml-12 transition-all duration-200 ${
        isRunning
          ? 'border-sky-200 bg-sky-50/80'
          : isSuccess
          ? 'border-emerald-200 bg-emerald-50/80'
          : isFailed
          ? 'border-red-200 bg-red-50/80'
          : 'border-slate-200 bg-white'
      }`}
      data-tool-card={tool.tool_name}
    >
      <div className="flex items-start gap-3">
        {/* 状态图标 */}
        <div
          className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-xl ${
            isRunning
              ? 'bg-sky-100 text-sky-600'
              : isSuccess
              ? 'bg-emerald-100 text-emerald-600'
              : isFailed
              ? 'bg-red-100 text-red-600'
              : 'bg-slate-100 text-slate-600'
          }`}
        >
          {isRunning && <Loader2 size={16} className="animate-spin" aria-hidden="true" />}
          {isSuccess && <CheckCircle2 size={16} aria-hidden="true" />}
          {isFailed && <XCircle size={16} aria-hidden="true" />}
          {!isRunning && !isSuccess && !isFailed && <Wrench size={16} aria-hidden="true" />}
        </div>

        {/* 工具名称和状态 */}
        <div className="min-w-0 flex-1">
          <div className="flex items-center justify-between">
            <span className="font-medium text-slate-900 truncate">{tool.display_name}</span>
            <span
              className={`ml-2 shrink-0 text-xs ${
                isRunning
                  ? 'text-sky-600'
                  : isSuccess
                  ? 'text-emerald-600'
                  : isFailed
                  ? 'text-red-600'
                  : 'text-slate-500'
              }`}
            >
              {isRunning ? '执行中...' : isSuccess ? '执行成功' : isFailed ? '执行失败' : '等待中'}
            </span>
          </div>

          {/* 输入参数 */}
          {tool.payload && Object.keys(tool.payload).length > 0 && (
            <div className="mt-1.5 text-xs text-slate-500">
              <span className="font-medium">输入：</span>
              <code className="ml-1 rounded bg-slate-100 px-1 py-0.5">
                {JSON.stringify(tool.payload).slice(0, 100)}
                {JSON.stringify(tool.payload).length > 100 ? '...' : ''}
              </code>
            </div>
          )}

          {/* 错误信息 */}
          {isFailed && tool.error_message && (
            <div className="mt-1.5 text-xs text-red-600">
              <span className="font-medium">错误：</span>
              {tool.error_message}
            </div>
          )}

          {/* 脉冲动画（执行中） */}
          {isRunning && (
            <div className="mt-2 flex items-center gap-1">
              <span className="h-1.5 w-1.5 rounded-full bg-sky-400 animate-pulse" />
              <span className="h-1.5 w-1.5 rounded-full bg-sky-400 animate-pulse" style={{ animationDelay: '150ms' }} />
              <span className="h-1.5 w-1.5 rounded-full bg-sky-400 animate-pulse" style={{ animationDelay: '300ms' }} />
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: 修改 agent-message-list.tsx 中的 RuntimeFeedRow**

将 RuntimeFeedRow 中的 tool 类型处理替换为使用 ToolExecutionCard：

```typescript
// agent-message-list.tsx 第 25-58 行
// 找到 RuntimeFeedRow 函数，修改 tool 类型处理

function RuntimeFeedRow({
  item,
  onConfirmAction,
  onRejectAction,
  toolEvents,
}: {
  item: IAgentRuntimeFeedItem;
  onConfirmAction: (action: IAgentActionStreamItem) => void;
  onRejectAction: (action: IAgentActionStreamItem) => void;
  toolEvents: IAgentToolStreamItem[];
}) {
  if (item.type === 'action' && item.action) {
    return <AgentActionCard action={item.action} onConfirm={onConfirmAction} onReject={onRejectAction} />;
  }

  // Tool 类型使用 ToolExecutionCard
  if (item.type === 'tool') {
    const tool = toolEvents.find((t) => t.id === item.id);
    if (tool) {
      return <ToolExecutionCard tool={tool} />;
    }
  }

  // 原有 node/thinking 处理保持不变
  const isRunning = item.status === 'running';
  const isFailed = item.status === 'failed';
  return (
    <div className="ml-0 flex max-w-3xl items-center gap-3 rounded-3xl border border-sky-100 bg-sky-50/80 px-4 py-3 text-sm text-slate-700 shadow-sm shadow-sky-100/70 md:ml-12">
      {/* ... 保持原有代码 ... */}
    </div>
  );
}
```

- [ ] **Step 3: 更新组件 props 传递**

在 agent-message-list.tsx 的 RuntimeFeedRow 调用处传递 toolEvents：

```typescript
// agent-message-list.tsx 约第 121 行
// 找到 runtimeFeedItems.map((item) => ...)
{index === insertRuntimeFeedAfterIndex &&
  runtimeFeedItems.map((item) => (
    <RuntimeFeedRow
      key={item.id}
      item={item}
      onConfirmAction={onConfirmAction}
      onRejectAction={onRejectAction}
      toolEvents={runtimeFeedItems}
    />
  ))}
```

- [ ] **Step 4: 提交**

```bash
git add frontend/src/components/employee/agent/tool-execution-card.tsx frontend/src/components/employee/agent/agent-message-list.tsx
git commit -m "feat(agent): 添加 ToolExecutionCard 组件显示工具执行状态"
```

---

## Task 5: 创建 RepairSuggestionsPanel 组件（支持单选/多选/自定义）

**Files:**
- Create: `frontend/src/components/employee/agent/repair-suggestions-panel.tsx`
- Modify: `frontend/src/components/employee/agent/plan-review-tree.tsx`
- Modify: `frontend/src/types/agent.ts`

**Context:** 当前 plan-review-tree.tsx 只有 PlanRepairHints（只读建议展示），需要增加支持单选/多选的自定义交互面板。

**Steps:**

- [ ] **Step 1: 修改 types/agent.ts 添加 IRepairSuggestion 类型**

```typescript
// frontend/src/types/agent.ts
// 在 IPlanReviewUiState 附近添加

export interface IRepairSuggestion {
  id: string;
  text: string;
  selected: boolean;
}

export interface IRepairSuggestionsPanelProps {
  suggestions: string[];
  selectionMode: 'single' | 'multiple';
  customInputFirst: boolean;
  customInput: string;
  onSuggestionToggle: (index: number) => void;
  onCustomInputChange: (value: string) => void;
  onSubmit: (selectedSuggestions: string[], customInput: string) => void;
  submitting: boolean;
}
```

- [ ] **Step 2: 创建 RepairSuggestionsPanel 组件**

```typescript
// frontend/src/components/employee/agent/repair-suggestions-panel.tsx
import { useState } from 'react';
import { Lightbulb, Loader2, ChevronRight } from 'lucide-react';
import { Button } from '@/components/ui/button';
import type { IRepairSuggestionsPanelProps } from '@/types/agent';

export function RepairSuggestionsPanel({
  suggestions,
  selectionMode,
  customInputFirst,
  customInput,
  onSuggestionToggle,
  onCustomInputChange,
  onSubmit,
  submitting,
}: IRepairSuggestionsPanelProps) {
  const [localCustomInput, setLocalCustomInput] = useState(customInput);
  const selectedIndices: number[] = [];

  const handleCustomInputChange = (value: string) => {
    setLocalCustomInput(value);
    onCustomInputChange(value);
  };

  const handleSubmit = () => {
    // 优先使用自定义输入
    if (localCustomInput.trim()) {
      onSubmit([], localCustomInput.trim());
    } else {
      // 否则使用选中的建议
      const selected = suggestions.filter((_, i) => selectedIndices.includes(i));
      onSubmit(selected, '');
    }
  };

  const isDisabled = submitting || (!localCustomInput.trim() && selectedIndices.length === 0);

  return (
    <div className="ml-0 max-w-3xl rounded-3xl border border-amber-200 bg-amber-50/80 p-4 text-sm shadow-sm shadow-amber-100/70 md:ml-12">
      <div className="mb-3 flex items-center gap-2 font-semibold text-slate-950">
        <Lightbulb size={15} className="text-amber-600" aria-hidden="true" />
        规划调整建议
      </div>

      {/* 建议选项列表 */}
      {suggestions.length > 0 && (
        <div className="space-y-2">
          {suggestions.map((suggestion, index) => {
            const isSelected = selectedIndices.includes(index);
            return (
              <label
                key={index}
                className={`flex cursor-pointer items-center gap-3 rounded-xl border p-3 transition-all duration-150 ${
                  isSelected
                    ? 'border-amber-400 bg-amber-100/50'
                    : 'border-amber-200 bg-white/80 hover:border-amber-300'
                } ${submitting ? 'opacity-50 cursor-not-allowed' : ''}`}
              >
                {selectionMode === 'single' ? (
                  <input
                    type="radio"
                    name="repair-suggestion"
                    checked={isSelected}
                    onChange={() => !submitting && onSuggestionToggle(index)}
                    className="h-4 w-4 text-amber-600 accent-amber-600"
                    disabled={submitting}
                  />
                ) : (
                  <input
                    type="checkbox"
                    checked={isSelected}
                    onChange={() => !submitting && onSuggestionToggle(index)}
                    className="h-4 w-4 rounded border-amber-400 text-amber-600 accent-amber-600"
                    disabled={submitting}
                  />
                )}
                <span className="flex-1 text-slate-700">{suggestion}</span>
                {isSelected && (
                  <ChevronRight size={14} className="text-amber-600" aria-hidden="true" />
                )}
              </label>
            );
          })}
        </div>
      )}

      {/* 自定义输入分隔线 */}
      <div className="my-4 flex items-center gap-3">
        <div className="h-px flex-1 border-t border-amber-200" />
        <span className="text-xs text-slate-500">或者输入你的想法</span>
        <div className="h-px flex-1 border-t border-amber-200" />
      </div>

      {/* 自定义输入框 */}
      <textarea
        className="w-full resize-y rounded-xl border border-amber-200 bg-white px-3 py-2 text-sm text-slate-700 focus:border-amber-400 focus:outline-none focus:ring-2 focus:ring-amber-200 disabled:bg-slate-50"
        rows={3}
        placeholder="请说明需要调整的方向，例如缺少岗位维度分析..."
        value={localCustomInput}
        onChange={(e) => handleCustomInputChange(e.target.value)}
        disabled={submitting}
        aria-label="自定义调整意见"
      />

      {/* 提交按钮 */}
      <div className="mt-4 flex flex-wrap justify-end gap-2">
        <Button
          type="button"
          size="sm"
          variant="outline"
          disabled={isDisabled}
          onClick={() => onSubmit([], localCustomInput.trim())}
        >
          {submitting ? <Loader2 size={14} className="animate-spin" aria-hidden="true" /> : null}
          重新规划
        </Button>
        <Button
          type="button"
          size="sm"
          disabled={isDisabled}
          onClick={handleSubmit}
        >
          {submitting ? <Loader2 size={14} className="animate-spin" aria-hidden="true" /> : null}
          确认并批准
        </Button>
      </div>
    </div>
  );
}
```

- [ ] **Step 3: 修改 plan-review-tree.tsx 集成 RepairSuggestionsPanel**

将现有的 PlanRepairHints 替换为 RepairSuggestionsPanel：

```typescript
// plan-review-tree.tsx
// 约第 94 行，将 <PlanRepairHints suggestions={repairSuggestions} /> 替换为：

{repairSuggestions.length > 0 && (
  <RepairSuggestionsPanel
    suggestions={repairSuggestions}
    selectionMode="single"
    customInputFirst={true}
    customInput={feedbackDraft}
    onSuggestionToggle={(index) => {
      // 单选模式：取消其他选择，只保留当前
      setPlanReview((prev) =>
        prev
          ? {
              ...prev,
              feedbackDraft: prev.repairSuggestions[index] || '',
            }
          : prev
      );
    }}
    onCustomInputChange={onFeedbackChange}
    onSubmit={(suggestions, customInput) => {
      // 提交逻辑由父组件处理
      if (customInput) {
        onFeedbackChange(customInput);
      } else if (suggestions.length > 0) {
        onFeedbackChange(suggestions.join('; '));
      }
    }}
    submitting={submitting}
  />
)}
```

- [ ] **Step 4: 提交**

```bash
git add frontend/src/components/employee/agent/repair-suggestions-panel.tsx frontend/src/components/employee/agent/plan-review-tree.tsx frontend/src/types/agent.ts
git commit -m "feat(agent): 添加 RepairSuggestionsPanel 支持单选/多选/自定义输入"
```

---

## Task 6: 创建 ThinkingRenderer 组件

**Files:**
- Create: `frontend/src/components/employee/agent/thinking-renderer.tsx`
- Modify: `frontend/src/components/employee/agent/agent-message-list.tsx`

**Context:** 显示 Agent 思考过程的内容渲染器，带有脉冲动画效果。

**Steps:**

- [ ] **Step 1: 创建 ThinkingRenderer 组件**

```typescript
// frontend/src/components/employee/agent/thinking-renderer.tsx
import { Brain, Loader2 } from 'lucide-react';
import { AgentMarkdownContent } from './agent-markdown-content';

interface ThinkingRendererProps {
  content: string;
  status: 'running' | 'success' | 'failed';
}

export function ThinkingRenderer({ content, status }: ThinkingRendererProps) {
  return (
    <div
      className={`ml-0 max-w-3xl rounded-2xl border p-4 text-sm shadow-sm md:ml-12 transition-all duration-200 ${
        status === 'running'
          ? 'border-violet-200 bg-violet-50/80'
          : status === 'success'
          ? 'border-emerald-200 bg-emerald-50/80'
          : 'border-red-200 bg-red-50/80'
      }`}
    >
      <div className="mb-2 flex items-center gap-2 font-medium text-slate-700">
        <Brain size={15} className="text-violet-600" aria-hidden="true" />
        <span>Agent 思考中</span>
        {status === 'running' && (
          <Loader2 size={14} className="animate-spin text-violet-600 ml-auto" aria-hidden="true" />
        )}
      </div>

      {/* 思考内容 */}
      {content ? (
        <div className="mt-2 text-xs text-slate-600 leading-relaxed">
          <AgentMarkdownContent content={content} />
        </div>
      ) : (
        <div className="mt-2 flex items-center gap-1">
          <span className="h-1.5 w-1.5 rounded-full bg-violet-400 animate-pulse" />
          <span className="h-1.5 w-1.5 rounded-full bg-violet-400 animate-pulse" style={{ animationDelay: '150ms' }} />
          <span className="h-1.5 w-1.5 rounded-full bg-violet-400 animate-pulse" style={{ animationDelay: '300ms' }} />
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 2: 修改 agent-message-list.tsx 中的 RuntimeFeedRow 处理 thinking 类型**

```typescript
// agent-message-list.tsx 第 25-58 行 RuntimeFeedRow 函数
// 添加 thinking 类型处理

if (item.type === 'thinking') {
  return <ThinkingRenderer content="" status={item.status} />;
}
```

- [ ] **Step 3: 提交**

```bash
git add frontend/src/components/employee/agent/thinking-renderer.tsx frontend/src/components/employee/agent/agent-message-list.tsx
git commit -m "feat(agent): 添加 ThinkingRenderer 组件显示思考过程"
```

---

## Task 7: 增强 agent_system_prompt.yaml

**Files:**
- Modify: `backend/app/llm/prompts/templates/agent_system_prompt.yaml`

**Context:** 当前 system prompt 过于简陋，需要增加角色定义、能力范围、人工确认规则等。

**Steps:**

- [ ] **Step 1: 读取当前 system prompt 内容**

```bash
cat backend/app/llm/prompts/templates/agent_system_prompt.yaml
```

- [ ] **Step 2: 替换为增强版本**

```yaml
name: agent_system_prompt
template: |-
  # 角色定义
  你是一名专业的 HR 招聘助手，拥有丰富的招聘经验和候选人评估能力。你的目标是帮助企业高效地完成招聘流程，提升候选人体验和招聘质量。

  # 核心能力
  - 候选人分析与评估：分析候选人的简历、技能、经验与岗位的匹配度
  - 岗位匹配度分析：比较候选人与岗位要求，识别优势和差距
  - 面试建议生成：根据候选人特点生成针对性的面试问题和建议
  - 招聘流程优化：提供招聘状态更新、流程推进建议

  # 必须收集的信息（在生成执行规划前必须确认）
  在生成规划前，你必须已收集以下信息：
  1. 用户意图：用户想要完成什么任务或解决什么问题
  2. 岗位信息：如果任务涉及候选人分析，必须知道岗位 ID 或名称
  3. 候选人信息：如果任务涉及特定候选人，必须知道候选人 ID 或简历
  4. 评估维度：如果任务涉及评估，必须明确评估的维度和标准

  # 人工确认规则
  - 执行任何具有副作用的操作（如发送消息、修改候选人状态、生成评估报告）前必须等待用户确认
  - 规划审批：任何涉及多个子任务的执行计划，必须经过用户批准后才能执行
  - 重要决策：涉及候选人命运的决策（如录用、拒绝）需要用户提供明确的反馈
  - 不可跳过：禁止绕过人工确认流程直接执行

  # 禁止行为
  - 禁止编造：禁止编造不存在的信息、数据或候选人资料
  - 禁止绕过：禁止在未获得用户确认前执行不可逆操作
  - 禁止假设：禁止假设用户意图或遗漏必要信息，遇到不清时必须先询问
  - 禁止越权：禁止代替用户做出最终决策

  # 对话风格
  - 专业：使用 HR 领域的专业术语和表达方式
  - 简洁：回复简洁明了，避免冗长
  - 主动：当信息不足时，主动询问用户以获取必要信息
  - 透明：明确告知用户每个操作的目的和可能的影响
```

- [ ] **Step 3: 提交**

```bash
git add backend/app/llm/prompts/templates/agent_system_prompt.yaml
git commit -m "feat(agent): 增强 system prompt 添加角色定义和能力范围"
```

---

## Task 8: 添加规划前置检查逻辑

**Files:**
- Modify: `backend/app/llm/graphs/nodes/planner.py`

**Context:** 确保在 LLM 生成规划前，已收集足够的信息（用户意图、岗位信息等）。

**Steps:**

- [ ] **Step 1: 读取当前 planner.py 内容**

```bash
cat backend/app/llm/graphs/nodes/planner.py | head -100
```

- [ ] **Step 2: 修改 _llm_plan_draft 函数，添加前置检查**

在 `_llm_plan_draft` 函数中，生成规划前先检查 state 中是否包含必要信息：

```python
// 在 _llm_plan_draft 函数开头（约第 265 行）
// 在生成规划草案之前添加检查逻辑

async def _llm_plan_draft(state: OrchestratorState, model_router: LLMModelRouter) -> list[SubTaskDTO]:
    """调用 LLM 生成结构化子任务列表。"""

    // 检查必要的上下文信息
    if not state.user_input:
        logger.warning("user_input 为空，无法生成规划")
        return [
            SubTaskDTO(
                task_id="clarify_intent",
                domain=AgentDomain.GENERIC,
                title="确认用户意图",
                instruction="请询问用户想要完成什么任务",
            )
        ]

    // 检查是否包含岗位相关信息（根据任务类型判断）
    // 如果分析类任务没有提供足够的上下文，先返回需要更多信息的任务
    has_sufficient_context = _check_context_sufficiency(state)

    if not has_sufficient_context:
        logger.info("上下文信息不足，需要先收集信息：session_key=%s", state.session_key)
        return [
            SubTaskDTO(
                task_id="collect_context",
                domain=AgentDomain.GENERIC,
                title="收集必要信息",
                instruction=f"当前任务：{state.user_input}。需要先确认：1) 涉及的岗位是什么？2) 需要分析哪位候选人？请询问用户补充这些信息。",
            )
        ]

    // ... 原有逻辑继续 ...
```

- [ ] **Step 3: 添加辅助函数 _check_context_sufficiency**

```python
def _check_context_sufficiency(state: OrchestratorState) -> bool:
    """检查是否收集了足够的上下文信息用于生成规划。"""

    // 如果有 resume_attachment（简历），认为上下文足够
    if state.has_resume_attachment:
        return True

    // 如果 analysis_summary 不为空，认为已经完成了分析阶段
    if state.analysis_summary and len(state.analysis_summary) > 10:
        return True

    // 如果 user_input 包含明确的关键词（如"分析"、"评估"），且不是太短
    if len(state.user_input) > 10:
        keywords = ["分析", "评估", "总结", "推荐", "匹配"]
        if any(kw in state.user_input for kw in keywords):
            return True

    return False
```

- [ ] **Step 4: 提交**

```bash
git add backend/app/llm/graphs/nodes/planner.py
git commit -m "feat(agent): 添加规划前置检查逻辑，信息不足时先收集上下文"
```

---

## Task 9: 集成测试与验证

**Files:**
- Modify: `frontend/src/__tests__/employee/agent-workspace.test.tsx` (如果存在)
- Create: `frontend/src/__tests__/employee/agent-stream-handler.test.ts`

**Context:** 验证所有修改正确工作。

**Steps:**

- [ ] **Step 1: 运行现有测试确保没有回归**

```bash
cd frontend && npm test -- --testPathPattern="agent" --passWithNoTests 2>&1 | head -50
```

- [ ] **Step 2: 创建基础测试**

```typescript
// frontend/src/__tests__/employee/agent-stream-handler.test.ts
import { describe, it, expect } from 'vitest';
import { parseAgentStreamEnvelopeV1, getUiComponentKey, parsePlanReviewTreeData } from '@/utils/agent-stream-v1';

describe('agent-stream-v1', () => {
  describe('parseAgentStreamEnvelopeV1', () => {
    it('should parse valid v1 envelope', () => {
      const data = {
        protocol_version: '1.0',
        seq: 1,
        event_type: 'lifecycle.node_enter',
        payload: { node_id: 'analyst' },
      };
      const result = parseAgentStreamEnvelopeV1(data);
      expect(result).not.toBeNull();
      expect(result?.event_type).toBe('lifecycle.node_enter');
    });

    it('should return null for invalid version', () => {
      const data = { protocol_version: '2.0', seq: 1, event_type: 'test', payload: {} };
      const result = parseAgentStreamEnvelopeV1(data);
      expect(result).toBeNull();
    });
  });

  describe('getUiComponentKey', () => {
    it('should return PlanReviewTree for PlanReviewTree key', () => {
      const result = getUiComponentKey({ component_key: 'PlanReviewTree' });
      expect(result).toBe('PlanReviewTree');
    });

    it('should return null for unknown key', () => {
      const result = getUiComponentKey({ component_key: 'Unknown' });
      expect(result).toBeNull();
    });
  });
});
```

- [ ] **Step 3: 运行测试**

```bash
cd frontend && npm test -- --testPathPattern="agent-stream-handler" 2>&1 | head -30
```

- [ ] **Step 4: 提交**

```bash
git add frontend/src/__tests__/employee/agent-stream-handler.test.ts
git commit -m "test(agent): 添加 agent-stream-handler 单元测试"
```

---

## 验收检查清单

- [ ] Task 1: 事件分发中心支持 lifecycle.* 和 tool.call_* 事件
- [ ] Task 2: PlanReviewTree phase 在 streamResume 完成后正确重置
- [ ] Task 3: AgentStatusTimeline 显示节点执行状态
- [ ] Task 4: ToolExecutionCard 显示工具执行状态（running/success/failed）
- [ ] Task 5: RepairSuggestionsPanel 支持单选/多选/自定义输入
- [ ] Task 6: ThinkingRenderer 显示思考过程
- [ ] Task 7: System prompt 包含完整角色定义和能力范围
- [ ] Task 8: 规划前置检查逻辑，信息不足时先收集
- [ ] Task 9: 所有测试通过

---

**Plan complete and saved to `docs/superpowers/plans/2026-05-20-agent-frontend-ui-enhancement.md`**

## 执行选项

**1. Subagent-Driven (recommended)** - 每个 Task 由独立 subagent 执行，任务间有检查点回顾

**2. Inline Execution** - 在当前 session 中顺序执行，批量处理后进行检查

**选择哪种执行方式？**