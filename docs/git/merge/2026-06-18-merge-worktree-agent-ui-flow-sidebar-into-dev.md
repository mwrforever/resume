# 合并 worktree-agent-ui-flow-sidebar 到 dev

- 创建日期：2026-06-18
- Git 操作：merge
- 源分支/Commit：worktree-agent-ui-flow-sidebar（HEAD `6662020`）
- 目标分支：dev（HEAD `4f0cddc`，merge-base `851f940`）
- 冲突文件数：2 个
- 冲突 Hunk 数：2 组（2 个强相关文件合并为一组协商）
- 状态：已审批

## 总览

| 编号 | 文件 | Hunk 数 | 用户决定汇总 |
| --- | --- | --- | --- |
| 1 | frontend/src/components/employee/agent/agent-message-card.tsx | 多处合并为 1 组语义冲突 | 1×自定义（D） |
| 2 | frontend/src/components/employee/agent/agent-message-list.tsx | 多处合并为 1 组语义冲突 | 1×自定义（D，与 #1 联动） |

## 冲突 #1 · frontend/src/components/employee/agent/agent-message-card.tsx

### 冲突类型
modify/modify（注释 / Props 接口 / 渲染主体 / blocks 容器 / footer / QuestionSkeleton 函数归属，多处）

### 三方差异说明

- **Base（共同祖先 `851f940`）**：历史 = 外卡 `rounded-2xl border divide-y` + 左 3px accent + `bg-[#FAFBFC]` 底栏 footer；流式 = list 内另一张独立卡 + 外部 StepStrip。两套独立结构，切换会跳动。
- **Ours（dev `0ce2fb3` "流式卡→历史卡共用 AgentMessageCard 同一外壳"）**：保留外卡形态，但让流式/历史复用同一个 AgentMessageCard，新增 props `streaming? / showSkeleton?`，并把原必填的 `runState` 放宽为可选（`runState?: AgentRunState | null`，便于历史 MessageRow 调用时省略/传 null），用 streaming flag 切换 accent 颜色（更亮 38BDF8→0369A1 vs 主蓝 0EA5E9→0369A1）、max-height 折叠 StepStrip、`!streaming` 显隐 footer → 流式→历史仅 className/子节点切换，DOM 节点不重建，无跳动。新增内部 `QuestionSkeleton` 组件。
- **Theirs（worktree T4 `6636089` "AgentMessageCard 改 rail 骨架"）**：完全去掉外卡 border/shadow/divide，改为 `.relative.pl-11`（左头像锚点）+ 内层 `border-image` 渐变左 rail（`[border-image:linear-gradient(180deg,#0EA5E9_0%,#0369A1_60%,transparent_100%)_1]`）+ 段头 "HR · Agent · 模型名" + `space-y-3` blocks（替代 divide-y）+ 段尾 inline 小字 token · 时间。props 去掉 `runState`，删 StepStrip 导入。
- **核心分歧**：结构层 ours 坚持"流式 + 历史共用 AgentMessageCard 同一 DOM 外壳 + streaming flag 切 className"消除跳动；theirs 坚持"去外卡改 rail 骨架，流式内联渲染不复用 card"。视觉层 ours 保留卡片堆叠，theirs 改对话流 rail。耦合层 theirs 把流式渲染完全写死在 list.tsx 内联使 AgentMessageCard 变纯历史卡片；ours 把 AgentMessageCard 升级为"流式历史通用外壳"，list.tsx 仅调度。两者互相否决对方的结构选择。

### 业务影响分析

