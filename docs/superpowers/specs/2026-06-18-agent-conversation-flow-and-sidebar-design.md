# Agent 工作台 · 对话流连续性 + 侧栏视觉升级 设计 Spec

**日期**：2026-06-18
**作者**：HR Agent 工作台前端组
**状态**：待用户审核

---

## 一、目标

针对 Agent 工作台两类视觉痛点进行升级，**严格保留全部现有业务功能**：

1. **消息流割裂感**：当前每段 agent 消息是独立 `rounded-2xl border` 大卡，内部 `divide-y` 切段，业务卡（评估报告 / 面试题）内部还有 `rounded-xl border` 子卡 → 评估报告里再有 `rounded-md border` 子子卡。三层嵌套强化了「割裂」与「卡片堆叠」感。
2. **侧栏简陋**：浏览器默认滚动条扎眼；视觉信息密度低；与已升级过的对话主区拉开质感差距。

升级后的视觉骨架基于 **方案 A · 对话流**（已与用户在 mockup 上确认）：

- 取消 agent 消息外卡 / 内部 divider；改为 **左 accent rail + 头像锚点** 把整段连成一条；
- 仅 **业务结果产出**（评估报告 / 面试题集合）保留浮起卡，作为唯一的"突出层"；
- 侧栏采用 **毛玻璃头部 + sky 光晕 + 时间分组 + 渐变 pill active + 6px 隐形滚动条**；
- **全局滚动条** 统一为 sky 着色、hover 显形的瘦身风格。

---

## 二、不在范围（YAGNI）

- 后端不动。所有改动局限在前端 `frontend/src/components/employee/agent/` 与极少量全局样式（滚动条）。
- 不引入新的设计 token；现有 `agent-tokens.ts` 已覆盖所需色值与缓动。
- 不调整 Topbar、Composer、EmptyState 三个区域（用户已确认 Topbar 不动；Composer/EmptyState 视觉与新对话流自然兼容）。
- 不新增后端字段（如"末条消息预览"），故侧栏列表保持单行。
- 不引入 `⌘K` 快捷键、计数徽标（用户已 opt-out）。
- 不改 `Topbar`、`agent-composer.tsx`、`empty-state.tsx`。

---

## 三、整体架构

改动聚焦两块组件树，外加一处全局样式：

```
frontend/src/
├── components/employee/agent/
│   ├── agent-message-card.tsx        ← 重写：去外卡、去 divider、改 rail + 头像
│   ├── agent-message-list.tsx        ← 调整：流式分支与历史共用 rail 骨架；rail 颜色更亮 + 呼吸光
│   ├── blocks/
│   │   ├── interview-questions-card.tsx  ← 内部子卡去 border，改"突出底块"
│   │   └── evaluation-report-card.tsx    ← 综合评语 / 参考答案子卡去 border
│   └── layout/
│       └── agent-sidebar-drawer.tsx  ← 重写头部毛玻璃 + 时间分组 + active 渐变 pill + 隐形滚动条
└── index.css                          ← 新增：全局 .thin-scroll 与 ::-webkit-scrollbar 美化
```

**调用关系不变**：`AgentStandaloneLayout → AgentSidebarDrawer / AgentMessageList → AgentMessageCard → BlockRenderer → 各 block`。仅替换 DOM 结构与样式，props 与事件契约不动。

---

## 四、组件级设计

### 4.1 AgentMessageCard（核心改造）

**原结构**（`agent-message-card.tsx:28-82`）：

```
.relative.pl-11
├── .absolute (头像 32px)
└── .rounded-2xl.border.shadow.divide-y   ← 外卡
    ├── 左侧 3px accent 条
    ├── StepStrip (运行中)
    ├── divide-y 包裹 N 个 block (px-4 py-3)
    └── 元信息 footer (border-t)
```

**新结构**：

