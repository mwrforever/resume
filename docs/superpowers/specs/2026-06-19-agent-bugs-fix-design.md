# Agent 工作台 · 中断提示卡 + 侧栏分组 + 步数显示 设计 Spec

**日期**：2026-06-19
**作者**：HR Agent 工作台前端组
**状态**：待用户审核

---

## 一、目标

修复 Agent 工作台 3 个前端 bug，**全部纯前端改动**：

1. **bug 1（中断提示）**：刷新页面时正在流式运行的 agent 任务被打断后，用户回到会话只看到半截输出，不知道任务已中断、也无法一键重发。
2. **bug 3（侧栏分组）**：分组标签从「今天 / 本周更早 / 更早」改为「今日 / 本周 / 更早」；新建会话发首条消息后立即出现在「今日」组顶部（当前会落到「更早」组底部，因为 `last_message_time` 仍为 null）。
3. **bug 4（步数显示）**：StepStrip 当前显示 `运行中 · 1/1 步` 永远等长，应显示 `当前已完成步 / workflow 静态总步数`。

**不在范围**（YAGNI）：

- 不改后端。bug 1 的"刷新后任务继续跑"涉及后端架构改造（graph 后台化 + 持久化 checkpointer + run 状态字段 + replay 端点），单独立项 spec。本次只在前端做"识别中断 + 提示重发"。
- 不修 bug 2（侧栏运行中加载图标刷新后消失）。在不真正续跑任务的前提下，刷新后继续显示 loading 图标会欺骗用户；待 bug 1 真后端化时再补。
- 不调整步数显示的"重做循环"语义：被驳回（dimension_rejected / plan_rejected）回到上游节点重做时，按 step_id 去重，不增加分母也不重置分子（保持 UI 稳定，重做用步骤标题文案"正在重新分析维度…"传达即可）。

---

## 二、整体架构

3 个 bug 改动**完全隔离**，互不依赖，可分别合入：

```
frontend/src/
├── components/employee/agent/
│   ├── step-strip.tsx                ← bug 4：分子/分母改用 workflow 步骤模板
│   ├── workflow-step-templates.ts    ← bug 4 新增：workflow_type → 节点清单常量
│   ├── agent-message-list.tsx        ← bug 1：识别最后一条 agent 消息含 streaming block → 渲染中断条
│   ├── interrupt-bar.tsx             ← bug 1 新增：单行 pill 中断提示组件
│   └── layout/
│       └── agent-sidebar-drawer.tsx  ← bug 3：分组标签改为「今日 / 本周 / 更早」
├── store/agent.ts                    ← bug 3：sendMessage 乐观写入 last_message_time = now()
└── hooks/use-agent-run.ts            ← 不动（store 层处理）
```

**调用关系不变**：`AgentMessageList → AgentMessageCard / InterruptBar`、`AgentSidebarDrawer 内部调 groupSessionsByTime`、`StepStrip 内部读 workflow-step-templates`。

---

## 三、Bug 1：中断提示卡

### 3.1 中断检测规则

后端在 `agent_runtime_service.py` 的 finally 块里把已生成的 envelope 折叠成 agent 消息落库（含 `_persist_agent_message`）。客户端断开时部分 block 来不及发 `block.stop`，落库时仍保留 `status='streaming'`。其它结束路径不会留 `streaming`：

| 结束路径 | 触发条件 | 落库 block 状态 | 是否触发中断条 |
|---|---|---|---|
| 正常 END | graph 走到 END | 全 `success` | ❌ |
| interrupt 暂停（人机交互卡） | interrupt() 节点 emit interaction.request | text/tool_use 是 `success`，interaction block 是 `pending` | ❌（正常显示交互卡） |
| 用户主动 abort | POST /sessions/{id}/abort 标记 pending → expired | interaction 是 `expired` | ❌ |
| 历史已处理 interaction | submitted/rejected | 终态 | ❌ |
| **客户端断开**（refresh） | GeneratorExit | 至少一个 block 留 `streaming` | ✅ |
| 后端 error | 异常抛出后 finally 落库 | 部分 block 留 `streaming` | ✅（合理：刷新后 runState.error 已丢失，"中断 + 重试"恰好覆盖） |

