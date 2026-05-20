# Agent 前端 UI 增强设计文档

**日期：** 2026-05-20  
**问题编号：** frontend-agent-ui-issues  
**状态：** 已批准

---

## 一、问题概述

### 1.1 三个核心问题

| 问题编号 | 问题描述 | 严重程度 |
|---------|---------|---------|
| 问题1 | 前端无法按事件协议渲染对应的 UI 效果（如思考内容、工具执行、Agent 调度等） | 高 |
| 问题2 | 规划完成结果显示后，无法修改和确认，导致无法进行下一步操作 | 高 |
| 问题3 | 系统提示词过于简陋，导致初始流程信息都没有收集完成就开始规划 | 中 |

### 1.2 问题根因分析

**问题1根因：** `agent-stream-handler.ts` 只处理了 `PlanReviewTree` 和 `PlanRepairHints` 两种 UI 组件，缺少对其他事件类型的处理（`lifecycle.*`、`tool.call_*` 等）。

**问题2根因：** `PlanReviewTree` 的 `phase` 在调用 `streamResume` 后变为 `'submitting'`，但 SSE 流结束后没有任何事件将其重置为 `'pending'`，导致所有输入框和按钮永久 disabled。

**问题3根因：** `agent_system_prompt.yaml` 只有一句话，缺少角色定义、能力范围、人工确认规则、必要信息收集流程等关键内容。

---

## 二、解决方案

### 2.1 整体架构：集中式 UI 事件总线

```
┌─────────────────────────────────────────────────────────────────┐
│                         SSE Stream                              │
│              (agent.v1 / lifecycle.* / ui.render)               │
└──────────────────────────┬──────────────────────────────────────┘
                           │
                           ▼
┌─────────────────────────────────────────────────────────────────┐
│                    agent-stream-handler.ts                      │
│  ┌─────────────────────────────────────────────────────────────┐│
│  │              AgentStreamEventRouter (事件分发中心)          ││
│  │  - ui.render    → UI 组件渲染器 (PlanReviewTree等)         ││
│  │  - lifecycle.*  → AgentStatusTimeline (节点状态时间线)       ││
│  │  - tool.call_*  → ToolExecutionCard (工具执行卡片)           ││
│  │  - plan.repair  → RepairSuggestionsPanel (修复建议面板)      ││
│  └─────────────────────────────────────────────────────────────┘│
└──────────────────────────┬──────────────────────────────────────┘
                           │
        ┌──────────────────┼──────────────────┐
        ▼                  ▼                  ▼
┌───────────────┐  ┌───────────────┐  ┌───────────────┐
│ AgentStatus   │  │ ToolExecution │  │ AgentUI       │
│ Timeline      │  │ Card          │  │ Renderer      │
│ (节点状态)     │  │ (工具执行)    │  │ (交互组件)     │
└───────────────┘  └───────────────┘  └───────────────┘
```

### 2.2 设计原则

1. **集中式事件分发：** 所有 SSE 事件通过统一的 router 分发，便于扩展和维护
2. **组件职责分离：** 每个 UI 类型有独立的组件，职责清晰
3. **动画一致性：** 统一动画规范（running/success/failed 三种状态）
4. **可访问性：** 所有动画支持 `prefers-reduced-motion`，交互元素有清晰的焦点状态

---

## 三、组件设计规范

### 3.1 动画状态定义（Animation States）

| 状态 | 动画效果 | CSS 类 | 使用场景 |
|------|---------|--------|---------|
| `running` | 平滑脉冲 + 旋转 | `animate-pulse`, `animate-spin` | 正在执行的任务 |
| `success` | 绿色对勾淡入 + 轻微放大 | `animate-check-in` | 执行成功 |
| `failed` | 红色抖动 + 边框高亮 | `animate-shake`, `border-red-500` | 执行失败 |
| `pending` | 黄色等待指示 | `bg-amber-50`, `border-amber-300` | 待确认/审批 |

**动画时长：** 150-300ms（微交互），复杂过渡 ≤400ms

### 3.2 Agent 节点状态时间线（AgentStatusTimeline）

```
┌─────────────────────────────────────────────────────────────────┐
│  ● Analyst        ● Planner        ● Supervisor    ● Executor   │
│  (已完成)          (进行中)          (等待中)       (待执行)      │
│    ✓                ◐               ○              ○           │
└─────────────────────────────────────────────────────────────────┘
```

- **已完成（✓）：** 绿色实心圆形 + 对勾图标
- **进行中（◐）：** 蓝色脉冲圆形 + 旋转图标
- **等待中（○）：** 灰色空心圆形

