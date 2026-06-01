# LangGraph Dual Workflow Event Rendering Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement the approved LangGraph dual-workflow Agent runtime with Redis stream buffering, checkpoint-based interaction resume, and compact frontend event/business-card rendering.

**Architecture:** Keep endpoint → service → repository/cache → schema boundaries. `AgentService` remains the session and persistence coordinator, while two compiled LangGraph workflow graphs route by message-level `workflow_type`. Business logic lives in focused services; graph nodes only read state, call services, and emit/resume interactions.

**Tech Stack:** Python 3.12, FastAPI, Pydantic v2, SQLAlchemy async ORM, redis.asyncio, LangGraph 1.1.10, React 19, TypeScript, Vite, Tailwind CSS, Lucide React, Vitest.

---

## Approved Spec

- Design spec: `docs/superpowers/specs/2026-06-01-langgraph-dual-workflow-event-rendering-design.md`
- Design commit: `d8b579f docs: add langgraph dual workflow design`

## Implementation Rules

- Start with `sql/init.sql` DDL update before backend/frontend code.
- Do not make Graph nodes query DB, query Redis, build prompts, call provider clients, or write `agent_message`.
- Use `model_router.complete()` / `model_router.stream()` only from services.
- Use Redis `APPEND` JSONL with 1800-second TTL for stream buffering.
- Use LangGraph checkpoint as the only execution recovery source.
- Store frontend render snapshots in `agent_message.content.blocks`; do not store executable graph state there.
- Preserve existing v2 events: `message.delta`, `message.done`, `tool.started`, `tool.finished`, `data.card`, `data.evaluation_report`.
- Add new dual-workflow events without breaking existing coordinator flow.
- Keep frontend runtime events compact and collapsed by default.

## File Structure Map

### DDL and ORM

- Modify: `sql/init.sql`
  - Add `workflow_type` and `run_id` columns to `agent_message`.
  - Add an index for workflow/run lookup.
- Modify: `backend/app/models/agent_message.py`
  - Mirror new nullable ORM fields and index.
- Modify: `backend/app/schemas/agent/response.py`
  - Surface optional `workflow_type` and `run_id` in `AgentMessageItem`.
- Modify: `frontend/src/types/agent.ts`
  - Surface optional `workflow_type` and `run_id` in `IAgentMessageItem`.

### Backend schemas and stream protocol

- Modify: `backend/app/schemas/agent/request.py`
  - Add `workflow_type` to `AgentMessageCreate`.
- Modify: `backend/app/schemas/agent/dto.py`
  - Add workflow DTOs for dimensions, question plan, question set, resume report, interaction payloads, render blocks.
- Modify: `backend/app/schemas/agent/stream/events.py`
  - Add workflow node ids, interaction payloads, thinking payloads, execution status payloads, and workflow business-card payloads.
- Modify: `backend/app/schemas/agent/stream/envelope.py`
  - Add optional `workflow_type` and `display_name` fields.
- Modify: `backend/app/schemas/agent/stream/__init__.py`
  - Export new payload models.
- Modify: `backend/app/llm/streaming/emitter.py`
  - Accept `workflow_type` and `display_name` when creating envelopes.

### Backend services

- Create: `backend/app/services/agent_stream_buffer_service.py`
  - Redis JSONL append/read/clear with in-memory fallback.
- Create: `backend/app/services/interview_question_service.py`
  - Resume load, dimension suggestion, plan creation, question generation, final block assembly.
- Create: `backend/app/services/resume_evaluation_workflow_service.py`
  - Resume load/profile, job candidates/validation, evaluation subgraph reuse, final report block assembly.
- Modify: `backend/app/services/agent_service.py`
  - Route by `workflow_type`, create workflow service context, buffer emitted events, persist final/stage messages, resume interactions.
- Modify: `backend/app/api/v1/endpoints/agent.py`
  - Inject `CacheService` into `AgentService` so Redis buffer service can be created.

### Backend LangGraph workflow package

- Create: `backend/app/llm/graphs/workflows/__init__.py`
- Create: `backend/app/llm/graphs/workflows/state.py`
  - Shared workflow state and typed business state definitions.
- Create: `backend/app/llm/graphs/workflows/interview_questions.py`
  - Graph builder and minimal nodes for interview question workflow.
- Create: `backend/app/llm/graphs/workflows/resume_evaluation.py`
  - Graph builder and minimal nodes for resume evaluation workflow.
- Create: `backend/app/llm/graphs/workflows/runner.py`
  - Run compiled workflow graphs and translate updates/interrupts/custom outputs to stream events.

### Prompt files

- Create: `backend/app/llm/prompts/templates/interview_dimension_suggest.yaml`
- Create: `backend/app/llm/prompts/templates/interview_question_plan.yaml`
- Create: `backend/app/llm/prompts/templates/interview_question_generate.yaml`
- Create: `backend/app/llm/prompts/templates/resume_profile_analyze.yaml`
- Create: `backend/app/llm/prompts/templates/resume_evaluation_visual_report.yaml`

### FastAPI lifespan

- Modify: `backend/app/main.py`
  - Compile workflow graph singletons in lifespan and store them on `app.state.agent_workflow_graphs`.

### Frontend API, types, state

- Modify: `frontend/src/types/agent.ts`
  - Add workflow, event, thinking, interaction, and business-card types.
- Modify: `frontend/src/api/employee/agent.ts`
  - Include `workflow_type` in stream message payload.
- Modify: `frontend/src/pages/employee/agent.tsx`
  - Track selected workflow, pass workflow to composer/API, restore business blocks from history.
- Modify: `frontend/src/components/employee/agent/agent-composer.tsx`
  - Add compact workflow segmented control.
- Modify: `frontend/src/utils/agent-stream-v2.ts`
  - Keep parser compatible with existing and new fields.
- Modify: `frontend/src/utils/agent-stream-handler.ts`
  - Handle thinking, execution status, interaction request/result, and workflow business cards.

### Frontend rendering components

- Create: `frontend/src/components/employee/agent/agent-run-compact-timeline.tsx`
- Create: `frontend/src/components/employee/agent/agent-thinking-panel.tsx`
- Create: `frontend/src/components/employee/agent/agent-interaction-card.tsx`
- Create: `frontend/src/components/employee/agent/interview-question-set-card.tsx`
- Create: `frontend/src/components/employee/agent/resume-evaluation-report-card.tsx`
- Modify: `frontend/src/components/employee/agent/agent-message-list.tsx`
  - Render compact events and business blocks inline without modal interruption.

### Tests

- Create: `backend/tests/services/test_agent_workflow_request_schema.py`
- Create: `backend/tests/services/test_agent_stream_buffer_service.py`
- Create: `backend/tests/services/test_agent_workflow_routing.py`
- Create: `backend/tests/llm/test_interview_question_graph.py`
- Create: `backend/tests/llm/test_resume_evaluation_workflow_graph.py`
- Modify: `backend/tests/services/test_agent_service_stream_message.py`
- Modify: `frontend/src/__tests__/employee/agent-stream-handler.test.ts`
- Create: `frontend/src/__tests__/employee/agent-workflow-switcher.test.tsx`
- Create: `frontend/src/__tests__/employee/agent-business-cards.test.tsx`

---

## Task 1: DDL-first message metadata columns

**Files:**
- Modify: `sql/init.sql`
- Modify: `backend/app/models/agent_message.py`
- Modify: `backend/app/schemas/agent/response.py`
- Modify: `frontend/src/types/agent.ts`
- Test: `backend/tests/services/test_agent_workflow_request_schema.py`

- [ ] **Step 1: Update `sql/init.sql` before touching runtime code**

In table `agent_message`, add these columns after `message_type`:

```sql
    `workflow_type`     VARCHAR(50)          DEFAULT NULL COMMENT 'Agent工作流类型',
    `run_id`            VARCHAR(80)          DEFAULT NULL COMMENT 'Agent运行ID',
```

Add this key after `idx_parent`:

```sql
    KEY `idx_agent_message_workflow_run` (`workflow_type`, `run_id`)
```

Expected result: `agent_message` has queryable workflow/run metadata while `content` remains the render snapshot JSON.

- [ ] **Step 2: Update ORM model**

Modify `backend/app/models/agent_message.py`:

```python
__table_args__ = (
    Index("idx_session_order", "session_id", "sort_order", "id"),
    Index("idx_parent", "parent_message_id"),
    Index("idx_agent_message_workflow_run", "workflow_type", "run_id"),
)

workflow_type: Mapped[str | None] = mapped_column(String(50))
run_id: Mapped[str | None] = mapped_column(String(80))
```

Place the fields after `message_type` and before `content`.