判定规则（前端，`agent-message-list.tsx`）：

```ts
function isLastAgentMessageInterrupted(messages: AgentMessage[]): boolean {
  if (messages.length === 0) return false;
  const last = messages[messages.length - 1];
  if (last.role !== 'agent') return false;
  return (last.content.blocks ?? []).some(b => b.status === 'streaming');
}
```

**关键点**：`interaction.status === 'pending'` 不触发（runner.py:107 emit 时就是 pending，不是 streaming），所以**不会把"等待用户填表单"误识别为"中断"**。

### 3.2 InterruptBar 组件

**新增文件**：`frontend/src/components/employee/agent/interrupt-bar.tsx`

```tsx
/**
 * 中断提示条：刷新中断或后端错误后，在被截断的 agent 消息底部展示。
 *
 * 单行 pill：橙色感叹号 + 「本次任务已中断」+ 重试图标按钮。
 * 重试 = 用上一条 user 消息的 content 与 workflow_type 重新发起 sendMessage。
 */
export interface InterruptBarProps {
  onRetry: () => void;
  /** 是否正在重新发送（重试期间禁用按钮，避免双发） */
  retrying?: boolean;
}
```

视觉规格（沿用项目 sky/orange 体系，不引入新 token）：
- 容器：`inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-[#FFF7ED] border border-[rgba(251,146,60,0.4)] mt-3 text-[12.5px] text-[#9A3412] font-medium`
- 感叹号：`inline-flex w-4 h-4 rounded-full bg-[#FED7AA] text-[#EA580C] text-[11px] font-bold` 圆形 chip
- 文案：固定字符串 "本次任务已中断"（无副描述、无步数信息，按用户要求精简）
- 重试按钮：`w-6 h-6 rounded-full text-[#EA580C] hover:bg-[rgba(234,88,12,0.12)]` 内嵌 `RotateCw` 图标（lucide-react），title="重试"
- 重试态：`retrying=true` 时按钮禁用 + 图标用 `Loader2 animate-spin`

### 3.3 AgentMessageList 整合

**改动**：`agent-message-list.tsx` 在 `messages.map` 后追加判定渲染：

```tsx
{!runState.running && isLastAgentMessageInterrupted(messages) && (
  <InterruptBar onRetry={handleRetryFromLastUser} retrying={sending} />
)}
```

- `!runState.running` 守卫：当前正在跑流式 run 时不显示（避免和流式状态条同屏）
- 重试逻辑（在 `agent-workspace.tsx`）：找到 messages 数组中**最后一条 user 消息**，用其 `content.blocks[0].text` + `workflow_type` + `content.context_refs` 调 `sendMessage`。
- 重试触发后：sending=true → 按钮禁用 → 流式开始 → 新一轮 run 完成后 messages 替换为最新落库结果，InterruptBar 自然消失（`isLastAgentMessageInterrupted` 返回 false，因为新的 agent 消息全 success）。

**props 链路**：`AgentMessageList` 新增 `onRetryFromLastUser` 回调（与现有 `onRetry` 区分——现有 `onRetry` 是 `runState.error` 红色 callout 的重试，对应未刷新的内存错误态）；`AgentWorkspace` 实现该回调。

### 3.4 与 runState.error 红色 callout 的关系

现有 `runState.error` 红色 callout 在内存中（流式中断且非 abort）触发；刷新后 runState 重置 → callout 消失，但 messages 里被截断的 agent 消息会被 `isLastAgentMessageInterrupted` 命中显示橙色 pill。两者**不会同屏**，因为 callout 依赖 `runState.error`、pill 依赖 `!runState.running`。

---

## 四、Bug 3：侧栏分组

### 4.1 标签替换

