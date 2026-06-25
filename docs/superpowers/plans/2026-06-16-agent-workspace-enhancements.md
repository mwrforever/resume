# Agent 工作台增强实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 为 Agent 工作台补齐会话删除/重命名/搜索防抖、统一交互卡片驳回、移除模式切换强制新建会话，并引入基于 `current_task_id` 的模型上下文隔离。

**Architecture:** `session.current_task_id`（新增字段）作为 LangGraph thread_id；创建会话时生成首个 uuid，工作流正常走到 END 时在 RuntimeService 收尾生成 `next_task_id` 覆盖该字段并经 `run.finish` 回传。同 task 内的 approve/驳回复用同一 thread_id（驳回走 graph 内循环不 END，故 task_id 不变）。遵循"agent_message 内容仅供展示，工作流记忆一律走 checkpoint"原则，删除所有从历史消息推导上下文/路由的代码。

**Tech Stack:** 后端 Python 3.12 / FastAPI / SQLAlchemy 2.x async / LangGraph / Pydantic v2 / pytest-asyncio；前端 React 19 / TypeScript / Zustand / vitest。

**设计依据：** `docs/superpowers/specs/2026-06-16-agent-workspace-enhancements-design.md`

**测试约定：**
- 后端：`cd backend && python -m pytest tests/services/test_xxx.py -v`（单测用 MagicMock，参照现有 `test_agent_session_service.py` 风格）
- 前端：`cd frontend && npm test`（vitest run）

---

## 阶段一：后端 task_id 隔离基础设施

### Task 1: AgentSession 模型新增 current_task_id 字段

**Files:**
- Modify: `backend/app/models/agent_session.py:21-30`
- Modify: `sql/init.sql:293-307`

- [ ] **Step 1: ORM 模型新增字段**

修改 `backend/app/models/agent_session.py`，在 `session_key` 字段后新增 `current_task_id`：

```python
    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    session_key: Mapped[str] = mapped_column(String(64), nullable=False)
    current_task_id: Mapped[str] = mapped_column(String(64), nullable=False, default="")
    employee_id: Mapped[int] = mapped_column(BigInteger, nullable=False)
```

- [ ] **Step 2: 同步 DDL（sql/init.sql）**

在 `sql/init.sql` 的 `agent_session` 建表语句中，`session_key` 行后新增 `current_task_id`：

```sql
    `session_key`           VARCHAR(64)  NOT NULL COMMENT '会话唯一标识',
    `current_task_id`       VARCHAR(64)  NOT NULL DEFAULT '' COMMENT '当前运行任务的thread_id（模型上下文隔离）',
    `employee_id`           BIGINT       NOT NULL COMMENT '员工ID',
```

- [ ] **Step 3: 验证模型可导入**

Run: `cd backend && python -c "from app.models.agent_session import AgentSession; print('ok')"`
Expected: 输出 `ok`，无报错。

- [ ] **Step 4: Commit**

```bash
git add backend/app/models/agent_session.py sql/init.sql
git commit -m "feat(agent): AgentSession 新增 current_task_id 字段（thread_id 隔离基础）"
```

---

### Task 2: AgentSessionItem / RunFinishData schema 扩展

**Files:**
- Modify: `backend/app/schemas/agent/response.py:62-76`
- Modify: `backend/app/schemas/agent/stream/events.py:45-47`

- [ ] **Step 1: AgentSessionItem 增加 current_task_id**

修改 `backend/app/schemas/agent/response.py` 的 `AgentSessionItem`，在 `session_key` 后加字段：

```python
class AgentSessionItem(BaseModel):
    """Agent 会话列表项（与新 DDL 对齐）。"""

    id: int
    session_key: str
    current_task_id: str = ""
    employee_id: int
    title: str | None = None
    status: int
    selected_model_name: str | None = None
    enable_thinking: bool = False
    last_message_time: datetime | None = None
    create_time: datetime | None = None
    update_time: datetime | None = None

    model_config = ConfigDict(from_attributes=True)
```

- [ ] **Step 2: RunFinishData 增加 next_task_id**

修改 `backend/app/schemas/agent/stream/events.py` 的 `RunFinishData`：

```python
class RunFinishData(_AllowExtra):
    """`run.finish` 事件 data，agent_message_id 是本 run 落库消息 ID。

    next_task_id：工作流正常走到 END 时生成的新 task_id，供下一轮隔离上下文使用。
    驳回（graph 内循环）/ run.error 时不携带。
    """
    agent_message_id: int
    next_task_id: str | None = None
```

- [ ] **Step 3: 写 schema 测试**

在 `backend/tests/services/test_agent_stream_events.py` 末尾追加（参照该文件现有风格）：

```python
def test_run_finish_data_optional_next_task_id():
    """RunFinishData 的 next_task_id 可选，默认 None。"""
    from app.schemas.agent.stream.events import RunFinishData
    d1 = RunFinishData(agent_message_id=10)
    assert d1.next_task_id is None
    d2 = RunFinishData(agent_message_id=10, next_task_id="abc")
    assert d2.next_task_id == "abc"
```

- [ ] **Step 4: 运行测试**

Run: `cd backend && python -m pytest tests/services/test_agent_stream_events.py -v`
Expected: PASS（含新增用例）。

- [ ] **Step 5: Commit**

```bash
git add backend/app/schemas/agent/response.py backend/app/schemas/agent/stream/events.py backend/tests/services/test_agent_stream_events.py
git commit -m "feat(agent): AgentSessionItem 加 current_task_id，RunFinishData 加 next_task_id"
```

---

### Task 3: emitter.emit_run_finish 支持 next_task_id

**Files:**
- Modify: `backend/app/llm/streaming/emitter.py:88-91`
- Modify: `backend/tests/services/test_agent_stream_emitter.py`

- [ ] **Step 1: 写失败测试**

在 `backend/tests/services/test_agent_stream_emitter.py` 末尾追加：

```python
def test_emit_run_finish_with_next_task_id():
    """emit_run_finish 可携带 next_task_id。"""
    from app.llm.streaming.emitter import AgentStreamEmitter
    emitter = AgentStreamEmitter(session_id=1, run_id="r1", workflow_type="interview_questions")
    env = emitter.emit_run_finish(agent_message_id=5, next_task_id="task-2")
    assert env.type == "run.finish"
    assert env.data["agent_message_id"] == 5
    assert env.data["next_task_id"] == "task-2"


def test_emit_run_finish_without_next_task_id():
    """不传 next_task_id 时为 None。"""
    from app.llm.streaming.emitter import AgentStreamEmitter
    emitter = AgentStreamEmitter(session_id=1, run_id="r1", workflow_type="interview_questions")
    env = emitter.emit_run_finish(agent_message_id=5)
    assert env.data["next_task_id"] is None
```

