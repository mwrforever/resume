# 简历上传与懒建会话重构设计

- 日期：2026-06-16
- 分支：dev
- 状态：待评审
- 关联：与 `2026-06-16-agent-workspace-polish-design.md`（8 项打磨）独立，是会话/简历生命周期的重新设计。

## 一、背景与目标

当前"新建会话"点击后要等后端建会话返回才响应（有感知延时），且多次点击会创建多个会话。更根本的问题：简历上传与 session_id 强耦合——上传接口 `POST /sessions/{id}/resumes` 必须挂在已存在的会话上，还会写 Redis session_ref 做"同会话记住上份简历"。

目标：
1. **点新建立即响应**：点击"新建会话"前端立即渲染空输入区（虚拟会话），首条消息发送时才真正建会话。
2. **简历上传脱离 session**：上传只存文件返回路径，不依赖 session_id、不入 resume 表、不解析、不缓存。
3. **简历内容由 checkpoint 管理**：首条消息携带 `file_path`，graph 的 `load_resume` 节点解析后写入 state，同 task 内由 checkpoint 复用，不依赖 Redis 缓存。

数据流定稿（已与需求方确认）：
```
上传 POST /employee/agent/resumes (无 session_id)
  → LocalStorage.upload(file) → file_path
  → 返回 { file_path, file_name }              ← 不入表、不解析、不缓存

首条消息 context_refs: [{type:'resume', file_path, file_name}]
  → load_resume 节点：extract_resume_text(file_path) → state.resume_text
  → checkpoint（InMemorySaver, thread_id 维度）管理，同 task 后续节点直接读 state
  → 新 task（END 推进后）重新解析（可接受，无 Redis 依赖）
```

关键事实（探查确认）：
- `load_resume` 是 `add_edge(START, "load_resume")` 的首节点，单向到下游，**驳回循环不回到它**——同 task 内只解析一次，state 复用无浪费。
- graph state 字段 `resume_text`（`InterviewQuestionState`/`ResumeEvaluationState`）已是 checkpoint 字段，复用，不新增字段。
- 现有 graph 只消费 `resume_ref.resume_id`，不消费 `file_path`——需改 `load_resume` 节点 + `ResumeLoader`。
- `context_refs` 在 `agent_message.content` 已落库（本次打磨已做），前端据此渲染文件图标，保留。

## 二、关键决策（已与需求方确认）

| 决策点 | 结论 |
|--------|------|
| 上传是否入 resume 表 | **不入表**。只存文件返回 file_path/file_name，失去归属记录/去重/简历库列表（Agent 上传的简历不在简历库）——可接受。 |
| 解析结果缓存 | **不用 Redis**。完全由 checkpoint 管理：同 task 内 state 复用，新 task 重解析。 |
| state 字段 | 复用现有 `resume_text`（不新增字段），来源从 resume_id→DB 改为 file_path→解析。 |
| Redis session_ref | **完全删除**。"同会话自动记住上份简历"行为取消（懒建会话后本就无意义）。 |
| 虚拟会话 id | 负数临时 id（`-Date.now()`），建会话后替换为真实 id。 |
| send 时序 | 虚拟会话首条消息：先建会话拿真实 id → 替换虚拟会话 → 再 streamMessage。 |
| 失败回滚 | 建会话失败 → 移除虚拟会话 + 提示，用户可重试。 |
| 文件存储隔离 | file_path 含 employee 维度目录（如 `resumes/{employee_id}/{uuid}.pdf`）保证归属隔离。 |

## 三、详细设计

### 3.1 后端

#### a) 新上传接口（脱离 session）：`POST /employee/agent/resumes`
- `backend/app/api/v1/endpoints/agent.py`
- 入参：`file`（multipart UploadFile），`current_user`（auth 依赖取 employee_id）。
- 行为：调用存储层存盘（路径含 employee 隔离目录）→ 返回 `{ file_path, file_name }`。
- **不**调 `ResumeService.upload_resume`、**不**入 resume 表、**不**解析、**不**写 Redis。
- 删除旧接口 `POST /sessions/{session_id}/resumes`（`upload_resume` endpoint）。

#### b) 存储层
- 复用 `LocalStorage.upload(file, relative_path)`（已支持 `relative_path` 参数，见 `backend/app/utils/storage/local.py:14`）。
- employee 隔离：调用时传 `relative_path=f"agent_resumes/{employee_id}/{uuid}{ext}"`，返回该相对路径作为 file_path。
- `load_by_path` 读文件时用 `storage.get_full_path(file_path)`（local.py:44）拼完整路径再 `extract_resume_text`。

#### c) `load_resume` 节点改 file_path 解析
- `_resolve_resume_ref`（`agent_runtime_service.py:335-360`）：
  - `context_refs` 取 `{type:'resume', file_path, file_name}`（不再要 resume_id，file_path 必填）。
  - **删除 Redis session_ref fallback**（连同 `get_session_ref` 调用）。
  - 返回 `{"file_path": ..., "file_name": ...}`。
- `ResumeLoader`（`backend/app/services/resume_loader.py`）：
  - 新增 `load_by_path(file_path: str) -> str`：直接 `extract_resume_text(完整路径)`，无缓存。
  - 保留 `load(resume_id)` 供旧路径（若有其他调用方），但 agent 链路改用 `load_by_path`。
- `InterviewQuestionService.load_resume` / `ResumeEvaluationService.load_resume`：
  - 改为 `file_path = state["resume_ref"]["file_path"]; text = loader.load_by_path(file_path); return {"resume_text": text}`。

