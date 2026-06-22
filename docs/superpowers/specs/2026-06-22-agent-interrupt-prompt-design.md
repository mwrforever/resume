# Agent 工作台中断提示优化设计

- 日期：2026-06-22
- 分支：dev
- 关联：2026-06-20 A2（中断续接机制）、2026-06-22 进度持久化与 UI 修复

## 一、背景与问题

### 1.1 现状

Agent 工作台已有三套与中断相关的 UI：

1. **Composer 红色「暂停」按钮**（`frontend/src/components/employee/agent/agent-composer.tsx:250-265`）—— 流式中（`sending=true`）显示，点击触发 `store.abort` → `AbortController.abort()` 切断 SSE。
2. **消息列表底部 InterruptBar 橙色 pill**（`frontend/src/components/employee/agent/interrupt-bar.tsx` + `agent-message-list.tsx:157-164`）—— 显示「本次任务已中断」+「恢复」按钮，调 `store.resumeRun` 续接 LangGraph checkpoint。
3. **红色错误 callout**（`agent-message-list.tsx:120-151`）—— `runState.error` 非空时显示 + RefreshCw +「重试」按钮。

### 1.2 问题

用户**主动点击「暂停」按钮中断正在流式运行的任务后，没有任何提示信息**。

### 1.3 根因

InterruptBar 的触发条件依赖后端 reload 回来的**落库 block 状态**反推：

```typescript
// agent-message-list.tsx —— 当前的「碰运气式」判定
isLastAgentMessageInterrupted(messages):
  messages[last].content.blocks.some(b => b.status === 'streaming')
```

该判定只在「恰好中断在某个 block 的流式生成中段」时才成立。以下场景全部漏判：

| 中断时机 | 落库 block 状态 | 判定结果 |
|---|---|---|
| text / tool 流式生成中段 | 最后 block 保持 `streaming` | ✓ 显示 |
| run 刚开始，尚未生成任何 block | blocks 为空 | ✗ 不显示 |
| 所有 block 已 `block.stop`（success）但 `run.finish` 未到达 | 全部 success | ✗ 不显示 |
| reload 时序竞争（后端 finally 仍在 shield 中跑落库） | 前端拿到旧状态 | ✗ 不显示 |

即当前实现是**「碰运气式」**的：没有显式的「用户主动中断」信号，全靠落库 block 状态反推，产生时机不可控。

## 二、目标与非目标

### 2.1 目标

1. 用户主动点击「暂停」后，**可靠地**显示「任务已中断」提示与「重试」图标按钮，不依赖落库 block 状态。
2. 中断后刷新页面 / 断网恢复，仍能可靠恢复中断态提示。
3. 中断提示内保留前端已展示的内容（已生成的 envelope 不丢失）。
4. 「重试」按钮行为 = 续接 LangGraph checkpoint（A2 决策不变，仅改文案与图标）。

### 2.2 非目标

- 不改动 interrupt 人机交互暂停态（dimension_selection / plan_approval / job_selection）的 UI。
- 不改动红色错误 callout（`runState.error` 路径）的实现。
- 不提供「放弃 checkpoint 从头重发」的按钮入口（用户可直接在输入框重发，`sendMessage` 会自动 abort 未完成的 task）。
- 不处理上线前已落库的历史中断消息兼容（dev 分支未上线，历史数据无价值）。

## 三、方案选型

采用**双信号 OR 兜底**模型（方案 C）：

| 信号 | 产生时机 | 存储 | 生命周期 | 覆盖场景 |
|---|---|---|---|---|
| `runState.aborted`（前端） | 用户点击「暂停」**瞬间** | store 内存 `runs[id].runState` | 下一次 run 入口清除 | 主动中断、不刷新 |
| `message.content.interrupted`（后端） | 后端 `client_aborted=True` 落库时 | DB `agent_message.content` | 永久（直到被新消息替代） | 主动中断后刷新、断网/崩溃恢复 |

两个信号**独立产生、OR 兜底**，任何一个为真即显示提示。

### 3.1 选型理由