- [ ] **Step 2: 运行测试确认失败**

Run: `cd backend && python -m pytest tests/services/test_agent_stream_emitter.py::test_emit_run_finish_with_next_task_id -v`
Expected: FAIL（`unexpected keyword argument 'next_task_id'`）。

- [ ] **Step 3: 实现**

修改 `backend/app/llm/streaming/emitter.py` 的 `emit_run_finish`：

```python
    def emit_run_finish(self, *, agent_message_id: int, next_task_id: str | None = None) -> AgentStreamEnvelope:
        """发射 run.finish 事件。

        @param next_task_id: 工作流正常 END 时生成的新 task_id，回传前端用于下一轮隔离。
        """
        data = RunFinishData(agent_message_id=agent_message_id, next_task_id=next_task_id).model_dump(mode="json")
        return self._wrap(type="run.finish", data=data)
```

- [ ] **Step 4: 运行测试确认通过**

Run: `cd backend && python -m pytest tests/services/test_agent_stream_emitter.py -v`
Expected: 全部 PASS。

- [ ] **Step 5: Commit**

```bash
git add backend/app/llm/streaming/emitter.py backend/tests/services/test_agent_stream_emitter.py
git commit -m "feat(agent): emitter.emit_run_finish 支持 next_task_id 回传"
```

---

### Task 4: create_session 生成首个 current_task_id

**Files:**
- Modify: `backend/app/services/agent_session_service.py:56-63`
- Modify: `backend/tests/services/test_agent_session_service.py`

- [ ] **Step 1: 写失败测试**

在 `backend/tests/services/test_agent_session_service.py` 的 `_make_session_orm` 的 defaults 中加 `current_task_id="t1"`（避免其它用例 from_attributes 报错），并新增用例：

```python
@pytest.mark.asyncio
async def test_create_session_generates_current_task_id():
    """创建会话时应生成首个 current_task_id 并写入 repo。"""
    captured = {}

    async def fake_create(**kwargs):
        captured.update(kwargs)
        return _make_session_orm(current_task_id=kwargs.get("current_task_id", ""))

    repo = MagicMock()
    repo.create_session = fake_create
    repo.commit = AsyncMock()
    svc = AgentSessionService(repo)
    await svc.create_session(
        AgentSessionCreate(title="T"),
        current_user={"user_type": "employee", "sub": "2"},
    )
    # create_session 必须传入 current_task_id（非空 uuid hex）
    assert captured.get("current_task_id")
    assert len(captured["current_task_id"]) == 32  # uuid4().hex 长度
```

- [ ] **Step 2: 运行测试确认失败**

Run: `cd backend && python -m pytest tests/services/test_agent_session_service.py::test_create_session_generates_current_task_id -v`
Expected: FAIL（`current_task_id` 未传入 / KeyError）。

- [ ] **Step 3: 实现**

修改 `backend/app/services/agent_session_service.py` 的 `create_session`，在 `session_key` 旁生成首个 task_id：

```python
        employee_id = self._employee_id(current_user)
        session = await self._repo.create_session(
            session_key=uuid.uuid4().hex,
            current_task_id=uuid.uuid4().hex,
            employee_id=employee_id,
            title=body.title,
            selected_model_name=body.selected_model_name,
        )
```

- [ ] **Step 4: 运行测试确认通过**

Run: `cd backend && python -m pytest tests/services/test_agent_session_service.py -v`
Expected: 全部 PASS（包括既有用例）。

- [ ] **Step 5: Commit**

```bash
git add backend/app/services/agent_session_service.py backend/tests/services/test_agent_session_service.py
git commit -m "feat(agent): create_session 生成首个 current_task_id"
```

---

### Task 5: RuntimeService 切换 thread_id 为 current_task_id + 收尾生成 next_task_id

**Files:**
- Modify: `backend/app/services/agent_runtime_service.py:62-218`

- [ ] **Step 1: 新增私有方法 _resolve_thread_id + _advance_task_id**

在 `AgentRuntimeService` 内部方法区（`# ---------- 内部 ----------` 之后）新增：

```python
    async def _resolve_thread_id(self, session) -> str:
        """解析当前 run 的 thread_id = session.current_task_id。

        兼容旧数据：若 current_task_id 为空（迁移前旧会话），兜底生成并 update。
        """
        task_id = (session.current_task_id or "").strip()
        if task_id:
            return task_id
        task_id = uuid.uuid4().hex
        await self._repo.update_session(session.id, current_task_id=task_id)
        session.current_task_id = task_id
        logger.info("旧会话兜底生成 current_task_id：session_id=%s", session.id)
        return task_id

    async def _advance_task_id(self, session) -> str:
        """工作流正常 END 时推进 task_id：生成新 uuid 覆盖 session 表。

        @return 新的 task_id（供 run.finish 回传）。
        """
        next_task_id = uuid.uuid4().hex
        await self._repo.update_session(session.id, current_task_id=next_task_id)
        session.current_task_id = next_task_id
        return next_task_id
```

- [ ] **Step 2: stream_message 使用 current_task_id + 正常结束时推进**

在 `stream_message` 中，把 `runner.astream(...)` 前的 thread_id 提取出来，try 正常结束后推进。修改关键段落：

```python
        # 运行 graph
        runner = self._runner_factory(self._workflow_graphs[body.workflow_type])
        thread_id = await self._resolve_thread_id(session)
        graph_ok = True
        try:
            async for env in runner.astream(
                thread_id=thread_id, graph_input=graph_input, ctx=ctx,
            ):
                envelope_buffer.append(env)
                await self._buffer_append(session.id, run_id, env)
                yield env
        except Exception as exc:
            graph_ok = False
            logger.exception("Graph 执行异常：session_id=%s run_id=%s", session.id, run_id)
            err_env = emitter.emit_run_error(
                code="graph_execution_failed", message=str(exc), retriable=False,
            )
            envelope_buffer.append(err_env)
            await self._buffer_append(session.id, run_id, err_env)
            yield err_env

        # 收尾：把 buffer 折叠为 blocks，落库 agent 消息
        agent_message = await self._persist_agent_message(
            session=session, user_message=user_message, run_id=run_id,
            envelopes=envelope_buffer, runtime_config=runtime_config,
            workflow_type=body.workflow_type,
        )
        # 仅 graph 正常 END 才推进 task_id（中断/异常保持不变以保证可 resume）
        next_task_id = await self._advance_task_id(session) if graph_ok else None
        finish_env = emitter.emit_run_finish(
            agent_message_id=agent_message.id, next_task_id=next_task_id,
        )
        await self._buffer_append(session.id, run_id, finish_env)
        yield finish_env
        # 清理 Redis buffer
        await self._cache.client.delete(
            STREAM_BUFFER_KEY.format(session_id=session.id, run_id=run_id),
        )
```

