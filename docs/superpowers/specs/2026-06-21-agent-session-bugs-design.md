# Agent 会话 4 个 Bug 修复 设计文档

- 日期：2026-06-21
- 范围：前端 Agent 会话状态管理、进度栏显示条件、Composer 按钮逻辑
- 工作分支：`worktree-agent-session-bugs`（基于 dev）
- 后端：经核查无需改动（详见 Bug4）

---

## 一、背景

承接悬浮进度岛上线后，用户反馈 4 个问题。其中 Bug1 为高风险状态泄漏，已用 systematic-debugging 确证根因；Bug2 为进度衔接缺陷；Bug3/Bug4 为交互行为调整。全部为纯前端改动。

---

## 二、Bug1：新会话串入其它会话历史消息（高风险）

### 现象
新建会话时，新会话的消息列表里出现其它（之前的）会话的历史消息。

### 确证根因（非猜想）
`store/agent.ts:210` `refreshSessions`：
```js
const activeId = s.activeId ?? (items.length ? items[0].id : null);
```
进入工作台时存在两条并发的 activeId 初始化路径：
1. `AgentStandaloneLayout` mount effect 调 `refreshSessions()`（异步网络），其 resolve 时若 `s.activeId` 仍为 null，把**最近的历史会话 A** 设为 activeId。
2. 另一 effect（`activeId === null` 时）调 `createSession()` 自动新建空虚拟会话。

二者竞争：当 `refreshSessions` 先 resolve（或 `didAutoCreate` ref 在 StrictMode/HMR 下失效），activeId 落到历史会话 A → `WorkspaceInner key={A}` 渲染 → `useAgentRun(A)` 触发 `ensureLoaded(A)` 拉取 A 的历史消息显示。随后才切到虚拟会话，但用户已看到 A 的消息闪现；且 `runs[A]` 永久缓存放大问题。

代码层面不存在"把 A 的 messages 写进 B 的 entry"，所有写入 key 都在闭包固定；问题是 **activeId 被错误地短暂指向历史会话**，叠加 `runs` 永久缓存。

### 修复（双层：根因 + 加固）
1. **根因** — `refreshSessions` 不再自动选 `items[0]` 为 activeId。activeId 的初始化收敛为单一路径（自动新建空会话）。
   - `refreshSessions` 改为：仅拉列表 + 同步已加载会话的 session 字段，**不写 activeId**；唯一例外：若当前 `activeId` 指向的会话已不在新列表中（被删/失效），置为 null 交由自动新建兜底。
2. **加固** — 自动新建的幂等判定从组件 `useRef` 上移到 store，新增 `bootstrapped` 标志：
   - store 新增 `bootstrap()` action（或在 `createSession` 增加幂等保护）：首次进入只建一次虚拟会话，StrictMode 双跑/HMR 重挂载不重复建。
   - `AgentStandaloneLayout` 的自动新建 effect 改为调用幂等的 store 入口，不再依赖组件 ref。

修复后：新会话进入时 activeId 要么瞬间为 null、要么为虚拟会话负 id，**永不指向历史会话**，messages 串史链路切断。`runs` 缓存保留（多会话并发需要）。

### 验证
- 单测：构造"已有历史会话 + activeId 初始为 null"，调用 `refreshSessions`，断言 activeId 不被设为 items[0]。
- 单测：连续调用 `bootstrap`/`createSession` 幂等，只产生一个虚拟会话。
- 实跑：进入工作台直接是空的新会话，无历史消息闪现；多次新建无串史。

---

## 三、Bug2：刷新后进度状态丢失

### 现象
刷新界面后继续任务，之前已完成的进度节点状态丢失，进度从完整 N 步回退。

### 根因
刷新后内存归零（`runState.steps=[]`）。点"继续/恢复" → `resumeRun` → reducer `run.start.resume` 分支只设 `running=true`，**不把 `session.progress.steps` 回写到 `runState.steps`**。第一条新 `step.update` 到达瞬间，`selectProgressSource` 优先取 `runState.steps`（仅 1 步），显示从"持久化完整 N 步"回退。

### 修复
`store/agent.ts` 的 `resumeRun`：在发起 resume、消费 envelope 前，用 `session.progress.steps` 初始化该会话的 `runState.steps`（及 `workflow_type`）作为基线。这样 resume 后新的 `step.update` 经 `upsertStep`（按 step_id 去重更新）在已有 N 步基础上继续累积，不再回退。

- 落点：`resumeRun` 内，调用 `resumeSession` API 前，`set` 一次 runState 基线：`steps = session.progress?.steps ?? []`，`workflow_type = session.progress?.workflow_type ?? 末条消息 workflow`。
- reducer `run.start.resume` 分支维持"不清空 steps"（已是现状），与基线配合。

### 验证
- 单测：模拟刷新后 `runState.steps=[]` + `session.progress.steps` 有 N 步，调 `resumeRun` 后断言 `runState.steps` 被初始化为 N 步基线。
- 实跑：刷新后点继续，进度保持 N 步并继续推进，无回退。

---

## 四、Bug3：新会话不显示右侧进度栏