**改动**：`agent-sidebar-drawer.tsx` 的 `groupSessionsByTime` 返回的 `label` 字段：

```ts
// 旧
{ key: 'today',    label: '今天',     items: today },
{ key: 'thisWeek', label: '本周更早', items: thisWeek },
{ key: 'earlier',  label: '更早',     items: ... },

// 新
{ key: 'today',    label: '今日', items: today },
{ key: 'thisWeek', label: '本周', items: thisWeek },
{ key: 'earlier',  label: '更早', items: ... },
```

**边界规则不变**（已通过 6 个测试用例覆盖，仅更新预期 label 字符串）：

- 今日：`last_message_time >= 本地今天 00:00`
- 本周：`本周一 00:00 <= last_message_time < 今日 00:00`
- 更早：本周一之前 / 解析失败 / 空时间
- 周首遵循 ISO（周一）；同组内按时间降序

**TypeScript label 联合类型**：

```ts
export interface SessionGroup {
  key: SessionGroupKey;
  label: '今日' | '本周' | '更早';   // ← 类型同步
  items: WorkspaceSession[];
}
```

### 4.2 新会话首条消息后置顶「今日」

**根因**：当前 `sendMessage`（`store/agent.ts:337-460`）发首条消息时只乐观更新了 `title`，**没有更新 `last_message_time`**。新会话刚由 `createSession` 建出，其 `last_message_time = null`（`agent_runtime_service.py` 仅在 `_persist_agent_message` 落库 agent 消息后才更新）。结果：发出消息后到 run 完成前，sessions 列表里这条会话的 `last_message_time` 仍是 null，被 `groupSessionsByTime` 归到「更早」组末尾（`earlierInvalid` 桶）。

**修复**：`sendMessage` 内乐观更新 `last_message_time` 为当前时间（与现有 `optimisticTitle` 同位置）：

```ts
// 现有逻辑（store/agent.ts 约 412-431）：
const optimisticTitle = (() => { ... })();

// 新增：乐观写入 last_message_time，让会话立即进入「今日」组顶部
const optimisticLastMessageTime = new Date().toISOString();

set((s) => {
  const entry = getRun(s.runs, realSessionId);
  const messages = [...entry.messages, optimisticUserMessage];
  // session 上同步乐观 last_message_time（标题逻辑不变）
  const sessionPatch = {
    ...(optimisticTitle ? { title: optimisticTitle } : {}),
    last_message_time: optimisticLastMessageTime,
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

**收敛**：run 完成后 `runEnvelopes` 调 `getSession(sessionId)` 把后端权威 `last_message_time` 写回 sessions 里的 entry（已通过 `mergeLocalRuntime` 路径），覆盖乐观值——但因为后端值与乐观值都是"今日"区间内，分组结果一致，UI 无视觉跳变。

**关于"新会话默认顶部展示"**：现有 `isEmptyVirtual` 过滤逻辑保留——虚拟会话（id < 0 + last_message_time 为空）不进侧栏。点击"新建会话"后侧栏不显示，发首条消息瞬间出现在「今日」组顶部。这正是用户期望的行为。

### 4.3 单测同步

**改动**：`__tests__/agent-sidebar-grouping.test.ts` 把所有断言里的 `'今天' | '本周更早' | '更早'` 改为 `'今日' | '本周' | '更早'`。算法本身不变，6 个测试用例的边界数据保持。

新增 1 个测试：`sendMessage 乐观更新后会话立即归入「今日」组`（在 store 测试或集成测试中）。如果 store 没有现成测试基础，**可以省略**（YAGNI）—— 改动本身只是一行 set，分组算法已被覆盖。

---

## 五、Bug 4：步数显示

### 5.1 后端工作流节点清单（信息源）

来自 `backend/app/llm/graphs/workflows/step_labels.py:16-64` 的 STEP_LABELS（已是稳定常量）：

| workflow_type | 节点 step_id（按拓扑顺序） | 显示标题 |
|---|---|---|
| **interview_questions** | load_resume | 读取简历 |
|  | suggest_dimensions | 分析维度 |
|  | request_dimension_selection | 选择维度 |
|  | build_question_plan | 规划出题 |
|  | request_plan_approval | 确认计划 |
|  | fanout_generate_questions | 生成题目 |
|  | reduce_questions | 汇总整理 |
|  | finalize_question_set | 输出题库 |
| **resume_evaluation** | load_resume | 读取简历 |
|  | analyze_resume_profile | 分析画像 |
|  | load_job_candidates | 加载岗位 |
|  | request_job_selection | 选择岗位 |
|  | validate_job_full_name | 校验岗位 |
|  | run_evaluation_subgraph | 多维评估 |
|  | build_visualization_report | 组装报告 |
|  | finalize_evaluation_report | 输出报告 |

interview_questions = 8 步、resume_evaluation = 8 步。

### 5.2 前端清单常量

**新增文件**：`frontend/src/components/employee/agent/workflow-step-templates.ts`

```ts
/**
 * Workflow 节点清单（与后端 step_labels.py 保持一致）。
 *
 * 用途：StepStrip 的"已完成 N / 总 M 步"分母 = 该 workflow 的静态节点数。
 * step.update envelope 到达时按 step_id 匹配模板项，标记 success 状态；
 * 重入相同 step_id（驳回循环）→ 该项重置为 running，不新增项，分母恒定。
 *
 * **同步约束**：后端 step_labels.py 增删节点时必须同步本文件。
 */

