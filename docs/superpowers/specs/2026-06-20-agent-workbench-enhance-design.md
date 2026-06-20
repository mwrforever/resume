# Agent 工作台体验强化设计文档

- 日期：2026-06-20
- 分支：worktree-agent-workbench-enhance
- 状态：待评审
- 关联：HTML 设计稿 `C:\Users\18229\.claude\jobs\3982a7eb\tmp\agent-progress-design.html`

## 一、背景与目标

当前 Agent 工作台存在四类体验问题，本设计一次性解决：

| 编号 | 问题 | 目标 |
|------|------|------|
| A1 | 用户未附简历就发消息，评估流程静默短路（空简历 END）、问答流程出通用题 | AI 识别简历缺失时，在对话内弹出上传组件，上传后自动续接 |
| A2 | 流式中断（点"中断"/关页刷新）后，下次发送会**重走整遍流程** | 中断后保留 checkpoint，下次"继续"从断点续接，不重跑 |
| A3 | 岗位选择一次性铺开最多 20 条，信息过载 | 分页（5 条/页）+ 搜索过滤 |
| B1 | 进度（读取简历→…→输出题库）嵌在会话内、仅流式时可见、刷新即丢 | 抽离到右侧可收起的进度追踪栏，基于 taste-v1 设计，含光波/弹簧动画 |

## 二、已确认的关键决策

经澄清问答与 HTML 设计稿评审确认：

1. **动画技术选型 = 引入 framer-motion**（Q1=A）。项目当前是纯 CSS 动画，本特性的进度侧栏引入 framer-motion 以实现 taste-v1 级别的弹簧物理 / `layout` 过渡 / `AnimatePresence` 进出场。保留现有纯 CSS 动画（WaveText 等）不动。
2. **中断续接机制 = B + ii**（Q2 触发方式选 B，放弃策略选 ii）。`current_task_id` 只在工作流 END 时推进；流式中断后由**既有"重试"按钮改为 resume 语义**触发续接（不新增"继续"按钮）；同一 task 必须续接到 END 才能开新问题（不支持放弃，错误/状态丢失除外）。interaction 暂停点续接本就可用，由 B1 持久化进度补足刷新后可见性。
3. **简历上传触发 = 发送时前置拦截**（Q3=A）。缺简历时在 `load_resume` 节点内 interrupt 弹上传卡，上传后继续同节点解析。
4. **设计稿已认可**：进度栏右侧 304px / 收起 60px；running 步骤四层光波效果（脉冲图标 + 整行光波扫掠 + 波浪文字 + 连接线流光点）；收起态悬浮 tooltip；A1 上传卡样式；A3 分页 + 搜索。

## 三、关键约束与风险

- **Checkpointer 是 `InMemorySaver`（进程内单例，不跨进程持久化）**。A2 的续接能力依赖 checkpoint：同一服务进程存活期间，刷新 / 离开后回来 / 中断后续接都可用；**服务重启后 checkpoint 丢失，无法续接（降级为重跑）**。这是 v1 既有折中（见 `_checkpointer.py` 注释）。本设计在续接失败时优雅降级为"重新开始"，并在文档标注后续可升级 `RedisSaver`/`SqliteSaver` 做持久化续接（**列入未来增强，不在本次范围**）。
- **每会话同一时刻只有一个活跃 run**（既有约束，护 LangGraph 同 thread 并发）。续接请求同样受此约束。
- **前端不直接调 axios**（项目规范）：所有新接口走 `src/api/employee/agent`。

## 四、整体架构

改动横跨后端 graph / runtime / 协议 / DDL 与前端组件 / store / api，但都在既有 `endpoint → service → repository → db → schema` 分层内，不新增越层调用。