- [ ] **Step 3: Update response and frontend message types**

Add to `backend/app/schemas/agent/response.py` `AgentMessageItem`:

```python
workflow_type: str | None = None
run_id: str | None = None
```

Add to `frontend/src/types/agent.ts` `IAgentMessageItem`:

```ts
workflow_type?: TAgentWorkflowType | null;
run_id?: string | null;
```

- [ ] **Step 4: Run metadata validation**

Run from `backend`:

```powershell
python -m py_compile app/models/agent_message.py app/schemas/agent/response.py
```

Expected: command exits `0`.

- [ ] **Step 5: Commit**

```powershell
git add -- sql/init.sql backend/app/models/agent_message.py backend/app/schemas/agent/response.py frontend/src/types/agent.ts
git commit -m "feat: add agent message workflow metadata"
```

---

## Task 2: Request schema workflow selection

**Files:**
- Modify: `backend/app/schemas/agent/request.py`
- Modify: `frontend/src/types/agent.ts`
- Modify: `frontend/src/api/employee/agent.ts`
- Test: `backend/tests/services/test_agent_workflow_request_schema.py`

- [ ] **Step 1: Write schema tests**

Create `backend/tests/services/test_agent_workflow_request_schema.py`:

```python
"""Agent workflow request schema tests."""

import pytest
from pydantic import ValidationError

from app.schemas.agent.request import AgentMessageCreate


def test_agent_message_defaults_to_interview_questions() -> None:
    """未传 workflow_type 时默认进入简历问答工作流。"""
    body = AgentMessageCreate(content="生成面试题")

    assert body.workflow_type == "interview_questions"


def test_agent_message_accepts_resume_evaluation() -> None:
    """允许消息级选择简历评估工作流。"""
    body = AgentMessageCreate(content="评估简历", workflow_type="resume_evaluation")

    assert body.workflow_type == "resume_evaluation"


def test_agent_message_rejects_invalid_workflow_type() -> None:
    """非法 workflow_type 由 Pydantic 拒绝。"""
    with pytest.raises(ValidationError):
        AgentMessageCreate(content="测试", workflow_type="general_chat")
```

- [ ] **Step 2: Run test to verify failure**

Run from `backend`:

```powershell
python -m pytest tests/services/test_agent_workflow_request_schema.py -q
```

Expected: failure because `workflow_type` does not exist yet.

- [ ] **Step 3: Add backend request literal**

Modify `backend/app/schemas/agent/request.py`:

```python
AgentWorkflowType = Literal["interview_questions", "resume_evaluation"]


class AgentMessageCreate(BaseModel):
    content: str = Field(min_length=1, max_length=20000)
    workflow_type: AgentWorkflowType = "interview_questions"
    context_refs: list[dict[str, Any]] = Field(default_factory=list)
    runtime_options: AgentRuntimeOptions | None = None
```

- [ ] **Step 4: Add frontend workflow request types**

Modify `frontend/src/types/agent.ts` near v2 types:

```ts
export type TAgentWorkflowType = 'interview_questions' | 'resume_evaluation';

export interface IAgentMessageCreatePayload {
  content: string;
  workflow_type?: TAgentWorkflowType;
  context_refs?: Array<Record<string, unknown>>;
  runtime_options?: IAgentRuntimeOptions;
}
```

Modify `frontend/src/api/employee/agent.ts` import and function signature:

```ts
import type {
  IAgentFormSubmitRequest,
  IAgentMessageCreatePayload,
  IAgentRunResumeRequest,
  IAgentRuntimeOptions,
  IAgentSessionDetail,
  IAgentStreamEvent,
  IAgentTemporaryActionExecute,
  ILlmConfigItem,
  ILlmConfigPayload,
} from '@/types/agent';

async function streamAgentMessage(
  id: number,
  data: IAgentMessageCreatePayload,
  onEvent: (event: IAgentStreamEvent) => void,
) {
  const response = await fetchStreamWithAuth(`/api/v1/employee/agent/sessions/${id}/messages/stream`, JSON.stringify(data));
  await consumeSseResponse(response, onEvent);
}
```

- [ ] **Step 5: Run tests**

Run from `backend`:

```powershell
python -m pytest tests/services/test_agent_workflow_request_schema.py -q
```

Expected: `3 passed`.

Run from `frontend`:

```powershell
npx tsc --noEmit
```

Expected: TypeScript exits `0`.

- [ ] **Step 6: Commit**

```powershell
git add -- backend/app/schemas/agent/request.py backend/tests/services/test_agent_workflow_request_schema.py frontend/src/types/agent.ts frontend/src/api/employee/agent.ts
git commit -m "feat: add agent workflow request selection"
```

---

## Task 3: Stream protocol extensions

**Files:**
- Modify: `backend/app/schemas/agent/stream/events.py`
- Modify: `backend/app/schemas/agent/stream/envelope.py`
- Modify: `backend/app/schemas/agent/stream/__init__.py`
- Modify: `backend/app/llm/streaming/emitter.py`
- Modify: `frontend/src/types/agent.ts`
- Modify: `frontend/src/utils/agent-stream-v2.ts`
- Test: `frontend/src/__tests__/employee/agent-stream-handler.test.ts`

- [ ] **Step 1: Extend backend event enum and payloads**

Add to `AgentNodeId`:

```python
INTERVIEW_QUESTIONS = "interview_questions"
RESUME_EVALUATION = "resume_evaluation"
DIMENSION_SELECTION = "dimension_selection"
PLAN_APPROVAL = "plan_approval"
JOB_SELECTION = "job_selection"
```

Add to `AgentStreamEventType`:

```python
THINKING_STATUS = "thinking_status"
THINKING_STREAM = "thinking_stream"
TEXT_STREAM = "text_stream"
EXECUTION_STATUS = "execution_status"
PLANNING = "planning"
INTERACTION_REQUEST = "interaction_request"
INTERACTION_RESULT = "interaction_result"
COMPLETED = "completed"
```

Add payload models to `events.py`:

```python
class ThinkingStatusPayload(BaseModel):
    """思考过程状态事件 payload。"""

    model_config = ConfigDict(extra="forbid")

    status: Literal["started", "streaming", "completed", "unavailable"]
    summary: str | None = None


class ThinkingStreamPayload(BaseModel):
    """思考过程增量事件 payload。"""

    model_config = ConfigDict(extra="forbid")

    message_id: str
    delta: str


class ExecutionStatusPayload(BaseModel):
    """轻量执行状态事件 payload。"""

    model_config = ConfigDict(extra="forbid")

    status: Literal["running", "success", "failed", "waiting"]
    title: str
    detail: str | None = None


class PlanningPayload(BaseModel):
    """规划事件 payload。"""

    model_config = ConfigDict(extra="forbid")

    plan_id: str
    title: str
    summary: str
    body: dict[str, Any] = Field(default_factory=dict)


class InteractionRequestPayload(BaseModel):
    """内联交互请求 payload。"""

    model_config = ConfigDict(extra="forbid")

    request_id: str
    interaction_type: Literal["dimension_selection", "plan_approval", "job_selection"]
    title: str
    prompt: str
    data: dict[str, Any] = Field(default_factory=dict)
    submit_label: str = "提交"
    cancel_label: str | None = None


class InteractionResultPayload(BaseModel):
    """内联交互完成 payload。"""

    model_config = ConfigDict(extra="forbid")

    request_id: str
    interaction_type: Literal["dimension_selection", "plan_approval", "job_selection"]
    accepted: bool
    values: dict[str, Any] = Field(default_factory=dict)


class CompletedPayload(BaseModel):
    """工作流完成事件 payload。"""

    model_config = ConfigDict(extra="forbid")

    message: str = "已完成"
    blocks: list[dict[str, Any]] = Field(default_factory=list)
```

- [ ] **Step 2: Extend stream envelope**

Modify `AgentStreamEnvelope`:

```python
workflow_type: str | None = None
display_name: str | None = None
```

Add both fields after `session_id` and before `node_id`.

- [ ] **Step 3: Update emitter constructor and emit method**

Modify `AgentStreamEmitter.__init__`:

```python
def __init__(
    self,
    *,
    session_id: int,
    session_key: str,
    run_id: str | None = None,
    workflow_type: str | None = None,
) -> None:
    self.session_id = session_id
    self.session_key = session_key
    self.run_id = run_id or uuid.uuid4().hex
    self.workflow_type = workflow_type
    self._seq = 0
```

Modify `emit()` signature:

```python
def emit(
    self,
    *,
    event: AgentStreamEventType,
    payload: BaseModel | dict | None = None,
    node_id: AgentNodeId | str = AgentNodeId.COORDINATOR,
    agent_id: AgentNodeId | str | None = None,
    display_name: str | None = None,
) -> AgentStreamEvent:
```

