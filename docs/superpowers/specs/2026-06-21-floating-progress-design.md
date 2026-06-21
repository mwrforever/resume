# 悬浮进度条重设计 + 进度 Bug 修复 设计文档

- 日期：2026-06-21
- 范围：前端 Agent 工作台「流程进度」展示层
- 工作分支：`worktree-floating-progress`

---

## 一、背景与目标

当前右侧常驻第三栏 `ProgressTracker`（304/60px 可收起侧栏）存在三个显示 bug，且交互形态（侧边抽屉）不符合期望。本次：

1. **修复 3 个进度 bug**（改动落在 store/reducer/模板等共享逻辑，逻辑先行）。
2. **将第三栏整体替换为右上角「悬浮岛」**（方案 A，已审批）：默认收起、只显示当前节点；点击向下展开玻璃面板看节点详情；默认 5 个节点 + 「加载更多」；最大高度限定单视窗内，超出滚动。
3. **统一精小滚动条**：主会话区与悬浮面板均用 `.thin-scroll`。

非目标：不改后端 graph 编排、不改 SSE 协议、不动 `step_labels.py` 节点定义。

---

## 二、三个 Bug 的根因与修复策略

### Bug 1 — 结果返回时进度"消失"，后台继续才恢复

**根因**（`agent-workspace.tsx:121`）：
```ts
const progressSteps = runState.running ? runState.steps : (session.progress?.steps ?? []);
```
任务流式结束瞬间 `runState.running` 变 `false`，立即切到 `session.progress.steps`；但此刻后端持久化进度尚未回写，`session.progress` 为空 → `mergeStepsWithTemplate` 把全部节点填为 pending，视觉上"消失"，等后台回写才恢复。

**修复策略**：数据源选择改为"取信息更完整的一方"，而非按 `running` 硬切。
```ts
// 优先用非空的 runState.steps；运行结束后在 session.progress 回写前继续沿用 runState.steps
const progressSteps =
  runState.steps.length > 0 ? runState.steps : (session.progress?.steps ?? []);
const progressWorkflow =
  runState.steps.length > 0
    ? runState.workflow_type
    : (session.progress?.workflow_type ?? lastMessageWorkflow ?? 'interview_questions');
```
配合现有 `resolveRunStateAfterFinish`（正常 END 会清空 `runState.steps`）：正常结束后 `runState.steps` 为空，此时 `session.progress` 通常已回写完成，回看持久化数据；而"刚结束、持久化未回"的空窗期，`runState.steps` 仍非空，继续显示，消除闪空。

**验证**：跑一次完整 interview_questions 流程，观察结束瞬间进度条不闪空、不全变 pending。

### Bug 2 — "规划出题"跳到进度条顶部，已完成节点变未完成

**根因**：`mergeStepsWithTemplate`（`workflow-step-templates.ts:80`）第一遍**按 runtime 到达顺序**输出已到达节点，未到达模板节点 pending 追加在后。当 runtime 到达顺序 ≠ 模板拓扑顺序（后端节点状态重入、并发 fanout、`upsertStep` 重入移末尾），渲染顺序就被打乱：某节点排到了不该在的位置，其下方本应"已完成"的节点因排在 pending 段而显示为未完成。

**修复策略**：**渲染顺序恒定按模板拓扑顺序**，runtime 只提供「状态/detail」，不再决定顺序。
```ts
export function mergeStepsWithTemplate(workflow, runtimeSteps) {
  const template = WORKFLOW_STEP_TEMPLATES[workflow];
  if (!template) return runtimeSteps; // 未知 workflow 走 fallback

  // runtime 状态索引：step_id → 运行时状态/detail
  const rt = new Map(runtimeSteps.map(s => [s.step_id, s]));

  // 按模板顺序产出，命中 runtime 用其 status/detail，否则 pending
  const merged = template.map(t => {
    const r = rt.get(t.step_id);
    return r
      ? { step_id: t.step_id, title: t.title, status: r.status, ...(r.detail !== undefined ? { detail: r.detail } : {}) }
      : { step_id: t.step_id, title: t.title, status: 'pending' as const };
  });

  // 兜底：runtime 出现但不在模板的未知 step_id，按到达顺序追加到末尾（异常分支可观测）
  for (const s of runtimeSteps) {
    if (!template.some(t => t.step_id === s.step_id)) merged.push(s);
  }
  return merged;
}
```
此改动使「跳顶」「已完成变未完成」同时消失：节点位置只由模板决定，状态只由 runtime 决定，两者解耦。

**连带影响**：`upsertStep` 的"重入移末尾"契约不再被排序依赖，保留即可（仍负责去重）。"当前活跃步骤"改为"模板顺序中最后一个非 pending"——与现状语义一致，无需改调用方。

**验证**：模板顺序渲染快照测试；构造乱序到达的 runtimeSteps，断言输出顺序 == 模板顺序、各节点状态正确。