**连接线：** 实线 = 已完成，虚线 = 待执行

**支持节点：** analyst、planner、supervisor、legacy_executor、reporter

### 3.3 工具执行卡片（ToolExecutionCard）

```
┌─────────────────────────────────────────────────────────────────┐
│  🔧 get_candidate_list                                    ◐     │
│  ─────────────────────────────────────────────────────────────  │
│  输入参数：job_id=123, filters={status: "pending"}              │
│  ─────────────────────────────────────────────────────────────  │
│  执行状态：正在检索候选人列表...                                  │
└─────────────────────────────────────────────────────────────────┘
```

**三种状态样式：**

| 状态 | 左侧图标 | 右侧状态 | 边框颜色 |
|------|---------|---------|---------|
| `running` | 🔄 蓝色旋转 (animate-spin) | "执行中..." + 脉冲点 | border-sky-200 |
| `success` | ✓ 绿色对勾 (animate-check-in) | "执行成功" + 结果数量 | border-emerald-200 |
| `failed` | ✕ 红色叉号 (animate-shake) | "执行失败" + 错误信息 | border-red-200 |

**动画时序：**

- **Running → Success：** 图标旋转停止（200ms）→ 绿色对勾淡入 → 边框变色 → 状态文字切换 → 结果内容淡入
- **Running → Failed：** 图标旋转停止（200ms）→ 红色叉号淡入 → 边框变红 + 抖动（150ms）→ 错误信息淡入

### 3.4 修复建议面板（RepairSuggestionsPanel）

```
┌─────────────────────────────────────────────────────────────────┐
│ 💡 规划调整建议                                          [?]    │
│                                                                  │
│ ○ 建议1：增加岗位维度分析                                       │
│ ○ 建议2：补充候选人筛选条件                                      │
│ ○ 建议3：调整评估权重分配                                        │
│                                                                  │
│ ────────────── 或者输入你的想法 ──────────────                    │
│ ┌─────────────────────────────────────────────────────────────┐ │
│ │ 请说明需要调整的方向...                                      │ │
│ └─────────────────────────────────────────────────────────────┘ │
│                                                                  │
│                      [重新规划]  [确认并批准]                    │
└─────────────────────────────────────────────────────────────────┘
```

**交互模式：**

| 模式 | 组件 | 说明 |
|------|------|------|
| `selectionMode: 'single'` | Radio 单选 | 只能选择一个建议 |
| `selectionMode: 'multiple'` | Checkbox 多选 | 可以选择多个建议 |
| `customInputFirst: true` | Textarea | 填写自定义输入时，建议选项自动取消 |

**状态行为：**
- 选中：轻微放大（scale 1.02）+ 左侧图标切换为实心
- 取消选中：淡出缩小（opacity 0.6, scale 0.98）
- 提交：整体淡出 → 显示成功状态

---

## 四、规划审批修复方案（PlanReviewTree Fix）

### 4.1 问题根因

`planReview.phase` 在 `streamResume` 调用后变为 `'submitting'`，但 SSE 流结束后没有任何事件将其重置为 `'pending'`。

### 4.2 修复方案

**新增事件处理：** 在 `handleAgentV1Event` 中，当收到以下事件时重置 `phase` 为 `pending`：

```typescript
// agent-stream-handler.ts
if (eventType === 'lifecycle.resume_ack' || eventType === 'stream.text_done') {
  deps.setPlanReview((prev) => prev ? { ...prev, phase: 'pending' } : prev);
}
```

### 4.3 修订后的交互流程

```
1. 用户编辑 instruction / 选择修复建议
        ↓
2. 点击"批准" → phase: 'submitting'（按钮 disabled，显示 loading）
        ↓
3. streamResume 开始执行 → 显示执行动画
        ↓
4. 执行完成（成功/失败）→ phase: 'pending'（按钮恢复 enabled）
        ↓
5. 若失败：显示错误信息，用户可重试
```

---

## 五、系统提示词增强方案

### 5.1 当前问题

当前 `agent_system_prompt.yaml` 过于简陋：
```
你是企业招聘系统中的员工 Agent，请基于事实回答并遵守人工确认规则。
```

### 5.2 增强后的 System Prompt