Pass these into `AgentStreamEnvelope`:

```python
workflow_type=self.workflow_type,
display_name=display_name,
```

- [ ] **Step 4: Export new payload models**

Modify `backend/app/schemas/agent/stream/__init__.py` so all new models are imported and included in `__all__`.

- [ ] **Step 5: Extend frontend v2 types**

Modify `frontend/src/types/agent.ts`:

```ts
export type TAgentEventTypeV2 =
  | 'lifecycle.run.started'
  | 'lifecycle.run.finished'
  | 'lifecycle.run.failed'
  | 'lifecycle.node.enter'
  | 'lifecycle.node.exit'
  | 'lifecycle.node.error'
  | 'message.started'
  | 'message.delta'
  | 'message.done'
  | 'tool.started'
  | 'tool.finished'
  | 'form.requested'
  | 'form.resolved'
  | 'action.requested'
  | 'action.resolved'
  | 'data.card'
  | 'data.evaluation_report'
  | 'thinking_status'
  | 'thinking_stream'
  | 'text_stream'
  | 'execution_status'
  | 'planning'
  | 'interaction_request'
  | 'interaction_result'
  | 'completed'
  | 'error';
```

Add fields to `IAgentStreamEnvelopeV2`:

```ts
workflow_type?: TAgentWorkflowType | null;
display_name?: string | null;
```

- [ ] **Step 6: Add parser test**

Extend `frontend/src/__tests__/employee/agent-stream-handler.test.ts`:

```ts
it('should parse workflow metadata and display name from v2 envelope', () => {
  const result = parseAgentStreamEnvelopeV2({
    schema_version: '2.0',
    seq: 1,
    run_id: 'run-1',
    session_id: 1,
    workflow_type: 'interview_questions',
    node_id: 'dimension_selection',
    display_name: '选择面试维度',
    event: 'interaction_request',
    payload: { request_id: 'req-1', interaction_type: 'dimension_selection', title: '选择面试维度', prompt: '', data: {} },
    ts: 1,
  });

  expect(result?.workflow_type).toBe('interview_questions');
  expect(result?.display_name).toBe('选择面试维度');
});
```

- [ ] **Step 7: Run validations**

Run from `backend`:

```powershell
python -m py_compile app/schemas/agent/stream/events.py app/schemas/agent/stream/envelope.py app/schemas/agent/stream/__init__.py app/llm/streaming/emitter.py
```

Run from `frontend`:

```powershell
npm.cmd test -- src/__tests__/employee/agent-stream-handler.test.ts
npx tsc --noEmit
```

Expected: all commands exit `0`.

- [ ] **Step 8: Commit**

```powershell
git add -- backend/app/schemas/agent/stream backend/app/llm/streaming/emitter.py frontend/src/types/agent.ts frontend/src/__tests__/employee/agent-stream-handler.test.ts
git commit -m "feat: extend agent stream workflow protocol"
```

---

## Task 4: Redis stream buffer service

**Files:**
- Create: `backend/app/services/agent_stream_buffer_service.py`
- Test: `backend/tests/services/test_agent_stream_buffer_service.py`

- [ ] **Step 1: Write service tests**

Create `backend/tests/services/test_agent_stream_buffer_service.py`:

```python
"""Agent stream Redis buffer service tests."""

from typing import Any

import pytest

from app.services.agent_stream_buffer_service import AgentStreamBufferService


class _FakeRedis:
    """测试用 Redis 客户端，记录 APPEND/EXPIRE/GET/DELETE 调用。"""

    def __init__(self) -> None:
        """初始化内存数据。"""
        self.values: dict[str, str] = {}
        self.expires: dict[str, int] = {}
        self.fail_append = False

    async def append(self, key: str, value: str) -> int:
        """模拟 Redis APPEND。"""
        if self.fail_append:
            raise RuntimeError("redis append failed")
        self.values[key] = self.values.get(key, "") + value
        return len(self.values[key])

    async def expire(self, key: str, ttl: int) -> bool:
        """模拟 Redis EXPIRE。"""
        self.expires[key] = ttl
        return True

    async def get(self, key: str) -> str | None:
        """模拟 Redis GET。"""
        return self.values.get(key)

    async def delete(self, key: str) -> int:
        """模拟 Redis DELETE。"""
        self.values.pop(key, None)
        return 1


@pytest.mark.asyncio
async def test_append_event_writes_jsonl_and_refreshes_ttl() -> None:
    """每个事件必须以 JSONL 追加，并刷新 30 分钟 TTL。"""
    redis = _FakeRedis()
    service = AgentStreamBufferService(redis_client=redis)

    await service.append_event(session_id=1, run_id="run-1", envelope={"seq": 1, "event": "message.delta"})

    key = "agent:stream_buffer:1:run-1"
    assert redis.values[key].endswith("\n")
    assert '"event":"message.delta"' in redis.values[key]
    assert redis.expires[key] == 1800


@pytest.mark.asyncio
async def test_read_events_parses_jsonl() -> None:
    """读取 Redis JSONL 时返回 envelope 列表。"""
    redis = _FakeRedis()
    service = AgentStreamBufferService(redis_client=redis)
    await service.append_event(session_id=1, run_id="run-1", envelope={"seq": 1})
    await service.append_event(session_id=1, run_id="run-1", envelope={"seq": 2})

    events = await service.read_events(session_id=1, run_id="run-1")

    assert [item["seq"] for item in events] == [1, 2]


@pytest.mark.asyncio
async def test_append_failure_uses_memory_fallback() -> None:
    """Redis 追加失败时退化为内存缓冲。"""
    redis = _FakeRedis()
    redis.fail_append = True
    service = AgentStreamBufferService(redis_client=redis)

    await service.append_event(session_id=1, run_id="run-1", envelope={"seq": 1, "event": "error"})
    events = await service.read_events(session_id=1, run_id="run-1")

    assert events == [{"seq": 1, "event": "error"}]
```

- [ ] **Step 2: Run test to verify failure**

Run from `backend`:

```powershell
python -m pytest tests/services/test_agent_stream_buffer_service.py -q
```

Expected: failure because service file does not exist.

- [ ] **Step 3: Implement service**

Create `backend/app/services/agent_stream_buffer_service.py`:

```python
"""Agent 流式事件 Redis 临时缓冲服务。"""

from __future__ import annotations

import json
import logging
from typing import Any

from redis.asyncio import Redis

logger = logging.getLogger(__name__)

STREAM_BUFFER_TTL_SECONDS = 1800


class AgentStreamBufferService:
    """使用 Redis APPEND 保存单次 Agent run 的 JSONL 流式事件。"""

    def __init__(self, redis_client: Redis | Any, ttl_seconds: int = STREAM_BUFFER_TTL_SECONDS) -> None:
        """
        初始化流式缓冲服务。

        Args:
            redis_client: redis.asyncio.Redis 兼容客户端
            ttl_seconds: 缓冲 TTL 秒数
        """
        self._redis = redis_client
        self._ttl_seconds = ttl_seconds
        self._memory_events: dict[str, list[dict[str, Any]]] = {}

    def build_key(self, session_id: int, run_id: str) -> str:
        """
        构建 Redis 缓冲 key。

        Args:
            session_id: Agent 会话 ID
            run_id: 本次 Agent run ID

        Returns:
            str: Redis key
        """
        return f"agent:stream_buffer:{session_id}:{run_id}"

    async def append_event(self, *, session_id: int, run_id: str, envelope: dict[str, Any]) -> None:
        """
        追加单条 envelope 到 Redis JSONL，失败时写入内存缓冲。

        Args:
            session_id: Agent 会话 ID
            run_id: 本次 Agent run ID
            envelope: SSE v2 envelope 字典
        """
        key = self.build_key(session_id, run_id)
        self._memory_events.setdefault(key, []).append(envelope)
        try:
            line = json.dumps(envelope, ensure_ascii=False, separators=(",", ":")) + "\n"
            await self._redis.append(key, line)
            await self._redis.expire(key, self._ttl_seconds)
        except (RuntimeError, TimeoutError, ConnectionError) as exc:
            logger.exception("Agent stream buffer append failed: key=%s", key, exc_info=exc)

    async def read_events(self, *, session_id: int, run_id: str) -> list[dict[str, Any]]:
        """
        读取 Redis JSONL 事件，Redis 不可用时返回内存缓冲。

        Args:
            session_id: Agent 会话 ID
            run_id: 本次 Agent run ID

        Returns:
            list[dict[str, Any]]: 按写入顺序排列的 envelope 列表
        """
        key = self.build_key(session_id, run_id)
        try:
            raw = await self._redis.get(key)
            text = raw.decode("utf-8") if isinstance(raw, bytes) else raw
            if text:
                return [json.loads(line) for line in text.splitlines() if line.strip()]
        except (RuntimeError, TimeoutError, ConnectionError, json.JSONDecodeError) as exc:
            logger.exception("Agent stream buffer read failed: key=%s", key, exc_info=exc)
        return list(self._memory_events.get(key, []))

    async def clear(self, *, session_id: int, run_id: str) -> None:
        """
        清理 Redis 与内存缓冲。

        Args:
            session_id: Agent 会话 ID
            run_id: 本次 Agent run ID
        """
        key = self.build_key(session_id, run_id)
        self._memory_events.pop(key, None)
        try:
            await self._redis.delete(key)
        except (RuntimeError, TimeoutError, ConnectionError) as exc:
            logger.exception("Agent stream buffer clear failed: key=%s", key, exc_info=exc)
```