- 业务职责：AgentMessageCard 负责"一条 Agent 消息（历史或流式伪消息）如何画"。
- 调用链上游：`agent-workspace.tsx:9` import AgentMessageList；`agent-workspace.tsx:100` `<AgentMessageList messages runState sending onSubmitInteraction onPickPrompt onRetry />`。AgentMessageCard 由 agent-message-list.tsx 的 MessageRow / 流式分支调用。
- 调用链下游（本文件直接 import）：BlockRenderer、attachReasoning、StepStrip、Sparkles。（ReasoningSection 经 BlockRenderer 间接调用，非本文件直接 import。）
- 影响范围：流式渲染形态、历史渲染形态、流式→历史切换是否跳动、StepStrip 位置、fanout 骨架屏、段头/段尾视觉。
- 配置/枚举：无。

### 各选择预期影响

- 选 ours：流式→历史 DOM 结构一致 ✅；但 AgentMessageCard 仍是 rounded-2xl border divide-y footer 卡片堆叠 ❌（用户已视觉验收 rail 方案，等于推翻验收）。
- 选 theirs：rail 视觉骨架保留 ✅；但流式分支内联在 list.tsx 不复用 card，切换瞬间外层 class 从 `relative pl-11 animate-[cardEnter...]` 变成 `relative pl-11`（无动画），整段子节点（头像/rail/段头/blocks）在新伪消息替换时整体重建，重新触发 railGlow 动画与段头 animate-pulse，肉眼可见跳动 ❌。
- 全保留：技术不可行——ours 要 AgentMessageCard 保留外卡 + 接 streaming flag，theirs 要去外卡改 rail 且 props 去掉 runState，对 Props 接口与外层 DOM 结构的修改直接冲突。
- 自定义：保留 theirs 的 rail 骨架作为 AgentMessageCard 最终形态（去外卡 border/shadow/divide、改 `.relative.pl-11` + `border-image` rail + 段头 + `space-y-3` blocks + 段尾 inline 小字），同时把 ours `0ce2fb3` 的"streaming flag 复用 card"机制吸收进来：AgentMessageCardProps 接回 `runState / streaming / showSkeleton`，让 list.tsx 流式分支也走 `<AgentMessageCard streaming runState showSkeleton />`。streaming flag 在 card 内部切换段头文案 / rail 颜色 / railGlow 动画 / StepStrip 折叠 / QuestionSkeleton 显隐。流式和历史的整段 DOM 树同构（`.relative.pl-11` > 头像 + rail 内 段头 + StepStrip? + `space-y-3` blocks + QuestionSkeleton? + 段尾），切换瞬间仅 className / 段头文案 / railGlow 动画类 / 子节点折叠差异，无节点重建，无视觉跳动。

### 推荐与理由

推荐：自定义（D）
理由：
1. 正确性：流式和历史收敛到同一个 AgentMessageCard + 同一棵 DOM 树（`pl-11 > 头像 + rail(div.pl-4.py-1.border-l-2) > 段头 + StepStrip? + space-y-3 blocks + 段尾`），切换瞬间 React 按 key 复用外层节点，仅 className（railBorderImage / railAnim）和子节点（StepStrip 折叠 / QuestionSkeleton 显隐 / 段头文案）增减，无节点重建 → 无视觉跳动。这正是 dev `0ce2fb3` 的核心价值（伪消息复用 card 防闪烁），同时不丢 worktree 的 rail 视觉。
2. 业务覆盖：grep 验证 AgentMessageList 唯一调用点是 agent-workspace.tsx:100，所有业务功能（中断按钮 / abort 端点 / pending 状态 / 重试 onRetry / sending 状态 / 标题截断）都在 composer.tsx + store/agent.ts + backend agent.py，不在本次冲突的两个文件，本次合并不会丢任何业务功能。AgentMessageCard / agent-message-list 与 composer/store 没有 props 级耦合。
3. 项目惯例：CLAUDE.md §4.2"单一职责：一个组件只做一件事"。自定义让 AgentMessageCard 作为"单条 Agent 消息（流式或历史）如何渲染"的唯一职责组件，list.tsx 作为纯调度器；而 theirs 把流式渲染写死在 list 内联让 list 同时承担编排和流式视觉，违反单一职责。
4. 风险面：所有 CSS keyframes（shimmer / cardEnter / blockEnter / railGlow）都已存在于 index.css，无需新增 CSS。新增的仅是 railBorderImage / railAnim 字符串变量与段头三元，纯展示分支，无副作用。