```
┌─ 后端 ──────────────────────────────────────────────────────────┐
│ graphs/workflows   两图的 load_resume 节点内加"缺简历 interrupt" │
│ graphs/workflows   runner / runtime_service：中断不推进 task_id  │
│   runtime_service  新增 resume_run()（同 thread 续接）            │
│ api/v1/endpoints   新增 POST /sessions/{id}/resume               │
│ schemas/agent      InteractionType 加 resume_upload              │
│ models + DDL       agent_session 加 progress JSON 列             │
└──────────────────────────────────────────────────────────────────┘
┌─ 前端 ──────────────────────────────────────────────────────────┐
│ components/agent/ProgressTracker  右侧进度栏（新，替代 StepStrip）│
│ components/agent/blocks/          ResumeUpload 卡（新）          │
│   interaction-block               JobSelection 加分页+搜索       │
│ store/agent                       新增 resumeRun action          │
│ api/employee/agent                新增 resumeSession             │
└──────────────────────────────────────────────────────────────────┘
```

---

## 五、特性 A1：简历缺失时上传组件

### 5.1 方案

**不新增 graph 节点，不改步骤模板（保持 8 步）**。把"缺简历"检测折叠进既有的 `load_resume` 服务方法，复用 `interrupt()` 机制——与现有 `_request_dimension_selection` 等节点的 interrupt 续接模式完全一致。

两图（`interview_question_service.load_resume` 与 `resume_evaluation_service.load_resume`）改造逻辑相同：

```python
async def load_resume(self, state, ctx):
    file_path = str((state.get("resume_ref") or {}).get("file_path") or "")
    # 缺简历 → interrupt 弹上传卡（LangGraph resume 时本节点重跑，
    #   interrupt() 第二次调用直接返回用户提交值，随后走正常解析）
    if not file_path:
        user_values = interrupt(self._build_resume_upload_interaction())
        file_path = str(user_values.get("file_path") or "")
        if not file_path:
            raise ValidationError("未收到简历文件路径，无法继续")
    # file_path 此时必有值（原本附带 OR 刚上传）→ 正常 emit tool_use 块 + 解析
    ...（既有 tool_use block + loader.load_by_path 逻辑不变）
    return {"resume_text": text, "resume_ref": {"file_path": file_path, ...}}
```

### 5.2 协议改动

- `InteractionType`（`schemas/agent/stream/events.py`）增加 `"resume_upload"`。
- 新增 `build_resume_upload_interaction(state)` 构造 payload：
  ```python
  { "request_id": f"resume_{uuid.uuid4().hex[:8]}",
    "interaction_type": "resume_upload",
    "title": "需要先上传一份简历",
    "prompt": "检测到尚未附带简历…上传后将自动继续，无需重新发送",
    "data": {} }
  ```

### 5.3 前端

- 新增 `ResumeUpload` 交互卡（`blocks/interaction-block.tsx` 内新增分支 + 子组件）：
  - 拖拽/点击上传区（复用 HTML 稿 dropzone 样式），格式标签 PDF/DOCX/DOC。
  - 上传走既有 `POST /employee/agent/resumes`（返回 `file_path`/`file_name`）。
  - 上传成功后置为已选态，"确认"按钮提交 `{file_path, file_name}`。
  - 提交走既有 `submitInteraction`（`POST /sessions/{id}/interactions/{request_id}`）→ 后端 `Command(resume={file_path, file_name})` → load_resume 重跑拿到 file_path → 解析。
- `InteractionBlock` 的 switch 与终态只读分支补 `resume_upload` 类型。

### 5.4 边界

- 用户已附简历发送：`resume_ref` 非空 → 不触发 interrupt，行为不变。
- 上传后解析失败（文件损坏）：`loader.load_by_path` 抛错 → graph error → 走既有错误态（非 A2 续接范畴）。
- interaction 终态（submitted）只读回看：显示已上传文件名。

---

## 六、特性 A2：中断后续接（不重跑）

### 6.1 现状回顾

- `thread_id = session.current_task_id`；LangGraph checkpoint 按 thread_id 持久化。
- **interaction 暂停**（选维度/计划/岗位）：checkpoint 保留，task_id **不**推进，`resolve_interaction` + `Command(resume=values)` 续接。✅ 已可用。
- **流式中断**（点红色"中断"/关页刷新）：`client_aborted=True` → `advance = graph_completed or client_aborted` → 推进 task_id → 下次发送走新 thread → **重跑**。❌