### Bug 3 — "X / 8 步"长期卡 2/8

**根因（待实跑确认）**：`reached = merged.filter(s => s.status !== 'pending').length`。卡 2 说明仅 2 个节点被认作"非 pending"。两个候选根因：
- (a) 后端实际推送的 `step.update` 只覆盖了部分 `step_id`（如交互暂停点之后未持续推送）；
- (b) 后端推送的 `step_id` 与前端模板 key 不完全一致，未命中模板，计数失真。

**修复策略**：
- 先实跑抓 SSE envelope，确认后端真实推送的 `step_id` 序列与模板 key 是否一一对应（这是 bug3 的关键验证点，不臆断）。
- 若是 (b) key 不一致 → 对齐前端模板 / 后端 `step_labels.py`（仅同步 key，不改语义）。
- 若是 (a) 推送不全 → 计数口径维持"非 pending 数 / 模板总数"，并确认 Bug 2 修复后顺序正确时计数随推送自然增长。
- Bug 2 的模板顺序化修复本身已让计数更稳健（不再因乱序导致重复/遗漏）。

**验证**：完整跑一遍流程，逐节点核对计数从 1/8 单调递增到 8/8。

---

## 三、悬浮岛（方案 A）组件设计

### 形态
- 右上角玻璃胶囊（`position: absolute; top:20px; right:24px`），固定于工作台舞台、不随会话滚动。
- **收起态（默认）**：迷你进度环（`reached/total`）+ 当前节点图标 + 当前节点标题（running 时波浪文字）+ 展开箭头。胶囊宽度自适应单节点信息。
- **展开态**：胶囊下方长出玻璃面板（`transform-origin: top right`，spring 缩放淡入）。面板含：头部（"流程进度" + `reached / total 步`）+ 节点列表。
- **默认 5 节点 + 加载更多**：列表默认 `slice(0,5)`，超出显示「加载更多（还有 N 步）」；点开后 `max-height` 限定在单视窗内（约 `min(展开高度, 视窗-上下边距)`），溢出走 `.thin-scroll`。收起面板时复位为 5 个。

### 保留的现有动画
- WaveText 波浪标题（running 节点）。
- running 图标 `progress-icon-pulse` 呼吸光圈。
- success 连接线 `progress-flow-dot` 流光点。
- framer-motion：面板展开 spring、列表项 `layout` + stagger 进出。

### 组件拆分（保持单一职责，复用修复后的共享逻辑）
```
progress-tracker/                 （目录复用，重构内部）
├── floating-progress.tsx         悬浮岛容器：收起/展开状态、数据源不变（props 透传）
├── progress-pill.tsx             收起态胶囊：迷你环 + 当前节点
├── progress-panel.tsx            展开态玻璃面板：头部 + 列表 + 加载更多
├── step-row.tsx                  单步行（复用现有，无需改）
└── (移除) progress-tooltip.tsx   收起态 tooltip 不再需要（悬浮岛自带当前节点展示）
```
- `agent-workspace.tsx`：移除常驻第三栏 `<ProgressTracker>`，主 `<main>` 占满；在舞台层挂 `<FloatingProgress>`，props（steps/running/workflowType）来自修复后的数据源选择。
- 当前活跃节点 = 复用 `mergeStepsWithTemplate` 结果中"最后一个非 pending"。

### 数据流（不变）
```
SSE envelope → agent-run-reducer(upsertStep) → store.runState.steps
                                                      ↓
agent-workspace 选择数据源（修复后）→ FloatingProgress
                                                      ↓
              mergeStepsWithTemplate（修复后，模板顺序）→ pill / panel 渲染
```

---

## 四、滚动条统一

- 复用现有 `.thin-scroll`（`index.css`，6px、半透明 slate、悬停加深至 sky）。
- 主会话区 `agent-message-list.tsx` 滚动容器追加 `thin-scroll` class（当前走 8px 默认）。
- 悬浮面板列表用 `thin-scroll`。
- 不新增全局滚动条规则，避免影响其它页面。

---

## 五、测试与验收

| 项 | 验证方式 |
|---|---|
| Bug1 | 完整跑流程，结束瞬间进度不闪空 |
| Bug2 | `mergeStepsWithTemplate` 单测：乱序输入 → 模板顺序输出 + 状态正确 |
| Bug3 | 实跑抓 SSE 确认 step_id 对齐；计数 1/8→8/8 单调 |
| 悬浮岛 | 默认收起显当前节点；点击展开；默认 5+加载更多；超高滚动 |
| 滚动条 | 主会话区 + 面板均为精小 thin-scroll |
| 动画 | 波浪文字 / 呼吸光圈 / 流光线均保留 |

---

## 六、不做的事（YAGNI）

- 不保留侧边栏形态（已确认完全移除第三栏）。
- 不改后端 graph / SSE / step_labels 语义（仅在 bug3 确认为 key 不一致时同步 key）。
- 不新增方案切换、不做主题可配置。
