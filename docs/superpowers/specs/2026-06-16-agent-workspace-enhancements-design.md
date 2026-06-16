# Agent 工作台增强设计（会话管理 + 驳回 + 模式切换 + task_id 隔离）

- 日期：2026-06-16
- 分支：dev
- 状态：已评审，待实现

## 一、背景与目标

当前 Agent 工作台存在四类缺口：

1. **会话管理能力不全**：无法删除会话、无法编辑会话标题；标题搜索已接后端但前端无防抖，每键触发请求。
2. **人机交互卡片缺少统一"驳回"**：只有 `plan_approval` 卡片有驳回（graph 内部带 feedback 循环），`dimension_selection` / `job_selection` 只有"确认"按钮，用户无法对 AI 建议表达"不满意、请重新生成"。
3. **模式切换强制新建会话**：`agent-composer.tsx` 中当会话已有消息时切换 workflow，会弹 confirm 并强制创建新会话，体验割裂。
4. **模型调用上下文未隔离**：当前 `thread_id = session.session_key` 固定不变，同一会话多轮对话共用同一 LangGraph thread/checkpoint 上下文，无法做到"每次工作流结束开启全新隔离上下文"。

目标：补齐会话管理 UI、统一交互卡片驳回语义、移除模式切换的硬性约束、引入基于 `current_task_id` 的上下文隔离机制。

## 二、关键决策（已与需求方确认）

| 决策点 | 结论 |
|--------|------|
| 「驳回重新生成」语义 | **graph 内部循环**（保持 LangGraph interrupt 机制），驳回时以"卡片内建议输入框的 feedback 内容"为依据回到上游节点重新生成；简历不调整。三类卡片（dimension_selection / plan_approval / job_selection）统一此行为。 |
| task_id 隔离模型 | `session.current_task_id`（首次 = 后端建会话时生成的 uuid）；**final 节点对应的工作流正常走到 END 时**生成 `next_task_id` 覆盖该字段，并通过 `run.finish` envelope 回传前端。`stream_message` / `resolve_interaction` 均读 `session.current_task_id` 作为 thread_id。 |
| task_id 存储 | **DB 持久化 + envelope 回传**（方案 3）。session 表只存"当前运行"的 task_id。 |
| 字段命名 | session 表字段：`current_task_id`；envelope 字段：`next_task_id`。 |
| 标题编辑入口 | Topbar 标题 inline 编辑 + 侧栏会话项 hover 编辑图标，两处都可重命名。 |
| 删除入口形式 | 侧栏会话项 hover 显示删除图标，点击弹 confirm 二次确认后软删除。 |

## 三、thread_id 隔离机制（核心架构）

### 3.1 数据流

```
创建会话
  → session.current_task_id = uuid_1（后端 create_session 时生成）
  ↓
stream_message(thread_id = session.current_task_id = uuid_1)
  → graph 运行
      ├── 遇到 interrupt（dimension/plan/job 卡片）
      │     → resolve_interaction(thread_id = uuid_1)  # 同一 task 内 resume
      │           ├── approve → 继续往后走
      │           └── 驳回（regenerate/feedback）→ 回上游节点重新生成（task_id 不变）
      └── 走完到 final 节点 → graph END
            → 后端生成 next_task_id = uuid_2
            → UPDATE session SET current_task_id = uuid_2
            → run.finish envelope.data.next_task_id = uuid_2  # 回传前端
  ↓
下一轮 stream_message(thread_id = session.current_task_id = uuid_2)
  → 全新隔离的 checkpointer 上下文（MemorySaver 按 thread_id 隔离）
```

### 3.2 为什么自洽

- **MemorySaver 是进程内单例**，`thread_id` 是隔离的唯一 key。不同 task_id → 不同 thread → checkpoint 上下文完全隔离。
- **同一 task_id 内**的 approve/驳回（resolve_interaction）复用同一 thread_id 才能 resume 中断点；因为 `next_task_id` 仅在 graph 正常 END 时才生成，驳回走 graph 内循环不 END，故 task_id 不变 → resume 仍指向同一 thread。
- **驳回语义**与隔离机制天然契合：驳回是"本任务内的修正"，不应开新上下文。

### 3.3 next_task_id 生成时机

放在 **`AgentRuntimeService` 收尾处**（而非 final 节点内部），原因：

- final 节点（`finalize_question_set` / `finalize_evaluation_report`）目前是纯 service 调用薄壳，拿不到 repo，也不应承担 session 写库职责（越层）。
- 在 `stream_message` / `resolve_interaction` 的 graph 迭代**正常结束**（非异常、非中断）后、`_persist_agent_message` 之前，由 RuntimeService 生成 next uuid 并 update session。这样：
  - final 节点逻辑无需改动（保持薄壳）。
  - 生成时机精确 = graph 正常走到 END（含 approve 后走完 final；不含驳回循环、不含 run.error）。
  - 职责清晰：RuntimeService 管编排与 session 状态，节点管业务。