- [ ] **Step 4: Run tests**

Run from `backend`:

```powershell
python -m pytest tests/services/test_agent_stream_buffer_service.py -q
```

Expected: `3 passed`.

- [ ] **Step 5: Commit**

```powershell
git add -- backend/app/services/agent_stream_buffer_service.py backend/tests/services/test_agent_stream_buffer_service.py
git commit -m "feat: add agent stream buffer service"
```

---

## Task 5: Workflow DTOs and prompt templates

**Files:**
- Modify: `backend/app/schemas/agent/dto.py`
- Create prompt files under `backend/app/llm/prompts/templates/`
- Test: `backend/tests/services/test_agent_workflow_request_schema.py`

- [ ] **Step 1: Add DTO coverage test**

Extend `backend/tests/services/test_agent_workflow_request_schema.py`:

```python
from app.schemas.agent.dto import InterviewQuestionItemDTO, ResumeEvaluationReportDTO


def test_interview_question_item_dto_requires_core_fields() -> None:
    """面试题 DTO 必须能承载前端结构化卡片字段。"""
    item = InterviewQuestionItemDTO(
        question="请介绍项目中的关键技术决策。",
        dimension="项目深度",
        difficulty="中等",
        evaluation_points=["真实贡献", "技术取舍"],
        follow_up_suggestions=["追问指标和代码实现"],
        excellent_signals=["能说明方案和指标"],
        average_signals=["只描述参与过程"],
        risk_signals=["无法说明本人贡献"],
    )

    assert item.dimension == "项目深度"
    assert item.difficulty == "中等"


def test_resume_evaluation_report_dto_contains_required_sections() -> None:
    """简历评估报告 DTO 必须包含全部前端展示分区。"""
    report = ResumeEvaluationReportDTO(
        final_score=82,
        final_label="良好",
        decision="建议进入面试",
        summary="岗位匹配度较高。",
        match_overview={"advantages": ["后端经验充分"], "risks": []},
        resume_structure={"work_experiences": []},
        experience_timeline=[],
        skill_dimensions=[],
        job_gaps=[],
    )

    assert report.decision == "建议进入面试"
    assert report.match_overview["advantages"] == ["后端经验充分"]
```

- [ ] **Step 2: Add DTOs**

Append to `backend/app/schemas/agent/dto.py`:

```python
class InterviewDimensionDTO(BaseModel):
    """AI 提议的面试维度。"""

    name: str
    reason: str
    source: str = "ai"


class InterviewQuestionPlanItemDTO(BaseModel):
    """面试题计划中的单个维度配置。"""

    dimension: str
    question_count: int
    difficulty: str
    focus: str


class InterviewQuestionPlanDTO(BaseModel):
    """面试题生成计划。"""

    total_questions: int
    items: list[InterviewQuestionPlanItemDTO]
    summary: str


class InterviewQuestionItemDTO(BaseModel):
    """单道结构化面试题。"""

    question: str
    dimension: str
    difficulty: str
    evaluation_points: list[str] = Field(default_factory=list)
    follow_up_suggestions: list[str] = Field(default_factory=list)
    excellent_signals: list[str] = Field(default_factory=list)
    average_signals: list[str] = Field(default_factory=list)
    risk_signals: list[str] = Field(default_factory=list)


class InterviewQuestionSetDTO(BaseModel):
    """最终面试题清单。"""

    title: str = "面试题清单"
    total_questions: int
    dimensions: list[str]
    questions: list[InterviewQuestionItemDTO]


class ResumeEvaluationReportDTO(BaseModel):
    """简历评估报告结构化数据。"""

    final_score: float
    final_label: str
    decision: str
    summary: str
    match_overview: dict[str, Any] = Field(default_factory=dict)
    resume_structure: dict[str, Any] = Field(default_factory=dict)
    experience_timeline: list[dict[str, Any]] = Field(default_factory=list)
    skill_dimensions: list[dict[str, Any]] = Field(default_factory=list)
    job_gaps: list[dict[str, Any]] = Field(default_factory=list)
```

- [ ] **Step 3: Create prompt templates**

Create each YAML file with `role`, `context`, `instructions`, and `output_format` keys. Each template must require JSON-only output and evidence from resume/job/template data.

Required files:

```text
backend/app/llm/prompts/templates/interview_dimension_suggest.yaml
backend/app/llm/prompts/templates/interview_question_plan.yaml
backend/app/llm/prompts/templates/interview_question_generate.yaml
backend/app/llm/prompts/templates/resume_profile_analyze.yaml
backend/app/llm/prompts/templates/resume_evaluation_visual_report.yaml
```

Use this concrete shape for `interview_dimension_suggest.yaml`:

```yaml
role: "你是企业 HR 面试设计助手。"
context: |
  候选人简历：
  {resume_text}
instructions: |
  请基于简历提议 4 到 6 个适合本次面试重点追问的维度。
  每个维度必须给出简短原因。
  如果简历信息不足，请仍然根据已有信息输出最稳妥的维度。
output_format: |
  只输出 JSON，不要输出 Markdown。
  {
    "dimensions": [
      {"name": "项目深度", "reason": "候选人有多个项目经历，需要核实真实贡献"}
    ]
  }
```

Use equivalent JSON-only structure for the other four templates, matching DTO fields in this task.

- [ ] **Step 4: Run validations**

Run from `backend`:

```powershell
python -m pytest tests/services/test_agent_workflow_request_schema.py -q
python -m py_compile app/schemas/agent/dto.py
```

Expected: tests pass and compile exits `0`.

- [ ] **Step 5: Commit**

```powershell
git add -- backend/app/schemas/agent/dto.py backend/app/llm/prompts/templates/interview_dimension_suggest.yaml backend/app/llm/prompts/templates/interview_question_plan.yaml backend/app/llm/prompts/templates/interview_question_generate.yaml backend/app/llm/prompts/templates/resume_profile_analyze.yaml backend/app/llm/prompts/templates/resume_evaluation_visual_report.yaml backend/tests/services/test_agent_workflow_request_schema.py
git commit -m "feat: add agent workflow DTOs and prompts"
```

---

## Task 6: Interview question service

**Files:**
- Create: `backend/app/services/interview_question_service.py`
- Test: `backend/tests/services/test_interview_question_service.py`

- [ ] **Step 1: Write service tests**

Create `backend/tests/services/test_interview_question_service.py` with tests for fixed fallback and final block shape:

```python
"""InterviewQuestionService tests."""

from types import SimpleNamespace

import pytest

from app.schemas.agent.dto import InterviewQuestionItemDTO
from app.services.interview_question_service import InterviewQuestionService


class _RouterThatFails:
    """测试用模型路由器：维度提议失败。"""

    async def complete(self, prompt, runtime_config):
        """模拟 LLM 失败。"""
        raise RuntimeError("llm failed")


@pytest.mark.asyncio
async def test_suggest_dimensions_falls_back_to_fixed_dimensions() -> None:
    """维度提议失败时返回固定内置维度。"""
    service = InterviewQuestionService(model_router=_RouterThatFails(), resume_pipeline=object())

    dimensions = await service.suggest_dimensions(resume_text="", runtime_config=SimpleNamespace())

    assert [item.name for item in dimensions]
    assert dimensions[0].source == "fallback"


def test_build_question_set_block_has_expected_type() -> None:
    """最终 block 必须使用 interview_question_set 类型。"""
    service = InterviewQuestionService(model_router=object(), resume_pipeline=object())
    block = service.build_question_set_block([
        InterviewQuestionItemDTO(
            question="问题",
            dimension="项目深度",
            difficulty="中等",
            evaluation_points=["贡献"],
        )
    ])

    assert block["type"] == "interview_question_set"
    assert block["question_set"]["total_questions"] == 1
```