- **前端 `aborted`** 解决「点击瞬间立即响应」：不等后端 reload（那一两百毫秒空窗期正是当前「没提示」体感最强的时刻）。
- **后端 `content.interrupted`** 解决「刷新后可靠恢复」：无论中断时 buffer 是否含 streaming block，都打显式标记，根除「碰运气」。
- **移除旧的 `isLastAgentMessageInterrupted`**（streaming-block 判定）：不留不稳定的兼容兜底，让后端 `content.interrupted` 成为唯一的中断持久化信号来源。

## 四、详细设计

### 4.1 UI 触发判定（最终）

两个信号各自独立成一个判定分支，职责互补：

```
显示 InterruptBar =
    !runState.error
  && (
       // ① 前端即时信号：用户点击「暂停」瞬间置 true，不限制 running 状态。
       //   中断瞬间（running 仍 true）即可与 pseudoStreamingMessage 同屏显示，给用户即时反馈；
       //   reload 完成后 pseudoStreamingMessage 被落库消息替换，本条仍在。
       runState.aborted
       // ② 后端持久化信号：刷新 / 断网恢复场景，aborted 已随内存丢失，
       //   靠 content.interrupted 兜底。要求 !running && !sending 排除"正在运行 / 正在发起重试"窗口，
       //   避免点重试瞬间（aborted 已清但 run.start 未到达、上一轮 content.interrupted 仍在）残留。
    || (!runState.running && !sending && messages[messages.length - 1]?.content?.interrupted === true)
  )

移除：isLastAgentMessageInterrupted 函数及其全部调用
```

**两分支职责对照**：

| 分支 | 覆盖场景 | 为什么有效 |
|---|---|---|
| ① `aborted` | 主动中断、不刷新 | 点击瞬间 store 置 true；reload 期间持续；三个 run 入口立即清 true → 点重试瞬间消失 |
| ② `!running && !sending && content.interrupted` | 刷新 / 断网恢复 | aborted 内存丢失后靠 DB 标记；`!sending` 排除重试发起窗口（resumeRun 入口 sending=true） |

### 4.2 后端改动

#### 4.2.1 `_persist_agent_message` 新增 `client_aborted` 入参

`backend/app/services/agent_runtime_service.py:773` 函数签名加参数，落库时写入标记：

```python
async def _persist_agent_message(
    self, *, session, user_message, run_id, envelopes,
    runtime_config, workflow_type,
    client_aborted: bool = False,   # 【新增】客户端中断标志
):
    """把 envelope 序列折叠为 blocks 并落库 agent 消息。

    client_aborted=True 时，在 content 中写入 interrupted=True 显式标记，
    供前端 reload 后识别中断态（不依赖 block 的 streaming 状态）。
    """
    blocks = self._envelopes_to_blocks(envelopes)
    content: dict[str, Any] = {"blocks": blocks}
    if client_aborted:
        content["interrupted"] = True        # 显式中断标记
    msg = await self._repo.create_message(
        session_id=session.id, ...,
        content=content, ...,
    )
```

#### 4.2.2 三条流式入口的 finally 调用点透传 `client_aborted`

后端有 3 个流式入口，均含 `client_aborted` 局部变量与 finally 落库段：

| 入口 | 位置 | 现状 |
|---|---|---|
| `stream_message` | `agent_runtime_service.py:266` | 已有 `client_aborted`，调用点加 `client_aborted=client_aborted` |
| `resolve_interaction` | `agent_runtime_service.py:426` 附近 | 实现时核实并补齐 |
| `resume` | `agent_runtime_service.py:572` 附近 | 实现时核实并补齐 |

每处 `_persist_agent_message(...)` 调用补 `client_aborted=client_aborted` 关键字参数。

#### 4.2.3 中断时落库空 agent 消息的处理

中断发生在 run 刚开始（`envelope_buffer` 为空）时，`_persist_agent_message` 仍会落库 `blocks=[]` 的空 agent 消息并打 `content.interrupted=true`。

**决策：接受空消息**（方案 a）。前端显示一条空 agent 气泡 + InterruptBar，语义清楚（agent 尚未生成就被中断）。`messages[last]?.content?.interrupted` 对 user 消息天然为 false（user 消息 content 无此字段），判定逻辑自洽。

### 4.3 前端类型层（`frontend/src/types/agent.ts`）