- [ ] **Step 3: resolve_interaction 同样改造**

在 `resolve_interaction` 中，同样用 `_resolve_thread_id`，并把 graph 执行段改成 `graph_ok` 模式 + 收尾推进。关键段落（替换原 `runner.astream` try/except 及收尾）：

```python
        thread_id = await self._resolve_thread_id(session)
        envelope_buffer: list[AgentStreamEnvelope] = [resolve_env, start_env]
        runner = self._runner_factory(self._workflow_graphs[workflow_type])
        graph_ok = True
        try:
            async for env in runner.astream(
                thread_id=thread_id,
                graph_input=Command(resume=body.values),
                ctx=ctx,
            ):
                envelope_buffer.append(env)
                await self._buffer_append(session.id, run_id, env)
                yield env
        except Exception as exc:
            graph_ok = False
            logger.exception("Graph 恢复失败：session_id=%s run_id=%s", session.id, run_id)
            err_env = emitter.emit_run_error(
                code="graph_execution_failed", message=str(exc), retriable=False,
            )
            envelope_buffer.append(err_env)
            await self._buffer_append(session.id, run_id, err_env)
            yield err_env

        # 收尾：落库新一条 agent 消息
        agent_message = await self._persist_agent_message(
            session=session, user_message=None, run_id=run_id,
            envelopes=envelope_buffer, runtime_config=runtime_config,
            workflow_type=workflow_type,
        )
        next_task_id = await self._advance_task_id(session) if graph_ok else None
        finish_env = emitter.emit_run_finish(
            agent_message_id=agent_message.id, next_task_id=next_task_id,
        )
        await self._buffer_append(session.id, run_id, finish_env)
        yield finish_env
        await self._cache.client.delete(
            STREAM_BUFFER_KEY.format(session_id=session.id, run_id=run_id),
        )
```

- [ ] **Step 4: 写测试验证 thread_id 解析与推进**

在 `backend/tests/services/test_agent_runtime_service.py` 末尾追加（参照该文件现有 mock 风格；若该文件已有 `_make_*` 辅助，复用之，否则内联 mock）：

```python
@pytest.mark.asyncio
async def test_resolve_thread_id_returns_existing():
    """已有 current_task_id 时直接返回。"""
    from app.services.agent_runtime_service import AgentRuntimeService
    svc = AgentRuntimeService.__new__(AgentRuntimeService)  # 跳过 __init__
    svc._repo = MagicMock()
    svc._repo.update_session = AsyncMock()
    session = MagicMock(current_task_id="existing-task-id")
    tid = await svc._resolve_thread_id(session)
    assert tid == "existing-task-id"
    svc._repo.update_session.assert_not_awaited()


@pytest.mark.asyncio
async def test_resolve_thread_id_generates_for_empty():
    """空 current_task_id 时兜底生成并 update。"""
    from app.services.agent_runtime_service import AgentRuntimeService
    svc = AgentRuntimeService.__new__(AgentRuntimeService)
    svc._repo = MagicMock()
    svc._repo.update_session = AsyncMock()
    session = MagicMock(current_task_id="")
    tid = await svc._resolve_thread_id(session)
    assert len(tid) == 32
    svc._repo.update_session.assert_awaited_once()


@pytest.mark.asyncio
async def test_advance_task_id_generates_new():
    """_advance_task_id 生成新 uuid 并 update。"""
    from app.services.agent_runtime_service import AgentRuntimeService
    svc = AgentRuntimeService.__new__(AgentRuntimeService)
    svc._repo = MagicMock()
    svc._repo.update_session = AsyncMock()
    session = MagicMock(current_task_id="old")
    nxt = await svc._advance_task_id(session)
    assert len(nxt) == 32
    assert nxt != "old"
    assert session.current_task_id == nxt
```

- [ ] **Step 5: 运行测试**

Run: `cd backend && python -m pytest tests/services/test_agent_runtime_service.py -v`
Expected: 全部 PASS（含新增 3 个用例与既有用例）。

- [ ] **Step 6: Commit**

```bash
git add backend/app/services/agent_runtime_service.py backend/tests/services/test_agent_runtime_service.py
git commit -m "feat(agent): thread_id 切换为 current_task_id，正常 END 时推进 next_task_id"
```

---

## 阶段二：后端数据流原则（移除历史推导）

### Task 6: 删除 _resolve_resume_ref_from_history（内容不当下文）

**Files:**
- Modify: `backend/app/services/agent_runtime_service.py:222-280`

- [ ] **Step 1: 删除第 3 层 fallback 方法及其调用**

在 `agent_runtime_service.py` 中：
1. 删除 `_resolve_resume_ref_from_history` 整个方法（约 252-280 行）。
2. 修改 `_resolve_resume_ref`，移除第 3 层调用，改为：

```python
    async def _resolve_resume_ref(
        self, session_id: int, body: AgentMessageCreate,
    ) -> dict[str, Any] | None:
        """解析简历引用：本轮 context_refs → Redis 会话引用。

        遵循"agent_message 内容仅供展示"原则：不从历史消息推导。
        不命中返回 None，由工作流 checkpoint / 空简历兜底处理。
        """
        # 1) 本次请求显式携带
        for ref in body.context_refs or []:
            if str(ref.get("type") or "").lower() == "resume":
                if not ref.get("resume_id"):
                    raise ValidationError("简历附件缺少 resume_id")
                return {
                    "resume_id": int(ref["resume_id"]),
                    "job_id": int(ref["job_id"]) if ref.get("job_id") is not None else None,
                    "file_name": str(ref.get("file_name") or ""),
                }
        # 2) Redis 会话级引用
        cached = await self._agent_resume.get_session_ref(session_id=session_id)
        return cached
```

- [ ] **Step 2: 运行现有 runtime 测试确认无破坏**

Run: `cd backend && python -m pytest tests/services/test_agent_runtime_service.py tests/services/test_agent_resume_service.py -v`
Expected: PASS（若有用例引用了被删方法则相应调整）。

- [ ] **Step 3: Commit**

```bash
git add backend/app/services/agent_runtime_service.py
git commit -m "refactor(agent): 移除 _resolve_resume_ref_from_history（内容不当下文原则）"
```

---

### Task 7: 移除 _infer_workflow_type，改显式 workflow_type

**Files:**
- Modify: `backend/app/schemas/agent/request.py:99-102`
- Modify: `backend/app/api/v1/endpoints/agent.py:310-345`

- [ ] **Step 1: AgentInteractionSubmit 增加 workflow_type 字段**

修改 `backend/app/schemas/agent/request.py` 的 `AgentInteractionSubmit`：