#### d) 删除
- `AgentResumeService`（或精简）、`SESSION_RESUME_REF_KEY`/`SESSION_RESUME_REF_TTL`、`get_session_ref`。
- 旧上传 endpoint 与其依赖注入。

#### e) 用户消息落库（已有，保持）
- `_create_user_message` 已把 `context_refs` 存进 `content`，保留——前端据此渲染文件图标。

### 3.2 前端

#### a) 虚拟会话（点新建立即响应）
- `store/agent.ts` `createSession`：不再调后端，改为生成虚拟会话对象（临时负数 id `-Date.now()`、空 title、默认 workflow、`enable_thinking` 默认），`activeId` 指向它，立即渲染输入区。
- 侧栏"新建会话"按钮：去掉 `creating` loading 态（瞬时完成）；保留防重入（避免连点生成多个虚拟会话——用 `creating` flag 守护即可，但置位/复位都在同步生成虚拟会话前后，不发请求）。
- `AgentWorkspace`：`sessionId === null` 兜底保留；虚拟会话（负 id）走 `WorkspaceInner` 渲染。

#### b) composer 持有 file_path
- `UploadState.success` 改为 `{ kind:'success'; file_path: string; fileName: string }`（原 `resumeId`）。
- `employeeAgentApi.uploadResume(file)`：改调新接口（无 session_id）→ `{file_path, file_name}`。
- `onPickFile`：`setUpload({kind:'success', file_path, fileName})`。
- `submit()` 的 `context_refs`：`[{type:'resume', file_path, file_name}]`。

#### c) send 时建会话（核心时序）
- `sendMessage` 检测 `sessionId < 0`（虚拟会话）：
  1. 先 `createSessionBackend()`（真实调后端建会话）拿真实 session_id；
  2. 替换 store 里的虚拟会话为真实会话（同位置换，保留已上传 file_path 与待发消息）；
  3. 再 `streamMessage(realSessionId, ...)`。
- 乐观用户消息已追加（带 file_path 的 context_refs），建会话成功后把乐观消息的 `session_id` 字段更新为真实 id。
- 失败：建会话失败 → 移除虚拟会话 + 提示错误，用户可重试。

#### d) useAgentRun 适配
- 现在按真实 sessionId 跑。虚拟会话（负 id）时：`session` 用 store 虚拟会话对象渲染，`messages` 空，`sending` 由 sendMessage 管理；send 时 store 完成建会话替换，`WorkspaceInner` 的 `key={sessionId}` 触发重挂载到真实会话。

#### e) 用户消息图标渲染（已有，保留）
- `MessageRow` 读 `content.context_refs` 渲染 `ResumeFileIcon`。虚拟会话乐观消息带 `file_path/file_name`，建会话后真实消息同样带，图标始终显示。

## 四、错误处理与边界

- **建会话失败**：移除虚拟会话 + 错误提示，file_path/upload 状态保留（用户重试 send 即重新建会话+发送）。
- **上传失败**：composer 显示 error chip，不影响建会话。
- **file_path 解析失败**（损坏文件）：`load_by_path` 抛错 → graph 走空简历兜底（现有 `_route_after_profile` 已对空简历短路 END，`load_resume` 也能处理空文本）。
- **虚拟会话期间刷新页面**：虚拟会话不入库，刷新后丢失（回到会话列表）——可接受，符合"未发送即未持久化"语义。
- **多虚拟会话**：防重入守护避免连点生成多个；切到已有会话再点新建会生成新虚拟会话（旧虚拟会话若未发送则丢弃）。
- **同文件多会话**：每次新 task 都重解析（无缓存），可接受；若后续观察到解析成为瓶颈，可加 file_path 维度的内存缓存（本次不做，YAGNI）。

## 五、验收标准

1. 点"新建会话"立即出现空输入区，无网络等待；连点不会生成多个会话。
2. 虚拟会话期间可上传简历（接口无 session_id），composer 显示文件图标；不上传也能直接发消息。
3. 发送首条消息时：先建会话（网络往返期间有 loading），成功后消息进入会话、简历图标显示；失败则回滚并提示。
4. 后端 `POST /employee/agent/resumes` 不依赖 session_id，只存文件返回 file_path/file_name；不写 resume 表、不写 Redis。
5. 旧 `POST /sessions/{id}/resumes` 与 Redis session_ref 已删除；`_resolve_resume_ref` 不再有 Redis fallback。
6. graph `load_resume` 按 file_path 解析，结果进 state.resume_text，同 task 内不重解析；新 task 重解析。
7. 简历库列表（resume 表）不受影响（Agent 上传不入表，简历库仍是员工主动上传的）。
8. 多轮驳回循环不会重跑 load_resume（验证 graph 边未变）。

## 六、不在本次范围

- file_path 维度的解析缓存（若解析成瓶颈再加）。
- 虚拟会话的草稿持久化（刷新保留未发送内容）。
- 简历库列表纳入 Agent 上传的简历（与"不入表"决策冲突，明确不做）。
- 持久化 checkpointer（替换 InMemorySaver，另立项）。

## 七、实现顺序建议（供 writing-plans 拆解）

1. 后端：新上传接口 + 存储层 employee 隔离；删除旧接口/Redis ref。
2. 后端：`_resolve_resume_ref` 改 file_path；`ResumeLoader.load_by_path`；两个 service 的 load_resume 改造。
3. 前端：uploadResume API 改新接口；composer UploadState 改 file_path。
4. 前端：虚拟会话（createSession 改本地生成）。
5. 前端：sendMessage 虚拟会话时先建后发 + 失败回滚。
6. 端到端验证 + 清理（删除 AgentResumeService 残留）。