```
.relative.pl-11.message-row
├── .absolute (头像 32px，保留)
└── .rail (border-left + 左渐变 image-source)
    ├── (无 StepStrip：只在流式时由 list 顶部渲染)
    ├── .meta-head (HR·Agent · 模型名)        — 段头
    ├── .blocks (block 之间用 spacing 而非 divider)
    │   ├── thinking → ReasoningSection (chip 折叠态，hover 出明色)
    │   ├── text     → TextBlock (无容器，纯排印)
    │   ├── tool_use → 内联 chip (.tool-chip 单行)
    │   ├── interaction → 保留卡（功能性表单需要边界）
    │   ├── interview_questions → 浮起卡（突出层，见 4.3）
    │   └── evaluation_report   → 浮起卡（突出层，见 4.4）
    └── .meta-foot (token / 时间，font-mono 小字 inline)
```

**关键 CSS**：

- `.rail`：`border-left: 2px`，`border-image: linear-gradient(180deg, #0EA5E9, #0369A1 60%, transparent) 1`，`padding: 4px 0 4px 16px`
- `.meta-head`：`text-[11px] text-[#64748B]`，「HR · Agent · 模型名 · 时间」一行；
- block 之间用 `space-y-3`，**不**加 divider；
- `.tool-chip` 的样式用现有 `tool-use-block.tsx` 改写（不再让其撑满）；
- footer 由"卡片底栏"降级为段尾小字：`mt-2 text-[10.5px] text-[#94A3B8] font-mono`。

**保留语义**：
- `runState` 仅在 `agent-message-list.tsx` 流式分支使用；历史 message 不接 `runState`，故 `AgentMessageCard` 内部的 `runState && StepStrip` 分支保留接口但实际不被走到，逻辑可清理（精准改动 §6.3）。

---

### 4.2 AgentMessageList（流式与历史共用骨架）

**原结构**（`agent-message-list.tsx:73-98`）：

```
runState.running →
  <div.space-y-2>
    <StepStrip />
    <div.rounded-2xl.border.shadow>           ← 流式独立大卡
      左侧 3px accent
      <divide-y>{blocks}</divide-y>
    </div>
  </div>
```

**新结构**：

```
runState.running →
  <div.message-row.streaming>
    .absolute (头像 32px，与历史一致)
    <div.rail.rail-streaming>                 ← 同 rail 骨架，仅颜色更亮 + 呼吸光
      <StepStrip />                            ← 上移到 rail 顶部
      <div.blocks.space-y-3>{blocks}</div>
      (skeleton 兜底也在此)
    </div>
  </div>
```

**`.rail-streaming` 微动效**：
- `border-image` 用更亮的渐变：`from-[#7DD3FC] via-[#0EA5E9] to-[#0369A1]`；
- 加 1.6s 呼吸光：`box-shadow: -3px 0 12px -4px rgba(14,165,233, .35)` 在 50% 关键帧加强到 `.55`，循环；
- 流式结束（`runState.running` 变 false）→ 该 row 卸载、该消息进入 `messages.map` → 切回普通 `.rail`，自然交叉淡入（messages.map 的入场动画 + rail-streaming 卸载淡出）。
- 错误提示卡（`runState.error`）保留独立 callout 卡（功能差异明确，需要红色边界，符合"业务结果保留浮起"原则）。

---

### 4.3 InterviewQuestionsCard（业务卡 - 浮起层）

**原结构**：每题用 `rounded-xl border border-[#E2E8F0]/80` 子卡。

**新结构**：

- 题目列表的 **每条** 改为：左侧 2.5px sky accent 条（hover/expanded 时高亮）+ 浅底悬停（`hover:bg-[#F8FAFC]`），**去 border**；
- 头部统计条（题数 / 维度 / 难度分布）保持，加一个 `EVALUATION QUESTIONS` 极小字 label 形成"浮起卡头"语义；
- 整卡（外层 div）现在被 `AgentMessageCard` 的 rail 直接包裹，需要自带"浮起"语义 → 在卡内最外层包一层：
  ```
  .rounded-2xl.bg-white.shadow-raised.border-gradient(sky→subtle)
  ```
  即 §4.5 的 `.result-card`。

参考答案子卡仍保留 `bg-[#F8FAFC]` + `border` 的弱卡（功能上是"答案区"，需要分隔），保留即可。

---

### 4.4 EvaluationReportCard（业务卡 - 浮起层）

**原结构**：综合评语 `rounded-md bg-[#F8FAFC] border` + 参考答案子卡 + 多个 section header。

**新结构**：