```python
class AgentInteractionSubmit(BaseModel):
    """提交 interaction 卡片的用户填写。"""
    values: dict[str, Any] = Field(default_factory=dict)
    workflow_type: AgentWorkflowType = "interview_questions"
```

（移除 `model_config = ConfigDict(extra="forbid")`，因为新增字段会与之冲突；或保留 forbid 但显式声明字段——选择显式声明字段并删除 forbid 以与 AgentMessageCreate 风格一致。）

- [ ] **Step 2: endpoint 改用 body.workflow_type**

修改 `backend/app/api/v1/endpoints/agent.py` 的 `submit_interaction`，删除 `_infer_workflow_type` 调用：

```python
@agent_router.post("/sessions/{session_id}/interactions/{request_id}")
async def submit_interaction(
    body: AgentInteractionSubmit,
    session_id: int = Path(..., ge=1),
    request_id: str = Path(..., min_length=1),
    current_user: dict = Depends(get_current_user),
    session_svc: AgentSessionService = Depends(_get_session_service),
    runtime_svc: AgentRuntimeService = Depends(_get_runtime_service),
    llm_svc: LlmConfigService = Depends(_get_llm_service),
):
    """提交 interaction 卡片的用户填写，恢复 graph。"""
    session = await session_svc._require_session(session_id, current_user)
    workflow_type = body.workflow_type
    runtime_config = await llm_svc.get_runtime_config(current_user, session.selected_model_name)
    runtime_config = runtime_config.model_copy(
        update={"enable_thinking": bool(session.enable_thinking)},
    )

    async def _generator():
        async for env in runtime_svc.resolve_interaction(
            session=session, request_id=request_id, body=body,
            runtime_config=runtime_config, workflow_type=workflow_type,
        ):
            yield {"event": "agent", "data": env.model_dump_json()}

    return EventSourceResponse(_generator())
```

- [ ] **Step 3: 删除 _infer_workflow_type 函数**

删除 `agent.py` 中 `_infer_workflow_type` 整个函数定义（约 338-345 行）。

- [ ] **Step 4: 验证导入与编译**

Run: `cd backend && python -c "from app.api.v1.endpoints.agent import submit_interaction; print('ok')"`
Expected: `ok`。

- [ ] **Step 5: Commit**

```bash
git add backend/app/schemas/agent/request.py backend/app/api/v1/endpoints/agent.py
git commit -m "refactor(agent): 移除 _infer_workflow_type，interaction 显式携带 workflow_type"
```

---

## 阶段三：后端 graph 驳回分支

### Task 8: interview graph dimension_selection 驳回分支

**Files:**
- Modify: `backend/app/llm/graphs/workflows/interview_questions.py:32-45`

- [ ] **Step 1: 节点增加 regenerate 分支**

修改 `_request_dimension_selection`：

```python
async def _request_dimension_selection(state: InterviewQuestionState, config) -> Command:
    """请求用户选择维度（interrupt）。

    支持两种用户回执：
    - {selected_dimensions, user_feedback?}    → 确认选择，进入 build_question_plan
    - {regenerate: true, feedback?}            → 驳回：带 feedback 回 suggest_dimensions 重新建议
    """
    ctx: WorkflowRuntimeContext = config["configurable"]["ctx"]
    payload = ctx.interview_service.build_dimension_interaction(state)
    user_values = interrupt(payload)
    if user_values.get("regenerate"):
        # 驳回：把卡片内反馈作为重新建议的依据，回到上游重新生成维度
        return Command(
            goto="suggest_dimensions",
            update={"dimension_feedback": str(user_values.get("feedback") or "")},
        )
    update: dict = {"selected_dimensions": user_values.get("selected_dimensions", [])}
    feedback = str(user_values.get("user_feedback") or "").strip()
    if feedback:
        update["dimension_feedback"] = feedback
    return Command(update=update)
```

- [ ] **Step 2: 验证图可编译**

Run: `cd backend && python -c "from langgraph.checkpoint.memory import InMemorySaver; from app.llm.graphs.workflows.interview_questions import build_interview_graph; build_interview_graph(InMemorySaver()); print('ok')"`
Expected: `ok`。

- [ ] **Step 3: Commit**

```bash
git add backend/app/llm/graphs/workflows/interview_questions.py
git commit -m "feat(agent): dimension_selection 卡片支持驳回回 suggest_dimensions"
```

---

### Task 9: evaluation graph job_selection 驳回分支 + state 字段

**Files:**
- Modify: `backend/app/llm/graphs/workflows/state.py:32-42`
- Modify: `backend/app/llm/graphs/workflows/resume_evaluation.py:40-46`

- [ ] **Step 1: state 增加 job_feedback 字段**

修改 `backend/app/llm/graphs/workflows/state.py` 的 `ResumeEvaluationState`：

```python
class ResumeEvaluationState(TypedDict, total=False):
    """图二 state：简历评估。"""
    resume_ref: dict[str, Any]
    resume_text: str
    resume_profile: dict[str, Any]
    job_candidates: list[dict[str, Any]]
    selected_job_name: str
    # 岗位选择卡片驳回时的反馈，作为 load_job_candidates 重新加载的参考
    job_feedback: str
    job_full: dict[str, Any] | None
    validation_attempts: int
    evaluation_result: dict[str, Any] | None
    report: dict[str, Any] | None
```

- [ ] **Step 2: 节点增加 regenerate 分支**

修改 `resume_evaluation.py` 的 `_request_job_selection`：

```python
async def _request_job_selection(state: ResumeEvaluationState, config) -> Command:
    """请求用户选择岗位（interrupt）。

    支持两种用户回执：
    - {selected_job_name}            → 确认选岗
    - {regenerate: true, feedback?}  → 驳回：回 load_job_candidates 重新加载候选岗
    """
    ctx: WorkflowRuntimeContext = config["configurable"]["ctx"]
    payload = ctx.evaluation_service.build_job_interaction(state)
    user_values = interrupt(payload)
    if user_values.get("regenerate"):
        return Command(
            goto="load_job_candidates",
            update={
                "selected_job_name": "",
                "validation_attempts": 0,
                "job_feedback": str(user_values.get("feedback") or ""),
            },
        )
    return Command(update={"selected_job_name": str(user_values.get("selected_job_name") or "")})
```

- [ ] **Step 3: 验证图可编译**

Run: `cd backend && python -c "from langgraph.checkpoint.memory import InMemorySaver; from app.llm.graphs.workflows.resume_evaluation import build_evaluation_graph; build_evaluation_graph(InMemorySaver()); print('ok')"`
Expected: `ok`。

- [ ] **Step 4: Commit**

```bash
git add backend/app/llm/graphs/workflows/state.py backend/app/llm/graphs/workflows/resume_evaluation.py
git commit -m "feat(agent): job_selection 卡片支持驳回回 load_job_candidates + job_feedback state"
```