```yaml
name: agent_system_prompt
template: |-
  # 角色定义
  你是一名专业的 HR 招聘助手，拥有丰富的招聘经验和候选人评估能力。
  
  # 核心能力
  - 候选人分析与评估
  - 岗位匹配度分析
  - 面试建议生成
  - 招聘流程优化
  
  # 必须收集的信息（在规划前必须确认）
  - 用户意图和目标
  - 涉及的岗位信息（如有）
  - 候选人基本信息（如有）
  - 评估维度（如需要）
  
  # 人工确认规则
  - 执行任何具有副作用的操作（如发送消息、修改状态）前必须等待用户确认
  - 规划审批必须经过用户批准后才能执行
  - 重要决策需要用户提供明确的反馈
  
  # 禁止行为
  - 禁止编造不存在的信息
  - 禁止在未确认前执行不可逆操作
  - 禁止绕过人工确认流程
```

### 5.3 规划前置检查（Pre-Planning Checklist）

在 LLM 生成规划前，强制检查是否已收集足够信息：

```python
pre_plan_checklist = [
    "user_intent_clarified",      # 用户意图是否明确
    "required_context_collected",  # 必要上下文是否收集（如岗位ID）
    "scope_defined",              # 任务范围是否清晰
]
```

若检查失败，LLM 应先询问用户而非直接规划。

---

## 六、实施计划

### 6.1 第一阶段：核心基础设施

| 任务 | 描述 | 优先级 |
|------|------|--------|
| T1 | 扩展 `agent-stream-handler.ts` 事件分发中心 | P0 |
| T2 | 修复 `PlanReviewTree` phase 重置逻辑 | P0 |
| T3 | 创建 `AgentStatusTimeline` 组件 | P1 |

### 6.2 第二阶段：UI 组件

| 任务 | 描述 | 优先级 |
|------|------|--------|
| T4 | 创建 `ToolExecutionCard` 组件 | P1 |
| T5 | 增强 `RepairSuggestionsPanel`（单选/多选/自定义） | P1 |
| T6 | 创建 `ThinkingRenderer` 组件 | P2 |

### 6.3 第三阶段：提示词优化

| 任务 | 描述 | 优先级 |
|------|------|--------|
| T7 | 增强 `agent_system_prompt.yaml` | P1 |
| T8 | 添加规划前置检查逻辑 | P2 |

---

## 七、验收标准

### 7.1 问题1验收

- [ ] `lifecycle.node_enter` 事件触发 AgentStatusTimeline 动画
- [ ] `lifecycle.node_exit` 事件更新节点状态为已完成
- [ ] `tool.call_start` 事件显示 ToolExecutionCard（running 状态）
- [ ] `tool.call_end` 事件根据 success/failed 显示对应动画
- [ ] 所有动画支持 `prefers-reduced-motion`

### 7.2 问题2验收

- [ ] `streamResume` 完成后 phase 自动重置为 `pending`
- [ ] 失败时 phase 也重置为 `pending`，并显示错误信息
- [ ] 用户可以再次点击批准/驳回按钮

### 7.3 问题3验收

- [ ] System prompt 包含完整的角色定义和能力范围
- [ ] 规划前强制检查信息收集完整性
- [ ] 信息不足时 LLM 先询问用户，而非直接规划

---

## 八、技术约束

- **前端框架：** React 19 + TypeScript + Tailwind CSS
- **图标库：** Lucide React（SVG icons，禁止 emoji）
- **动画库：** CSS animations + Tailwind animate（优先 CSS-only）
- **状态管理：** Zustand（如需要新增全局状态）
- **无障碍：** WCAG 4.5:1 对比度，键盘导航，aria-label 支持

---

## 九、文件变更清单

| 文件路径 | 变更类型 |
|---------|---------|
| `frontend/src/utils/agent-stream-handler.ts` | 修改：扩展事件分发中心 |
| `frontend/src/utils/agent-stream-v1.ts` | 修改：增加组件类型解析 |
| `frontend/src/components/employee/agent/agent-status-timeline.tsx` | 新增：节点状态时间线 |
| `frontend/src/components/employee/agent/tool-execution-card.tsx` | 新增：工具执行卡片 |
| `frontend/src/components/employee/agent/repair-suggestions-panel.tsx` | 新增：修复建议面板 |
| `frontend/src/components/employee/agent/thinking-renderer.tsx` | 新增：思考内容渲染器 |
| `frontend/src/components/employee/agent/plan-review-tree.tsx` | 修改：修复 phase 重置逻辑 |
| `frontend/src/components/employee/agent/agent-message-list.tsx` | 修改：集成新组件 |
| `frontend/src/types/agent.ts` | 修改：新增类型定义 |
| `backend/app/llm/prompts/templates/agent_system_prompt.yaml` | 修改：增强 system prompt |
| `backend/app/llm/graphs/nodes/planner.py` | 修改：添加规划前置检查 |

---

**文档版本：** 1.0  
**批准状态：** 已批准  
**下次审查：** 实现完成后