import type { WorkflowType } from '@/types/agent';

export interface StepTemplate {
  step_id: string;
  title: string;
}

export const WORKFLOW_STEP_TEMPLATES: Record<WorkflowType, StepTemplate[]> = {
  interview_questions: [
    { step_id: 'load_resume',                title: '读取简历' },
    { step_id: 'suggest_dimensions',         title: '分析维度' },
    { step_id: 'request_dimension_selection',title: '选择维度' },
    { step_id: 'build_question_plan',        title: '规划出题' },
    { step_id: 'request_plan_approval',      title: '确认计划' },
    { step_id: 'fanout_generate_questions',  title: '生成题目' },
    { step_id: 'reduce_questions',           title: '汇总整理' },
    { step_id: 'finalize_question_set',      title: '输出题库' },
  ],
  resume_evaluation: [
    { step_id: 'load_resume',               title: '读取简历' },
    { step_id: 'analyze_resume_profile',    title: '分析画像' },
    { step_id: 'load_job_candidates',       title: '加载岗位' },
    { step_id: 'request_job_selection',     title: '选择岗位' },
    { step_id: 'validate_job_full_name',    title: '校验岗位' },
    { step_id: 'run_evaluation_subgraph',   title: '多维评估' },
    { step_id: 'build_visualization_report',title: '组装报告' },
    { step_id: 'finalize_evaluation_report',title: '输出报告' },
  ],
};

/**
 * 合并 workflow 模板与运行时 steps：模板项按顺序输出，runtime 命中的项替换状态，
 * 未命中的保持 pending。重入相同 step_id 时 runtime 数组里有多条同 id 的 step
 * （后端按节点完成顺序 emit），本函数取**最后一次出现**的状态作为该项当前状态。
 *
 * @param workflow workflow_type；未知 workflow 走 fallback（直接返回 runtime steps，分母 = 实际收到数）
 * @param runtimeSteps 运行时收到的 step.update（来自 runState.steps）
 * @returns 合并后的步骤数组（长度恒定 = 模板长度）
 */