### 6.2 方案：task_id 只在 END 推进；中断即暂停，重试即续接（B + ii）

核心规则（与你确认的模型一致）：

1. **`current_task_id` 只在工作流走到 END 时推进**。既有 finally 块的 `graph_completed` 分支保留；`client_aborted` 分支去掉。中断/刷新/报错都不动 task_id → 同一 task 的 checkpoint 始终保留。
2. **不新增"继续"按钮**（B）：流式中断后，既有 InterruptBar 的"重试"按钮语义从"重发(重启)"改为"续接(resume)"——复用既有 affordance，不引入新按钮。
3. **不支持放弃**（ii）：同一 task 必须续接到 END 才能开始下一个问题；没有"放弃当前流程"出口。

后端 `agent_runtime_service`：

1. `stream_message` finally：`advance = graph_completed`（去掉 `or client_aborted`）。client_aborted 仍落库已生成内容，但保留 thread → checkpoint 完好可续接。
2. 新增 `resume_run(session, runtime_config, workflow_type)`：与 `resolve_interaction` 同构，`graph_input=None`，同 thread 续接。被中断节点重跑，产出作为新 agent 消息追加；后续节点正常执行。收尾仍 `advance = graph_completed`（再次中断可继续续接）。
3. 新增端点 `POST /sessions/{id}/resume`（鉴权 + runtime_config + workflow_type 从最近消息推导，返回 SSE）。
4. **不需要"脏 thread 守卫"**：ii 下发送新消息只在 END 后发生（见 6.3），stream_message 永远跑在干净 thread 上，无需检测/推进。

### 6.3 续接与新问题的边界（ii 模型）

- **流式中断** → 会话处于"暂停态"（最后一条 agent 消息含 `streaming` block，`isLastAgentMessageInterrupted=true`）。前端 InterruptBar 显示，"重试"按钮 = 调 `POST /resume` 续接（B：复用既有按钮，不新增）。
- **interaction 暂停**（选维度/计划/岗位）→ 天然续接：提交卡片 = resume。不变。
- **新问题**：ii 下，工作流未到 END 时不允许开新问题——**Composer 在工作流未完成期间禁用发送**（running / interaction 暂停 / 流式中断 三态都禁用发送，引导用户用对应的 resume / 卡片提交动作）。只有工作流 END（task_id 已推进、会话回到 idle）后，Composer 才允许发送新消息，走全新 task。
- 这条规则让 stream_message 永远在干净 thread 上跑，无需脏 thread 守卫，也彻底消除"中断后重跑整遍"的可能。

> 判定"被中断的 run"：最后一条 agent 消息含 `status='streaming'` 的 block（既有 `isLastAgentMessageInterrupted` 信号）。client_aborted 后 finally 落库保留该信号；task_id 未推进 → checkpoint 完好 → 可续接。
> 错误态（`run.error`）不可续接（续接会重现错误）：错误态的"重试"= 放弃当前 task 重新发，作为错误恢复出口（见 6.5，是系统强制重置，非用户主动放弃）。

### 6.4 前端改动

- `store/agent.ts` 新增 `resumeRun(sessionId)`：调 `employeeAgentApi.resumeSession` → SSE → 复用 `runEnvelopes` 消费。
- `api/employee/agent.ts` 新增 `resumeSession(sessionId, runtimeOptions, signal)`（SSE，同 streamMessage 形态）。
- `interrupt-bar.tsx`：被中断态的"重试"按钮文案改"恢复"，点击调 `resumeRun`（不再调 `onRetryFromLastUser`）。错误态保持"重试"（= 放弃当前 task 重发，见 6.5）。
- `agent-workspace.tsx` / `agent-composer.tsx`：工作流未完成期间禁用发送（running / interaction 暂停 / 流式中断 三态 `submit` 禁用 + 提示"请先完成上方流程/恢复运行"）。interaction 暂停时用户改用卡片自身输入（维度卡补充意见、计划卡编辑等）表达意图。
- **移除 interaction 暂停态 Composer 的"中断"红色按钮**：既有 `abort_pending_interaction`（推进 task_id）路径在 ii 下不再使用——不放弃。Composer 在 interaction 暂停时为禁用发送态，不再提供 abort 入口。