### 用户决定

- 选择：D（自定义合并）
- 决定时间：2026-06-18 21:00
- 最终保留代码：见下方"最终保留代码"小节（合并 #1 与 #2 联动后的完整版）。

## 冲突 #2 · frontend/src/components/employee/agent/agent-message-list.tsx

### 冲突类型
modify/modify（import 行 / `pseudoStreamingMessage` + 流式分支整体）

### 三方差异说明

- **Base（`851f940`）**：流式 = list 内独立 `rounded-2xl border` 卡 + 外部 StepStrip + divide-y blocks；历史走 MessageRow → AgentMessageCard。
- **Ours（dev `0ce2fb3`）**：删内联流式渲染，用 `useMemo` 构造 id=-1 的 `pseudoStreamingMessage`（role='agent'、content.blocks=runState.current_blocks、sort_order=MAX_SAFE_INTEGER），通过 `<AgentMessageCard streaming showSkeleton runState={runState} />` 复用同一外壳。import 行 `import { AlertCircle, RefreshCw } from 'lucide-react'`（无 Sparkles，头像在 card 里）。错误卡片/MessageRow/空态/follow 逻辑保留。
- **Theirs（worktree T5 `629b8c0`）**：流式分支内联渲染整段 rail + 呼吸光（`<div relative pl-11 animate-[cardEnter]>` 含头像 + 更亮 rail `[border-image:linear-gradient(180deg,#7DD3FC_0%,#0EA5E9_50%,#0369A1_100%)_1]` + `animate-[railGlow_1.6s_...]` + StepStrip 在 rail 顶部 + 段头 "生成中…" + space-y-3 blocks + showSkeleton 接 QuestionSkeleton）。import 加 `Sparkles`（list.tsx:10）。

### 业务影响分析

- 业务职责：AgentMessageList 负责"整张消息列表的编排（历史 map + 流式分支 + 空态 + 错误卡片 + 自动滚动）"。
- 调用链上游：agent-workspace.tsx:100。
- 调用链下游：AgentMessageCard、BlockRenderer、attachReasoning、StepStrip、EmptyState、ResumeFileIcon、useFollowBottom、Sparkles（theirs）。
- 影响范围：流式渲染、流式→历史切换跳动、StepStrip 位置、QuestionSkeleton 位置、import 清单。
- 配置/枚举：无。

### 各选择预期影响

- 选 ours：流式复用 card、伪消息防闪烁 ✅；但与 #1 联动——若 #1 也走 ours 则回到外卡卡片堆叠。
- 选 theirs：rail 呼吸光视觉保留 ✅；但流式内联不复用 card → 切换跳动（同 #1）。
- 全保留：技术不可行。
- 自定义（与 #1 联动）：采用 ours 的 `pseudoStreamingMessage` + `<AgentMessageCard streaming runState showSkeleton />` 结构，让流式复用 card；card 内部（#1 自定义）已吸收 rail 骨架与 railGlow。自检实证：ours(`:2:`) 的 import 行本就只有 `useEffect/useMemo/AlertCircle/RefreshCw`（无 Sparkles/StepStrip/BlockRenderer/attachReasoning），MessageRow 末尾 `<AgentMessageCard>` 本就含 `runState={null}` —— 因此**文件 2 最终保留代码 = ours(`:2:`) 原样，零调整**。错误卡片 / 空态 / follow 逻辑 / pseudoStreamingMessage useMemo 全部保留 ours 原貌。

### 推荐与理由