```typescript
export interface AgentRunState {
  // ...原有字段不动
  aborted: boolean;                // 【新增】用户主动中断标志（前端即时信号，刷新丢失）
}

export interface AgentMessage {
  // ...
  content: {
    blocks: AgentBlock[];
    context_refs?: Array<Record<string, unknown>>;
    interrupted?: boolean;         // 【新增】后端 client_aborted 时落库的持久化标记
  };
  // ...
}
```

### 4.4 前端 reducer 层（`frontend/src/utils/agent-run-reducer.ts`）

#### 4.4.1 `INITIAL_RUN_STATE` 加默认值

```typescript
export const INITIAL_RUN_STATE: AgentRunState = {
  // ...原有字段
  aborted: false,
};
```

#### 4.4.2 `run.start` 清除 aborted（两个分支）

resume 与非 resume 分支都加 `aborted: false` —— 新一轮 run 开始即清中断态。

#### 4.4.3 `resolveRunStateAfterFinish` 保留 aborted

```typescript
// 客户端主动中断特征：无 finish、无 error、且前端已置 aborted
const preserveAborted = !finish.hasFinish && !finish.hasError && prev.aborted;

return {
  ...INITIAL_RUN_STATE,
  workflow_type: prev.workflow_type,
  ...(isInterruptPause ? { steps: prev.steps } : {}),
  ...(preserveAborted ? { aborted: true } : {}),
};
```

四种收尾路径的 aborted 处理：

| 收尾场景 | hasFinish | hasError | prev.aborted | 结果 aborted |
|---|---|---|---|---|
| 正常 END | ✓ | ✗ | ✗ | false |
| interrupt 暂停（人机交互） | ✓ | ✗ | ✗ | false |
| 用户主动 abort | ✗ | ✗ | ✓ | **true（保留）** |
| 错误终态 | ✗ | ✓ | ✗ | false |

### 4.5 前端 store 层（`frontend/src/store/agent.ts`）

#### 4.5.1 `abort` action 路径1 设置 aborted

```typescript
abort: (sessionId) => {
  const ac = abortControllers.get(sessionId);
  if (ac) {
    ac.abort();
    // 【新增】立即设置前端中断标志，让 UI 瞬间显示提示（不等 reload）
    set((s) => ({
      runs: {
        ...s.runs,
        [sessionId]: {
          ...getRun(s.runs, sessionId),
          runState: { ...getRun(s.runs, sessionId).runState, aborted: true },
        },
      },
    }));
    return;
  }
  // 路径2：interrupt 态后端 abort（不变）
  // ...
}
```

#### 4.5.2 三个 run 入口启动时立即清除 aborted

`sendMessage` / `submitInteraction` / `resumeRun` 在设置 `sending: true` 的同一处 setState 中加入 `runState.aborted: false`。

**理由**：用户点「重试」/发新消息瞬间 InterruptBar 消失，不等 `run.start` envelope 到达，消除点击后短暂残留。

### 4.6 前端 UI 层

#### 4.6.1 `agent-message-list.tsx`

- **删除** `isLastAgentMessageInterrupted` 函数（`agent-message-list.tsx:188-193`）。
- **删除** `onRetryFromLastUser` prop（仅旧 InterruptBar 兜底用过，新设计不再需要「重发」入口）。
- 触发条件改为内联判定（`onResume` 改为必传，不再依赖 `onRetryFromLastUser` 兜底）：

```tsx
{!runState.error && (
  runState.aborted
  || (!runState.running && !sending && messages[messages.length - 1]?.content?.interrupted === true)
) && onResume && (
  <InterruptBar onResume={onResume} />
)}
```

#### 4.6.2 `interrupt-bar.tsx`（简化）

移除死代码 `isError` / `onRetry` / `retrying` / `resuming` props（错误态本就走独立红色 callout，从未以 `isError=true` 调用本组件；`resuming` 不需要——点击重试后 store 立即清 `aborted`，InterruptBar 瞬间消失，天然防重入）。`onResume` 改为必填 prop。仅保留中断态：

```tsx
export interface InterruptBarProps {
  onResume: () => void;       // 续接 checkpoint（必填）
}
// 文案：「本次任务已中断」→「任务已中断」
// 按钮：文字「恢复」→ RefreshCw 图标 + 「重试」
// 行为：保持 onResume（续接 checkpoint，A2 决策不变）
<button onClick={onResume}>
  <RefreshCw size={12} />
  <span>重试</span>
</button>
```