- [ ] **Step 2: Implement service with minimal public API**

Create `backend/app/services/interview_question_service.py` with these public methods:

- `load_resume_text(employee_id: int, resume_ref: dict[str, Any]) -> str`
- `suggest_dimensions(resume_text: str, runtime_config: LLMRuntimeConfigDTO) -> list[InterviewDimensionDTO]`
- `build_question_plan(resume_text: str, selected_dimensions: list[str], runtime_config: LLMRuntimeConfigDTO) -> InterviewQuestionPlanDTO`
- `generate_questions_for_dimension(resume_text: str, plan_item: InterviewQuestionPlanItemDTO, runtime_config: LLMRuntimeConfigDTO) -> list[InterviewQuestionItemDTO]`
- `build_question_set_block(questions: list[InterviewQuestionItemDTO]) -> dict[str, Any]`

Implementation requirements:

- `load_resume_text()` calls `AgentResumePipelineService.load_resume_context()` or existing resume pipeline equivalent and returns structured markdown when available.
- `suggest_dimensions()` calls `model_router.complete()` and parses JSON.
- On LLM or JSON parse failure, return fixed fallback dimensions with `source="fallback"`.
- Fixed fallback dimensions: `项目深度`, `技术能力`, `沟通表达`, `稳定性`, `岗位匹配`.
- `build_question_set_block()` returns:

```python
question_set = InterviewQuestionSetDTO(
    total_questions=len(questions),
    dimensions=sorted({item.dimension for item in questions}),
    questions=questions,
)
return {
    "type": "interview_question_set",
    "question_set": question_set.model_dump(mode="json"),
}
```

- [ ] **Step 3: Run service tests**

Run from `backend`:

```powershell
python -m pytest tests/services/test_interview_question_service.py -q
python -m py_compile app/services/interview_question_service.py
```

Expected: tests pass and compile exits `0`.

- [ ] **Step 4: Commit**

```powershell
git add -- backend/app/services/interview_question_service.py backend/tests/services/test_interview_question_service.py
git commit -m "feat: add interview question workflow service"
```

---

## Task 7: Resume evaluation workflow service

**Files:**
- Create: `backend/app/services/resume_evaluation_workflow_service.py`
- Test: `backend/tests/services/test_resume_evaluation_workflow_service.py`

- [ ] **Step 1: Write service tests**

Create `backend/tests/services/test_resume_evaluation_workflow_service.py`:

```python
"""ResumeEvaluationWorkflowService tests."""

from types import SimpleNamespace

import pytest

from app.services.resume_evaluation_workflow_service import ResumeEvaluationWorkflowService


class _JobRepo:
    """测试用岗位仓储。"""

    async def get_by_employee(self, employee_id: int):
        """返回员工岗位。"""
        return [SimpleNamespace(id=1, name="Java 后端工程师", status=1)]


class _Cache:
    """测试用缓存服务。"""

    def __init__(self) -> None:
        """初始化缓存。"""
        self.value = None

    async def get_json(self, key: str):
        """读取缓存。"""
        return self.value

    async def set_json(self, key: str, value, expire: int) -> None:
        """写入缓存。"""
        self.value = value


@pytest.mark.asyncio
async def test_load_job_candidates_uses_repository_on_cache_miss() -> None:
    """缓存未命中时查询岗位仓储并写缓存。"""
    cache = _Cache()
    service = ResumeEvaluationWorkflowService(
        model_router=object(),
        resume_pipeline=object(),
        job_repo=_JobRepo(),
        cache=cache,
        evaluation_graph=None,
    )

    candidates = await service.load_job_candidates(employee_id=1)

    assert candidates[0]["name"] == "Java 后端工程师"
    assert cache.value[0]["name"] == "Java 后端工程师"


@pytest.mark.asyncio
async def test_validate_job_full_name_rejects_partial_name() -> None:
    """岗位全名校验必须严格匹配。"""
    service = ResumeEvaluationWorkflowService(
        model_router=object(),
        resume_pipeline=object(),
        job_repo=_JobRepo(),
        cache=_Cache(),
        evaluation_graph=None,
    )

    result = await service.validate_job_full_name(employee_id=1, job_name="Java")

    assert result["valid"] is False
    assert result["error_code"] == "job_name_not_matched"
```

- [ ] **Step 2: Implement service public API**

Create `backend/app/services/resume_evaluation_workflow_service.py` with these public methods:

- `load_resume_text(employee_id: int, resume_ref: dict[str, Any]) -> str`
- `analyze_resume_profile(resume_text: str, runtime_config: LLMRuntimeConfigDTO) -> dict[str, Any]`
- `load_job_candidates(employee_id: int) -> list[dict[str, Any]]`
- `validate_job_full_name(employee_id: int, job_name: str) -> dict[str, Any]`
- `run_evaluation_subgraph(resume_text: str, selected_job: dict[str, Any], runtime_config: LLMRuntimeConfigDTO) -> dict[str, Any]`
- `build_visualization_report(resume_profile: dict[str, Any], selected_job: dict[str, Any], evaluation_result: dict[str, Any], runtime_config: LLMRuntimeConfigDTO) -> ResumeEvaluationReportDTO`
- `build_report_block(report: ResumeEvaluationReportDTO) -> dict[str, Any]`

Implementation requirements:

- `load_job_candidates()` key: `agent:job_candidates:{employee_id}`.
- Candidate cache TTL: `300` seconds.
- `validate_job_full_name()` accepts only exact `job.name == job_name` and returns selected job dict on success.
- `run_evaluation_subgraph()` calls the injected evaluation graph or existing evaluation graph wrapper and does not write business evaluation tables.
- `build_report_block()` returns:

```python
{
    "type": "resume_evaluation_report",
    "report": report.model_dump(mode="json"),
}
```

- [ ] **Step 3: Run service tests**

Run from `backend`:

```powershell
python -m pytest tests/services/test_resume_evaluation_workflow_service.py -q
python -m py_compile app/services/resume_evaluation_workflow_service.py
```

Expected: tests pass and compile exits `0`.

- [ ] **Step 4: Commit**

```powershell
git add -- backend/app/services/resume_evaluation_workflow_service.py backend/tests/services/test_resume_evaluation_workflow_service.py
git commit -m "feat: add resume evaluation workflow service"
```

---

## Task 8: Workflow graph builders and runner

**Files:**
- Create: `backend/app/llm/graphs/workflows/__init__.py`
- Create: `backend/app/llm/graphs/workflows/state.py`
- Create: `backend/app/llm/graphs/workflows/interview_questions.py`
- Create: `backend/app/llm/graphs/workflows/resume_evaluation.py`
- Create: `backend/app/llm/graphs/workflows/runner.py`
- Test: `backend/tests/llm/test_interview_question_graph.py`
- Test: `backend/tests/llm/test_resume_evaluation_workflow_graph.py`

- [ ] **Step 1: Write graph tests**

Create `backend/tests/llm/test_interview_question_graph.py`:

```python
"""Interview question graph tests."""

from app.llm.graphs.workflows.interview_questions import build_interview_question_graph


def test_build_interview_question_graph_compiles() -> None:
    """面试题工作流图可以编译。"""
    graph = build_interview_question_graph()

    assert graph is not None
```

Create `backend/tests/llm/test_resume_evaluation_workflow_graph.py`:

```python
"""Resume evaluation workflow graph tests."""

from app.llm.graphs.workflows.resume_evaluation import build_resume_evaluation_graph


def test_build_resume_evaluation_graph_compiles() -> None:
    """简历评估工作流图可以编译。"""
    graph = build_resume_evaluation_graph()

    assert graph is not None
```

- [ ] **Step 2: Implement `state.py`**

Use `TypedDict` states with `service_context` as injected runtime object. Required keys:

```python
class AgentWorkflowState(TypedDict, total=False):
    workflow_type: str
    employee_id: int
    session_id: int
    session_key: str
    user_message_id: int
    run_id: str
    resume_ref: dict[str, Any]
    runtime_config: dict[str, Any]
    interaction_payload: dict[str, Any]
    service_context: Any
    final_text: str
    final_blocks: list[dict[str, Any]]
    error_message: str
```

Add `InterviewQuestionState` and `ResumeEvaluationState` with the business fields from the approved spec.

- [ ] **Step 3: Implement interview graph**

`interview_questions.py` must use `StateGraph(InterviewQuestionState)` and nodes:

```text
load_resume
suggest_dimensions
request_dimension_selection
build_question_plan
request_plan_approval
fanout_generate_questions
reduce_questions
finalize_question_set
```

Interaction nodes use `langgraph.types.interrupt()` with payload:

```python
{
    "kind": "interaction",
    "request_id": request_id,
    "interaction_type": "dimension_selection",
    "title": "请选择面试重点",
    "prompt": "选择本次面试需要重点追问的维度。",
    "data": {"dimensions": dimensions},
    "submit_label": "确认选择",
}
```

`request_plan_approval` must always interrupt before generation.

- [ ] **Step 4: Implement resume evaluation graph**

`resume_evaluation.py` must use `StateGraph(ResumeEvaluationState)` and nodes:

```text
load_resume
analyze_resume_profile
load_job_candidates
request_job_selection
validate_job_full_name
run_evaluation_subgraph
build_visualization_report
finalize_evaluation_report
```

Validation failure returns to `request_job_selection` until `validation_attempts >= 3`; after 3 failures, set `error_message` and end through finalize with an error block.

- [ ] **Step 5: Implement workflow runner**

`runner.py` must expose:

```python
class AgentWorkflowRunner:
    """双业务工作流图运行器。"""

    def __init__(self, compiled_graph) -> None:
        """初始化运行器。"""
        self._graph = compiled_graph

    async def astream(self, *, thread_id: str, graph_input: dict[str, Any] | Command, emitter: AgentStreamEmitter) -> AsyncIterator[AgentStreamEvent]:
        """运行图并翻译更新、中断和完成事件。"""
```

Runner translation rules:

- Graph update → `execution_status` with compact `display_name`.
- `kind == "interaction"` interrupt → `interaction_request`.
- `completed` final state → `completed` with `blocks`.
- Preserve `get_final_message(thread_id)` returning `final_text` from graph state.
- Add `get_final_blocks(thread_id)` returning `final_blocks` from graph state.

- [ ] **Step 6: Run graph tests**

Run from `backend`:

```powershell
python -m pytest tests/llm/test_interview_question_graph.py tests/llm/test_resume_evaluation_workflow_graph.py -q
python -m py_compile app/llm/graphs/workflows/state.py app/llm/graphs/workflows/interview_questions.py app/llm/graphs/workflows/resume_evaluation.py app/llm/graphs/workflows/runner.py
```

Expected: tests pass and compile exits `0`.

- [ ] **Step 7: Commit**

```powershell
git add -- backend/app/llm/graphs/workflows backend/tests/llm/test_interview_question_graph.py backend/tests/llm/test_resume_evaluation_workflow_graph.py
git commit -m "feat: add agent workflow graphs"
```

---

## Task 9: FastAPI lifespan graph singletons

**Files:**
- Modify: `backend/app/main.py`
- Test: `backend/tests/llm/test_interview_question_graph.py`

- [ ] **Step 1: Add graph imports and lifespan state**

Modify `backend/app/main.py`:

```python
from app.llm.graphs.workflows import build_interview_question_graph, build_resume_evaluation_graph
```

Inside `lifespan`, after cache creation:

```python
app.state.agent_workflow_graphs = {
    "interview_questions": build_interview_question_graph(),
    "resume_evaluation": build_resume_evaluation_graph(),
}
```

- [ ] **Step 2: Run compile validation**

Run from `backend`:

```powershell
python -m py_compile app/main.py
```

Expected: command exits `0`.

- [ ] **Step 3: Commit**

```powershell
git add -- backend/app/main.py
git commit -m "feat: compile agent workflow graphs in lifespan"
```

---

## Task 10: AgentService workflow routing, buffering, and persistence

**Files:**
- Modify: `backend/app/services/agent_service.py`
- Modify: `backend/app/api/v1/endpoints/agent.py`
- Test: `backend/tests/services/test_agent_workflow_routing.py`
- Modify: `backend/tests/services/test_agent_service_stream_message.py`

- [ ] **Step 1: Write routing test**

Create `backend/tests/services/test_agent_workflow_routing.py`:

```python
"""AgentService workflow routing tests."""

from types import SimpleNamespace
from typing import Any

import pytest

from app.schemas.agent.request import AgentMessageCreate
from app.services.agent_service import AgentService


class _Repo:
    """测试用 AgentRepository。"""

    def __init__(self) -> None:
        """初始化状态。"""
        self.created_messages: list[dict[str, Any]] = []

    async def get_session(self, session_id: int, employee_id: int):
        """返回测试会话。"""
        return SimpleNamespace(id=session_id, session_key="session-key", employee_id=employee_id, selected_model_name=None)

    async def next_message_order(self, session_id: int) -> int:
        """返回排序。"""
        return len(self.created_messages) + 1

    async def create_message(self, **kwargs: Any):
        """记录消息。"""
        self.created_messages.append(kwargs)
        return SimpleNamespace(id=len(self.created_messages), **kwargs)

    async def update_session(self, *args: Any, **kwargs: Any) -> None:
        """忽略会话更新。"""
        return None

    async def commit(self) -> None:
        """模拟提交。"""
        return None

    async def rollback(self) -> None:
        """模拟回滚。"""
        return None


class _LlmService:
    """测试用 LLM 配置服务。"""

    async def get_runtime_config(self, current_user, model_name):
        """返回最小运行时配置。"""
        from app.schemas.agent.dto import LLMRuntimeConfigDTO

        return LLMRuntimeConfigDTO(model_name="m", api_key="k", base_url="http://example.test")


@pytest.mark.asyncio
async def test_stream_message_uses_requested_workflow_type() -> None:
    """消息级 workflow_type 必须保存并传入 emitter。"""
    repo = _Repo()
    service = AgentService(repo, _LlmService(), model_router=object())
    body = AgentMessageCreate(content="评估简历", workflow_type="resume_evaluation")

    assert body.workflow_type == "resume_evaluation"
```

This first test only locks schema and constructor compatibility. Add deeper runner assertions after `_build_workflow_runner()` exists.

- [ ] **Step 2: Inject cache into AgentService endpoint**

Modify `backend/app/api/v1/endpoints/agent.py` `get_agent_service()` so `AgentService` receives `cache=cache`.

- [ ] **Step 3: Extend AgentService constructor**

Add optional dependencies:

```python
cache: CacheService | None = None,
workflow_graphs: dict[str, Any] | None = None,
```

Inside constructor:

```python
self._cache = cache
self._stream_buffer = AgentStreamBufferService(cache.client) if cache else None
self._workflow_graphs = workflow_graphs or {}
```

- [ ] **Step 4: Route `stream_message()` by workflow**

In `stream_message()`:

- Use `body.workflow_type`.
- Create `AgentStreamEmitter(session_id=session.id, session_key=session.session_key, workflow_type=body.workflow_type)`.
- If `body.workflow_type == "interview_questions"`, build `AgentWorkflowRunner` for interview graph.
- If `body.workflow_type == "resume_evaluation"`, build `AgentWorkflowRunner` for resume evaluation graph.
- Keep old coordinator runner only for explicit compatibility branches inside private helpers.

- [ ] **Step 5: Buffer every emitted event**

Add private helper:

```python
async def _yield_buffered_event(
    self,
    *,
    event: AgentStreamEvent,
    session_id: int,
    run_id: str,
) -> AgentStreamEvent:
    """写入 Redis stream buffer 后返回事件。"""
    if self._stream_buffer:
        await self._stream_buffer.append_event(session_id=session_id, run_id=run_id, envelope=event.data)
    return event
```

Wrap all yields from workflow runs through this helper.

- [ ] **Step 6: Persist final blocks**

Modify `_persist_agent_message()` or add `_persist_agent_message_blocks()` so agent messages include:

```python
content={
    "context_refs": [],
    "blocks": [
        {"type": "text", "text": final_message},
        {"type": "stream_events", "schema_version": "2.0", "events": buffered_events},
        *final_blocks,
    ],
}
workflow_type=workflow_type,
run_id=run_id,
```

- [ ] **Step 7: Persist interaction snapshots**

When workflow runner emits `interaction_request`, read current buffered events and persist a stage agent message with `stream_events` block so refresh can show the pending card. Execution resume remains checkpoint-based.

- [ ] **Step 8: Update form submit resume**

`submit_form()` must:

- Locate the workflow from latest pending stage message `workflow_type` or request payload.
- Emit `interaction_result` ACK.
- Resume with `Command(resume=body.values)`.
- Use the same `session.session_key` as thread id.

- [ ] **Step 9: Run tests**

Run from `backend`:

```powershell
python -m pytest tests/services/test_agent_workflow_routing.py tests/services/test_agent_service_stream_message.py -q
python -m py_compile app/services/agent_service.py app/api/v1/endpoints/agent.py
```

Expected: tests pass and compile exits `0`.

- [ ] **Step 10: Commit**