### 6.5 降级与风险

- **服务重启 / checkpoint 丢失**：`resume_run` 调 `graph.astream(None)` 找不到 checkpoint → LangGraph 抛错 → 端点返回 `run.error(code="no_resumable_checkpoint", retriable=False)` → 前端提示"流程状态已过期，请重新发送"，并**临时允许发送新消息**（resume 不可行时唯一出路是开新 task——这是状态丢失的系统强制重置，非用户主动放弃）。
- **run.error（节点抛错）**：续接会重现同一错误，故错误态不可续接。错误态 InterruptBar"重试"= 放弃当前 task（推进 task_id）重新发送，作为错误恢复出口（ii 的唯一例外，由"无法前进"触发，非用户随意放弃）。
- **被中断节点重跑**：部分输出已在历史消息；续接产出作为**新 agent 消息**追加（既有 `_persist_agent_message` 每 run 一条消息）。用户视角：旧消息（已中断）+ 新消息（续接结果）；进度上"之前的步骤不重跑，仅断点处续上"。
- **InMemorySaver 跨进程不持久化**：续接仅在同一服务进程存活期内可用。未来升级 `RedisSaver`/`SqliteSaver` 可跨重启续接（列为未来增强）。

---

## 七、特性 A3：岗位分页 + 搜索

纯前端，无后端改动（候选岗已在 interaction data，上限 20）。

`blocks/interaction-block.tsx` 的 `JobSelection` 组件改造：

- 顶部搜索框 + 显式"搜索"按钮（**手动搜索，输入不自动过滤**）：
  - **搜索按钮 / Enter 触发过滤**：点击"搜索"或按 Enter 才执行过滤；输入过程中不搜。
  - **节流（throttle，leading-edge 300ms）**：搜索动作距上次执行不足 300ms 则忽略，防止连点 / Enter+点击叠加导致重复过滤。
  - **清除按钮（×）**：清空输入并立即重置（清除是幂等动作，不走节流；同时重置节流计时让紧接的搜索能立即生效）。
  - 输入框仅用于录入关键词 + 切换清除按钮显隐，不触发任何过滤。
  - 过滤维度：岗位名 + 描述，大小写/中英文不敏感。
- 列表分页：每页 5 条，上一页/下一页按钮 + 页码点指示器。
- 联动：过滤变更 → 重置到第 1 页 → 按过滤后数量重算页数；若已选岗位被过滤掉 → 清空选择 + 禁用确认按钮。
- 空态：过滤无结果时显示"未找到匹配「xxx」的岗位"。
- 提交载荷不变：`{selected_job_name}`。

> 节流实现要点：用 `useRef` 持有上次执行时间戳（不进 React state），`applySearch` 开头判断 `Date.now() - last < 300` 则直接 return；按钮/Enter 共用同一条 `applySearch`，清除单独处理（清空 + 重置时间戳）。

只读终态（`ReadOnlyJobSelection`）不变（历史回看仍是全量高亮选中项）。

---

## 八、特性 B1：右侧进度追踪栏

### 8.1 布局

`AgentStandaloneLayout` 的 `.body` 由 `两栏`（左会话栏 + 中工作区）改为 `三栏`（左 + 中 + 右进度栏）：

```
grid-template-columns: 220px 1fr auto;  /* 右栏 auto = 304px 或 60px */
```

进度栏抽离自 `AgentMessageCard` 内的 `StepStrip`：从消息卡内**移除** StepStrip 渲染，改为 layout 层渲染单一 `ProgressTracker`（绑定当前活跃会话的 runState / 持久化进度）。