---

## 阶段四：前端类型与数据层

### Task 10: 前端类型扩展

**Files:**
- Modify: `frontend/src/types/agent.ts:59-59,100-111`

- [ ] **Step 1: WorkspaceSession 增加 current_task_id**

修改 `frontend/src/types/agent.ts` 的 `WorkspaceSession`：

```typescript
export interface WorkspaceSession {
  id: number;
  session_key: string;
  current_task_id: string;
  employee_id: number;
  title: string | null;
  selected_model_name: string | null;
  enable_thinking: boolean;
  status: number;
  last_message_time: string | null;
  create_time: string | null;
  update_time: string | null;
}
```

- [ ] **Step 2: run.finish envelope 增加 next_task_id**

修改同文件 envelope 联合类型的 `run.finish` 分支：

```typescript
  | { v: 1; seq: number; ts: number; run_id: string; session_id: number;
      type: 'run.finish'; data: { agent_message_id: number; next_task_id?: string } }
```

- [ ] **Step 3: 类型检查**

Run: `cd frontend && npx tsc --noEmit`
Expected: 无错误（若有 `IAgentSessionItem = WorkspaceSession` 别名使用者因缺字段报错，补默认值处理，见 Task 12 store）。

- [ ] **Step 4: Commit**

```bash
git add frontend/src/types/agent.ts
git commit -m "feat(agent-fe): WorkspaceSession 加 current_task_id，run.finish 加 next_task_id"
```

---

### Task 11: API 层 submitInteraction 携带 workflow_type

**Files:**
- Modify: `frontend/src/api/employee/agent.ts:91-102`

- [ ] **Step 1: 改造 submitInteraction 签名**

修改 `frontend/src/api/employee/agent.ts`：

```typescript
  /** 提交 interaction（返回 AsyncIterableIterator）
   *
   * workflowType 由前端显式携带（对齐后端 AgentInteractionSubmit.workflow_type），
   * 后端不再从历史消息推断路由。
   */
  submitInteraction: (
    sessionId: number,
    requestId: string,
    values: Record<string, unknown>,
    workflowType: WorkflowType,
    signal?: AbortSignal,
  ): AsyncIterableIterator<AgentEnvelope> => {
    return openAgentStream(
      `/api/v1/employee/agent/sessions/${sessionId}/interactions/${requestId}`,
      { values, workflow_type: workflowType },
      { signal },
    );
  },
```

- [ ] **Step 2: 类型检查**

Run: `cd frontend && npx tsc --noEmit`
Expected: store 调用处（Task 12）尚未更新会报错，记录待 Task 12 修复。

- [ ] **Step 3: Commit（与 Task 12 合并提交亦可，此处单独提交 API 层）**

```bash
git add frontend/src/api/employee/agent.ts
git commit -m "feat(agent-fe): submitInteraction 显式携带 workflow_type"
```

---

### Task 12: store 新增 deleteSession/renameSession + submitInteraction 传 workflow_type + next_task_id 同步

**Files:**
- Modify: `frontend/src/store/agent.ts`

- [ ] **Step 1: 接口扩展 + submitInteraction 改造**

在 `AgentStoreState` interface 的 actions 区新增两个方法签名：

```typescript
  deleteSession: (id: number) => Promise<void>;
  renameSession: (id: number, title: string) => Promise<void>;
```

- [ ] **Step 2: 改造 submitInteraction 从 runs 取该会话自身 workflow_type**

修改 store 内 `submitInteraction` 实现：

```typescript
  submitInteraction: async (sessionId, requestId, values) => {
    // 取该会话自身的 workflow_type（最后一条消息 / runState），不串台其它会话
    const entry = get().runs[sessionId];
    const workflowType: WorkflowType =
      (entry?.messages?.at(-1)?.workflow_type) ??
      entry?.runState.workflow_type ??
      'interview_questions';
    const ac = new AbortController();
    abortControllers.set(sessionId, ac);
    set((s) => ({ runs: { ...s.runs, [sessionId]: { ...getRun(s.runs, sessionId), sending: true } } }));
    try {
      const iter = employeeAgentApi.submitInteraction(sessionId, requestId, values, workflowType, ac.signal);
      await runEnvelopes(sessionId, iter);
    } finally {
      set((s) => ({ runs: { ...s.runs, [sessionId]: { ...getRun(s.runs, sessionId), sending: false } } }));
      abortControllers.delete(sessionId);
    }
  },
```

- [ ] **Step 3: runEnvelopes 处理 run.finish 时同步 next_task_id**

修改 `runEnvelopes` 函数中处理 `pendingFinish` 的 `setState`（reload 后那段），在更新 entry 时把 `next_task_id` 写入 session.current_task_id：

```typescript
    if (pendingFinish) {
      const nextTaskId = (pendingFinish.data as { next_task_id?: string }).next_task_id ?? null;
      const resp = await employeeAgentApi.getSession(sessionId);
      const detail = resp.data?.data ?? resp.data;
      useAgentStore.setState((s) => {
        const entry = getRun(s.runs, sessionId);
        // 后端已 update session.current_task_id；这里以前端 envelope 为准同步（二者一致）
        const session = (detail?.session ?? entry.session) as WorkspaceSession | null;
        if (session && nextTaskId) session.current_task_id = nextTaskId;
        return {
          runs: {
            ...s.runs,
            [sessionId]: {
              ...entry,
              session,
              messages: detail?.messages ?? entry.messages,
              loaded: true,
              runState: agentRunReducer(entry.runState, pendingFinish!),
            },
          },
        };
      });
      // run.finish 已把 running 置 false；再重置 runState 清空 current_blocks 释放内存
      useAgentStore.setState((s) => {
        const entry = getRun(s.runs, sessionId);
        return {
          runs: {
            ...s.runs,
            [sessionId]: {
              ...entry,
              runState: { ...INITIAL_RUN_STATE, workflow_type: entry.runState.workflow_type },
            },
          },
        };
      });
    }
```

> 注意：需在文件顶部 import 确保引入 `WorkspaceSession` 类型（若未引入）。

- [ ] **Step 4: 实现 deleteSession action**

在 store create 对象内新增（`abort` 之后）：

```typescript
  deleteSession: async (id) => {
    // 先中止该会话进行中的流，避免悬挂
    abortControllers.get(id)?.abort();
    abortControllers.delete(id);
    await employeeAgentApi.deleteSession(id);
    set((s) => {
      const sessions = s.sessions.filter((x) => x.id !== id);
      const activeId = s.activeId === id
        ? (sessions[0]?.id ?? null)
        : s.activeId;
      const runs = { ...s.runs };
      delete runs[id];
      return { sessions, activeId, runs };
    });
  },

  renameSession: async (id, title) => {
    await employeeAgentApi.updateSession(id, { title });
    set((s) => {
      const sessions = s.sessions.map((x) => (x.id === id ? { ...x, title } : x));
      const runs = { ...s.runs };
      const entry = runs[id];
      if (entry?.session) runs[id] = { ...entry, session: { ...entry.session, title } };
      return { sessions, runs };
    });
  },
```