> 注：`resolve_interaction` 中若 approve 后 graph 继续走到 END，同样会在其收尾处生成 next_task_id。

## 四、详细改动点

### 4.1 后端

#### a) `models/agent_session.py`（+ DB 迁移）
新增字段：
```python
current_task_id: Mapped[str] = mapped_column(String(64), nullable=False)
```
配套迁移（DDL）：
```sql
ALTER TABLE agent_session
  ADD COLUMN current_task_id VARCHAR(64) NOT NULL DEFAULT '' AFTER session_key;
-- 旧数据 current_task_id 留空，首次新发消息时由 RuntimeService 兜底生成（见 4.1.f）。
```

#### a2) `llm/graphs/workflows/state.py`
`ResumeEvaluationState` 增加驳回反馈字段（供 job 驳回后上游节点读取）：
```python
# 岗位选择卡片驳回时的反馈，作为 load_job_candidates 重新加载的参考
job_feedback: str
```
（`InterviewQuestionState` 的 `dimension_feedback` 已存在，无需新增。）

#### b) `schemas/agent/response.py`
`AgentSessionItem` 增加：
```python
current_task_id: str
```

#### c) `schemas/agent/stream/events.py`
`RunFinishData` 增加可选字段：
```python
class RunFinishData(_AllowExtra):
    agent_message_id: int
    next_task_id: str | None = None
```

#### d) `llm/streaming/emitter.py`
`emit_run_finish` 增加参数：
```python
def emit_run_finish(self, *, agent_message_id: int, next_task_id: str | None = None) -> AgentStreamEnvelope:
    data = RunFinishData(agent_message_id=agent_message_id, next_task_id=next_task_id).model_dump(mode="json")
    return self._wrap(type="run.finish", data=data)
```

#### e) `services/agent_session_service.py`
`create_session`：生成首个 task_id 写入。
```python
session = await self._repo.create_session(
    session_key=uuid.uuid4().hex,
    current_task_id=uuid.uuid4().hex,   # 新增
    employee_id=employee_id,
    ...
)
```

#### f) `services/agent_runtime_service.py`
1. `stream_message` 与 `resolve_interaction`：
   - `thread_id` 由 `session.session_key` 改为 `session.current_task_id`。
   - **兼容旧数据**：若 `current_task_id` 为空，运行前兜底生成并 update session（避免迁移期间旧会话报错）。
2. graph 正常结束后（runner.astream 迭代完毕、未抛异常），在收尾处：
   ```python
   next_task_id = uuid.uuid4().hex
   await self._repo.update_session(session.id, current_task_id=next_task_id)
   ```
3. `emit_run_finish` 传入 `next_task_id`。

> 关键：仅在 try 块内 graph 正常跑完才生成 next_task_id；`except` 走 run.error 分支不生成，task_id 保持不变（保证中断态仍可 resume）。

#### g) `llm/graphs/workflows/interview_questions.py` / `resume_evaluation.py`
interaction 节点增加 regenerate 分支：

- `_request_dimension_selection`：
  ```python
  user_values = interrupt(payload)
  if user_values.get("regenerate"):
      # 驳回：带 feedback 回 suggest_dimensions 重新建议
      return Command(
          goto="suggest_dimensions",
          update={"dimension_feedback": str(user_values.get("feedback") or "")},
      )
  # 正常：保留现有 selected_dimensions / dimension_feedback 逻辑
  ```
- `_request_job_selection`（resume_evaluation.py）：
  ```python
  user_values = interrupt(payload)
  if user_values.get("regenerate"):
      # 驳回：带 feedback 回 load_job_candidates 重新加载候选岗
      return Command(
          goto="load_job_candidates",
          update={"selected_job_name": "", "validation_attempts": 0,
                  "job_feedback": str(user_values.get("feedback") or "")},
      )
  return Command(update={"selected_job_name": str(user_values.get("selected_job_name") or "")})
  ```
- `_request_plan_approval`：现有 `{approved:false, feedback}` 驳回逻辑保留不变（已符合统一语义）。

### 4.2 前端

#### a) `types/agent.ts`
- `WorkspaceSession` 增加 `current_task_id: string`。
- `RunFinishData` 对应类型增加 `next_task_id?: string`（可选，仅记录用）。

#### b) `api/employee/agent.ts`
- `updateSession` / `deleteSession` 已存在，无需新增。
- 确认 `WorkspaceSession` 透传 current_task_id（前端不主动用其调接口，仅 store 内部/调试用）。