### 8.2 ProgressTracker 组件结构

```
ProgressTracker（右侧栏容器，控制展开/收起 + 宽度过渡）
├─ 头部：标题 + 收起按钮 + 进度环(SVG) + "N/8 步" + 当前步骤名
├─ 步骤列表（垂直，自上而下）
│   └─ StepRow × N
│        ├─ 连接线（已完成段实色 + 流光点；待执行段虚灰）
│        ├─ 图标（pending 空心圈 / running 脉冲渐变球 / success 绿勾 / failed 红 X）
│        └─ 文字（标题；running 时波浪文字；detail 子标题）
└─ 收起态：60px 细栏，仅图标列 + 悬浮 tooltip
```

### 8.3 动画（framer-motion，taste-v1）

- **展开/收起**：`<motion.aside animate={{width: collapsed?60:304}} transition={{type:'spring',stiffness:120,damping:20}}>`；内部列表用 `AnimatePresence` + `layout` 让步骤在宽度变化时平滑重排。
- **步骤状态切换**：StepRow 包 `motion.div layout`，状态变化（pending→running→success）时图标/配色用 `layout` + `AnimatePresence` 平滑过渡，无硬切。
- **running 四层光波**（CSS 实现，framer-motion 管容器）：
  1. 图标脉冲呼吸光圈（`box-shadow` 扩散 keyframe）
  2. 整行光波扫掠（`::before` 渐变 `background-position` 循环）
  3. 标题波浪文字（复用既有 `WaveText` 组件）
  4. 已完成段连接线流光点（小圆点沿连接线 `top` 下落 keyframe）
- **入场 stagger**：步骤列表 `staggerChildren`（每项 45ms 级联）；切换工作流模板时整体重挂载级联。
- **收起态 tooltip**：单例 tooltip 挂 body（`position:fixed` 规避栏 `overflow:hidden`），mouseenter 时按图标 `getBoundingClientRect` 定位到左侧，显示"状态点 + 步骤名 + 状态文案"。

### 8.4 持久化进度（支撑 A2 + 刷新后可见）

当前 `step.update` 仅在前端 runState 内、不持久化 → 刷新即丢。为让进度栏在刷新/离开回来后仍显示"当前第 N 步"，把累积步骤持久化到会话：

**后端：**
- DDL：`agent_session` 加列 `progress JSON NULL`（存 `{workflow_type, steps:[{step_id,title,status,detail}]}`）。
- Model `AgentSession.progress` + Schema `AgentSessionItem.progress`。
- `agent_runtime_service`：每个 `step.update` envelope 落 buffer 时，同步 upsert `session.progress.steps`（按 step_id 去重，与前端 reducer 语义一致）。**重置时机**：仅 `stream_message`（新用户消息 = 新 task）开头重置 progress 为空；`resolve_interaction`（interaction 续接）与 `resume_run`（中断续接）**不**重置——它们属于同一 task，步骤跨段累积。失败仅日志不阻塞。
- 会话详情（`getSession`）返回 `progress`。

**前端：**
- `WorkspaceSession` 类型加 `progress?: {workflow_type, steps}`。
- `ProgressTracker` 数据源优先级：流式中 = `runState.steps`（实时）；非流式（历史/暂停态）= `session.progress.steps`（持久化）。两者都经 `mergeStepsWithTemplate` 补齐 pending 项。
- 收起态、进度环、当前步骤均基于合并后步骤计算。

### 8.5 两个工作流模式

`WORKFLOW_STEP_TEMPLATES` 既有两套模板（各 8 步）直接复用。进度栏根据 `workflow_type`（流式取 runState，历史取 progress）选模板。模式切换（Composer 切 interview_questions/resume_evaluation）即时重挂载步骤列表。

### 8.6 StepStrip 退役

- `AgentMessageCard` 移除 StepStrip 渲染分支（流式段头下方的折叠条）。
- `step-strip.tsx` 可保留（导出 `StepIcon` 等供 ProgressTracker 复用）或整体迁入 ProgressTracker；实现期决定，倾向后者以减少冗余。