推荐：自定义（D，与 #1 联动）
理由：
1. 正确性：与 #1 同构的 DOM 树保证流式→历史无跳动。
2. 业务覆盖：MessageRow / 错误卡片 / 空态 / follow 逻辑全部保留，零业务功能损失。
3. 项目惯例：list.tsx 回归"列表编排"纯调度器职责（CLAUDE.md §4.2），流式视觉交给 AgentMessageCard。
4. 风险面：list.tsx 删掉内联 rail 后行数下降，import 精简，回归风险低。

### 用户决定

- 选择：D（自定义合并，与 #1 联动）
- 决定时间：2026-06-18 21:00
- 最终保留代码：见下方。

## 最终保留代码

### 文件 1：frontend/src/components/employee/agent/agent-message-card.tsx（完整替换）

```tsx
/**
 * AgentMessageCard：Agent 响应消息（rail 骨架）
 *
 * 设计要点（对话流方案 A + dev 0ce2fb3 流式复用机制）：
 * - 去掉"外卡 + divide-y"，整段以左 accent rail + 头像锚点连成一条；
 * - block 之间用 spacing 而非 divider；
 * - 仅业务结果块（interview_questions / evaluation_report）由各自渲染器内
 *   使用 result-card 浮起，作为唯一"突出层"；
 * - 流式与历史复用同一个本组件：streaming flag 切换 rail 颜色 / 段头文案 /
 *   railGlow 呼吸光 / StepStrip 折叠 / QuestionSkeleton 显隐 / 段尾可见性，
 *   流式 → reload 历史时 DOM 节点不重建，仅 className/子节点增减 → 无视觉跳动。
 */

import type { AgentMessage, AgentRunState } from '@/types/agent';
import { Sparkles } from 'lucide-react';
import { BlockRenderer } from './blocks/block-renderer';
import { attachReasoning } from './blocks/group-blocks';
import { StepStrip } from './step-strip';

export interface AgentMessageCardProps {
  message: AgentMessage;
  /** 流式期间透传当前 runState（用于渲染 StepStrip）；历史为 null */
  runState?: AgentRunState | null;
  /** 是否处于流式渲染状态（伪消息）：影响段头文案 / rail 颜色 / railGlow / StepStrip 可见性 */
  streaming?: boolean;
  /** fanout 期间题目骨架屏（仅 streaming 有效） */
  showSkeleton?: boolean;
  /** interaction 提交进行中：禁用提交按钮防重复点击 */
  submitting?: boolean;
  onSubmitInteraction: (requestId: string, values: Record<string, unknown>) => void;
}

export function AgentMessageCard({
  message, runState, streaming, showSkeleton, submitting, onSubmitInteraction,
}: AgentMessageCardProps) {
  const blocks = attachReasoning(message.content.blocks ?? []);

  // 流式期间即使无 block 也要渲染外壳（让用户看到 StepStrip 进度）；历史无 block 不渲染
  if (blocks.length === 0 && !streaming) return null;

  // rail border-image：流式更亮（sky300 起），历史主蓝（sky500 起），切换时无节点重建
  const railBorderImage = streaming
    ? '[border-image:linear-gradient(180deg,#7DD3FC_0%,#0EA5E9_50%,#0369A1_100%)_1]'
    : '[border-image:linear-gradient(180deg,#0EA5E9_0%,#0369A1_60%,transparent_100%)_1]';
  // railGlow 呼吸光：仅流式追加
  const railAnim = streaming
    ? 'animate-[railGlow_1.6s_cubic-bezier(0.4,0,0.6,1)_infinite] motion-reduce:animate-none'
    : '';

  return (
    <div className="relative pl-11">
      {/* Agent 助手徽标（rail 起点锚点，流式与历史同位置） */}
      <div className="absolute left-0 top-0 flex h-8 w-8 items-center justify-center rounded-xl
                      bg-gradient-to-br from-[#0EA5E9] to-[#0369A1] text-white
                      shadow-[0_4px_10px_-3px_rgba(3,105,161,0.5)]
                      ring-1 ring-inset ring-white/20">
        <Sparkles size={15} className="fill-white/25" strokeWidth={2.2} />
      </div>

      {/* 左 accent rail（border-image 渐变垂直线）：streaming 切换颜色与呼吸光 */}
      <div className={`relative pl-4 py-1 border-l-2 border-transparent ${railBorderImage} ${railAnim}`}>
        {/* 段头：流式 = '生成中…'，历史 = 'HR · Agent · 模型名' */}
        <div className="flex items-center gap-2 mb-2 text-[11px] text-[#64748B]">
          <span className="font-semibold text-[#334155]">HR · Agent</span>
          {streaming ? (
            <>
              <span className="w-[3px] h-[3px] rounded-full bg-[#CBD5E1]" />
              <span className="text-[#0EA5E9] font-medium animate-pulse">生成中…</span>
            </>
          ) : message.model_name ? (
            <>
              <span className="w-[3px] h-[3px] rounded-full bg-[#CBD5E1]" />
              <span className="font-mono">{message.model_name}</span>
            </>
          ) : null}
        </div>

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

        {/* Blocks：space-y-3 替代 divide-y（保留 rail 视觉） */}
        <div className="space-y-3">
          {blocks.map((block) => (
            <BlockRenderer
              key={block.index}
              block={block}
              submitting={submitting}
              onSubmitInteraction={
                block.type === 'interaction' ? onSubmitInteraction : undefined
              }
            />
          ))}
          {/* fanout 骨架屏：仅 streaming && showSkeleton */}
          {streaming && showSkeleton && <QuestionSkeleton />}
        </div>

        {/* 段尾 inline 元信息：流式时不显示（避免 reload 后突然冒出抖一下）；历史时显示 */}
        {!streaming && (message.token_count != null || message.create_time) && (
          <div className="flex items-center gap-2 mt-3 text-[10.5px] text-[#94A3B8] font-mono">
            {message.token_count != null && <span>{message.token_count} token</span>}
            {message.token_count != null && message.create_time && (
              <span className="w-[3px] h-[3px] rounded-full bg-[#E2E8F0]" />
            )}
            {message.create_time && <span>{message.create_time}</span>}
          </div>
        )}
      </div>
    </div>
  );
}

/** fanout 期间题目骨架卡：shimmer 占位（流式复用 card 后归属本文件） */
function QuestionSkeleton() {
  return (
    <div className="space-y-2.5">
      {[0, 1, 2].map(i => (
        <div key={i} className="space-y-1.5">
          <div className="h-3 rounded bg-[#E2E8F0] bg-gradient-to-r from-[#E2E8F0] via-[#F1F5F9] to-[#E2E8F0]
                          bg-[length:200%_100%] animate-[shimmer_1.8s_linear_infinite] w-3/4" />
          <div className="h-2.5 rounded bg-[#E2E8F0] bg-gradient-to-r from-[#E2E8F0] via-[#F1F5F9] to-[#E2E8F0]
                          bg-[length:200%_100%] animate-[shimmer_1.8s_linear_infinite] w-full" />
          <div className="h-2.5 rounded bg-[#E2E8F0] bg-gradient-to-r from-[#E2E8F0] via-[#F1F5F9] to-[#E2E8F0]
                          bg-[length:200%_100%] animate-[shimmer_1.8s_linear_infinite] w-5/6" />
        </div>
      ))}
    </div>
  );
}
```