```powershell
git add -- backend/app/services/agent_service.py backend/app/api/v1/endpoints/agent.py backend/tests/services/test_agent_workflow_routing.py backend/tests/services/test_agent_service_stream_message.py
git commit -m "feat: route agent messages through workflow graphs"
```

---

## Task 11: Frontend workflow switcher and API payload

**Files:**
- Modify: `frontend/src/components/employee/agent/agent-composer.tsx`
- Modify: `frontend/src/pages/employee/agent.tsx`
- Modify: `frontend/src/api/employee/agent.ts`
- Test: `frontend/src/__tests__/employee/agent-workflow-switcher.test.tsx`

- [ ] **Step 1: Write component test**

Create `frontend/src/__tests__/employee/agent-workflow-switcher.test.tsx`:

```tsx
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { AgentComposer } from '@/components/employee/agent/agent-composer';


describe('AgentComposer workflow switcher', () => {
  it('renders workflow options and calls onWorkflowChange', async () => {
    const onWorkflowChange = vi.fn();
    render(
      <AgentComposer
        input=""
        sending={false}
        resumeFile={null}
        workflowType="interview_questions"
        onWorkflowChange={onWorkflowChange}
        onInputChange={() => undefined}
        onResumeFileChange={() => undefined}
        onSubmit={(event) => event.preventDefault()}
      />,
    );

    await userEvent.click(screen.getByRole('button', { name: '简历评估' }));

    expect(screen.getByRole('button', { name: '简历问答' })).toBeInTheDocument();
    expect(onWorkflowChange).toHaveBeenCalledWith('resume_evaluation');
  });
});
```

- [ ] **Step 2: Extend composer props**

Add props:

```ts
workflowType: TAgentWorkflowType;
onWorkflowChange: (workflowType: TAgentWorkflowType) => void;
```

Render segmented buttons above file upload row:

```tsx
<div className="flex items-center gap-1 rounded-2xl bg-slate-100 p-1" aria-label="Agent 工作流选择">
  <button type="button" className={workflowType === 'interview_questions' ? selectedClass : idleClass} onClick={() => onWorkflowChange('interview_questions')}>简历问答</button>
  <button type="button" className={workflowType === 'resume_evaluation' ? selectedClass : idleClass} onClick={() => onWorkflowChange('resume_evaluation')}>简历评估</button>
</div>
```

Use Tailwind classes that do not scale on hover.

- [ ] **Step 3: Wire page state and API**

In `frontend/src/pages/employee/agent.tsx`:

- Add state: `const [workflowType, setWorkflowType] = useState<TAgentWorkflowType>('interview_questions');`
- Pass `workflowType` and `setWorkflowType` to `AgentComposer`.
- Include `workflow_type: workflowType` in `employeeAgentApi.streamMessage()` payload.

- [ ] **Step 4: Run frontend tests**

Run from `frontend`:

```powershell
npm.cmd test -- src/__tests__/employee/agent-workflow-switcher.test.tsx
npx tsc --noEmit
```

Expected: tests pass and TypeScript exits `0`.

- [ ] **Step 5: Commit**

```powershell
git add -- frontend/src/components/employee/agent/agent-composer.tsx frontend/src/pages/employee/agent.tsx frontend/src/api/employee/agent.ts frontend/src/__tests__/employee/agent-workflow-switcher.test.tsx
git commit -m "feat: add agent workflow switcher"
```

---

## Task 12: Frontend stream handler for compact workflow events

**Files:**
- Modify: `frontend/src/types/agent.ts`
- Modify: `frontend/src/utils/agent-stream-handler.ts`
- Modify: `frontend/src/__tests__/employee/agent-stream-handler.test.ts`

- [ ] **Step 1: Add frontend runtime state types**

Add to `frontend/src/types/agent.ts`:

```ts
export interface IAgentThinkingStreamItem {
  id: string;
  run_id: string;
  status: 'started' | 'streaming' | 'completed' | 'unavailable';
  content: string;
}

export interface IAgentInteractionRequestItem {
  id: string;
  run_id: string;
  interaction_type: 'dimension_selection' | 'plan_approval' | 'job_selection';
  title: string;
  prompt: string;
  data: Record<string, unknown>;
  submit_label: string;
  status: 'pending' | 'submitted' | 'expired';
}

export interface IAgentBusinessCardItem {
  id: string;
  run_id: string;
  type: 'interview_question_set' | 'resume_evaluation_report';
  payload: Record<string, unknown>;
}
```

- [ ] **Step 2: Extend handler dependencies**

Add setters to `AgentStreamHandlerDeps`:

```ts
setThinkingItems?: Dispatch<SetStateAction<IAgentThinkingStreamItem[]>>;
setInteractionRequests?: Dispatch<SetStateAction<IAgentInteractionRequestItem[]>>;
setBusinessCards?: Dispatch<SetStateAction<IAgentBusinessCardItem[]>>;
```

Keep optional setters so existing tests and older pages do not break during incremental migration.

- [ ] **Step 3: Handle new events**

In `handleAgentV2Event()` add branches:

- `thinking_status`: create/update thinking item status.
- `thinking_stream`: append to thinking item content only; never append to message body.
- `text_stream`: append to message body using `appendTokenDelta()`.
- `execution_status`: upsert compact runtime feed item using `display_name` or payload title.
- `interaction_request`: upsert interaction request with `status: 'pending'`.
- `interaction_result`: mark matching request `submitted`.
- `data.card` with `card_type=interview_question_set` or `resume_evaluation_report`: add business card.
- `completed`: mark running feed items success.

- [ ] **Step 4: Add stream handler tests**

Extend `frontend/src/__tests__/employee/agent-stream-handler.test.ts` with:

```ts
it('keeps thinking_stream separate from message text', () => {
  const { deps, messages } = createHandlerDeps();
  const thinkingItems = { value: [] as Array<{ id: string; content: string; status: string; run_id: string }> };
  deps.setThinkingItems = createSetter(thinkingItems);

  handleAgentStreamEvent({
    event: 'agent',
    data: {
      schema_version: '2.0',
      seq: 1,
      run_id: 'run-1',
      session_id: 1,
      node_id: 'interview_questions',
      event: 'thinking_stream',
      payload: { message_id: 'think-1', delta: '内部思考' },
      ts: 1,
    },
  }, deps);

  expect(messages.value).toHaveLength(0);
  expect(thinkingItems.value[0].content).toBe('内部思考');
});
```

Add an interaction request test that asserts `interaction_request` creates a pending item.

- [ ] **Step 5: Run tests**

Run from `frontend`:

```powershell
npm.cmd test -- src/__tests__/employee/agent-stream-handler.test.ts
npx tsc --noEmit
```

Expected: tests pass and TypeScript exits `0`.

- [ ] **Step 6: Commit**

```powershell
git add -- frontend/src/types/agent.ts frontend/src/utils/agent-stream-handler.ts frontend/src/__tests__/employee/agent-stream-handler.test.ts
git commit -m "feat: handle compact agent workflow events"
```

---

## Task 13: Frontend compact event and interaction components

**Files:**
- Create: `frontend/src/components/employee/agent/agent-run-compact-timeline.tsx`
- Create: `frontend/src/components/employee/agent/agent-thinking-panel.tsx`
- Create: `frontend/src/components/employee/agent/agent-interaction-card.tsx`
- Modify: `frontend/src/components/employee/agent/agent-message-list.tsx`
- Test: `frontend/src/__tests__/employee/agent-business-cards.test.tsx`

- [ ] **Step 1: Create compact timeline component**

`AgentRunCompactTimeline` props:

```ts
interface AgentRunCompactTimelineProps {
  items: IAgentRuntimeFeedItem[];
}
```

Rules:

- Default collapsed.
- Summary text: `运行过程 · 已完成 X 步`.
- Expand button with visible focus state.
- No JSON payload rendering.
- Use Lucide icons only.

- [ ] **Step 2: Create thinking panel**

`AgentThinkingPanel` props:

```ts
interface AgentThinkingPanelProps {
  item: IAgentThinkingStreamItem;
}
```

Rules:

- Default collapsed.
- `aria-live="polite"` for status text.
- Max expanded height `max-h-48 overflow-y-auto`.
- Does not render inside the text message Markdown component.

- [ ] **Step 3: Create interaction card**

`AgentInteractionCard` props:

```ts
interface AgentInteractionCardProps {
  item: IAgentInteractionRequestItem;
  onSubmit: (requestId: string, values: Record<string, unknown>) => void;
}
```

Render variants:

- `dimension_selection`: checkbox chips.
- `plan_approval`: summary with approve/reject controls.
- `job_selection`: candidate buttons and text input for full name.