视觉沿用项目 sky/orange 体系，不引入新 token。

#### 4.6.3 `agent-workspace.tsx`（连带清理）

- 删除 `handleRetryFromLastUser` 函数（`agent-workspace.tsx:79-94`）。
- 删除传递给 `AgentMessageList` 的 `onRetryFromLastUser` prop。
- `onRetry={handleRetry}`（错误态红色 callout 用）与 `onResume={() => void resumeRun(sessionId)}` 保留不动。

## 五、信号生命周期与状态流转

```
[空闲]
  ↓ 发送消息（run.start，aborted=false）
[运行中] runState.aborted=false, running=true, sending=true
  ↓ 用户点「暂停」→ store.abort：ac.abort() + 置 aborted=true
[中断中] aborted=true, running 仍 true, sending 仍 true
  ← UI 立即显示 InterruptBar（分支 ① 不限 running），与 pseudoStreamingMessage 同屏：
    流式内容冻结在中断点 + 下方「任务已中断」提示，不等 reload
  ↓ 后端 finally 落库（content.interrupted=true）
  ↓ 前端 runEnvelopes 收尾 reload（单次 setState：running=false + 替换 messages）
[中断态] aborted=true, running=false, messages[last].content.interrupted=true
  ← pseudoStreamingMessage 消失，落库 agent 消息出现（内容一致无闪烁）；InterruptBar 持续显示
  ↓ 用户点「重试」→ resumeRun：入口立即清 aborted=false + sending=true
[重试发起窗] aborted=false, running=false, sending=true, content.interrupted 仍 true（上一轮）
  ← 分支 ① aborted=false 不触发；分支 ② !sending 不满足 → InterruptBar 不显示（避免残留误导）
  ↓ run.start envelope 到达（resume=true）
[运行中] running=true, aborted=false
  ↓ 正常 END → 新一轮 agent 消息 content.interrupted 不打标记
[结束] InterruptBar 不显示
```

### 四种场景的信号覆盖

| 场景 | 前端 aborted | 后端 interrupted | 结果 |
|---|---|---|---|
| 主动中断、不刷新 | ✓（点击瞬间） | ✓（reload 后） | 提示立即出现并持续 |
| 主动中断后刷新页面 | ✗（内存丢失） | ✓（DB 持久化） | 靠后端信号恢复 |
| 断网/崩溃后重开 | ✗ | ✓ | 同上 |
| 正常结束 | ✗ | ✗ | 不显示 |

## 六、边界场景处理

| # | 场景 | 信号走向 | 处理 |
|---|---|---|---|
| 1 | resume 时 checkpoint 已过期（服务重启 / Redis TTL） | 后端返 `run.error(no_resumable_checkpoint)` → `runState.error` 非空 | 现有：红色 callout 显示「流程状态已过期」，InterruptBar 因 `!error` 不显示 |
| 2 | 中断 + 后端落库失败 | `client_aborted=True` 时后端不发 `run.error`（连接已断）；`content.interrupted` 未落库 | 前端 `aborted=true` 保底显示 InterruptBar；刷新后信号丢失属极端边界，后端 ERROR 日志可追溯 |
| 3 | 中断在 run 刚开始（buffer 为空） | 落库空 agent 消息 + `content.interrupted=true` | 方案 a：显示空 agent 气泡 + InterruptBar |
| 4 | 连续中断（中断→重试→又中断） | 每次 run 独立：入口清 aborted、新一轮落库新消息 | 逻辑自洽，无需特殊处理 |
| 5 | resume 流途中再次点「暂停」 | resumeRun → run.start(resume) 清 aborted → 再次 abort 置 aborted + 后端 resume 路径落库 interrupted | 4.2.2 已覆盖（resume 入口透传 client_aborted） |
| 6 | interrupt 暂停态点「暂停」 | 此时 `sending=false`，Composer 显示「发送」非「暂停」；用户若发新消息走 `/abort` 端点（路径2），不经 `ac.abort()` | 不置 aborted，不显示 InterruptBar（语义正确：用户已主动发新消息） |
| 7 | 切换会话再切回 | `runs[sessionId].runState` 保留 | aborted 仍在，InterruptBar 自然持续 |

## 七、测试策略