- 整卡用 `.result-card`（§4.5）包裹；
- 头部分数环 + 决策 tag 保持；新增 `RESUME EVALUATION` 极小字 label 形成"浮起卡头";
- 综合评语区由 `bg-[#F8FAFC] border` 改为 `bg-gradient-to-r from-[#F8FAFC] to-transparent` 的左 accent 条 callout（去 border）；
- 维度条形图保持（视觉本就是连续的，不动）；
- 岗位差距 / 面试建议 section 间用 `mt-4` + section 小标签替代视觉分隔，**不加 divider**。

---

### 4.5 共享 utility class：`.result-card`

**定位**：业务结果浮起卡 — 整个对话流里**唯一**的"突出层"。仅 `InterviewQuestionsCard`、`EvaluationReportCard` 两处使用，因此**直接 inline className**，不放入 `agent-tokens.ts`（避免无意义抽象，符合 CLAUDE.md §6.2 简单优先）。

```tsx
const RESULT_CARD_CLASS = `
  relative bg-white rounded-2xl px-4 py-3.5
  shadow-[0_1px_3px_rgba(2,6,23,.05),0_12px_32px_-12px_rgba(3,105,161,.14)]
  before:content-[''] before:absolute before:inset-0 before:rounded-2xl
  before:p-px before:pointer-events-none
  before:bg-[linear-gradient(135deg,rgba(14,165,233,.45),rgba(3,105,161,.18)_50%,rgba(226,232,240,.6))]
  before:[mask:linear-gradient(#000_0_0)_content-box,linear-gradient(#000_0_0)]
  before:[mask-composite:xor] before:[-webkit-mask-composite:xor]
`;
```

> Tailwind 内的渐变描边技巧：`before` 伪元素 1px 内边距、双 mask、xor 合成。两处独立各自定义同名常量即可，未来若出现第三处使用再提取共享。

---

### 4.6 AgentSidebarDrawer（侧栏视觉升级）

**变动列表**：

| 区域 | 现状 | 新设计 |
|---|---|---|
| 顶部头 | `flex items-center justify-between px-3 pt-3 pb-2` 朴素 | 毛玻璃 + sky 微光晕：`relative` 容器 + `radial-gradient(120% 60% at 0% 0%, rgba(14,165,233,.08), transparent 60%)` 底 + `backdrop-blur-sm` |
| "会话"标题 | 纯文字 | 保持纯文字（用户确认去掉计数徽标） |
| 搜索 | 图标按钮（保留） | 图标按钮（保留），hover 增加 sky 微底 |
| 列表分组 | 时间倒序平铺 | **新增**：按 `last_message_time` 分到 今天 / 本周更早 / 更早；组头小字大写 label |
| item 普通态 | `text-[#334155] hover:bg-[#F1F5F9]` | 同上 + `hover:translate-x-[1px]` 微位移 |
| item active | 纯背景色 `bg-[#F0F9FF]` + 左 2.5px accent 条 | 渐变 pill：`bg-[linear-gradient(90deg,rgba(14,165,233,.12)_0%,rgba(14,165,233,.04)_60%,transparent)]` + 同样的左 2.5px accent；时间 chip 着色为 sky |
| 滚动条 | 浏览器默认 | 6px 隐形（thumb 透明 → hover 才出现 sky 着色），见 §4.7 |
| 底部新建按钮 | 现有渐变按钮 | 保持，`hover:translate-y-[-1px]` 微浮起 |

**分组逻辑**（导出供单测复用）：

```ts
// 会话时间分组：今天 / 本周更早 / 更早
// 边界规则：
//   - 今天：last_message_time >= 本地今天 00:00
//   - 本周更早：本周一 00:00 <= last_message_time < 今天 00:00
//   - 更早：last_message_time < 本周一 00:00 或为空
//   - 同组内按 last_message_time 降序
//   - 周一计算用 ISO 周（周一为周首）
type SessionGroup = { key: 'today' | 'thisWeek' | 'earlier'; label: '今天' | '本周更早' | '更早'; items: WorkspaceSession[] };

export function groupSessionsByTime(
  sessions: WorkspaceSession[],
  now: Date = new Date()
): SessionGroup[];
```

**实现要点**：
- 用 `now` 参数注入便于测试（不直接 `new Date()`）；
- `last_message_time` 字段为后端字符串（ISO），`new Date(str)` 解析；解析失败 → 落入"更早"末尾；
- 空数组的组在返回值中保留但 `items: []`，渲染层自行过滤空组。

- 空虚拟会话过滤逻辑保留（`isEmptyVirtual`）。
- 同组内仍按 `last_message_time` 降序。
- 折叠态（`expanded === false`）维持现状，不分组（屏幕太窄无意义）；分组只在展开态生效。

---

### 4.7 全局滚动条统一

加到 `frontend/src/index.css`（项目入口样式）：

```css
/* 全局滚动条美化 - 与 Agent 工作台 sky 品牌色统一
   规则：
   - 默认 thumb 透明，仅 track 占位
   - 容器 hover 时 thumb 显形（半透明 slate）
   - thumb 自身 hover 进一步加深为 sky
   - 保留浏览器原生功能（点击滚动、键盘 PgUp/PgDn 等）
*/

/* WebKit / Blink */
*::-webkit-scrollbar       { width: 8px; height: 8px; }
*::-webkit-scrollbar-track { background: transparent; }
*::-webkit-scrollbar-thumb {
  background: rgba(100, 116, 139, .18);
  border-radius: 999px;
  border: 2px solid transparent;
  background-clip: padding-box;
  transition: background .2s cubic-bezier(.16, 1, .3, 1);
}
*::-webkit-scrollbar-thumb:hover {
  background: rgba(3, 105, 161, .4);
  background-clip: padding-box;
}

/* Firefox */
* { scrollbar-width: thin; scrollbar-color: rgba(100, 116, 139, .25) transparent; }

/* 工具类：极致瘦身（仅在阅读型容器需要时叠加） */
.thin-scroll { scrollbar-width: thin; scrollbar-color: transparent transparent; }
.thin-scroll:hover { scrollbar-color: rgba(100, 116, 139, .32) transparent; }
.thin-scroll::-webkit-scrollbar { width: 6px; }
.thin-scroll::-webkit-scrollbar-thumb { background: transparent; transition: background .25s cubic-bezier(.16, 1, .3, 1); }
.thin-scroll:hover::-webkit-scrollbar-thumb { background: rgba(100, 116, 139, .32); }
.thin-scroll:hover::-webkit-scrollbar-thumb:hover { background: rgba(3, 105, 161, .5); }
```

**应用范围**：
- 全局规则自动覆盖整个应用（不仅 Agent）；
- `.thin-scroll` 显式加在 sidebar 列表、message-list 滚动容器、长内容业务卡内部滚动区。

**风险与回退**：
- 全局规则是纯样式，无副作用；如需回退把 `*::-webkit-scrollbar*` 与 `* { scrollbar-* }` 块去掉即可。
- 不影响项目其它管理后台界面 — 仅是滚动条变美，不改变占位。

---

## 五、保留的现有业务功能（验收清单）

| 功能 | 保留方式 |
|---|---|
| 用户消息蓝渐变气泡 + resume 文件 chip | 不动（`agent-message-list.tsx:163-193`） |
| StepStrip 多步指示 | 流式 rail 顶部展示，结束随 row 卸载 |
| ReasoningSection 思考折叠 | 改为 chip 入口（默认折叠），保留点击展开/收起；与吸附逻辑（`group-blocks.attachReasoning`）兼容 |
| InteractionBlock 表单提交 | 保留独立卡（功能性边界），`submitting` prop 透传不变 |
| 错误重试卡 | 保留独立红 callout |
| QuestionSkeleton（fanout 占位） | 保留，挪到流式 rail 内部 |
| 流式 → 历史 切换 | 同 rail 骨架，靠 `runState.running` 切 class，避免视觉跳变 |
| token / 模型 / 时间 元信息 | 改为段尾 inline 小字，不再是底栏卡片 |
| 侧栏：搜索弹窗、重命名弹窗、删除确认、收起/展开持久化 | 全部保留 |

---

## 六、错误处理与边界情况

- **空消息（无 block）**：`AgentMessageCard` 已有 `if (blocks.length === 0) return null` 保留。
- **流式期间没有 current_blocks**：rail 仍渲染但内部仅 StepStrip + skeleton，不会出现空白 rail（已有 `showSkeleton` 兜底）。
- **同一 message 既是流式又是历史**：流式期间 message 还未持久化（不在 `messages` 数组），结束后才进入；不存在双渲染。
- **侧栏没有会话**：保留 "发送第一条消息后…" 空态文案。
- **滚动条样式与第三方组件冲突**：`AlertDialog`、`Tooltip` 等无内部滚动；`Dialog` 内的滚动区会受全局规则影响 → 视觉一致，不算冲突。

---

## 七、测试策略

### 7.1 单测（vitest）

- `agent-sidebar-drawer.tsx` 的 `groupSessionsByTime` 纯函数：
  - 跨 0 点边界："昨天 23:50" 应分到"本周更早"；
  - 周一 0 点边界："上周日" 应到"更早"；
  - 空 `last_message_time` → "更早"组末尾；
  - 同组内仍按时间降序。
- 已有 `sortSessionsByTime` 测试保留（`__tests__` 目录）。

### 7.2 视觉验证（手动）

- **流式 → 历史切换**：发起一条消息，观察 rail 颜色由亮转沉，无闪烁。
- **嵌套层级**：评估报告 / 面试题集合卡仍清晰浮起，但不再有"卡中卡中卡"。
- **滚动条**：侧栏 / 消息区滚动时 thumb 出现 sky 着色，不滚动时透明。
- **侧栏分组**：拥有 ≥3 天历史的账号能看到 3 个组头。

---

## 八、回退策略

每一项改动独立可回退：

1. 对话流改造：还原 `agent-message-card.tsx` + `agent-message-list.tsx` 即可；
2. 业务卡内部去 border：还原 `interview-questions-card.tsx` + `evaluation-report-card.tsx`；
3. 侧栏：还原 `agent-sidebar-drawer.tsx`；
4. 全局滚动条：从 `index.css` 删除两个 block。

---

## 九、风险与权衡

| 风险 | 缓解 |
|---|---|
| rail 替代外卡后，长消息没有"边界"，与下条 user 气泡可能粘连 | 通过 `space-y-6`（已有）+ 头像锚点视觉断点保证；mockup 已验证 |
| 渐变描边的 `mask-composite` 在低版本浏览器降级 | 项目目标浏览器现代（React 19、Vite），可接受；降级时仅丢失 1px 描边、卡片仍清晰 |
| 全局滚动条规则可能被其它组件视为破坏性改动 | 规则纯加饰，不改占位与行为；其它后台界面不会被破坏 |
| ReasoningSection 改 chip 后用户不易发现 | chip 视觉用 `bg-[#F3E8FF] text-[#7C3AED]` 紫色，与正文形成色相对比；hover 加深；保留原折叠语义 |
| 流式 rail 呼吸光在性能弱机器上耗能 | 用 `box-shadow` 而非 filter，开销可接受；可后续加 `prefers-reduced-motion` 关闭 |

---

## 十、实施步骤（高层）

1. 全局滚动条样式（最小风险，先合）；
2. 侧栏分组函数 + 单测；
3. 侧栏 UI 重写（毛玻璃头、active 渐变 pill、hover 微位移）；
4. `AgentMessageCard` 改 rail + 头像 + 段头/段尾（去外卡、去 divider）；
5. `AgentMessageList` 流式分支同骨架，rail-streaming 微动效；
6. `InterviewQuestionsCard` / `EvaluationReportCard` 内部去 border + result-card 浮起；
7. 联调：发起完整对话，验证流式 / 历史 / 业务卡 / 侧栏滚动连贯；
8. 视觉清单回归。

详细实施任务划分与 TDD 测试设计在 plan 阶段产出。

---

## 十一、设计语言一致性

本次升级与已有视觉脚本无冲突：

- **现有色板**（`agent-tokens.ts`）：sky、navy、surface、semantic 全部复用；
- **现有动效**（`agentMotion.easing.smooth`）：`cubic-bezier(.16, 1, .3, 1)` 全程用作 hover / 入场缓动；
- **现有阴影**（`shadow.raised` / `shadow.cardFlat`）：`shadow-raised` 升级为 `result-card` 的浮起；
- **品牌徽标 / 顶栏深空蓝渐变**：保持不动，方案 A 的左 rail sky 渐变天然延伸品牌线。