### 文件 2：frontend/src/components/employee/agent/agent-message-list.tsx（采用 ours 原样，零调整）

自检实证（`git show :2:frontend/src/components/employee/agent/agent-message-list.tsx`）：dev `0ce2fb3`（ours）版本**已经**满足自定义合并的全部要求，无需任何修改：

- import 行：`useEffect, useMemo`（react）、`AlertCircle, RefreshCw`（lucide，无 Sparkles）、`AgentMessage, AgentRunState, WorkflowType`（type）、`useFollowBottom`、`EmptyState`、`ResumeFileIcon`、`AgentMessageCard` —— **本就不含** StepStrip/BlockRenderer/attachReasoning（这些 ours 早已收回 card 内部管理）。
- `pseudoStreamingMessage` useMemo：id=-1, role='agent', content.blocks=runState.current_blocks, sort_order=MAX_SAFE_INTEGER ✅
- 流式分支：`<AgentMessageCard message={pseudoStreamingMessage} runState={runState} submitting={sending} onSubmitInteraction={onSubmitInteraction} streaming showSkeleton />` ✅（与文件 1 新 Props 契约一致）
- MessageRow 末尾：`<AgentMessageCard message runState={null} submitting onSubmitInteraction />` ✅（ours 本就含 `runState={null}`，对齐文件 1 新 Props 的可选 runState）
- 错误卡片 / 空态 / follow 逻辑全部保留 ours 原貌。