- [ ] **Step 5: 类型检查 + 单测**

Run: `cd frontend && npx tsc --noEmit`
Expected: 无错误。

- [ ] **Step 6: Commit**

```bash
git add frontend/src/store/agent.ts
git commit -m "feat(agent-fe): store 加 deleteSession/renameSession + submitInteraction 传 workflow_type + next_task_id 同步"
```

---

## 阶段五：前端 UI 组件

### Task 13: 侧栏会话项 hover 编辑/删除入口

**Files:**
- Modify: `frontend/src/components/employee/agent/layout/agent-sidebar-drawer.tsx`
- Create: `frontend/src/components/employee/agent/layout/__tests__/agent-sidebar-drawer.test.tsx`

- [ ] **Step 1: props 扩展**

修改 `AgentSidebarDrawerProps`，新增回调：

```typescript
export interface AgentSidebarDrawerProps {
  sessions: WorkspaceSession[];
  activeId: number | null;
  onSelect: (id: number) => void;
  onCreate: () => void;
  onSearch: (keyword: string) => void;
  onRename: (id: number, title: string) => Promise<void>;
  onDelete: (id: number) => Promise<void>;
}
```

- [ ] **Step 2: 会话项渲染加入 hover 操作 + inline 编辑**

在展开态的 `group.items.map` 内，把单个 `<li>` 的 `<button>` 改为带操作区的结构。新增组件内状态 `editingId` / `editingTitle`（用 useState）。替换原 `<li>...</li>`：

```tsx
{group.items.map(s => {
  const isActive = s.id === activeId;
  const isRunning = runningIds.has(s.id);
  const isEditing = editingId === s.id;
  return (
    <li key={s.id} className="group relative">
      {isEditing ? (
        <div className="flex items-center gap-1 px-2 py-1.5">
          <input
            autoFocus
            value={editingTitle}
            onChange={e => setEditingTitle(e.target.value)}
            onKeyDown={async (e) => {
              if (e.key === 'Enter') { await commitRename(s.id); }
              else if (e.key === 'Escape') { setEditingId(null); }
            }}
            onBlur={() => commitRename(s.id)}
            className="flex-1 h-8 px-2 rounded border border-[#0EA5E9] text-sm outline-none"
          />
        </div>
      ) : (
        <>
          <button
            type="button"
            onClick={() => onSelect(s.id)}
            title={isRunning ? '正在运行…' : undefined}
            className={`w-full flex items-center gap-3 px-3 py-2 rounded-lg text-left
                        transition-colors duration-150
                        ${isActive ? 'bg-[#E0F2FE] text-[#020617] font-medium' : 'text-[#334155] hover:bg-[#F1F5F9]'}`}
          >
            {isRunning ? (
              <Loader2 size={16} className={`flex-shrink-0 animate-spin ${isActive ? 'text-[#0369A1]' : 'text-[#0EA5E9]'}`} />
            ) : (
              <Bot size={16} className={`flex-shrink-0 ${isActive ? 'text-[#0369A1]' : 'text-[#64748B]'}`} />
            )}
            <span className="truncate text-sm flex-1">{s.title || '未命名会话'}</span>
          </button>
          {/* hover 操作区：编辑 + 删除 */}
          <div className="absolute right-1.5 top-1/2 -translate-y-1/2 hidden group-hover:flex items-center gap-0.5 bg-inherit">
            <button
              type="button" title="重命名"
              onClick={(e) => { e.stopPropagation(); startRename(s); }}
              className="w-6 h-6 flex items-center justify-center rounded text-[#64748B] hover:text-[#0369A1] hover:bg-white"
            >
              <Pencil size={12} />
            </button>
            <button
              type="button" title="删除"
              onClick={(e) => void handleDelete(e, s.id)}
              className="w-6 h-6 flex items-center justify-center rounded text-[#64748B] hover:text-[#DC2626] hover:bg-white"
            >
              <Trash2 size={12} />
            </button>
          </div>
        </>
      )}
    </li>
  );
})}
```

在组件顶部加状态与处理函数（import `Pencil, Trash2`）：

```tsx
import { Bot, Plus, Search, Settings, PanelLeftClose, PanelLeftOpen, Loader2, Pencil, Trash2 } from 'lucide-react';
// ...
const [editingId, setEditingId] = useState<number | null>(null);
const [editingTitle, setEditingTitle] = useState('');

const startRename = (s: WorkspaceSession) => {
  setEditingId(s.id);
  setEditingTitle(s.title ?? '');
};
const commitRename = async (id: number) => {
  const t = editingTitle.trim();
  setEditingId(null);
  if (!t) return;
  await onRename(id, t);
};
const handleDelete = async (e: React.MouseEvent, id: number) => {
  e.stopPropagation();
  if (!window.confirm('删除该会话？')) return;
  await onDelete(id);
};
```

- [ ] **Step 3: layout 层接线**

修改 `agent-standalone-layout.tsx` 的 `<AgentSidebarDrawer>` 调用，传入 `onRename` / `onDelete`：

```tsx
        <AgentSidebarDrawer
          sessions={sessions}
          activeId={activeId}
          onSelect={setActive}
          onCreate={() => void createSession()}
          onSearch={setKeyword}
          onRename={(id, title) => useAgentStore.getState().renameSession(id, title)}
          onDelete={(id) => useAgentStore.getState().deleteSession(id)}
        />
```

- [ ] **Step 4: 类型检查**

Run: `cd frontend && npx tsc --noEmit`
Expected: 无错误。

- [ ] **Step 5: Commit**

```bash
git add frontend/src/components/employee/agent/layout/agent-sidebar-drawer.tsx frontend/src/components/employee/agent/layout/agent-standalone-layout.tsx
git commit -m "feat(agent-fe): 侧栏会话项 hover 编辑/重命名/删除入口"
```

---

### Task 14: Topbar 标题 inline 编辑

**Files:**
- Modify: `frontend/src/components/employee/agent/layout/agent-topbar.tsx`

- [ ] **Step 1: props 扩展 + inline 编辑**

修改 `agent-topbar.tsx`，加 `onRename` prop 与本地编辑状态：