---

## 九、数据与协议变更总览

### 9.1 DDL

```sql
ALTER TABLE agent_session ADD COLUMN progress JSON NULL COMMENT '累积步骤进度（支撑进度栏持久化展示）';
```

对应 Alembic 迁移（项目若有）/ 手工 SQL（与既有 DDL 管理方式一致）。

### 9.2 协议（schemas/agent/stream/events.py）

- `InteractionType` 增加 `"resume_upload"`。
- 不新增 envelope type：A1 复用 interaction.request/resolve；A2 续接复用 run.start(resume=True)/step/block/run.finish。
- 新增错误码 `no_resumable_checkpoint`（A2 续接时 checkpoint 不存在的降级）。

### 9.3 新增端点

| 方法 | 路径 | 用途 |
|------|------|------|
| POST | `/employee/agent/sessions/{id}/resume` | 续接被中断的 run（A2） |

A1 上传复用既有 `POST /employee/agent/resumes` + `POST /sessions/{id}/interactions/{request_id}`。

### 9.4 前端类型/Store/API

- `types/agent.ts`：`InteractionType` 加 `resume_upload`；`WorkspaceSession` 加 `progress?`。
- `store/agent.ts`：加 `resumeRun(sessionId)` action。
- `api/employee/agent.ts`：加 `resumeSession(...)`（SSE）。

---

## 十、测试策略

### 10.1 后端

- **A1**：`load_resume` 缺简历 → interrupt → 提交 `{file_path}` → 重跑解析出 `resume_text` 非空；已附简历 → 不 interrupt。
- **A2**：模拟 client_aborted → 断言 task_id **未**推进；`resume_run(None)` → 从 checkpoint 续接，产出新 agent 消息；checkpoint 不存在（模拟清空）→ 返回 `no_resumable_checkpoint` 错误码。
- **progress 持久化**：多段 step.update 后 `session.progress.steps` 累积正确；新 task 重置。
- 复用既有 `tests/` 下 graph/runtime 测试夹具。

### 10.2 前端

- **B1**：`ProgressTracker` 渲染两套模板；running 四层效果 class 正确挂载；收起/展开宽度过渡；收起态 tooltip 定位。
- **A1**：`ResumeUpload` 卡上传 → 提交 `{file_path,file_name}`；终态只读回看。
- **A3**：输入不触发搜索；搜索按钮/Enter 触发过滤且 300ms 节流防连点；分页联动 + 空态 + 清除按钮；已选被过滤清除。
- **A2**：InterruptBar 中断态"恢复"按钮调 `resumeRun`（非重发）；错误态"重试"= 放弃当前 task 重发；工作流未完成时 Composer 发送禁用。
- 既有 `__tests__/`（step-strip、group-blocks、sidebar 等）随 StepStrip 迁移同步更新。

### 10.3 手工验收

按 HTML 设计稿对照：进度栏位置/宽度、光波四层、收起 tooltip、A1 上传卡、A3 分页搜索，与生产构建一致。

---

## 十一、实施分期建议

四特性可独立验收，建议按依赖顺序分两期提交（一份实现计划可拆对应任务）：

1. **期一（后端基础 + A1 + A3）**：A1 interrupt 改造、A3 纯前端分页搜索、progress 持久化 DDL+落库。风险低、互不阻塞。
2. **期二（A2 + B1）**：A2 中断语义改 + resume 端点、B1 ProgressTracker（framer-motion）+ StepStrip 退役。B1 依赖期一的 progress 持久化字段。

---

## 十二、未来增强（不在本次范围）

- **持久化 Checkpointer**：`InMemorySaver` → `RedisSaver`/`SqliteSaver`，使 A2 续接跨服务重启可用。
- **进度栏可拖拽调宽**：当前固定 304/60px。
- **A1 上传支持拖拽进整个工作区**（目前仅卡内 dropzone）。