export function mergeStepsWithTemplate(
  workflow: WorkflowType,
  runtimeSteps: AgentStep[],
): AgentStep[];
```

实现细节（spec 不展开，写在文件本身）：用 `Map<step_id, AgentStep>` 取 runtime 最后一次出现的状态，按模板顺序拼出最终数组；模板里没出现的 runtime step（理论上不应出现，但保护性兜底）追加到末尾。

### 5.3 StepStrip 改造

**改动**：`step-strip.tsx`

新增 prop `workflowType`：

```tsx
export interface StepStripProps {
  steps: AgentStep[];
  running: boolean;
  workflowType: WorkflowType;   // ← 新增
}
```

内部用 `mergeStepsWithTemplate(workflowType, steps)` 得到完整数组 `mergedSteps`，分子分母改为：

```tsx
const successCount = mergedSteps.filter(s => s.status === 'success').length;
const totalCount = mergedSteps.length;  // = WORKFLOW_STEP_TEMPLATES[workflowType].length

// 当前活跃步骤：找第一个非 success 的（pending / running / failed），
// 找不到则说明全 success（运行结束态）
const activeStep = mergedSteps.find(s => s.status !== 'success') ?? mergedSteps[mergedSteps.length - 1];

return (
  <span>
    {running ? <>运行中 · {successCount} / {totalCount} 步 · <WaveText text={activeStep.title} /></> 
            : `已完成 ${successCount} / ${totalCount} 步`}
  </span>
);
```

展开态时间线渲染 `mergedSteps` 全量（pending 项显示灰圈），用户能看到"还要做哪些步"。

**调用方更新**：`agent-message-list.tsx` 流式分支 + `agent-message-card.tsx` 历史分支调 `<StepStrip>` 时传入 `workflowType={runState.workflow_type}` 或 `message.workflow_type`。

### 5.4 重入循环的语义

按 step_id 去重保证分母恒定：

- 用户驳回维度 → 后端从 `request_dimension_selection` 跳回 `suggest_dimensions` 重新跑
- 后端 emit `step.update(step_id='suggest_dimensions', status='success')` 又一次（runner.py 总用 `status='success'` 因 LangGraph updates 在节点完成后才触发）
- 前端 `mergeStepsWithTemplate` 取该 step_id 最后一次状态 = success，**仍然占用同一项**，模板长度不变 → 分母不变
- 视觉上活跃步骤标题文字不变（仍叫"分析维度"），但波浪动画再次激活，用户能感知"被驳回回来重做了"

### 5.5 单测

新增 `workflow-step-templates.test.ts`：

```ts
describe('mergeStepsWithTemplate', () => {
  it('空 runtime steps → 全模板项 status=pending', ...);
  it('部分 runtime steps → 命中项变 success，未命中保持 pending', ...);
  it('重入相同 step_id → 最后一次状态生效，长度不变', ...);
  it('未知 workflow → fallback 返回原 runtime steps', ...);
});
```

---

## 六、错误处理与边界

- **空 messages 数组**：`isLastAgentMessageInterrupted([])` 返回 false，不显示中断条
- **最后一条不是 agent**（理论上只有 user message 时——刷新瞬间 user 已落库 agent 还没）：返回 false。这个场景下用户感知不到中断，但后端 finally 没跑出 agent 消息说明 user message 也很可能被回滚了（rollback），实际不会发生
- **重发后再次中断**：与首次中断同样逻辑，pill 持续显示直到一次成功完成的 run
- **lastUser 找不到**（防御）：messages 倒序找不到 user message → 重试按钮 disabled + title="找不到上一条消息"
- **groupSessionsByTime 算法不变**：所有现有边界用例（空时间、解析失败、跨周一边界）保持
- **乐观 `last_message_time` 与服务端冲突**：服务端权威值在 run 完成后通过 `getSession` 回写，覆盖乐观值。乐观值为客户端 toISOString() — 与服务端时间可能差几秒，但都在「今日」区间内，分组结果一致

---

## 七、测试策略

### 7.1 单测

- `agent-sidebar-grouping.test.ts`：6 个用例的 label 字符串更新（今天→今日、本周更早→本周）
- `workflow-step-templates.test.ts`（新增）：4 个用例覆盖 merge 函数
- `interrupt-bar.test.tsx`（可选，新增）：基本渲染 + onRetry 触发；可省略——组件极简（一行容器 + 一个按钮），渲染靠人眼验证

### 7.2 视觉验证（手动）

| 场景 | 预期 |
|---|---|
| 流式运行中观察 StepStrip | 数字递增：1/8 → 2/8 → … → 8/8 |
| 触发驳回（dimension_rejected） | 分母不变（仍 8），活跃步骤标题切换、波浪重启 |
| 流式中刷新页面 | 灰化 rail + 单行橙色"本次任务已中断 ↻"在被截断 agent 消息底部 |
| 点击"重试" | 按钮变 spinner + 立即开始新 run；run 完成后 pill 消失 |
| interrupt 暂停态刷新 | 仅显示 interaction 卡片，**无**中断条 |
| 用户 abort interaction 后刷新 | 仅显示 expired 状态的 interaction（已不可交互），**无**中断条 |
| 新建会话发首条消息 | 该会话在侧栏「今日」组顶部立即出现 |
| 侧栏组头 | 显示「今日 / 本周 / 更早」三种标签 |

---

## 八、回退策略

每项独立可回退：

- bug 1：删除 `interrupt-bar.tsx` + `agent-message-list.tsx` 里的判定渲染 + `agent-workspace.tsx` 重试回调
- bug 3 标签：`agent-sidebar-drawer.tsx` 三处 label 字符串还原 + 测试断言还原
- bug 3 乐观时间：`store/agent.ts` 删除 `optimisticLastMessageTime` 相关行
- bug 4：删除 `workflow-step-templates.ts` + 还原 `step-strip.tsx` 的 successCount/steps.length 写法 + 删除 props.workflowType + 还原调用方

---

## 九、风险与权衡

| 风险 | 缓解 |
|---|---|
| 前端 step 模板与后端 step_labels.py 漂移 | 注释中标明同步约束；后端 8 个节点已是稳定的工作流业务定义，最近 PR 历史显示低频变动 |
| 中断条把"后端 error"也识别为"中断" | 这是预期行为：刷新后 runState.error 已丢失，"中断 + 重试"恰好覆盖该场景；用户语义上"重试"也成立 |
| 乐观 `last_message_time` 比真实时间略早 | 误差秒级，分组结果一致；run 完成后被服务端权威值覆盖，无视觉跳变 |
| 重发可能再次中断 | pill 自动重新显示；用户可不限次重试。无重试上限是为简单，符合 YAGNI |
| 新模板节点漏配 | `mergeStepsWithTemplate` 防御性兜底——未知 workflow 退回 runtime steps，分母 = 已收到步数（与现状等同），不会报错 |

---

## 十、实施步骤（高层）

1. **bug 4**（独立）：写 `workflow-step-templates.ts` + 单测；改 StepStrip + 调用方
2. **bug 3**（独立）：改 `groupSessionsByTime` 的 label 字段 + 测试断言；store 加 `optimisticLastMessageTime`
3. **bug 1**（独立）：写 `interrupt-bar.tsx`；`agent-message-list.tsx` 加判定函数 + 渲染；`agent-workspace.tsx` 加重试回调
4. **联调**：跑一遍简历问答 + 简历评估完整流程，分别在不同步刷新看中断条、走驳回看分母不变；新建会话发首条消息看分组归属

详细任务划分与 TDD 设计在 plan 阶段产出。

---

## 十一、与现有设计的一致性

- **视觉语言**：橙色中断条复用项目已有的 `runState.error` 红色 callout 视觉模式（圆角 pill + 图标 + 操作按钮），仅切到 orange 色相区分语义
- **rail 体系**：被截断的 agent 消息延续 `agent-message-card.tsx` 的 rail 骨架，仅追加 InterruptBar，无结构破坏
- **侧栏分组**：算法零改动，仅改 label 字段；保留 ISO 周首、降序、空时间兜底等所有既定规则
- **StepStrip**：保留折叠态单行 + 展开态时间线 + 波浪动画的现有交互；仅替换分子/分母数据源