```tsx
import { useState } from 'react';
import { ArrowLeft, Pencil, Check, X } from 'lucide-react';
import type { WorkspaceSession } from '@/types/agent';

export interface AgentTopbarProps {
  session?: WorkspaceSession | null;
  userName?: string;
  onRename?: (title: string) => Promise<void>;
}

export function AgentTopbar({ session, userName = 'HR', onRename }: AgentTopbarProps) {
  const nameAbbr = userName.slice(0, 2).toUpperCase();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState('');

  const startEdit = () => { setDraft(session?.title ?? ''); setEditing(true); };
  const commit = async () => {
    const t = draft.trim();
    setEditing(false);
    if (t && t !== session?.title && onRename) await onRename(t);
  };
  const cancel = () => setEditing(false);
```

把中央标题区改为：

```tsx
      {/* 中：当前会话标题（< 768px 隐藏），点击可编辑 */}
      {session && (
        <div className="hidden md:flex items-center gap-2 text-xs text-white/70 max-w-[40%]">
          <span className="w-1 h-1 rounded-full bg-white/30" />
          {editing ? (
            <span className="flex items-center gap-1">
              <input
                autoFocus
                value={draft}
                onChange={e => setDraft(e.target.value)}
                onKeyDown={e => {
                  if (e.key === 'Enter') void commit();
                  else if (e.key === 'Escape') cancel();
                }}
                className="h-6 px-2 rounded bg-white/10 border border-white/20 text-white text-xs outline-none w-48"
              />
              <button onClick={() => void commit()} title="确认"><Check size={12} /></button>
              <button onClick={cancel} title="取消"><X size={12} /></button>
            </span>
          ) : (
            <button
              type="button"
              onClick={startEdit}
              className="flex items-center gap-1 truncate hover:text-white transition-colors"
              title="点击编辑标题"
            >
              <span className="truncate">{session.title || '未命名会话'}</span>
              <Pencil size={11} className="opacity-50 hover:opacity-100" />
            </button>
          )}
        </div>
      )}
```

- [ ] **Step 2: layout 层接线**

修改 `agent-standalone-layout.tsx` 的 `<AgentTopbar>`：

```tsx
      <AgentTopbar
        session={activeSession}
        onRename={(title) =>
          activeSession ? useAgentStore.getState().renameSession(activeSession.id, title) : Promise.resolve()
        }
      />
```

- [ ] **Step 3: 类型检查**

Run: `cd frontend && npx tsc --noEmit`
Expected: 无错误。

- [ ] **Step 4: Commit**

```bash
git add frontend/src/components/employee/agent/layout/agent-topbar.tsx frontend/src/components/employee/agent/layout/agent-standalone-layout.tsx
git commit -m "feat(agent-fe): Topbar 会话标题 inline 编辑"
```

---

### Task 15: 搜索防抖

**Files:**
- Modify: `frontend/src/components/employee/agent/layout/agent-standalone-layout.tsx`

- [ ] **Step 1: keyword 加 300ms 防抖**

修改 `agent-standalone-layout.tsx`，把 `keyword` 拆为"输入值"与"防抖后值"：

```tsx
export function AgentStandaloneLayout() {
  const sessions = useAgentStore((s) => s.sessions);
  const activeId = useAgentStore((s) => s.activeId);
  const refreshSessions = useAgentStore((s) => s.refreshSessions);
  const setActive = useAgentStore((s) => s.setActive);
  const createSession = useAgentStore((s) => s.createSession);
  const [keyword, setKeyword] = useState('');
  const [debouncedKeyword, setDebouncedKeyword] = useState('');

  const activeSession = sessions.find(s => s.id === activeId) ?? null;

  // 输入值 300ms 防抖后触发后端搜索
  useEffect(() => {
    const t = setTimeout(() => setDebouncedKeyword(keyword), 300);
    return () => clearTimeout(t);
  }, [keyword]);

  useEffect(() => { void refreshSessions(debouncedKeyword); }, [refreshSessions, debouncedKeyword]);
```

并把侧栏 `onSearch={setKeyword}`（侧栏直接 setKeyword 即时响应输入），同时侧栏内部 keyword 输入框已由 props 的 onSearch 驱动，无需改动侧栏。

> 注：侧栏组件内部有自己的 `keyword` state 用于受控输入，layout 的 `setKeyword` 作为 `onSearch` 回调。防抖发生在 layout→refreshSessions 之间，侧栏输入体验不受影响。

- [ ] **Step 2: 类型检查**

Run: `cd frontend && npx tsc --noEmit`
Expected: 无错误。

- [ ] **Step 3: Commit**

```bash
git add frontend/src/components/employee/agent/layout/agent-standalone-layout.tsx
git commit -m "feat(agent-fe): 会话搜索 300ms 防抖"
```

---

### Task 16: interaction 卡片 dimension/job 驳回按钮

**Files:**
- Modify: `frontend/src/components/employee/agent/blocks/interaction-block.tsx`

- [ ] **Step 1: DimensionSelection 加驳回按钮**

在 `DimensionSelection` 的提交按钮区（现有"确认选择"按钮旁）加驳回按钮：

```tsx
      <div className="flex items-center gap-2">
        <button
          type="button"
          className="px-4 py-1.5 rounded-md bg-[#0369A1] text-white text-sm font-medium
                     hover:bg-[#0EA5E9] transition-colors
                     disabled:opacity-50 disabled:cursor-not-allowed"
          disabled={!canSubmit || submitting}
          onClick={submit}
        >
          {submitting ? '提交中…' : `确认选择 (${selected.size}${feedback.trim() ? ' + 备注' : ''})`}
        </button>
        <button
          type="button"
          className="px-3 py-1.5 rounded-md border border-[#E2E8F0] text-[#64748B] text-sm
                     hover:bg-[#F8FAFC] transition-colors
                     disabled:opacity-50 disabled:cursor-not-allowed"
          disabled={submitting}
          onClick={() => onSubmit({ regenerate: true, feedback: feedback.trim() })}
        >
          驳回重新建议
        </button>
      </div>
```

（删除原独立的 `<button>确认选择</button>`，由上面 flex 容器取代。）

- [ ] **Step 2: JobSelection 加 feedback textarea + 驳回按钮**

在 `JobSelection` 的确认按钮区改为：

```tsx
      {/* 驳回反馈输入框（与维度/计划卡统一） */}
      <textarea
        value={feedback}
        onChange={e => setFeedback(e.target.value)}
        placeholder="如需驳回重新选岗，可填写反馈意见（可选）"
        rows={2}
        className="w-full text-xs border border-[#E2E8F0] rounded px-2 py-1.5 mb-2
                   outline-none focus:border-[#0EA5E9] resize-none"
      />

      <div className="flex items-center gap-2">
        <button
          type="button"
          className="px-4 py-1.5 rounded-md bg-[#0369A1] text-white text-sm font-medium
                     hover:bg-[#0EA5E9] transition-colors
                     disabled:opacity-50 disabled:cursor-not-allowed"
          disabled={!selected || submitting}
          onClick={() => selected && onSubmit({ selected_job_name: selected })}
        >
          {submitting ? '提交中…' : '确认选择'}
        </button>
        <button
          type="button"
          className="px-3 py-1.5 rounded-md border border-[#E2E8F0] text-[#64748B] text-sm
                     hover:bg-[#F8FAFC] transition-colors
                     disabled:opacity-50 disabled:cursor-not-allowed"
          disabled={submitting}
          onClick={() => onSubmit({ regenerate: true, feedback: feedback.trim() })}
        >
          驳回重新选岗
        </button>
      </div>
```