#### c) `store/agent.ts`
新增 actions：
```typescript
deleteSession: async (id: number) => {
  await employeeAgentApi.deleteSession(id);
  set((s) => ({
    sessions: s.sessions.filter(x => x.id !== id),
    activeId: s.activeId === id ? (s.sessions.find(x => x.id !== id)?.id ?? null) : s.activeId,
    // 清理 runs[id]
  }));
};
renameSession: async (id: number, title: string) => {
  await employeeAgentApi.updateSession(id, { title });
  // 同步 sessions / runs[id].session
};
```
- `runEnvelopes` 处理 run.finish 时，把 `next_task_id` 同步到 `runs[id].session.current_task_id`（与后端 update 一致，保证前端状态正确）。

#### d) `components/.../layout/agent-sidebar-drawer.tsx`
展开态会话项改造：
- 鼠标 hover 时，右侧浮出两个小图标按钮：**编辑（Pencil）** 和 **删除（Trash2）**。
- 编辑：点击进入 inline `<input>`，回车/失焦提交 → `renameSession`；Esc 取消。
- 删除：点击 `window.confirm('删除该会话？')` → `deleteSession`。
- 折叠态列表无 hover 空间，不加操作入口（折叠态仅快速切换）。

#### e) `components/.../layout/agent-topbar.tsx`
中央会话标题改为 inline 编辑：
- 默认展示标题文本。
- 点击/双击切换为 `<input>`（受控），回车/失焦提交 → `renameSession`；Esc 取消。
- 空标题时回退占位"未命名会话"。

#### f) `components/.../blocks/interaction-block.tsx`
- `DimensionSelection`：在"确认选择"按钮旁加次要按钮「驳回重新建议」；点击提交 `{ regenerate: true, feedback: feedback.trim() }`（复用现有 feedback textarea）。
- `JobSelection`：加 feedback textarea（与其他两卡一致）+「驳回重新选岗」按钮；点击提交 `{ regenerate: true, feedback: feedback.trim() }`。后端 `_request_job_selection` 的 regenerate 分支把 feedback 写入 state 供 `load_job_candidates` 上游节点参考（如调整岗位筛选条件）。
- `PlanApproval`：保持现有「批准 / 驳回并重生成」不变。
- 三处驳回按钮统一次要样式（border + 灰字），主操作（确认/批准）保持主色填充。

#### g) `components/.../agent-composer.tsx`
- `handleWorkflowClick`：移除 `if (hasMessages) { confirm...; onRequestNewSession }` 分支，统一为 `setWorkflow(next)`。
- 清理 `creatingSession` state；若 `onRequestNewSession` 不再有其他调用方，一并从 props 链路（Workspace / Layout）移除。

#### h) `components/.../layout/agent-standalone-layout.tsx`
- 搜索防抖：`keyword` 用 300ms 防抖后再调 `refreshSessions`（用 `useRef` + `setTimeout` 或自写 `useDebouncedValue`）。

## 五、错误处理与边界

- **旧数据兼容**：迁移后旧会话 `current_task_id` 为空，RuntimeService 首次运行时兜底生成，避免空 thread_id 导致 LangGraph 报错。
- **run.error 不推进 task_id**：保证中断/异常态下 task_id 不变，用户重试仍能命中正确 thread（虽然 MemorySaver 重启会丢，但这是已知折中）。
- **驳回循环上限**：dimension/job 的 regenerate 当前不设硬上限（AI 建议本身可迭代）；若后续观察到死循环，可加计数器。plan 驳回同理。
- **删除当前运行中的会话**：store `deleteSession` 应先 abort 对应 AbortController，再删除，避免流悬挂。

## 六、验收标准

1. 侧栏会话项 hover 出现编辑/删除按钮；删除弹 confirm 后会话从列表消失且切到下一个；重命名后 Topbar 与侧栏标题同步。
2. Topbar 标题点击可编辑，提交后持久化（刷新仍在）。
3. 搜索框连续输入时后端只收到防抖后的请求。
4. dimension_selection / job_selection 卡片有"驳回"按钮，点击后回到上游节点重新生成（维度建议刷新 / 岗位列表刷新）。
5. 同一会话内切换 workflow 不再弹 confirm、不再新建会话，直接切换模式标签。
6. 同一会话发两轮消息：第二轮运行时 thread_id 与第一轮不同（可通过日志 `current_task_id` 变化验证），且第一轮的中断态不影响第二轮。
7. 驳回（graph 内循环）期间 task_id 不变；approve 走完 final 后 task_id 推进。

## 七、不在本次范围

- 持久化 checkpointer（替换 InMemorySaver 为 SqliteSaver/PostgresSaver）：保持现状，未来单独立项。
- 会话归档/批量删除：仅单会话软删除。
- interaction 卡片驳回次数限制：暂不加。