### 7.1 前端单元测试

**`utils/__tests__/agent-run-reducer.test.ts`**：
- `run.start`（resume / 非 resume）→ `aborted: false`
- `resolveRunStateAfterFinish`：4 种收尾路径表驱动（abort 保留 / END·error·interrupt-pause 清除）

**`store/__tests__/agent-aborted.test.ts`**（新增）：
- `abort(id)` → `runState.aborted === true`
- `sendMessage` / `submitInteraction` / `resumeRun` 入口 → `aborted === false`
- 中断后 reload 回 `content.interrupted=true` 的消息 → InterruptBar 数据源成立

**`components/.../agent-message-list` 测试**：
- `aborted=true` → 渲染 InterruptBar
- `content.interrupted=true` → 渲染 InterruptBar
- 两者皆 false → 不渲染
- `error` 非空 → 不渲染（互斥）

**`interrupt-bar` 测试**：
- 文案「任务已中断」+ 按钮 RefreshCw +「重试」
- 点击触发 `onResume`

### 7.2 后端测试

**`tests/services/test_agent_runtime_service.py`**：
- 客户端中断（模拟 `GeneratorExit` / `CancelledError`）→ 落库 `agent_message.content.interrupted === true`
- 三条流式入口（`stream_message` / `resolve_interaction` / `resume`）参数化覆盖
- buffer 为空时中断 → 空消息 + `interrupted=true`
- 正常 END → `content.interrupted` 不存在

## 八、验收标准

1. 用户主动点击「暂停」按钮后，消息列表底部**立即**出现橙色「任务已中断」pill + RefreshCw +「重试」按钮（不等 reload）。
2. 中断后刷新页面，重新进入同一会话，InterruptBar 仍显示（靠 `content.interrupted` 持久化）。
3. 点击「重试」按钮 → 触发 `resumeRun` 续接 checkpoint → InterruptBar 立即消失，流式继续。
4. resume 时若 checkpoint 已过期 → 显示红色 callout「流程状态已过期」（现有行为不变）。
5. 中断前已生成的内容（text/tool_use/interview_questions 等 block）保留在消息列表中，不丢失、不闪烁。
6. `isLastAgentMessageInterrupted` 函数及其调用从代码中完全移除。
7. 后端三条流式入口的客户端中断路径均落库 `content.interrupted=true`。
8. 前端 reducer / store / UI 单元测试与后端 `test_agent_runtime_service` 测试全部通过。
9. 点击「重试」发起 resumeRun 到 `run.start` 到达之间（`sending=true`、`running=false`、上一轮 `content.interrupted=true` 仍在），InterruptBar **不显示**，避免残留误导用户以为没点成功。

## 九、改动文件清单

### 后端
- `backend/app/services/agent_runtime_service.py` —— `_persist_agent_message` 加 `client_aborted` 入参；三条流式入口 finally 调用点透传。
- `backend/tests/services/test_agent_runtime_service.py` —— 新增中断落库测试用例。

### 前端
- `frontend/src/types/agent.ts` —— `AgentRunState.aborted`、`AgentMessage.content.interrupted`。
- `frontend/src/utils/agent-run-reducer.ts` —— `INITIAL_RUN_STATE.aborted`、`run.start` 清除、`resolveRunStateAfterFinish` 保留逻辑。
- `frontend/src/store/agent.ts` —— `abort` 置标志、三个 run 入口清标志。
- `frontend/src/components/employee/agent/agent-message-list.tsx` —— 删除 `isLastAgentMessageInterrupted`、删除 `onRetryFromLastUser` prop、改触发判定。
- `frontend/src/components/employee/agent/interrupt-bar.tsx` —— 简化为仅中断态（移除 `isError`/`onRetry`/`retrying`）、文案图标改「重试」+ RefreshCw。
- `frontend/src/components/employee/agent/agent-workspace.tsx` —— 删除 `handleRetryFromLastUser` 及其 prop 传递（连带清理）。
- `frontend/src/utils/__tests__/agent-run-reducer.test.ts` —— 4 种收尾路径测试。
- `frontend/src/store/__tests__/agent-aborted.test.ts`（新增）—— abort 标志生命周期测试。
- `frontend/src/components/employee/agent/__tests__/` —— InterruptBar 渲染与交互测试。