在 `JobSelection` 函数顶部加 `const [feedback, setFeedback] = useState('');`。

- [ ] **Step 3: 类型检查**

Run: `cd frontend && npx tsc --noEmit`
Expected: 无错误。

- [ ] **Step 4: Commit**

```bash
git add frontend/src/components/employee/agent/blocks/interaction-block.tsx
git commit -m "feat(agent-fe): dimension/job 卡片加驳回重新生成按钮"
```

---

### Task 17: 移除模式切换强制新建会话

**Files:**
- Modify: `frontend/src/components/employee/agent/agent-composer.tsx:121-139,54-56`
- Modify: `frontend/src/components/employee/agent/agent-workspace.tsx:16-20,29-31,56,99,106-109`

- [ ] **Step 1: 简化 handleWorkflowClick**

修改 `agent-composer.tsx` 的 `handleWorkflowClick`：

```tsx
  const handleWorkflowClick = (next: WorkflowType) => {
    if (next === workflow) return;
    setWorkflow(next);
  };
```

- [ ] **Step 2: 清理 creatingSession state 与 onRequestNewSession prop**

在 `agent-composer.tsx`：
- 删除 `const [creatingSession, setCreatingSession] = useState(false);`
- 从 `AgentComposerProps` 删除 `onRequestNewSession` 字段。
- 从解构参数删除 `onRequestNewSession`。
- 把 workflow 按钮的 `disabled={creatingSession}` 改为 `disabled={false}`（或直接删除 disabled）。
- 把 `onClick={() => void handleWorkflowClick(wf)}` 改为 `onClick={() => handleWorkflowClick(wf)}`。

- [ ] **Step 3: workspace 移除 onRequestNewSession 透传**

修改 `agent-workspace.tsx`：
- 从 `AgentWorkspaceProps` 删除 `onRequestNewSession`。
- `AgentWorkspace` 不再有 `onRequestNewSession`；`WorkspaceInner` 的 props 与解构同步删除。
- `<AgentComposer ... />` 调用删除 `onRequestNewSession={onRequestNewSession}`。

- [ ] **Step 4: layout 移除 onRequestNewSession**

修改 `agent-standalone-layout.tsx`：
- 删除 `onRequestNewSession` 的 `useCallback` 定义。
- `<AgentWorkspace>` 调用删除 `onRequestNewSession` prop。

- [ ] **Step 5: 类型检查**

Run: `cd frontend && npx tsc --noEmit`
Expected: 无错误（确认无残留 onRequestNewSession 引用）。

- [ ] **Step 6: Commit**

```bash
git add frontend/src/components/employee/agent/agent-composer.tsx frontend/src/components/employee/agent/agent-workspace.tsx frontend/src/components/employee/agent/layout/agent-standalone-layout.tsx
git commit -m "feat(agent-fe): 移除模式切换强制新建会话，直接切换 workflow"
```

---

## 阶段六：集成验证

### Task 18: 全量类型检查与测试

- [ ] **Step 1: 后端全量测试**

Run: `cd backend && python -m pytest tests/ -v`
Expected: 全部 PASS。

- [ ] **Step 2: 前端类型检查 + 测试**

Run: `cd frontend && npx tsc --noEmit && npm test`
Expected: 无类型错误，测试 PASS。

- [ ] **Step 3: 手动回归（验收标准对照）**

启动后端与前端，逐项验证（见 spec 第六节验收标准）：
1. 侧栏 hover 出现编辑/删除；删除 confirm 后消失并切到下一个；重命名后 Topbar+侧栏同步。
2. Topbar 标题点击可编辑，刷新仍在。
3. 搜索连续输入只触发防抖后请求。
4. dimension/job 卡片有"驳回"，点击后维度建议/岗位列表刷新。
5. 同一会话切 workflow 不再弹 confirm、不新建会话。
6. 同一会话两轮消息，日志确认 `current_task_id` 变化、第二轮 thread 隔离。
7. 驳回期间 task_id 不变；approve 走完 final 后 task_id 推进。
8. 会话A 切「简历评估」→ 空会话B → B 显示默认「面试问答」。
9. 代码确认 `_resolve_resume_ref_from_history` 与 `_infer_workflow_type` 已移除。

- [ ] **Step 4: 最终 Commit（如有手动回归发现的修复）**

```bash
git add -A
git commit -m "test(agent): 集成回归修复"
```

---

## 自检（writing-plans 要求）

**1. Spec coverage（逐条对照 spec 第四节）：**
- 4.1.a model 字段 → Task 1 ✓
- 4.1.a2 state job_feedback → Task 9 ✓
- 4.1.b AgentSessionItem → Task 2 ✓
- 4.1.c RunFinishData → Task 2 ✓
- 4.1.d emitter → Task 3 ✓
- 4.1.e create_session → Task 4 ✓
- 4.1.f thread_id + next_task_id + 删历史扫描 → Task 5 + Task 6 ✓
- 4.1.g graph 驳回分支 → Task 8 + Task 9 ✓
- 4.1.h 移除 _infer_workflow_type + schema → Task 7 ✓
- 4.2.a types → Task 10 ✓
- 4.2.b/c api + store → Task 11 + Task 12 ✓
- 4.2.d 侧栏 → Task 13 ✓
- 4.2.e Topbar → Task 14 ✓
- 4.2.f interaction 卡片 → Task 16 ✓
- 4.2.g 模式切换 + 多会话隔离 → Task 17 ✓（隔离依赖现有 key={sessionId}，无需额外代码，Task 18 手动验证）
- 4.2.h 搜索防抖 → Task 15 ✓

**2. Placeholder scan：** 无 TBD/TODO/省略代码；每步含完整代码。

**3. Type consistency：**
- `current_task_id` 全链路命名一致（model/schema/envelope/state/types/store）✓
- `next_task_id` emitter→envelope→store 一致 ✓
- `deleteSession`/`renameSession` store action 命名在 layout 调用处一致 ✓
- `submitInteraction` 新增第 4 参数 `workflowType: WorkflowType` 在 api/store 两处一致 ✓
- `regenerate`/`feedback` 提交值在 interaction-block（前端）与 graph 节点（后端）取值 key 一致 ✓

无遗漏。计划完整。
