# Agent 进度持久化与 UI 修复 Design（Spec A）

> 日期：2026-06-22
> 状态：待实现
> 关联：Spec B（权限体系）、Spec C（对话式中途修正，含原 Bug B）

---

## 一、背景与根因

### 1.1 命门根因：flush 未 commit

`get_db()`（`backend/app/deps.py`）用的是 `mysql_manager.session()`（`backend/app/db/mysql.py:125`）——只 `yield session`，**不 `begin()`、不自动 commit**。SQLAlchemy 2.0 的 `async with session_factory() as session:` 退出时只 `close()`，未提交事务在连接归还连接池时被回滚。

`AgentRuntimeService` 中只有 `_persist_agent_message`（`agent_runtime_service.py:738`）显式 `commit()`；以下三处只 `flush` 不 `commit`，响应结束被回滚：

| 调用点 | 作用 | 是否 commit |
|---|---|---|
| `_persist_agent_message` | agent 消息落库 + `last_message_time` + `status` | ✅ commit |
| `_advance_task_id` | END 后推进 `current_task_id`（新 thread_id） | ❌ 只 flush |
| `_persist_block_index` | 更新 `last_block_index` | ❌ 只 flush |
| `_persist_progress` | 更新 `session.progress`（进度栏数据源） | ❌ 只 flush |

### 1.2 已确认现象（用户查库核实）

- `SELECT progress FROM agent_session` → **NULL**（根因实锤）。
- **所有会话刷新后进度节点全丢**——非中断专属；`getSession` 返回空 `progress` → `selectProgressSource` 回退空 → 进度岛只剩全 pending 模板。
- 继续任务时进度又对——那是**实时 `step.update` 事件**撑出来的，不是读持久化数据。
- `current_task_id` 推进同样丢失 → 多轮隔离语义受损（关联原 Bug B，在 Spec C 中处理）。

### 1.3 错误处理现状（用户提问盘点）

- Graph 业务异常 → `run.error` 信令前端 ✅
- 客户端中断 → `finally` 仍尝试落库 ✅（但落库 commit 缺失如上）
- **持久化失败基本静默**：`_persist_progress`/`_persist_block_index`/`_buffer_append` 只 `logger.exception` 不抛；`_persist_agent_message` 内部 `rollback+raise` 但**被 `finally` 的 `try/except` 吞掉**（置 `agent_message=None`）→ 前端无任何错误信号，刷新后数据消失。
- 无"落库失败 → 通知前端"回路。

---

## 二、范围

### 本 spec 包含

1. **Cluster 1**：持久化 commit 修复（后端）——**地基，优先做**。
2. **议题 2**：全局进度丢失——由 Cluster 1 解决。
3. **议题 3**：进入被中断会话时显示"任务已中断"+恢复按钮——核实 `InterruptBar`（Cluster 1 修好后大概率已生效）。
4. **议题 4**：进度节点序号——pending 空圈内显示数字。
5. **排序**：会话列表前后端统一按 `create_time` 降序。
6. **新 Bug A 残留 UI**：Cluster 1 修好后复测，残存（中断按钮常驻 / 假"提交中" / 自恢复）单独定位。

### 不在本 spec

- **Bug B**（进行中发消息的隔离/续接行为）→ **Spec C**：统一"注入消息 + 重跑当前节点"，需先 spike LangGraph 的 `update_state + astream(None)` 在"流式中断"与"interrupt 态"下的行为（interrupt 态可能需额外绕过 active interrupt）。
- **权限体系**（RBAC、替换硬编码 admin 邮箱）→ **Spec B**。

---

## 三、方案

### 3.1 Cluster 1：持久化 commit 修复（后端，`agent_runtime_service.py`）

**目标**：让 `_advance_task_id` / `_persist_block_index` / `_persist_progress` 的更新真正落库。

**做法**：在以下四个执行路径的末尾各补**一次** `await self._repo.commit()`（覆盖该路径上所有 `flush` 但未 `commit` 的更新）：

1. `stream_message` 的 `finally`（约 `agent_runtime_service.py:254-299`）
2. `resolve_interaction` 的 `finally`（约 `:397-440`）
3. `resume_run` 的 `finally`（约 `:526-572`）
4. `abort_pending_interaction`（约 `:848-888`）——当前 `_advance_task_id` 同样未 commit

**位置约束**：commit 必须在 `_persist_progress` 之后、`yield finish_env` 之前——保证 DB 一致性先于前端收到 `run.finish`。`client_aborted` 路径同样 commit（已生成内容要落库）。

**异常处理**：commit 包一层 `try/except`，失败 `logger.exception` 但不阻塞后续 `yield`/清理（与现有 `_persist_*` 的容错风格一致）。落库失败的前端通知见 §3.6。

**不采用**：不改 `get_db` 为 `mysql_manager.transaction()`——SSE 生命周期内 `session.begin()` 的提交时机与流式响应耦合，风险大于收益；显式 commit 更可控。

**验证**：修好后查库 `SELECT id, progress, current_task_id, last_block_index FROM agent_session WHERE id=?` 应能看到持久化值；刷新界面进度节点不再丢失。

### 3.2 议题 2：全局进度丢失

无需独立改动，由 3.1 解决。验收：任意会话（含已完成的）刷新后进度节点状态保留。