**实现阶段指令**：文件 2 直接取 `git show :2:frontend/src/components/employee/agent/agent-message-list.tsx` 的完整内容写回，不做任何编辑。仅文件 1 需要按"最终保留代码"文件 1 版本完整替换。

## 跨文件方案一致性说明

文件 1 与文件 2 是同一决定的两个面：文件 1 自定义（rail 骨架 + streaming flag 复用 card）要求文件 2 走 ours 的 pseudoStreamingMessage 结构，二者 Props 契约一致（`runState? / streaming? / showSkeleton?` 全部可选 + 中文注释），DOM 树同构，无跨文件矛盾。无其他文件涉及（agent-workspace.tsx 调用面未改，composer/store/backend 不受影响）。

## 自检记录

- 自检方式：文件 1 用 subagent；文件 2 因 subagent 工具集受限（无 Bash/Read/Grep）降级为主 agent 自检
- 自检子 agent 数量：1 个（文件 1）+ 主 agent 降级 1 个（文件 2）
- 自检发现并修订的项：
  1. 冲突 #1 Ours 差异说明：原文"新增 props streaming?/showSkeleton?/runState?"不准（runState 在 base 已存在，ours 是放宽为可选）→ 已修订为"新增 streaming?/showSkeleton?，runState 放宽为可选"。
  2. 冲突 #1 业务影响下游清单：原文含"ReasoningSection"但本文件未直接 import → 已修订为"直接 import: BlockRenderer/attachReasoning/StepStrip/Sparkles；ReasoningSection 经 BlockRenderer 间接调用"。
  3. 冲突 #2 最终保留代码：原文描述需"微调 import + 加回 runState={null}"，自检实证 ours(`:2:`) 本就满足（import 无多余项、MessageRow 已含 runState={null}）→ 已修订为"文件 2 = ours 原样零调整"。
- 自检通过时间：2026-06-18 21:10

## 审批

- 审批人：mwr（用户）

- 审批时间：2026-06-18 21:15
- 审批结论：通过
- 备注：

## 实现衔接

- 衔接 skill：superpowers:writing-plans
- 衔接时间：2026-06-18 21:20
- 传递给 writing-plans 的关键参数：
  - spec 文档（审批后提交到）绝对路径：`D:/code/py/project/resume/docs/git/merge/2026-06-18-merge-worktree-agent-ui-flow-sidebar-into-dev.md`（当前临时存于 `$CLAUDE_JOB_DIR/tmp/merge-spec.md`，审批通过后随实现阶段提交进仓库）
  - Git 操作类型：merge（写回完成后用 `git merge --continue` 完成合并）
  - 源分支：worktree-agent-ui-flow-sidebar
  - 目标分支：dev
  - 用户决定明细：2 个冲突文件均选 D（自定义合并，rail 骨架 + streaming flag 复用 card），最终保留代码见上方
  - 是否允许实现阶段执行 git add / commit：是（merge --continue 需要提交合并 commit）