All errors render inline using `role="alert"`.

- [ ] **Step 4: Wire into message list**

Modify `AgentMessageList` so compact runtime/thinking/interactions render below the relevant agent message area and above final business cards. Keep existing `AgentActionCard` and `PlanReviewTree` compatibility until migrated.

- [ ] **Step 5: Run frontend tests**

Run from `frontend`:

```powershell
npm.cmd test -- src/__tests__/employee/agent-business-cards.test.tsx src/__tests__/employee/agent-stream-handler.test.ts
npx tsc --noEmit
```

Expected: tests pass and TypeScript exits `0`.

- [ ] **Step 6: Commit**

```powershell
git add -- frontend/src/components/employee/agent/agent-run-compact-timeline.tsx frontend/src/components/employee/agent/agent-thinking-panel.tsx frontend/src/components/employee/agent/agent-interaction-card.tsx frontend/src/components/employee/agent/agent-message-list.tsx frontend/src/__tests__/employee/agent-business-cards.test.tsx
git commit -m "feat: render compact workflow interactions"
```

---

## Task 14: Frontend business cards and history restore

**Files:**
- Create: `frontend/src/components/employee/agent/interview-question-set-card.tsx`
- Create: `frontend/src/components/employee/agent/resume-evaluation-report-card.tsx`
- Modify: `frontend/src/components/employee/agent/agent-message-list.tsx`
- Modify: `frontend/src/pages/employee/agent.tsx`
- Test: `frontend/src/__tests__/employee/agent-business-cards.test.tsx`

- [ ] **Step 1: Add business card tests**

Create `frontend/src/__tests__/employee/agent-business-cards.test.tsx`:

```tsx
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { InterviewQuestionSetCard } from '@/components/employee/agent/interview-question-set-card';
import { ResumeEvaluationReportCard } from '@/components/employee/agent/resume-evaluation-report-card';


describe('agent business cards', () => {
  it('renders interview question set grouped content', () => {
    render(<InterviewQuestionSetCard questionSet={{ title: '面试题清单', total_questions: 1, dimensions: ['项目深度'], questions: [{ question: '请介绍项目贡献', dimension: '项目深度', difficulty: '中等', evaluation_points: ['真实贡献'], follow_up_suggestions: [], excellent_signals: [], average_signals: [], risk_signals: [] }] }} />);

    expect(screen.getByText('面试题清单')).toBeInTheDocument();
    expect(screen.getByText('请介绍项目贡献')).toBeInTheDocument();
  });

  it('renders resume evaluation report summary', () => {
    render(<ResumeEvaluationReportCard report={{ final_score: 82, final_label: '良好', decision: '建议进入面试', summary: '匹配度较高', match_overview: {}, resume_structure: {}, experience_timeline: [], skill_dimensions: [], job_gaps: [] }} />);

    expect(screen.getByText('简历评估报告')).toBeInTheDocument();
    expect(screen.getByText('建议进入面试')).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Implement `InterviewQuestionSetCard`**

Rules:

- Render title and total count.
- Group questions by `dimension`.
- Show question, dimension, difficulty, and evaluation points by default.
- Put follow-up suggestions and signals in collapsible details.
- Provide copy buttons without using emoji.

- [ ] **Step 3: Implement `ResumeEvaluationReportCard`**

Rules:

- Render summary score/label/decision.
- Render sections: match overview, HR decision, resume structure, timeline, skill dimensions, job gaps.
- Use CSS bars/SVG only for lightweight visualization.
- No modal and no heavy chart dependency.

- [ ] **Step 4: Restore history blocks**

In `frontend/src/pages/employee/agent.tsx` or a small helper in `agent-message-list.tsx`, parse historical `message.content.blocks`:

- `text`: render as current markdown reply.
- `stream_events`: rebuild compact timeline, thinking panel, and pending interactions.
- `interview_question_set`: render `InterviewQuestionSetCard`.
- `resume_evaluation_report`: render `ResumeEvaluationReportCard`.

Pending interaction detection:

```ts
const pending = interactionRequests.filter((request) => !interactionResults.has(request.id));
```

Only the latest run pending card is submit-enabled; older pending cards render as read-only if checkpoint resume fails.

- [ ] **Step 5: Run tests**

Run from `frontend`:

```powershell
npm.cmd test -- src/__tests__/employee/agent-business-cards.test.tsx src/__tests__/employee/agent-stream-handler.test.ts
npx tsc --noEmit
```

Expected: tests pass and TypeScript exits `0`.

- [ ] **Step 6: Commit**

```powershell
git add -- frontend/src/components/employee/agent/interview-question-set-card.tsx frontend/src/components/employee/agent/resume-evaluation-report-card.tsx frontend/src/components/employee/agent/agent-message-list.tsx frontend/src/pages/employee/agent.tsx frontend/src/__tests__/employee/agent-business-cards.test.tsx
git commit -m "feat: render agent workflow business cards"
```

---

## Task 15: End-to-end verification and regression pass

**Files:**
- Modify only files needed to fix failures found by the commands in this task.

- [ ] **Step 1: Run focused backend tests**

Run from `backend`:

```powershell
python -m pytest tests/services/test_agent_workflow_request_schema.py tests/services/test_agent_stream_buffer_service.py tests/services/test_interview_question_service.py tests/services/test_resume_evaluation_workflow_service.py tests/services/test_agent_workflow_routing.py tests/services/test_agent_service_stream_message.py tests/llm/test_interview_question_graph.py tests/llm/test_resume_evaluation_workflow_graph.py -q
```

Expected: all selected tests pass.

- [ ] **Step 2: Run backend compile checks**

Run from `backend`:

```powershell
python -m py_compile app/models/agent_message.py app/schemas/agent/request.py app/schemas/agent/response.py app/schemas/agent/dto.py app/schemas/agent/stream/events.py app/schemas/agent/stream/envelope.py app/llm/streaming/emitter.py app/services/agent_stream_buffer_service.py app/services/interview_question_service.py app/services/resume_evaluation_workflow_service.py app/llm/graphs/workflows/state.py app/llm/graphs/workflows/interview_questions.py app/llm/graphs/workflows/resume_evaluation.py app/llm/graphs/workflows/runner.py app/services/agent_service.py app/api/v1/endpoints/agent.py app/main.py
```

Expected: command exits `0`.

- [ ] **Step 3: Run focused frontend tests**

Run from `frontend`:

```powershell
npm.cmd test -- src/__tests__/employee/agent-stream-handler.test.ts src/__tests__/employee/agent-workflow-switcher.test.tsx src/__tests__/employee/agent-business-cards.test.tsx
npx tsc --noEmit
```

Expected: tests pass and TypeScript exits `0`.

- [ ] **Step 4: Run diff hygiene**

Run from repository root:

```powershell
git diff --check
```

Expected: no whitespace errors. LF-to-CRLF warnings are acceptable if they match existing repository behavior.

- [ ] **Step 5: Manual smoke test**

Start backend/frontend using the project’s normal commands. In the employee Agent UI:

- Send a `简历问答` message with a resume attachment.
- Verify dimension selection card appears inline.
- Approve plan.
- Verify final interview question card renders and event details are compact.
- Send a `简历评估` message with the same resume.
- Select a candidate job and submit exact full name.
- Verify report card renders without writing a business evaluation record.
- Refresh page.
- Verify historical stream events, thinking panel, business cards, and pending interactions restore.

- [ ] **Step 6: Commit final fixes**

```powershell
git add -- backend frontend sql docs
git commit -m "test: verify langgraph dual workflow agent"
```

---

## Self-Review Checklist

- [ ] DDL update appears before backend/frontend runtime implementation.
- [ ] `workflow_type` defaults to `interview_questions`.
- [ ] Existing v2 `message.delta` and `message.done` remain supported.
- [ ] `thinking_stream` never appends to the final message body.
- [ ] Redis buffer uses APPEND JSONL and TTL 1800.
- [ ] Final `agent_message.content.blocks` contains `stream_events` and business card blocks.
- [ ] Checkpoint remains execution recovery source.
- [ ] `agent_message` remains frontend render snapshot only.
- [ ] Graph nodes only call services and update state.
- [ ] Services own prompts, LLM calls, repositories, cache, and business rules.
- [ ] Frontend events default collapsed and do not crowd正文.
- [ ] 图二 does not persist business evaluation rows.

## Execution Recommendation

Use Subagent-Driven execution. The implementation is broad and has independent slices:

1. DDL/schema/protocol
2. Redis buffer
3. backend services
4. graph builders/runners
5. AgentService integration
6. frontend workflow/event rendering
7. verification

Each task should be implemented, reviewed, and committed before the next task starts.