### 现象
新会话（未发送）就显示了右侧进度岛（一串灰 pending 节点）。期望：只有发送消息到后端后才显示。

### 根因
`agent-workspace.tsx` 无条件挂载 `FloatingProgress`；`floating-progress.tsx` 仅在 `!active` 时早退，而空 steps 经 `mergeStepsWithTemplate` 被模板填成 pending 节点，`active` 非空，故空会话也显示。

### 修复
`agent-workspace.tsx` 挂载 `FloatingProgress` 处加条件 `messages.length > 0`：
```tsx
{messages.length > 0 && (
  <FloatingProgress steps={progress.steps} running={runState.running} workflowType={progress.workflowType} />
)}
```
新会话/空会话不渲染；发送首条消息（乐观消息进入 messages）后即出现。

### 验证
- 单测：`messages=[]` 时 workspace 不渲染 FloatingProgress（query 不到进度岛）；`messages` 非空时渲染。
- 实跑：新建会话无进度岛；发首条消息后出现。

---

## 五、Bug4：中断/发送按钮互斥 + interrupt 时可发送

### 现象
中断按钮与发送按钮同时显示（应互斥）；interrupt 人机交互等待时无法发送新消息（应可发送，且"先中断工作流再发送"）。

### 根因
`agent-composer.tsx`：
- `sending=true` 时发送按钮只 `disabled` 未隐藏 → 与"中断"按钮并列。
- `sendDisabled = sending || hasPendingInteraction`（约 :61）→ interrupt 态（`hasPendingInteraction=true`）拦截发送。

### 后端支持（已核查，无需改动）
- `/sessions/{id}/abort` → `abort_pending_interaction`：把最近一条 pending interaction 标 `expired` 并持久化，推进 `current_task_id`（新 LangGraph thread）。
- 发消息端点无"上一轮未完成则拒绝"的校验，可正常开新一轮。
- 新 thread_id 隔离，不会误续接旧 checkpoint。
结论：前端"先 /abort 再发新消息"两步走即可。

### 修复（纯前端）
1. **按钮互斥**（`agent-composer.tsx` 按钮区）：
   - `sending`（流式中）：只显示"中断"按钮，隐藏"发送"。
   - 非 sending：只显示"发送"按钮。
2. **interrupt 态可发送**：
   - `sendDisabled` 改为只看 `sending || !content.trim()`，移除 `hasPendingInteraction` 拦截。
   - 发送文案不再显示"请先完成上方选择"。
3. **发送前自动中断**（`store/agent.ts` `sendMessage`）：
   - 发送前检测该会话是否有 pending interaction（最近一条 agent 消息含 `interaction` 且 `status==='pending'`）。
   - 若有：先 `await` 调 `/abort`（`abort_pending_interaction`，标 expired），再发新消息开新一轮。
   - 判定逻辑抽为纯函数 `hasPendingInteraction(messages)`，供 store 与 Composer 复用（避免重复实现）。

**按钮状态表（修复后）：**
| 状态 | sending | hasPendingInteraction | 显示 | 发送可用 |
|---|---|---|---|---|
| 空闲 | false | false | 仅发送 | 有输入则可 |
| 流式中 | true | false | 仅中断 | —（隐藏） |
| interrupt 等待 | false | true | 仅发送 | 可（点击→先 abort 再发） |

### 验证
- 单测：`hasPendingInteraction(messages)` 纯函数（pending/submitted/expired/无 interaction 各场景）。
- 单测：Composer 三态按钮渲染（空闲=仅发送、sending=仅中断、interrupt=发送可用）。
- 单测：`sendMessage` 在 pending interaction 时先调 abort 再发（mock API 断言调用顺序）。
- 实跑：流式中只见中断键；interrupt 卡等待时输入框可发新消息，旧 interaction 变 expired，新一轮正常开始。

---

## 六、不做的事（YAGNI）

- 不改后端（已核查支持）。
- 不动 `runs` 多会话缓存机制（隔离本身正确，仅修 activeId 初始化）。
- 不重构 Composer 整体，仅改按钮显隐与 sendDisabled。
- 不处理探索中发现的 `deleteSession` 漏清 `runningRunPromises`（与本次 4 个 bug 无关的既有问题，仅记录，不在本次范围）。

---

## 七、文件改动清单

**修改：**
- `frontend/src/store/agent.ts` — refreshSessions 不写 activeId（Bug1）、新增 bootstrap 幂等（Bug1）、resumeRun 进度基线（Bug2）、sendMessage 发送前 abort（Bug4）
- `frontend/src/components/employee/agent/layout/agent-standalone-layout.tsx` — 自动新建改用 store 幂等入口（Bug1）
- `frontend/src/components/employee/agent/agent-workspace.tsx` — FloatingProgress 条件挂载（Bug3）
- `frontend/src/components/employee/agent/agent-composer.tsx` — 按钮互斥 + sendDisabled（Bug4）

**新建：**
- `frontend/src/components/employee/agent/interaction-utils.ts` — `hasPendingInteraction(messages)` 纯函数（Bug4，store 与 Composer 复用）

**测试：** 对应每个改动的单测文件（vitest + @testing-library）。