### 3.3 议题 3：进入被中断会话显示中断提示

**现状**：`InterruptBar`（`interrupt-bar.tsx`）已在 `isLastAgentMessageInterrupted(messages)`（最后一条 agent 消息含 `streaming` block）时渲染"本次任务已中断 + 恢复"按钮，调 `resumeRun`（`agent-workspace.tsx:127`）。pending interaction（status=pending）不误命中——符合"只对非人机交互中断显示"的要求。

**改动**：Cluster 1 修好后复测。预期 `InterruptBar` 已正常显示、`恢复` 按钮调 `resumeRun` 后进度能从持久化基线续上。若仍有缺口（如文案、按钮态）再微调，本 spec 不预先改。

**不做的**：不做"刷新后自动跳转到被中断会话"（用户已否决）。

### 3.4 议题 4：进度节点序号

**改动**：`ProgressPanel`（`progress-tracker/progress-panel.tsx:53`）把 `i+1` 传入 `StepRow`；`StepRow`（`step-row.tsx`）在 **pending 态的空圈内**显示数字（success/running/failed 仍用原图标）。

**接口**：`StepRow` 新增可选 prop `index?: number`；`StepIcon` 的 pending 分支渲染 `index`（提供时显示数字，未提供时保持空圈——向后兼容）。

**视觉**：数字用 `text-[12px] font-semibold text-[#64748B]`，与空圈边框配色一致。

### 3.5 排序：统一按 `create_time` 降序

**后端**：`AgentRepository.list_sessions`（`agent_repository.py:54`）排序改为 `AgentSession.create_time.desc(), AgentSession.id.desc()`。

**前端**：
- `refreshSessions`（`store/agent.ts:204-211`）：**移除**按 `last_message_time` 的兜底重排，单一信任后端 `create_time` 排序（避免前后端两套排序键打架）。
- `groupSessionsByTime`（`agent-sidebar-drawer.tsx`）及其单测：分组键从 `last_message_time` 改为 `create_time`（今日/本周/更早 按**创建时间**判定）。

**语义变化（需用户已知悉）**："今日"= 今天**创建**的会话，不是今天活跃的。一个三天前创建、今天刚发过消息的会话会落在"本周"组。

### 3.6 新 Bug A 残留 UI：复测优先

Cluster 1 修好后，以下症状大概率消失或变化，**先复测再决定是否单独改**：

- **数据消失**：直接由 3.1 解决（progress 等能存住了）。
- **中断按钮常驻**：怀疑是 `isLastAgentMessageInterrupted` 命中（旧 agent 消息残留 `streaming` block）。复测看是否仍复现；若复现，定位为何 `streaming` block 未在续接/完成后被覆盖为终态。
- **假"提交中"**：出题规划（plan_approval interaction）未提交却显示"提交中"——疑似 interaction block status 流转 bug 或前端乐观态残留。复测后定位 `interaction.resolve` / block.delta 的 status 写入路径。
- **过段自恢复**：疑似一次 reload/refresh 覆盖了乐观态。复测确认。

**错误处理改进（建议本 spec 顺手做，小改动）**：`_persist_agent_message` 失败时，当前静吞（`agent_message=None` → 跳过 `run.finish`）。改为 emit 一个 `run.error(code='persist_failed', retriable=True)`，让前端在落库失败时**显式报错**而非静默丢数据。前端 `agent-message-list.tsx` 现有 `runState.error` 红色 callout 复用即可。

---

## 四、测试策略

- **Cluster 1（后端）**：
  - 单测：mock repo，断言四条路径在 `finally` 末尾各调用一次 `commit()`。
  - 集成：跑完一轮 run 后查库，断言 `progress` / `current_task_id` / `last_block_index` 非空且与运行态一致。
  - 回归：现有 `test_agent_runtime_service.py` / `test_workflow_runner.py` 全过。
- **议题 4**：`step-strip.test.tsx` / `progress-panel` 相关单测加"pending 节点显示序号"用例。
- **排序**：`agent-sidebar-sort.test.ts` / `agent-sidebar-grouping.test.ts` 更新为 `create_time` 语义。
- **议题 3 / 新 Bug A**：以复测为主；改动项补对应单测。

## 五、风险

- **commit 位置的副作用**：在 `finally` 补 commit 后，若 `_persist_agent_message` 已 commit、后续 `_persist_*` flush 在新事务中，末尾 commit 合并提交它们——事务边界清晰，风险低。
- **排序语义变化**对用户感知的影响：老会话的分组位置会变（按创建时间归组）。已在 §3.5 标注，确认是用户要的语义。
- **新 Bug A 的"假提交中"** 若复测仍存在，可能涉及 interaction block status 在 `block.delta` / `interaction.resolve` 的写入逻辑，届时可能需要小改 emitter 或 reducer——留作本 spec 内的待定性任务，不扩大范围。

## 六、执行顺序

1. Cluster 1（§3.1）——地基，最先。
2. 议题 4 序号（§3.4）+ 排序（§3.5）——纯前端，可并行。
3. 议题 3 核实（§3.3）——依赖 Cluster 1。
4. 新 Bug A 复测 + 残留（§3.6）——依赖 Cluster 1。
5. 错误处理改进（§3.6 末尾）——顺手。
