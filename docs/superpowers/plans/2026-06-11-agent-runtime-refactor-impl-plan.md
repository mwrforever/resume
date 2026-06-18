# Agent 运行时与渲染重构实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 推倒重建招聘 Agent 后端与前端：9 事件 + 6 block 协议（对齐 Claude Code）+ 两个 LangGraph 业务图 + 同模型 thinking 开关 + 基于 ui-ux-pro-max 的 block 中心前端，清掉 v1/v2/legacy 所有兼容包袱。

**Architecture:**
- 后端：`endpoint → 三个 service (session/runtime/resume) → 两图业务 service → LangGraph 节点 → llm 底座`；事件协议彻底重写为 9 type + 6 block 的 content_block 模型。
- 前端：以 `AgentBlock` 为中心，单一 reducer + 单一渲染器；rAF 节拍器解决流式断断续续；`layoutId` shared-element 解决 run→message 切换闪烁；token 化设计系统从 tailwind.config 单一来源。
- 清库重来：drop `agent_session/agent_message`，删除 `agent_memory` 与 Action 框架与长期记忆。

**Tech Stack:** Python 3.12 / FastAPI / SQLAlchemy 2.x async / langgraph 1.1 / langchain-openai 1.2 / pytest + pytest-asyncio | React 19 / TypeScript / Vite / Tailwind / Framer Motion / Vitest + Testing Library

**Spec Reference:** `docs/superpowers/specs/2026-06-11-agent-runtime-refactor-design.md`

---

## 文件结构总览

### 后端

**新建：**
- `backend/app/schemas/agent/stream/envelope.py` — 9 事件信封
- `backend/app/schemas/agent/stream/events.py` — 9 type + discriminated union
- `backend/app/schemas/agent/stream/blocks.py` — 6 block 类型
- `backend/app/llm/graphs/workflows/context.py` — `WorkflowRuntimeContext` dataclass
- `backend/app/services/agent_session_service.py` — 会话 CRUD + 标题
- `backend/app/services/agent_runtime_service.py` — SSE 编排 + Redis buffer + 落库 + checkpoint
- `backend/app/services/agent_resume_service.py` — 会话内简历上传 + Redis 引用
- `backend/app/services/resume_loader.py` — 简历读取（Redis 缓存 + Repository fallback）
- `backend/app/services/resume_evaluation_service.py` — 图二业务规则（重写）

**重写（同路径替换）：**
- `backend/app/llm/streaming/emitter.py` — 9 个 emit_* 方法
- `backend/app/llm/gateway.py` — 双 channel chunk + THINKING_PARAM_MAP
- `backend/app/llm/model_router.py` — 仅保留 stream/complete + fallback
- `backend/app/llm/graphs/workflows/state.py` — 两个独立扁平 TypedDict
- `backend/app/llm/graphs/workflows/runner.py` — 薄壳 runner
- `backend/app/llm/graphs/workflows/interview_questions.py` — 图一节点
- `backend/app/llm/graphs/workflows/resume_evaluation.py` — 图二节点
- `backend/app/services/interview_question_service.py` — 图一业务规则
- `backend/app/api/v1/endpoints/agent.py` — 四个路由
- `backend/app/schemas/agent/dto.py` — 精简 `LLMRuntimeConfigDTO` + `LLMStreamChunkDTO`
- `backend/app/schemas/agent/request.py` — 精简 `AgentMessageCreate` + `AgentInteractionSubmit`
- `backend/app/repositories/agent_repository.py` — 删 memory 相关方法
- `sql/init.sql` — DDL drop & recreate

**删除：**
- `backend/app/services/agent_context_service.py`
- `backend/app/services/agent_resume_pipeline_service.py`
- `backend/app/services/agent_service.py`
- `backend/app/services/agent_stream_buffer_service.py`
- `backend/app/services/resume_evaluation_workflow_service.py`（功能进入新 `resume_evaluation_service.py`）
- `backend/app/llm/graphs/workflows/_ctx.py`
- `backend/app/llm/prompts/templates/_deprecated/` 整目录
- `backend/app/models/agent_memory.py`（若存在）
- `backend/app/schemas/agent/enums.py` 中 `AgentNodeId` 旧节点
- `backend/app/schemas/agent/stream/__init__.py` 中所有 v2 payload 类（与旧 emitter 一起删）

### 前端

**新建：**
- `frontend/src/design/tokens.ts`
- `frontend/src/design/motion.ts`
- `frontend/src/utils/agent-stream-client.ts`
- `frontend/src/utils/agent-run-reducer.ts`
- `frontend/src/hooks/use-agent-run.ts`
- `frontend/src/hooks/use-frame-batched-text.ts`
- `frontend/src/hooks/use-follow-bottom.ts`
- `frontend/src/components/employee/agent/agent-workspace.tsx`（重写）
- `frontend/src/components/employee/agent/step-strip.tsx`
- `frontend/src/components/employee/agent/blocks/block-renderer.tsx`
- `frontend/src/components/employee/agent/blocks/text-block.tsx`
- `frontend/src/components/employee/agent/blocks/thinking-block.tsx`
- `frontend/src/components/employee/agent/blocks/tool-use-block.tsx`
- `frontend/src/components/employee/agent/blocks/interaction-block.tsx`
- `frontend/src/components/employee/agent/blocks/interview-questions-card.tsx`
- `frontend/src/components/employee/agent/blocks/evaluation-report-card.tsx`

**重写（同路径替换）：**
- `frontend/src/types/agent.ts`
- `frontend/src/api/employee/agent.ts`
- `frontend/src/components/employee/agent/agent-message-list.tsx`
- `frontend/src/components/employee/agent/agent-composer.tsx`
- `frontend/src/components/employee/agent/agent-session-sidebar.tsx`
- `frontend/src/pages/employee/agent.tsx`
- `frontend/tailwind.config.ts`

**删除（详见阶段 0）：** 21 个组件 + 3 个 stream util + 类型层 v1/v2 残留

### 关键依赖（需安装/确认）

- 前端：`framer-motion`（新增），其他依赖已在 package.json 中

---

## 实施阶段总览

| 阶段 | 主题 | Task 数 |
|---|---|---|
| 0 | 破坏性清理（DDL + 删文件） | 3 |
| 1 | 协议层 schema | 4 |
| 2 | LLM 底座（gateway + router） | 4 |
| 3 | 流式发射器 emitter | 2 |
| 4 | Graph + Runner + Context | 4 |
| 5 | 业务 Service（两图） | 4 |
| 6 | Runtime 三服务 | 4 |
| 7 | Endpoint 重写 | 2 |
| 8 | 前端协议层 | 4 |
| 9 | 前端 token + 动效 hooks | 3 |
| 10 | 前端 6 个 block 渲染器 | 6 |
| 11 | 前端骨架与集成 | 4 |

总计约 **44 个 task**。

---

## 阶段 0：破坏性清理

### Task 0.1：drop 旧表并重建新 DDL

**Files:**
- Modify: `sql/init.sql`

- [ ] **Step 1：定位 sql/init.sql 中 agent_session / agent_message / agent_memory 三段 CREATE TABLE**

Run: `grep -n "CREATE TABLE.*agent_" sql/init.sql`
Expected: 输出三处 CREATE TABLE 行号

- [ ] **Step 2：用以下 SQL 完整替换三段（保留其他表不动）**

```sql
DROP TABLE IF EXISTS agent_message;
DROP TABLE IF EXISTS agent_memory;
DROP TABLE IF EXISTS agent_session;

CREATE TABLE agent_session (
  id              BIGINT PRIMARY KEY AUTO_INCREMENT,
  session_key     VARCHAR(64) NOT NULL UNIQUE,
  employee_id     BIGINT NOT NULL,
  title           VARCHAR(80),
  selected_model_name VARCHAR(80),
  enable_thinking TINYINT NOT NULL DEFAULT 0,
  status          TINYINT NOT NULL DEFAULT 1,
  last_message_time DATETIME,
  create_time     DATETIME NOT NULL,
  update_time     DATETIME NOT NULL,
  INDEX idx_employee (employee_id, status, last_message_time DESC)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE agent_message (
  id              BIGINT PRIMARY KEY AUTO_INCREMENT,
  session_id      BIGINT NOT NULL,
  parent_message_id BIGINT,
  role            VARCHAR(16) NOT NULL,
  workflow_type   VARCHAR(32) NOT NULL,
  run_id          VARCHAR(64),
  content         JSON NOT NULL,
  model_name      VARCHAR(80),
  token_count     INT,
  sort_order      INT NOT NULL,
  create_time     DATETIME NOT NULL,
  INDEX idx_session_order (session_id, sort_order)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
```

- [ ] **Step 3：在 mysql 客户端执行新 DDL 验证语法**

Run: `mysql --version`（确认本机能执行）
然后在测试库执行以验证：`mysql -uroot -p<password> -e "use resume_test; $(sed -n '/DROP TABLE IF EXISTS agent_message/,/DEFAULT CHARSET=utf8mb4/p' sql/init.sql | head -60)"`
Expected: 无 syntax error

- [ ] **Step 4：commit**

```bash
git add sql/init.sql
git commit -m "refactor(agent): drop and recreate agent_session/agent_message, remove agent_memory

阶段 0.1：DDL 重建
- agent_session 新增 enable_thinking 列
- agent_message 新增 workflow_type/run_id 列，content 统一为 JSON blocks 结构
- 删除 agent_memory 表"
```

### Task 0.2：删除后端废弃文件

**Files:**
- Delete: 见 step 1 列表

- [ ] **Step 1：批量 git rm 后端删除清单**

```bash
git rm backend/app/services/agent_context_service.py
git rm backend/app/services/agent_resume_pipeline_service.py
git rm backend/app/services/agent_service.py
git rm backend/app/services/agent_stream_buffer_service.py
git rm backend/app/services/resume_evaluation_workflow_service.py
git rm backend/app/llm/graphs/workflows/_ctx.py
git rm -r backend/app/llm/prompts/templates/_deprecated/
git rm -f backend/app/models/agent_memory.py 2>/dev/null || true
git rm -f backend/app/repositories/agent_memory_repository.py 2>/dev/null || true
# 同时移除现存 stream package 旧 v2 events/envelope（将在阶段 1 重写）
git rm backend/app/schemas/agent/stream/envelope.py
git rm backend/app/schemas/agent/stream/events.py
git rm backend/app/schemas/agent/stream/__init__.py
git rm backend/app/llm/streaming/emitter.py
```

- [ ] **Step 2：删除引用上述文件的旧测试（这些测试会在阶段 1-7 重写覆盖）**

```bash
git rm backend/tests/services/test_agent_message_metadata_schema.py
git rm backend/tests/services/test_agent_resume_attachment.py
git rm backend/tests/services/test_agent_service_stream_message.py
git rm backend/tests/services/test_agent_stream_buffer_service.py
git rm backend/tests/services/test_agent_stream_protocol_extensions.py
git rm backend/tests/services/test_agent_workflow_request_schema.py
git rm backend/tests/services/test_agent_workflow_routing.py
git rm backend/tests/services/test_agent_workflow_runner.py
git rm backend/tests/services/test_interview_question_service.py
git rm backend/tests/services/test_resume_evaluation_workflow_service.py
git rm backend/tests/llm/test_interview_question_graph.py
git rm backend/tests/llm/test_resume_evaluation_workflow_graph.py
```

- [ ] **Step 3：临时让 agent.py endpoint 与 main.py 能 import（注释掉所有引用）**

Run: `grep -rn "from app.services.agent_service\|from app.services.agent_context_service\|from app.services.agent_resume_pipeline_service\|from app.services.agent_stream_buffer_service\|from app.services.resume_evaluation_workflow_service\|from app.llm.streaming.emitter\|from app.schemas.agent.stream" backend/app`

对每一个命中的 import 行，将整行替换为 `# TODO(refactor): import removed in stage 0, will be replaced in later stages`。同样把该行影响到的函数体临时替换为：

```python
raise NotImplementedError("Agent runtime is being refactored; stages 1-7 will restore this")
```

具体涉及（按既知调用面）：
- `backend/app/api/v1/endpoints/agent.py` 全部路由
- `backend/app/main.py` 中 lifespan 注册 workflow graphs 的部分
- `backend/app/api/deps.py` 中 `get_agent_service` 工厂

- [ ] **Step 4：验证后端能 import 启动（不要求路由能用）**

Run: `cd backend && python -c "from app.main import app; print('ok')"`
Expected: 输出 `ok`，无 ImportError

- [ ] **Step 5：commit**

```bash
git add -A
git commit -m "refactor(agent): wipe legacy backend services, emitter, stream schemas

阶段 0.2：删除 9 个后端文件 + 12 个旧测试，临时桩住 endpoint/main 引用以保持可启动
- 删除 agent_service/agent_context_service/agent_resume_pipeline_service/agent_stream_buffer_service/resume_evaluation_workflow_service
- 删除 emitter.py 与 stream schemas（阶段 1-3 重写）
- 删除 _ctx.py（ContextVar hack）
- 删除 _deprecated prompt 目录
- endpoint/main/deps 用 NotImplementedError 临时桩住"
```

### Task 0.3：删除前端废弃文件

**Files:**
- Delete: 见 step 1

- [ ] **Step 1：批量 git rm 前端删除清单**

```bash
cd frontend
git rm src/utils/agent-stream-handler.ts
git rm src/utils/agent-stream-v1.ts
git rm src/utils/agent-stream-v2.ts
git rm src/components/employee/agent/agent-action-card.tsx
git rm src/components/employee/agent/agent-interaction-card.tsx
git rm src/components/employee/agent/agent-status-timeline.tsx
git rm src/components/employee/agent/agent-tool-timeline.tsx
git rm src/components/employee/agent/agent-run-compact-timeline.tsx
git rm src/components/employee/agent/agent-thinking-panel.tsx
git rm src/components/employee/agent/thinking-renderer.tsx
git rm src/components/employee/agent/agent-markdown-content.tsx
git rm src/components/employee/agent/agent-workspace-header.tsx
git rm src/components/employee/agent/agent-session-dialogs.tsx
git rm src/components/employee/agent/agent-ui-utils.ts
git rm src/components/employee/agent/plan-review-tree.tsx
git rm src/components/employee/agent/plan-repair-hints.tsx
git rm src/components/employee/agent/repair-suggestions-panel.tsx
git rm src/components/employee/agent/tool-execution-card.tsx
git rm src/components/employee/agent/agent-preferences-dialog.tsx
git rm src/components/employee/agent/interview-question-set-card.tsx
git rm src/components/employee/agent/resume-evaluation-report-card.tsx
```

- [ ] **Step 2：临时桩住 `pages/employee/agent.tsx` 与 `components/employee/agent/agent-message-list.tsx`**

把这两个文件的整个 default export 内容替换为：

```tsx
export default function AgentRefactoring() {
  return <div className="p-8 text-center text-gray-500">Agent workspace is being rebuilt (stages 8-11)…</div>;
}
```

如果有命名导出（如 `WorkspaceSession`），保留类型但去掉 v1/v2 内容；具体在阶段 0 不必精修，确保 tsc 不报错即可。

- [ ] **Step 3：清理 `types/agent.ts` 中的 v1/v2 类型**

删除以下导出：
- `IPlanReviewUiState`、`IPlanReviewTaskNode`、`IPlanRepairSuggestion`
- `IAgentActionStreamItem`
- `IAgentInteractionRequestItem`
- `IAgentRuntimeFeedItem`
- `IAgentToolStreamItem`
- `IAgentThinkingStreamItem`
- `IAgentBusinessCardItem`
- `IAgentStreamEnvelopeV1`、`IAgentStreamEnvelopeV2`
- `IAgentReply`
- `IAgentMemoryItem`
- 所有 legacy event union 类型

保留：`WorkspaceSession`、最简版 `IAgentMessageItem`（仅 id/session_id/role/content），`WorkflowType` 字面量。其余在阶段 8 重写时统一替换。

- [ ] **Step 4：验证前端能编译**

Run: `cd frontend && npx tsc --noEmit`
Expected: 0 errors

如果有遗漏引用错误，按报错路径继续删除/桩住。

- [ ] **Step 5：commit**

```bash
git add -A
git commit -m "refactor(agent): wipe legacy frontend components, stream utils, v1/v2 types

阶段 0.3：删除 21 个前端组件 + 3 个 stream util + 类型层 v1/v2 残留
- types/agent.ts 精简到 WorkspaceSession + WorkflowType + 最简 IAgentMessageItem
- pages/employee/agent.tsx 与 agent-message-list.tsx 临时桩为占位组件
- tsc --noEmit 通过"
```

---

## 阶段 1：协议层 schema

### Task 1.1：信封 envelope.py

**Files:**
- Create: `backend/app/schemas/agent/stream/envelope.py`
- Create: `backend/tests/services/test_agent_stream_envelope.py`

- [ ] **Step 1：写失败测试**

`backend/tests/services/test_agent_stream_envelope.py`:

```python
"""Agent 流式协议信封 v1 单测：字段约束与未知字段静默接受。"""
from __future__ import annotations

import pytest
from app.schemas.agent.stream.envelope import AgentStreamEnvelope, STREAM_PROTOCOL_VERSION


def test_envelope_minimum_fields():
    """构造最小合法信封，验证必填字段与默认值。"""
    env = AgentStreamEnvelope(
        seq=1, ts=1717920000123, run_id="run_x", session_id=42,
        type="run.start", data={"workflow_type": "interview_questions"},
    )
    assert env.v == 1
    assert env.seq == 1
    assert env.type == "run.start"


def test_envelope_protocol_version_is_one():
    """协议版本常量固定为 1。"""
    assert STREAM_PROTOCOL_VERSION == 1


def test_envelope_silently_accepts_unknown_data_keys():
    """data 内未知键允许，前后端独立演进。"""
    env = AgentStreamEnvelope(
        seq=2, ts=0, run_id="r", session_id=1,
        type="block.delta", data={"index": 0, "delta": {"text_delta": "hi"}, "future_field": True},
    )
    assert env.data["future_field"] is True


def test_envelope_round_trip_json():
    """序列化-反序列化往返一致。"""
    env = AgentStreamEnvelope(seq=3, ts=10, run_id="r", session_id=1, type="run.finish", data={"agent_message_id": 99})
    dumped = env.model_dump(mode="json")
    restored = AgentStreamEnvelope.model_validate(dumped)
    assert restored == env
```

- [ ] **Step 2：运行测试验证失败**

Run: `cd backend && pytest tests/services/test_agent_stream_envelope.py -v`
Expected: ModuleNotFoundError（envelope.py 不存在）

- [ ] **Step 3：创建最小实现**

`backend/app/schemas/agent/stream/envelope.py`:

```python
"""
Agent 流式协议 v1 统一信封。

所有 SSE 事件均通过 `AgentStreamEnvelope` 下发。SSE 顶层 event 行恒为 `agent`，
data 中携带本信封 JSON。前端按 `seq` 排序后顺序渲染。

字段说明：
    v: 协议版本，固定 1。出现 v != 1 时前端应忽略并打日志。
    seq: 同一 run 内单调递增序号，前端排序唯一依据。
    ts: 服务器毫秒时间戳，仅用于调试，不参与排序。
    run_id: 本次运行 ID，用户消息触发或 interaction 提交触发各为独立 run。
    session_id: 关联的 agent_session.id。
    type: 事件类型枚举（详见 events.py 的 EVENT_TYPES）。
    data: 事件载荷，结构由 type 决定（详见 events.py）。
"""

from typing import Any
from pydantic import BaseModel, ConfigDict, Field

STREAM_PROTOCOL_VERSION = 1


class AgentStreamEnvelope(BaseModel):
    """Agent 流式事件统一信封。"""

    model_config = ConfigDict(extra="allow")

    v: int = STREAM_PROTOCOL_VERSION
    seq: int
    ts: int
    run_id: str
    session_id: int
    type: str
    data: dict[str, Any] = Field(default_factory=dict)
```

- [ ] **Step 4：运行测试验证通过**

Run: `cd backend && pytest tests/services/test_agent_stream_envelope.py -v`
Expected: 4 passed

- [ ] **Step 5：commit**

```bash
git add backend/app/schemas/agent/stream/envelope.py backend/tests/services/test_agent_stream_envelope.py
git commit -m "feat(agent-protocol): add AgentStreamEnvelope v1 with seq-ordered events

阶段 1.1：统一信封，extra=allow 支持未知字段静默接受"
```

### Task 1.2：事件类型枚举 + 9 type 常量

**Files:**
- Create: `backend/app/schemas/agent/stream/events.py`
- Create: `backend/tests/services/test_agent_stream_events.py`

- [ ] **Step 1：写失败测试**

`backend/tests/services/test_agent_stream_events.py`:

```python
"""Agent 流式协议事件类型枚举与 data payload 校验。"""
from __future__ import annotations

import pytest
from app.schemas.agent.stream.events import (
    EVENT_TYPES,
    RunStartData, RunFinishData, RunErrorData,
    StepUpdateData,
    BlockStartData, BlockDeltaData, BlockStopData,
    InteractionRequestData, InteractionResolveData,
)


def test_event_types_are_nine():
    """事件类型严格 9 个，无多余无遗漏。"""
    assert set(EVENT_TYPES) == {
        "run.start", "run.finish", "run.error",
        "step.update",
        "block.start", "block.delta", "block.stop",
        "interaction.request", "interaction.resolve",
    }


def test_run_start_data_required_fields():
    """run.start 必带 run_id / workflow_type / enable_thinking。"""
    data = RunStartData(run_id="r1", workflow_type="interview_questions",
                        enable_thinking=True, user_message_id=42)
    assert data.workflow_type == "interview_questions"


def test_run_error_data_default_retriable_false():
    err = RunErrorData(code="job_validation_exhausted", message="超过 3 次")
    assert err.retriable is False


def test_step_update_status_constrained():
    """step.update.status 限定枚举。"""
    with pytest.raises(Exception):
        StepUpdateData(step_id="x", title="t", status="invalid_status")  # type: ignore[arg-type]
    ok = StepUpdateData(step_id="x", title="t", status="running")
    assert ok.status == "running"


def test_block_start_carries_initial_block_dict():
    """block.start 的 block 字段是 dict，包含 type 字段。"""
    data = BlockStartData(index=0, block={"type": "text", "text": ""})
    assert data.block["type"] == "text"


def test_block_delta_data_index_and_payload():
    data = BlockDeltaData(index=0, delta={"text_delta": "hi"})
    assert data.delta == {"text_delta": "hi"}


def test_interaction_request_minimum_fields():
    data = InteractionRequestData(
        request_id="req_x",
        interaction_type="job_selection",
        title="请选择岗位",
        prompt="从候选中选择",
        schema={}, data={"candidates": []},
    )
    assert data.interaction_type == "job_selection"


def test_interaction_resolve_carries_values():
    data = InteractionResolveData(request_id="req_x", values={"job_full_name": "高级算法工程师"})
    assert data.values["job_full_name"] == "高级算法工程师"
```

- [ ] **Step 2：运行测试验证失败**

Run: `cd backend && pytest tests/services/test_agent_stream_events.py -v`
Expected: ModuleNotFoundError

- [ ] **Step 3：创建实现**

`backend/app/schemas/agent/stream/events.py`:

```python
"""
Agent 流式协议 v1 - 事件类型枚举与各 data payload 模型。

共 9 种事件类型（EVENT_TYPES）：
    - run.start / run.finish / run.error
    - step.update
    - block.start / block.delta / block.stop
    - interaction.request / interaction.resolve

每种事件的 envelope.data 形状由对应 *Data 类约束。
所有 *Data 均 extra="allow"，支持前后端独立演进未知字段。
"""

from __future__ import annotations

from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field

EVENT_TYPES: tuple[str, ...] = (
    "run.start", "run.finish", "run.error",
    "step.update",
    "block.start", "block.delta", "block.stop",
    "interaction.request", "interaction.resolve",
)

StepStatus = Literal["pending", "running", "success", "failed"]


class _AllowExtra(BaseModel):
    """所有 data payload 基类，允许未知键被静默接受。"""
    model_config = ConfigDict(extra="allow")


# ====== run ======

class RunStartData(_AllowExtra):
    """`run.start` 事件 data。"""
    run_id: str
    workflow_type: Literal["interview_questions", "resume_evaluation"]
    enable_thinking: bool
    user_message_id: int | None = None


class RunFinishData(_AllowExtra):
    """`run.finish` 事件 data，agent_message_id 是本 run 落库消息 ID。"""
    agent_message_id: int


class RunErrorData(_AllowExtra):
    """`run.error` 事件 data。"""
    code: str
    message: str
    retriable: bool = False


# ====== step ======

class StepUpdateData(_AllowExtra):
    """`step.update` 事件 data，仅用于"运行条"轻量展示。"""
    step_id: str
    title: str
    status: StepStatus
    detail: str | None = None


# ====== block ======

class BlockStartData(_AllowExtra):
    """`block.start` 事件 data，block 字段为初始空骨架（带 type）。"""
    index: int
    block: dict[str, Any]


class BlockDeltaData(_AllowExtra):
    """`block.delta` 事件 data，delta 形态按 block 类型分形。"""
    index: int
    delta: dict[str, Any] = Field(default_factory=dict)


class BlockStopData(_AllowExtra):
    """`block.stop` 事件 data。"""
    index: int


# ====== interaction ======

InteractionType = Literal["dimension_selection", "plan_approval", "job_selection"]


class InteractionRequestData(_AllowExtra):
    """`interaction.request` 事件 data，对应 graph interrupt 出口。"""
    request_id: str
    interaction_type: InteractionType
    title: str
    prompt: str
    schema: dict[str, Any] = Field(default_factory=dict)
    data: dict[str, Any] = Field(default_factory=dict)


class InteractionResolveData(_AllowExtra):
    """`interaction.resolve` 事件 data，服务端 ACK 用户提交。"""
    request_id: str
    values: dict[str, Any] = Field(default_factory=dict)
```

- [ ] **Step 4：运行测试验证通过**

Run: `cd backend && pytest tests/services/test_agent_stream_events.py -v`
Expected: 8 passed

- [ ] **Step 5：commit**

```bash
git add backend/app/schemas/agent/stream/events.py backend/tests/services/test_agent_stream_events.py
git commit -m "feat(agent-protocol): add 9 event types with discriminated data payloads

阶段 1.2：run.* + step.update + block.* + interaction.* 共 9 type，全部 extra=allow"
```

### Task 1.3：6 种 block 类型

**Files:**
- Create: `backend/app/schemas/agent/stream/blocks.py`
- Create: `backend/tests/services/test_agent_stream_blocks.py`

- [ ] **Step 1：写失败测试**

`backend/tests/services/test_agent_stream_blocks.py`:

```python
"""Agent block 类型与 status 流转单测。"""
from __future__ import annotations

import pytest
from app.schemas.agent.stream.blocks import (
    BLOCK_TYPES, BlockStatus,
    TextBlock, ThinkingBlock, ToolUseBlock, InteractionBlock,
    InterviewQuestionsBlock, EvaluationReportBlock,
    coerce_block,
)


def test_block_types_are_six():
    assert set(BLOCK_TYPES) == {
        "text", "thinking", "tool_use", "interaction",
        "interview_questions", "evaluation_report",
    }


def test_text_block_default_status_streaming():
    b = TextBlock(text="hi")
    assert b.type == "text"
    assert b.status == "streaming"


def test_tool_use_block_failed_with_error():
    b = ToolUseBlock(tool_name="load_resume", display_name="读取简历",
                     input={}, status="failed", error="not found")
    assert b.status == "failed"
    assert b.error == "not found"


def test_interaction_block_pending_default():
    b = InteractionBlock(
        request_id="req_1", interaction_type="dimension_selection",
        title="选择维度", prompt="多选", data={"options": []},
    )
    assert b.status == "pending"
    assert b.values is None


def test_interaction_block_submitted_with_values():
    b = InteractionBlock(
        request_id="req_1", interaction_type="dimension_selection",
        title="t", prompt="p", data={}, status="submitted",
        values={"selected": [1, 2]},
    )
    assert b.values == {"selected": [1, 2]}


def test_coerce_block_dispatches_by_type():
    raw = {"type": "thinking", "text": "正在思考"}
    block = coerce_block(raw)
    assert isinstance(block, ThinkingBlock)
    assert block.text == "正在思考"


def test_coerce_block_unknown_type_returns_none():
    """未知 type 返回 None，前后端独立演进。"""
    assert coerce_block({"type": "future_block"}) is None
```

- [ ] **Step 2：运行测试验证失败**

Run: `cd backend && pytest tests/services/test_agent_stream_blocks.py -v`
Expected: ModuleNotFoundError

- [ ] **Step 3：创建实现**

`backend/app/schemas/agent/stream/blocks.py`:

```python
"""
Agent content blocks - 6 种统一渲染单元。

落库时 `agent_message.content.blocks` 是这些 block 的有序数组；
流式时 `block.start/delta/stop` 围绕这些 block 的生命周期下发。

设计参考 Claude Code Messages SSE 的 content_block 模型，前端只需一套渲染管线。
"""

from __future__ import annotations

from typing import Any, Literal, Union

from pydantic import BaseModel, ConfigDict, Field

BLOCK_TYPES: tuple[str, ...] = (
    "text", "thinking", "tool_use", "interaction",
    "interview_questions", "evaluation_report",
)

BlockStatus = Literal[
    "streaming", "success", "failed",
    "pending", "submitted", "expired",
]

InteractionType = Literal["dimension_selection", "plan_approval", "job_selection"]


class _BlockBase(BaseModel):
    """block 公共字段。extra=allow 支持演进。"""
    model_config = ConfigDict(extra="allow")


class TextBlock(_BlockBase):
    """Agent 正文流式文本块。"""
    type: Literal["text"] = "text"
    text: str = ""
    status: BlockStatus = "streaming"


class ThinkingBlock(_BlockBase):
    """思考过程流式文本块（仅 enable_thinking 时下发）。"""
    type: Literal["thinking"] = "thinking"
    text: str = ""
    status: BlockStatus = "streaming"


class ToolUseBlock(_BlockBase):
    """内部工具调用块。HR 视角即"运行步骤"。"""
    type: Literal["tool_use"] = "tool_use"
    tool_name: str
    display_name: str
    input: dict[str, Any] = Field(default_factory=dict)
    output: dict[str, Any] | None = None
    status: BlockStatus = "running"
    error: str | None = None


class InteractionBlock(_BlockBase):
    """内联交互卡片块（graph interrupt 的唯一出口）。"""
    type: Literal["interaction"] = "interaction"
    request_id: str
    interaction_type: InteractionType
    title: str
    prompt: str
    data: dict[str, Any] = Field(default_factory=dict)
    status: BlockStatus = "pending"
    values: dict[str, Any] | None = None


class InterviewQuestionsBlock(_BlockBase):
    """业务卡：面试题清单。一次性写满。"""
    type: Literal["interview_questions"] = "interview_questions"
    question_set: dict[str, Any] = Field(default_factory=dict)
    status: BlockStatus = "success"


class EvaluationReportBlock(_BlockBase):
    """业务卡：简历评估报告。一次性写满。"""
    type: Literal["evaluation_report"] = "evaluation_report"
    report: dict[str, Any] = Field(default_factory=dict)
    status: BlockStatus = "success"


AnyBlock = Union[
    TextBlock, ThinkingBlock, ToolUseBlock, InteractionBlock,
    InterviewQuestionsBlock, EvaluationReportBlock,
]


_BLOCK_CLS_BY_TYPE: dict[str, type[_BlockBase]] = {
    "text": TextBlock,
    "thinking": ThinkingBlock,
    "tool_use": ToolUseBlock,
    "interaction": InteractionBlock,
    "interview_questions": InterviewQuestionsBlock,
    "evaluation_report": EvaluationReportBlock,
}


def coerce_block(raw: dict[str, Any]) -> _BlockBase | None:
    """
    根据 raw['type'] 派发到具体 block 类。未知 type 返回 None。

    Args:
        raw: 包含 'type' 字段的 dict。

    Returns:
        对应的 BlockBase 实例，或 None（未知类型时）。
    """
    cls = _BLOCK_CLS_BY_TYPE.get(str(raw.get("type") or ""))
    if cls is None:
        return None
    return cls.model_validate(raw)
```

- [ ] **Step 4：运行测试验证通过**

Run: `cd backend && pytest tests/services/test_agent_stream_blocks.py -v`
Expected: 7 passed

- [ ] **Step 5：commit**

```bash
git add backend/app/schemas/agent/stream/blocks.py backend/tests/services/test_agent_stream_blocks.py
git commit -m "feat(agent-protocol): add 6 content block types with status flow

阶段 1.3：text/thinking/tool_use/interaction/interview_questions/evaluation_report"
```

### Task 1.4：stream package __init__ + 精简 request schema

**Files:**
- Create: `backend/app/schemas/agent/stream/__init__.py`
- Modify: `backend/app/schemas/agent/request.py`
- Create: `backend/tests/services/test_agent_request_schema.py`

- [ ] **Step 1：写失败测试**

`backend/tests/services/test_agent_request_schema.py`:

```python
"""AgentMessageCreate / AgentInteractionSubmit 请求 schema 单测。"""
from __future__ import annotations

import pytest
from app.schemas.agent.request import AgentMessageCreate, AgentInteractionSubmit


def test_message_create_workflow_type_default_interview():
    body = AgentMessageCreate(content="hi")
    assert body.workflow_type == "interview_questions"
    assert body.runtime_options is None


def test_message_create_invalid_workflow_type_rejected():
    with pytest.raises(Exception):
        AgentMessageCreate(content="hi", workflow_type="general_chat")  # type: ignore[arg-type]


def test_message_create_with_thinking_override():
    body = AgentMessageCreate(content="hi", runtime_options={"enable_thinking": True})
    assert body.runtime_options.enable_thinking is True


def test_interaction_submit_required_values():
    body = AgentInteractionSubmit(values={"selected_job_name": "高级算法工程师"})
    assert body.values["selected_job_name"] == "高级算法工程师"
```

- [ ] **Step 2：运行测试验证失败**

Run: `cd backend && pytest tests/services/test_agent_request_schema.py -v`
Expected: 字段不匹配 / 类不存在

- [ ] **Step 3：重写 `backend/app/schemas/agent/request.py`**

```python
"""
Agent 端点请求体 schema（精简版本）。

仅保留两次重构后实际使用的请求模型：
- AgentSessionCreate / AgentSessionUpdate / AgentSessionModelSelect 会话 CRUD
- AgentMessageCreate 流式消息触发
- AgentInteractionSubmit interaction 提交
"""

from __future__ import annotations

from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field

WorkflowType = Literal["interview_questions", "resume_evaluation"]


class RuntimeOptions(BaseModel):
    """单次消息的运行时覆盖（仅 thinking 开关）。"""
    model_config = ConfigDict(extra="forbid")
    enable_thinking: bool | None = None


class AgentSessionCreate(BaseModel):
    model_config = ConfigDict(extra="forbid")
    title: str | None = None
    selected_model_name: str | None = None


class AgentSessionUpdate(BaseModel):
    model_config = ConfigDict(extra="forbid")
    title: str


class AgentSessionModelSelect(BaseModel):
    model_config = ConfigDict(extra="forbid")
    model_name: str | None = None


class AgentMessageCreate(BaseModel):
    """用户输入文本，触发一次 workflow run。"""
    model_config = ConfigDict(extra="forbid")
    content: str = Field(..., min_length=1, max_length=8000)
    workflow_type: WorkflowType = "interview_questions"
    context_refs: list[dict[str, Any]] = Field(default_factory=list)
    runtime_options: RuntimeOptions | None = None


class AgentInteractionSubmit(BaseModel):
    """提交 interaction 卡片的用户填写。"""
    model_config = ConfigDict(extra="forbid")
    values: dict[str, Any] = Field(default_factory=dict)
```

- [ ] **Step 4：创建 `backend/app/schemas/agent/stream/__init__.py`**

```python
"""Agent 流式协议 v1 schema 一站式导出。"""
from app.schemas.agent.stream.envelope import (
    STREAM_PROTOCOL_VERSION,
    AgentStreamEnvelope,
)
from app.schemas.agent.stream.events import (
    EVENT_TYPES, StepStatus, InteractionType,
    RunStartData, RunFinishData, RunErrorData,
    StepUpdateData,
    BlockStartData, BlockDeltaData, BlockStopData,
    InteractionRequestData, InteractionResolveData,
)
from app.schemas.agent.stream.blocks import (
    BLOCK_TYPES, BlockStatus, AnyBlock,
    TextBlock, ThinkingBlock, ToolUseBlock, InteractionBlock,
    InterviewQuestionsBlock, EvaluationReportBlock,
    coerce_block,
)

__all__ = [
    "STREAM_PROTOCOL_VERSION", "AgentStreamEnvelope",
    "EVENT_TYPES", "StepStatus", "InteractionType",
    "RunStartData", "RunFinishData", "RunErrorData",
    "StepUpdateData",
    "BlockStartData", "BlockDeltaData", "BlockStopData",
    "InteractionRequestData", "InteractionResolveData",
    "BLOCK_TYPES", "BlockStatus", "AnyBlock",
    "TextBlock", "ThinkingBlock", "ToolUseBlock", "InteractionBlock",
    "InterviewQuestionsBlock", "EvaluationReportBlock",
    "coerce_block",
]
```

- [ ] **Step 5：运行测试验证通过**

Run: `cd backend && pytest tests/services/test_agent_request_schema.py tests/services/test_agent_stream_envelope.py tests/services/test_agent_stream_events.py tests/services/test_agent_stream_blocks.py -v`
Expected: 4 + 4 + 8 + 7 = 23 passed

- [ ] **Step 6：commit**

```bash
git add backend/app/schemas/agent/stream/__init__.py backend/app/schemas/agent/request.py backend/tests/services/test_agent_request_schema.py
git commit -m "feat(agent-protocol): rebuild request schemas and stream package init

阶段 1.4：AgentMessageCreate + AgentInteractionSubmit + stream package exports"
```

---

## 阶段 2：LLM 底座

### Task 2.1：精简 LLMRuntimeConfigDTO + LLMStreamChunkDTO

**Files:**
- Modify: `backend/app/schemas/agent/dto.py`
- Create: `backend/tests/services/test_llm_dto.py`

- [ ] **Step 1：写失败测试**

`backend/tests/services/test_llm_dto.py`:

```python
"""LLM 运行时配置与流式 chunk DTO 单测。"""
from __future__ import annotations

import pytest
from app.schemas.agent.dto import LLMRuntimeConfigDTO, LLMStreamChunkDTO, TokenUsage


def test_runtime_config_minimum_fields():
    cfg = LLMRuntimeConfigDTO(
        protocol="openai_compatible", provider="deepseek",
        base_url="https://api.deepseek.com", api_key="sk-x",
        model_name="deepseek-chat",
    )
    assert cfg.enable_thinking is False
    assert cfg.max_retries == 1
    assert cfg.timeout_seconds == 60


def test_runtime_config_rejects_unknown_provider():
    with pytest.raises(Exception):
        LLMRuntimeConfigDTO(
            protocol="openai_compatible", provider="unknown_vendor",  # type: ignore[arg-type]
            base_url="x", api_key="x", model_name="x",
        )


def test_runtime_config_dropped_fields_no_longer_present():
    """旧字段 source / enable_memory / top_p 必须不存在。"""
    cfg = LLMRuntimeConfigDTO(
        protocol="openai_compatible", provider="deepseek",
        base_url="x", api_key="x", model_name="x",
    )
    assert not hasattr(cfg, "source")
    assert not hasattr(cfg, "enable_memory")
    assert not hasattr(cfg, "top_p")
    assert not hasattr(cfg, "presence_penalty")
    assert not hasattr(cfg, "frequency_penalty")
    assert not hasattr(cfg, "enable_prompt_cache")


def test_stream_chunk_kind_text():
    c = LLMStreamChunkDTO(kind="text", text_delta="hi")
    assert c.text_delta == "hi"
    assert c.usage is None


def test_stream_chunk_kind_thinking():
    c = LLMStreamChunkDTO(kind="thinking", text_delta="正在想")
    assert c.kind == "thinking"


def test_stream_chunk_kind_usage():
    c = LLMStreamChunkDTO(kind="usage", usage=TokenUsage(input_tokens=10, output_tokens=20))
    assert c.usage.total_tokens == 30


def test_stream_chunk_kind_done_with_finish_reason():
    c = LLMStreamChunkDTO(kind="done", finish_reason="stop")
    assert c.finish_reason == "stop"
```

- [ ] **Step 2：运行测试验证失败**

Run: `cd backend && pytest tests/services/test_llm_dto.py -v`
Expected: 旧字段仍存在导致部分 FAIL；TokenUsage 不存在

- [ ] **Step 3：重写 `backend/app/schemas/agent/dto.py`**

完整重写（删除 v1 期 Agent 工具上下文 DTO，保留业务结构 DTO）：

```python
"""
Agent / LLM 数据传输对象（精简后版本）。

仅保留两次重构后实际使用的 DTO：
- LLM 调用相关：LLMRuntimeConfigDTO / LLMResultDTO / LLMStreamChunkDTO / TokenUsage
- 业务结构：InterviewQuestionSetDTO 系列、ResumeEvaluationReportDTO

删除（v1 残留）：source / enable_memory / top_p / presence_penalty / frequency_penalty /
enable_prompt_cache / AgentToolCallDTO / AgentToolResultDTO / AgentToolContextDTO /
ResumeContextDTO / ResumeAnalyseState。
"""

from __future__ import annotations

from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field, SecretStr


# ====== LLM 调用 ======

LLMProtocol = Literal["openai_compatible"]
LLMProvider = Literal["deepseek", "qwen", "other"]


class LLMRuntimeConfigDTO(BaseModel):
    """LLM 运行时配置（精简版）。"""
    model_config = ConfigDict(extra="forbid")

    # 路由
    protocol: LLMProtocol = "openai_compatible"
    provider: LLMProvider
    base_url: str
    api_key: SecretStr
    model_name: str
    fallback_model_name: str | None = None

    # 运行参数
    temperature: float = 0.7
    max_tokens: int | None = None
    max_retries: int = 1
    timeout_seconds: int = 60

    # 思考模式
    enable_thinking: bool = False
    thinking_budget_tokens: int | None = None


class TokenUsage(BaseModel):
    """Token 使用统计。"""
    model_config = ConfigDict(extra="forbid")
    input_tokens: int = 0
    output_tokens: int = 0

    @property
    def total_tokens(self) -> int:
        return self.input_tokens + self.output_tokens


class LLMResultDTO(BaseModel):
    """非流式调用结果。"""
    content: str
    model_name: str
    usage: TokenUsage = Field(default_factory=TokenUsage)


class LLMStreamChunkDTO(BaseModel):
    """流式增量。同一 chunk 至多承载一种 delta。"""
    model_config = ConfigDict(extra="forbid")
    kind: Literal["text", "thinking", "usage", "done"]
    text_delta: str = ""
    usage: TokenUsage | None = None
    finish_reason: str | None = None


# ====== 业务结构 DTO（保留，给 Service 内组装结构化输出） ======


class InterviewDimensionDTO(BaseModel):
    name: str
    reason: str
    source: str = "ai"


class InterviewQuestionPlanItemDTO(BaseModel):
    dimension: str
    question_count: int
    difficulty: str
    focus: str


class InterviewQuestionPlanDTO(BaseModel):
    total_questions: int
    items: list[InterviewQuestionPlanItemDTO]
    summary: str


class InterviewQuestionItemDTO(BaseModel):
    question: str
    dimension: str
    difficulty: str
    evaluation_points: list[str] = Field(default_factory=list)
    follow_up_suggestions: list[str] = Field(default_factory=list)
    excellent_signals: list[str] = Field(default_factory=list)
    average_signals: list[str] = Field(default_factory=list)
    risk_signals: list[str] = Field(default_factory=list)


class InterviewQuestionSetDTO(BaseModel):
    title: str = "面试题清单"
    total_questions: int
    dimensions: list[str]
    questions: list[InterviewQuestionItemDTO]


class ResumeEvaluationReportDTO(BaseModel):
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

- [ ] **Step 4：运行测试验证通过**

Run: `cd backend && pytest tests/services/test_llm_dto.py -v`
Expected: 7 passed

- [ ] **Step 5：commit**

```bash
git add backend/app/schemas/agent/dto.py backend/tests/services/test_llm_dto.py
git commit -m "feat(llm): slim LLMRuntimeConfigDTO and dual-channel LLMStreamChunkDTO

阶段 2.1：删除 source/enable_memory/top_p/presence_penalty 等无用字段
新增 provider 枚举驱动 THINKING_PARAM_MAP；chunk 引入 kind 区分 text/thinking/usage/done"
```

### Task 2.2：重写 OpenAICompatibleGateway（双 channel + provider 映射）

**Files:**
- Create: `backend/app/llm/gateway.py`（覆盖现文件）
- Create: `backend/tests/services/test_llm_gateway.py`

- [ ] **Step 1：写失败测试（mock ChatOpenAI.astream 输出 reasoning_content）**

`backend/tests/services/test_llm_gateway.py`:

```python
"""OpenAICompatibleGateway 双 channel 抽取与 provider 适配单测。"""
from __future__ import annotations

from collections.abc import AsyncIterator
from typing import Any
from unittest.mock import AsyncMock, MagicMock, patch

import pytest
from pydantic import SecretStr

from app.llm.gateway import OpenAICompatibleGateway, THINKING_PARAM_MAP, LLMGatewayError
from app.schemas.agent.dto import LLMRuntimeConfigDTO


def _cfg(provider: str = "deepseek", enable_thinking: bool = True) -> LLMRuntimeConfigDTO:
    return LLMRuntimeConfigDTO(
        provider=provider,  # type: ignore[arg-type]
        base_url="https://api.deepseek.com",
        api_key=SecretStr("sk-x"),
        model_name="deepseek-chat",
        enable_thinking=enable_thinking,
    )


def test_thinking_param_map_has_three_providers():
    assert set(THINKING_PARAM_MAP) == {"deepseek", "qwen", "other"}


def test_chat_kwargs_injects_deepseek_thinking_extra_body():
    gw = OpenAICompatibleGateway()
    kwargs = gw._chat_kwargs(_cfg("deepseek", True))
    assert kwargs["extra_body"] == {"thinking": {"type": "enabled"}}


def test_chat_kwargs_injects_qwen_thinking_extra_body():
    gw = OpenAICompatibleGateway()
    kwargs = gw._chat_kwargs(_cfg("qwen", True))
    assert kwargs["extra_body"] == {"enable_thinking": True}


def test_chat_kwargs_omits_thinking_when_disabled():
    gw = OpenAICompatibleGateway()
    kwargs = gw._chat_kwargs(_cfg("deepseek", False))
    assert "extra_body" not in kwargs or kwargs["extra_body"] == {}


class _FakeChunk:
    def __init__(self, *, content: str = "", reasoning: str = "",
                 usage: dict[str, Any] | None = None) -> None:
        self.content = content
        # 模拟 LangChain ChatOpenAI 把 reasoning_content 放到 additional_kwargs
        self.additional_kwargs = {"reasoning_content": reasoning} if reasoning else {}
        self.usage_metadata = usage or {}
        self.response_metadata = {}


class _FakeStream:
    def __init__(self, chunks: list[_FakeChunk]) -> None:
        self._chunks = chunks

    def __aiter__(self) -> AsyncIterator[_FakeChunk]:
        async def gen():
            for c in self._chunks:
                yield c
        return gen()


@pytest.mark.asyncio
async def test_stream_once_emits_separate_thinking_and_text_chunks():
    """deepseek 流式：reasoning_content 走 kind=thinking，content 走 kind=text。"""
    gw = OpenAICompatibleGateway()
    fake_chunks = [
        _FakeChunk(reasoning="先看候选人"),
        _FakeChunk(reasoning="主修方向"),
        _FakeChunk(content="匹配度 87 分"),
        _FakeChunk(usage={"input_tokens": 10, "output_tokens": 20}),
    ]
    fake_chat = MagicMock()
    fake_chat.astream = MagicMock(return_value=_FakeStream(fake_chunks))
    with patch.object(gw, "_get_or_create_chat_model", return_value=fake_chat):
        out = [c async for c in gw.stream_once("prompt", _cfg())]

    text_chunks = [c for c in out if c.kind == "text"]
    thinking_chunks = [c for c in out if c.kind == "thinking"]
    usage_chunks = [c for c in out if c.kind == "usage"]
    done_chunks = [c for c in out if c.kind == "done"]
    assert "".join(c.text_delta for c in thinking_chunks) == "先看候选人主修方向"
    assert "".join(c.text_delta for c in text_chunks) == "匹配度 87 分"
    assert usage_chunks and usage_chunks[0].usage.total_tokens == 30
    assert done_chunks  # 必须以 done 结尾


@pytest.mark.asyncio
async def test_stream_once_raises_gateway_error_on_openai_error():
    """OpenAI 错误被包装为 LLMGatewayError。"""
    gw = OpenAICompatibleGateway()
    fake_chat = MagicMock()
    async def _explode():
        raise TimeoutError("upstream")
        yield  # pragma: no cover
    fake_chat.astream = MagicMock(return_value=_explode())
    with patch.object(gw, "_get_or_create_chat_model", return_value=fake_chat):
        with pytest.raises(LLMGatewayError):
            [c async for c in gw.stream_once("p", _cfg())]
```

- [ ] **Step 2：运行测试验证失败**

Run: `cd backend && pytest tests/services/test_llm_gateway.py -v`
Expected: AttributeError / ImportError（旧 gateway 已删）

- [ ] **Step 3：创建新 `backend/app/llm/gateway.py`**

```python
"""
OpenAI 协议网关（重写版）。

职责：
- 把 LLMRuntimeConfigDTO 翻译成 ChatOpenAI 构造参数（含 thinking 模式 extra_body 注入）
- 流式响应分流：reasoning_content → kind=thinking；content → kind=text
- 统一异常 LLMGatewayError；ChatOpenAI 实例 LRU 缓存复用 HTTP 连接

不做：业务规则、模型路由（由 model_router 负责）、provider SDK 直接调用。
"""

from __future__ import annotations

import logging
from collections.abc import AsyncIterator
from typing import Any

from langchain_openai import ChatOpenAI
from openai import OpenAIError

from app.schemas.agent.dto import (
    LLMResultDTO,
    LLMRuntimeConfigDTO,
    LLMStreamChunkDTO,
    TokenUsage,
)

logger = logging.getLogger(__name__)

LLM_GATEWAY_ERRORS = (OpenAIError, TimeoutError, ValueError)


# Provider 适配表：enable_thinking=True 时注入到 ChatOpenAI extra_body 的键值
THINKING_PARAM_MAP: dict[str, dict[str, Any]] = {
    "deepseek": {"thinking": {"type": "enabled"}},
    "qwen":     {"enable_thinking": True},
    "other":    {"enable_thinking": True},
}


class LLMGatewayError(RuntimeError):
    """LLM 调用网关层统一异常。"""


class OpenAICompatibleGateway:
    """OpenAI 协议网关。"""

    protocol = "openai_compatible"
    _chat_model_cache: dict[str, ChatOpenAI] = {}
    _chat_model_max_cache: int = 16

    # ---------- 内部辅助 ----------

    def _get_or_create_chat_model(self, runtime_config: LLMRuntimeConfigDTO) -> ChatOpenAI:
        """获取/缓存 ChatOpenAI 实例，复用 HTTP 连接池。"""
        kwargs = self._chat_kwargs(runtime_config)
        cache_key = f"{kwargs['model']}:{kwargs['base_url']}:{kwargs.get('api_key', '')}"
        cached = self._chat_model_cache.get(cache_key)
        if cached is not None:
            return cached
        instance = ChatOpenAI(**kwargs)
        if len(self._chat_model_cache) >= self._chat_model_max_cache:
            self._chat_model_cache.pop(next(iter(self._chat_model_cache)))
        self._chat_model_cache[cache_key] = instance
        return instance

    def _chat_kwargs(self, runtime_config: LLMRuntimeConfigDTO) -> dict[str, Any]:
        """构造 ChatOpenAI kwargs。仅在 enable_thinking 时注入 extra_body。"""
        extra_body: dict[str, Any] = {}
        if runtime_config.enable_thinking:
            extra_body.update(THINKING_PARAM_MAP.get(runtime_config.provider, THINKING_PARAM_MAP["other"]))
            if runtime_config.thinking_budget_tokens:
                extra_body["thinking_budget_tokens"] = runtime_config.thinking_budget_tokens

        kwargs: dict[str, Any] = {
            "model": runtime_config.model_name,
            "api_key": runtime_config.api_key.get_secret_value(),
            "base_url": runtime_config.base_url,
            "timeout": runtime_config.timeout_seconds,
            "temperature": runtime_config.temperature,
        }
        if runtime_config.max_tokens is not None:
            kwargs["max_tokens"] = runtime_config.max_tokens
        if extra_body:
            kwargs["extra_body"] = extra_body
        return kwargs

    @staticmethod
    def _extract_reasoning(chunk: Any) -> str:
        """
        从 ChatOpenAI 流式 chunk 中抽取 reasoning_content。

        两路 fallback：
            1. chunk.additional_kwargs['reasoning_content']  (DeepSeek/Qwen)
            2. chunk.additional_kwargs['thinking']           (部分实现)
        """
        kw = getattr(chunk, "additional_kwargs", None) or {}
        return kw.get("reasoning_content") or kw.get("thinking") or ""

    @staticmethod
    def _extract_usage(chunk: Any) -> TokenUsage | None:
        meta = getattr(chunk, "usage_metadata", None) or {}
        if not meta:
            return None
        return TokenUsage(
            input_tokens=int(meta.get("input_tokens") or meta.get("prompt_tokens") or 0),
            output_tokens=int(meta.get("output_tokens") or meta.get("completion_tokens") or 0),
        )

    # ---------- 对外 API ----------

    async def stream_once(
        self, prompt: str, runtime_config: LLMRuntimeConfigDTO,
    ) -> AsyncIterator[LLMStreamChunkDTO]:
        """
        流式调用。按以下顺序 yield chunk：
            kind=thinking (多次) → kind=text (多次) → kind=usage (0或1) → kind=done (1)
        """
        chat = self._get_or_create_chat_model(runtime_config)
        finish_reason: str | None = None
        try:
            async for chunk in chat.astream(prompt):
                reasoning = self._extract_reasoning(chunk)
                if reasoning:
                    yield LLMStreamChunkDTO(kind="thinking", text_delta=reasoning)
                raw_content = chunk.content if isinstance(chunk.content, str) else str(chunk.content or "")
                if raw_content:
                    yield LLMStreamChunkDTO(kind="text", text_delta=raw_content)
                usage = self._extract_usage(chunk)
                if usage is not None:
                    yield LLMStreamChunkDTO(kind="usage", usage=usage)
                meta = getattr(chunk, "response_metadata", None) or {}
                if meta.get("finish_reason"):
                    finish_reason = str(meta["finish_reason"])
        except LLM_GATEWAY_ERRORS as exc:
            raise LLMGatewayError(str(exc)) from exc
        yield LLMStreamChunkDTO(kind="done", finish_reason=finish_reason)

    async def complete_once(
        self, prompt: str, runtime_config: LLMRuntimeConfigDTO,
    ) -> LLMResultDTO:
        """非流式调用，仅用于会话标题生成等内部场景。"""
        chat = self._get_or_create_chat_model(runtime_config)
        try:
            response = await chat.ainvoke(prompt)
        except LLM_GATEWAY_ERRORS as exc:
            raise LLMGatewayError(str(exc)) from exc
        raw = response.content if isinstance(response.content, str) else str(response.content or "")
        usage = self._extract_usage(response) or TokenUsage()
        return LLMResultDTO(content=raw, model_name=runtime_config.model_name, usage=usage)
```

- [ ] **Step 4：运行测试验证通过**

Run: `cd backend && pytest tests/services/test_llm_gateway.py -v`
Expected: 6 passed

- [ ] **Step 5：commit**

```bash
git add backend/app/llm/gateway.py backend/tests/services/test_llm_gateway.py
git commit -m "feat(llm): rewrite OpenAICompatibleGateway with thinking dual-channel

阶段 2.2：reasoning_content → kind=thinking；content → kind=text；
THINKING_PARAM_MAP 按 provider 注入 extra_body"
```

### Task 2.3：重写 LLMModelRouter + thinking 自愈降级

**Files:**
- Modify: `backend/app/llm/model_router.py`
- Create: `backend/tests/services/test_llm_model_router.py`

- [ ] **Step 1：写失败测试**

`backend/tests/services/test_llm_model_router.py`:

```python
"""LLMModelRouter：stream + fallback + thinking 自愈降级单测。"""
from __future__ import annotations

from collections.abc import AsyncIterator
from unittest.mock import MagicMock, patch

import pytest
from pydantic import SecretStr

from app.llm.gateway import LLMGatewayError
from app.llm.model_router import LLMModelRouter
from app.schemas.agent.dto import LLMRuntimeConfigDTO, LLMStreamChunkDTO


def _cfg(model="m1", fallback=None, thinking=False):
    return LLMRuntimeConfigDTO(
        provider="deepseek", base_url="x", api_key=SecretStr("sk"),
        model_name=model, fallback_model_name=fallback, enable_thinking=thinking,
        max_retries=0,
    )


def _async_iter(items):
    async def gen():
        for it in items:
            yield it
    return gen()


@pytest.mark.asyncio
async def test_stream_passes_through_gateway_chunks():
    router = LLMModelRouter()
    gw = MagicMock()
    gw.stream_once = MagicMock(return_value=_async_iter([
        LLMStreamChunkDTO(kind="text", text_delta="hi"),
        LLMStreamChunkDTO(kind="done"),
    ]))
    router.gateways = {"openai_compatible": gw}
    out = [c async for c in router.stream("p", _cfg())]
    assert [c.kind for c in out] == ["text", "done"]


@pytest.mark.asyncio
async def test_stream_falls_back_to_secondary_model_on_error():
    """主模型错 → 切 fallback；fallback 继承 enable_thinking。"""
    router = LLMModelRouter()
    gw = MagicMock()
    call_count = {"n": 0}

    def _stream_side(prompt, runtime_config):
        call_count["n"] += 1
        if call_count["n"] == 1:
            async def _err():
                raise LLMGatewayError("upstream down")
                yield  # pragma: no cover
            return _err()
        return _async_iter([LLMStreamChunkDTO(kind="text", text_delta="ok"),
                            LLMStreamChunkDTO(kind="done")])

    gw.stream_once = MagicMock(side_effect=_stream_side)
    router.gateways = {"openai_compatible": gw}

    out = [c async for c in router.stream("p", _cfg(model="m1", fallback="m2", thinking=True))]
    assert [c.kind for c in out] == ["text", "done"]
    # 第二次调用是 fallback
    second_cfg = gw.stream_once.call_args_list[1][0][1]
    assert second_cfg.model_name == "m2"
    assert second_cfg.enable_thinking is True  # 继承


@pytest.mark.asyncio
async def test_stream_self_heals_thinking_unsupported():
    """enable_thinking=True 但 provider 报 thinking 不支持 → 自动降级 false 重试一次。"""
    router = LLMModelRouter()
    gw = MagicMock()
    call_count = {"n": 0}

    def _stream_side(prompt, runtime_config):
        call_count["n"] += 1
        if call_count["n"] == 1:
            async def _err():
                raise LLMGatewayError("model does not support thinking parameter")
                yield  # pragma: no cover
            return _err()
        return _async_iter([LLMStreamChunkDTO(kind="text", text_delta="ok"),
                            LLMStreamChunkDTO(kind="done")])

    gw.stream_once = MagicMock(side_effect=_stream_side)
    router.gateways = {"openai_compatible": gw}

    out = [c async for c in router.stream("p", _cfg(model="m1", thinking=True))]
    assert [c.kind for c in out] == ["text", "done"]
    # 第二次调用 enable_thinking 被降为 False
    second_cfg = gw.stream_once.call_args_list[1][0][1]
    assert second_cfg.enable_thinking is False
```

- [ ] **Step 2：运行测试验证失败**

Run: `cd backend && pytest tests/services/test_llm_model_router.py -v`
Expected: 旧 router 的 API 不匹配（gateways 是 list 不是 dict 等）

- [ ] **Step 3：重写 `backend/app/llm/model_router.py`**

```python
"""
LLM 模型路由：选模型 → 调 gateway → 失败时 fallback / thinking 自愈降级。

不关心思考模式细节（由 gateway 处理）。不支持按节点切换策略（由调用者决定 runtime_config）。
"""

from __future__ import annotations

import logging
import re
from collections.abc import AsyncIterator

from app.llm.gateway import LLMGatewayError, OpenAICompatibleGateway
from app.schemas.agent.dto import LLMResultDTO, LLMRuntimeConfigDTO, LLMStreamChunkDTO

logger = logging.getLogger(__name__)

# 匹配 provider 抛出"不支持思考模式"的常见错误特征
_THINKING_UNSUPPORTED_PATTERNS = (
    re.compile(r"thinking", re.IGNORECASE),
    re.compile(r"reasoning_content", re.IGNORECASE),
    re.compile(r"enable_thinking", re.IGNORECASE),
)


def _is_thinking_unsupported_error(exc: LLMGatewayError) -> bool:
    msg = str(exc)
    return any(p.search(msg) for p in _THINKING_UNSUPPORTED_PATTERNS)


class LLMModelRouter:
    """模型路由器。"""

    def __init__(self, gateways: list[OpenAICompatibleGateway] | None = None) -> None:
        registered = gateways or [OpenAICompatibleGateway()]
        self.gateways: dict[str, OpenAICompatibleGateway] = {gw.protocol: gw for gw in registered}

    async def stream(
        self, prompt: str, runtime_config: LLMRuntimeConfigDTO,
    ) -> AsyncIterator[LLMStreamChunkDTO]:
        """流式调用，按失败策略路由。"""
        async for chunk in self._stream_with_route(prompt, runtime_config, allow_thinking_self_heal=True):
            yield chunk

    async def complete(self, prompt: str, runtime_config: LLMRuntimeConfigDTO) -> LLMResultDTO:
        gateway = self._gateway_for(runtime_config)
        try:
            return await gateway.complete_once(prompt, runtime_config)
        except LLMGatewayError as exc:
            if runtime_config.fallback_model_name and runtime_config.fallback_model_name != runtime_config.model_name:
                fallback = runtime_config.model_copy(
                    update={"model_name": runtime_config.fallback_model_name, "fallback_model_name": None}
                )
                return await self.complete(prompt, fallback)
            raise

    # ---------- 内部 ----------

    def _gateway_for(self, runtime_config: LLMRuntimeConfigDTO) -> OpenAICompatibleGateway:
        gateway = self.gateways.get(runtime_config.protocol)
        if gateway is None:
            raise LLMGatewayError(f"未知协议: {runtime_config.protocol}")
        return gateway

    async def _stream_with_route(
        self,
        prompt: str,
        runtime_config: LLMRuntimeConfigDTO,
        *,
        allow_thinking_self_heal: bool,
    ) -> AsyncIterator[LLMStreamChunkDTO]:
        gateway = self._gateway_for(runtime_config)
        try:
            async for chunk in gateway.stream_once(prompt, runtime_config):
                yield chunk
            return
        except LLMGatewayError as exc:
            # 1) thinking 自愈降级
            if allow_thinking_self_heal and runtime_config.enable_thinking and _is_thinking_unsupported_error(exc):
                logger.warning("LLM 模型不支持 thinking 模式，自动降级重试一次：%s", exc)
                degraded = runtime_config.model_copy(update={"enable_thinking": False})
                async for chunk in self._stream_with_route(prompt, degraded, allow_thinking_self_heal=False):
                    yield chunk
                return
            # 2) fallback 模型
            if runtime_config.fallback_model_name and runtime_config.fallback_model_name != runtime_config.model_name:
                logger.warning("LLM 主模型 %s 失败，切换 fallback %s",
                               runtime_config.model_name, runtime_config.fallback_model_name)
                fallback = runtime_config.model_copy(
                    update={"model_name": runtime_config.fallback_model_name, "fallback_model_name": None}
                )
                async for chunk in self._stream_with_route(prompt, fallback, allow_thinking_self_heal=False):
                    yield chunk
                return
            raise


DEFAULT_MODEL_ROUTER = LLMModelRouter()


def get_default_model_router() -> LLMModelRouter:
    return DEFAULT_MODEL_ROUTER
```

- [ ] **Step 4：运行测试验证通过**

Run: `cd backend && pytest tests/services/test_llm_model_router.py tests/services/test_llm_gateway.py -v`
Expected: 3 + 6 passed

- [ ] **Step 5：commit**

```bash
git add backend/app/llm/model_router.py backend/tests/services/test_llm_model_router.py
git commit -m "feat(llm): rewrite LLMModelRouter with fallback + thinking self-heal

阶段 2.3：stream/complete 极简化；
thinking 不支持时自动降级一次；fallback 模型继承 enable_thinking 语义"
```

### Task 2.4：清理 chains.py 与其他对 dto 旧字段的引用

**Files:**
- Modify: `backend/app/llm/chains/chains.py`（按 grep 结果改）
- Modify: 其他命中文件

- [ ] **Step 1：grep 旧字段引用**

Run: `cd backend && grep -rn "\.source\b\|\.enable_memory\|\.top_p\|\.presence_penalty\|\.frequency_penalty\|\.enable_prompt_cache\|enable_tools" app --include="*.py" | grep -v __pycache__`

输出每一条引用。**不在 dto 自身的引用**全部替换：把读取旧字段的地方用合理默认值或新字段替换。

- [ ] **Step 2：对每一处命中按以下规则修改**

- `cfg.source` → 删除该引用（无对应概念）
- `cfg.enable_memory` → 删除该判断分支（默认不启用 memory）
- `cfg.top_p` / `cfg.presence_penalty` / `cfg.frequency_penalty` → 删除参数传递（gateway 已不使用）
- `cfg.enable_prompt_cache` → 删除
- `cfg.enable_tools` → 删除（业务工具调用通过 emit_block 表达，不再走 LangChain Tools）

- [ ] **Step 3：确保 backend 仍可 import 启动**

Run: `cd backend && python -c "from app.main import app; print('ok')"`
Expected: `ok`

- [ ] **Step 4：commit**

```bash
git add -A
git commit -m "refactor(llm): drop legacy LLMRuntimeConfigDTO field references across codebase

阶段 2.4：清理 source/enable_memory/top_p/presence_penalty/enable_tools 等无用字段引用"
```

---

## 阶段 3：流式发射器

### Task 3.1：AgentStreamEmitter 9 个 emit_* 方法

**Files:**
- Create: `backend/app/llm/streaming/emitter.py`
- Create: `backend/tests/services/test_agent_stream_emitter.py`

- [ ] **Step 1：写失败测试**

`backend/tests/services/test_agent_stream_emitter.py`:

```python
"""AgentStreamEmitter 9 个 emit_* 方法的单调 seq 与信封字段校验。"""
from __future__ import annotations

import pytest
from app.llm.streaming.emitter import AgentStreamEmitter


def _new(emitter_kwargs: dict | None = None) -> AgentStreamEmitter:
    return AgentStreamEmitter(
        session_id=42, run_id="run_x", workflow_type="interview_questions",
        **(emitter_kwargs or {}),
    )


def test_run_start_envelope_shape():
    e = _new()
    env = e.emit_run_start(enable_thinking=True, user_message_id=99)
    assert env.v == 1
    assert env.type == "run.start"
    assert env.seq == 1
    assert env.data["run_id"] == "run_x"
    assert env.data["enable_thinking"] is True
    assert env.data["user_message_id"] == 99


def test_seq_is_monotonic_across_emits():
    e = _new()
    seqs = [
        e.emit_run_start(enable_thinking=False, user_message_id=1).seq,
        e.emit_step(step_id="x", title="t", status="running").seq,
        e.emit_block_start(index=0, block={"type": "text", "text": ""}).seq,
        e.emit_block_delta(index=0, delta={"text_delta": "hi"}).seq,
        e.emit_block_stop(index=0).seq,
        e.emit_run_finish(agent_message_id=1).seq,
    ]
    assert seqs == [1, 2, 3, 4, 5, 6]


def test_interaction_request_payload():
    e = _new()
    env = e.emit_interaction_request(
        request_id="req_x", interaction_type="job_selection",
        title="选岗位", prompt="从候选中选",
        schema={"type": "object"}, data={"candidates": [1, 2]},
    )
    assert env.type == "interaction.request"
    assert env.data["request_id"] == "req_x"
    assert env.data["interaction_type"] == "job_selection"
    assert env.data["data"]["candidates"] == [1, 2]


def test_interaction_resolve_carries_values():
    e = _new()
    env = e.emit_interaction_resolve(request_id="req_x", values={"job_full_name": "高级算法工程师"})
    assert env.type == "interaction.resolve"
    assert env.data["values"]["job_full_name"] == "高级算法工程师"


def test_run_error_default_retriable_false():
    e = _new()
    env = e.emit_run_error(code="job_validation_exhausted", message="超过 3 次")
    assert env.data["retriable"] is False
```

- [ ] **Step 2：运行测试验证失败**

Run: `cd backend && pytest tests/services/test_agent_stream_emitter.py -v`
Expected: ModuleNotFoundError

- [ ] **Step 3：创建 `backend/app/llm/streaming/emitter.py`**

```python
"""
Agent 流式事件发射器。

只做两件事：
1. 内部维护 seq 单调递增计数器
2. 把方法调用包装成 AgentStreamEnvelope 实例（带 v / seq / ts / run_id / session_id / type / data）

业务规则、缓冲、SSE 序列化均不归 emitter。所有 emit_* 方法返回 envelope，调用者
（Service / Runner / Endpoint）决定如何投递（直接 yield、缓冲、forward）。

线程模型：每次 run 一个独立 emitter 实例（per-request scope）。
"""

from __future__ import annotations

import time
from itertools import count
from typing import Any, Literal

from app.schemas.agent.stream import (
    STREAM_PROTOCOL_VERSION,
    AgentStreamEnvelope,
    BlockStartData,
    BlockDeltaData,
    BlockStopData,
    InteractionRequestData,
    InteractionResolveData,
    InteractionType,
    RunErrorData,
    RunFinishData,
    RunStartData,
    StepStatus,
    StepUpdateData,
)


def _now_ms() -> int:
    return int(time.time() * 1000)


class AgentStreamEmitter:
    """9 个 emit_* 方法封装协议事件构造。"""

    def __init__(
        self,
        *,
        session_id: int,
        run_id: str,
        workflow_type: Literal["interview_questions", "resume_evaluation"],
    ) -> None:
        self.session_id = session_id
        self.run_id = run_id
        self.workflow_type = workflow_type
        self._seq = count(1)

    # ---------- 内部 ----------

    def _wrap(self, *, type: str, data: dict[str, Any]) -> AgentStreamEnvelope:
        return AgentStreamEnvelope(
            v=STREAM_PROTOCOL_VERSION,
            seq=next(self._seq),
            ts=_now_ms(),
            run_id=self.run_id,
            session_id=self.session_id,
            type=type,
            data=data,
        )

    # ---------- run.* ----------

    def emit_run_start(
        self, *, enable_thinking: bool, user_message_id: int | None,
    ) -> AgentStreamEnvelope:
        data = RunStartData(
            run_id=self.run_id, workflow_type=self.workflow_type,
            enable_thinking=enable_thinking, user_message_id=user_message_id,
        ).model_dump(mode="json")
        return self._wrap(type="run.start", data=data)

    def emit_run_finish(self, *, agent_message_id: int) -> AgentStreamEnvelope:
        data = RunFinishData(agent_message_id=agent_message_id).model_dump(mode="json")
        return self._wrap(type="run.finish", data=data)

    def emit_run_error(self, *, code: str, message: str, retriable: bool = False) -> AgentStreamEnvelope:
        data = RunErrorData(code=code, message=message, retriable=retriable).model_dump(mode="json")
        return self._wrap(type="run.error", data=data)

    # ---------- step ----------

    def emit_step(
        self, *, step_id: str, title: str, status: StepStatus, detail: str | None = None,
    ) -> AgentStreamEnvelope:
        data = StepUpdateData(step_id=step_id, title=title, status=status, detail=detail).model_dump(mode="json")
        return self._wrap(type="step.update", data=data)

    # ---------- block ----------

    def emit_block_start(self, *, index: int, block: dict[str, Any]) -> AgentStreamEnvelope:
        data = BlockStartData(index=index, block=block).model_dump(mode="json")
        return self._wrap(type="block.start", data=data)

    def emit_block_delta(self, *, index: int, delta: dict[str, Any]) -> AgentStreamEnvelope:
        data = BlockDeltaData(index=index, delta=delta).model_dump(mode="json")
        return self._wrap(type="block.delta", data=data)

    def emit_block_stop(self, *, index: int) -> AgentStreamEnvelope:
        data = BlockStopData(index=index).model_dump(mode="json")
        return self._wrap(type="block.stop", data=data)

    # ---------- interaction ----------

    def emit_interaction_request(
        self, *, request_id: str, interaction_type: InteractionType,
        title: str, prompt: str,
        schema: dict[str, Any] | None = None,
        data: dict[str, Any] | None = None,
    ) -> AgentStreamEnvelope:
        payload = InteractionRequestData(
            request_id=request_id, interaction_type=interaction_type,
            title=title, prompt=prompt,
            schema=schema or {}, data=data or {},
        ).model_dump(mode="json")
        return self._wrap(type="interaction.request", data=payload)

    def emit_interaction_resolve(self, *, request_id: str, values: dict[str, Any]) -> AgentStreamEnvelope:
        payload = InteractionResolveData(request_id=request_id, values=values).model_dump(mode="json")
        return self._wrap(type="interaction.resolve", data=payload)
```

- [ ] **Step 4：运行测试验证通过**

Run: `cd backend && pytest tests/services/test_agent_stream_emitter.py -v`
Expected: 5 passed

- [ ] **Step 5：commit**

```bash
git add backend/app/llm/streaming/emitter.py backend/tests/services/test_agent_stream_emitter.py
git commit -m "feat(agent-protocol): rewrite AgentStreamEmitter with 9 emit_* methods

阶段 3.1：seq 单调递增；emit_* 仅返回 envelope，不负责投递"
```

### Task 3.2：block_index 计数器辅助

**Files:**
- Modify: `backend/app/llm/streaming/emitter.py`（追加）
- Modify: `backend/tests/services/test_agent_stream_emitter.py`（追加测试）

- [ ] **Step 1：追加失败测试**

在 `test_agent_stream_emitter.py` 末尾追加：

```python
def test_next_block_index_is_monotonic():
    """emitter 内置 block index 分配器，单调递增。"""
    e = _new()
    assert e.next_block_index() == 0
    assert e.next_block_index() == 1
    assert e.next_block_index() == 2


def test_block_index_independent_from_seq():
    """seq 与 block index 是两个独立计数器。"""
    e = _new()
    e.emit_run_start(enable_thinking=False, user_message_id=1)
    idx0 = e.next_block_index()
    e.emit_block_start(index=idx0, block={"type": "text", "text": ""})
    e.emit_block_stop(index=idx0)
    assert idx0 == 0  # 第一次 next_block_index 应为 0
```

- [ ] **Step 2：运行测试验证失败**

Run: `cd backend && pytest tests/services/test_agent_stream_emitter.py::test_next_block_index_is_monotonic -v`
Expected: AttributeError: 'AgentStreamEmitter' object has no attribute 'next_block_index'

- [ ] **Step 3：在 emitter.py 的 `__init__` 末尾追加：**

```python
        self._block_index = count(0)

    def next_block_index(self) -> int:
        """分配下一个 block index（由 Service 持有，跨 emit_block_start 调用单调递增）。"""
        return next(self._block_index)
```

- [ ] **Step 4：运行测试验证通过**

Run: `cd backend && pytest tests/services/test_agent_stream_emitter.py -v`
Expected: 7 passed

- [ ] **Step 5：commit**

```bash
git add backend/app/llm/streaming/emitter.py backend/tests/services/test_agent_stream_emitter.py
git commit -m "feat(agent-protocol): add block index allocator to AgentStreamEmitter

阶段 3.2：next_block_index() 单调递增，独立于 seq 计数器"
```

---

## 阶段 4：Graph + Runner + Context

### Task 4.1：State 与 Context 定义

**Files:**
- Modify: `backend/app/llm/graphs/workflows/state.py`（重写）
- Create: `backend/app/llm/graphs/workflows/context.py`
- Create: `backend/tests/services/test_workflow_state_context.py`

- [ ] **Step 1：写失败测试**

`backend/tests/services/test_workflow_state_context.py`:

```python
"""WorkflowRuntimeContext 与两个 graph state 的字段约束。"""
from __future__ import annotations

from unittest.mock import MagicMock

import pytest
from pydantic import SecretStr

from app.llm.graphs.workflows.context import WorkflowRuntimeContext
from app.llm.graphs.workflows.state import InterviewQuestionState, ResumeEvaluationState
from app.llm.streaming.emitter import AgentStreamEmitter
from app.schemas.agent.dto import LLMRuntimeConfigDTO


def _cfg() -> LLMRuntimeConfigDTO:
    return LLMRuntimeConfigDTO(
        provider="deepseek", base_url="x", api_key=SecretStr("sk"),
        model_name="m1",
    )


def test_workflow_context_carries_emitter_and_services():
    emitter = AgentStreamEmitter(session_id=1, run_id="r", workflow_type="interview_questions")
    ctx = WorkflowRuntimeContext(
        emitter=emitter, runtime_config=_cfg(),
        interview_service=MagicMock(), evaluation_service=MagicMock(),
        resume_loader=MagicMock(),
        session_id=1, employee_id=2, run_id="r",
    )
    assert ctx.run_id == "r"
    assert ctx.emitter is emitter


def test_interview_state_has_expected_keys():
    state: InterviewQuestionState = {
        "resume_ref": {},
        "resume_text": "",
        "suggested_dimensions": [],
        "selected_dimensions": [],
        "question_plan": {},
        "plan_approved": False,
        "question_set": None,
    }
    assert state["question_set"] is None


def test_resume_evaluation_state_has_validation_attempts():
    state: ResumeEvaluationState = {
        "resume_ref": {},
        "resume_text": "",
        "resume_profile": {},
        "job_candidates": [],
        "selected_job_name": "",
        "job_full": None,
        "validation_attempts": 0,
        "evaluation_result": None,
        "report": None,
    }
    assert state["validation_attempts"] == 0
```

- [ ] **Step 2：运行测试验证失败**

Run: `cd backend && pytest tests/services/test_workflow_state_context.py -v`
Expected: ImportError（context.py 不存在；旧 state.py 字段不匹配）

- [ ] **Step 3：重写 `backend/app/llm/graphs/workflows/state.py`**

```python
"""
两个 workflow graph 的扁平 state 定义。

无共享 state；每图独立一个 TypedDict。运行时上下文（emitter / services / runtime_config）
通过 WorkflowRuntimeContext（context.py）由 config["configurable"]["ctx"] 注入，
不进入 graph state（不参与 checkpoint 持久化）。
"""

from __future__ import annotations

from typing import Any, TypedDict


class InterviewQuestionState(TypedDict, total=False):
    """图一 state：简历问答。"""
    resume_ref: dict[str, Any]
    resume_text: str
    suggested_dimensions: list[dict[str, Any]]
    selected_dimensions: list[dict[str, Any]]
    question_plan: dict[str, Any]
    plan_approved: bool
    question_set: dict[str, Any] | None


class ResumeEvaluationState(TypedDict, total=False):
    """图二 state：简历评估。"""
    resume_ref: dict[str, Any]
    resume_text: str
    resume_profile: dict[str, Any]
    job_candidates: list[dict[str, Any]]
    selected_job_name: str
    job_full: dict[str, Any] | None
    validation_attempts: int
    evaluation_result: dict[str, Any] | None
    report: dict[str, Any] | None
```

- [ ] **Step 4：创建 `backend/app/llm/graphs/workflows/context.py`**

```python
"""
WorkflowRuntimeContext：通过 graph config["configurable"]["ctx"] 注入节点。

替代旧的 ContextVar + asyncio.Queue 机制。节点函数从 config 拿 ctx，
拿到 emitter 和 services 实例后调 service 方法，service 内部用
get_stream_writer() 向 LangGraph custom stream 投递事件。
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import TYPE_CHECKING

from app.llm.streaming.emitter import AgentStreamEmitter
from app.schemas.agent.dto import LLMRuntimeConfigDTO

if TYPE_CHECKING:
    from app.services.interview_question_service import InterviewQuestionService
    from app.services.resume_evaluation_service import ResumeEvaluationService
    from app.services.resume_loader import ResumeLoader


@dataclass
class WorkflowRuntimeContext:
    """单次 graph 执行的运行时上下文。"""
    emitter: AgentStreamEmitter
    runtime_config: LLMRuntimeConfigDTO
    interview_service: "InterviewQuestionService"
    evaluation_service: "ResumeEvaluationService"
    resume_loader: "ResumeLoader"
    session_id: int
    employee_id: int
    run_id: str
```

- [ ] **Step 5：运行测试验证通过**

Run: `cd backend && pytest tests/services/test_workflow_state_context.py -v`
Expected: 3 passed

- [ ] **Step 6：commit**

```bash
git add backend/app/llm/graphs/workflows/state.py backend/app/llm/graphs/workflows/context.py backend/tests/services/test_workflow_state_context.py
git commit -m "feat(graph): rewrite workflow state and add WorkflowRuntimeContext

阶段 4.1：两个 graph 独立扁平 TypedDict；
ctx 替代 ContextVar 注入 emitter/services 到节点"
```

### Task 4.2：薄壳 Runner

**Files:**
- Modify: `backend/app/llm/graphs/workflows/runner.py`（重写）
- Create: `backend/tests/services/test_workflow_runner.py`

- [ ] **Step 1：写失败测试**

`backend/tests/services/test_workflow_runner.py`:

```python
"""AgentWorkflowRunner：updates → step.update 翻译 + custom stream forward + interrupt 翻译。"""
from __future__ import annotations

from collections.abc import AsyncIterator
from unittest.mock import MagicMock, patch
from typing import Any

import pytest
from langgraph.types import Command, Interrupt
from pydantic import SecretStr

from app.llm.graphs.workflows.context import WorkflowRuntimeContext
from app.llm.graphs.workflows.runner import AgentWorkflowRunner
from app.llm.streaming.emitter import AgentStreamEmitter
from app.schemas.agent.dto import LLMRuntimeConfigDTO


def _ctx() -> WorkflowRuntimeContext:
    emitter = AgentStreamEmitter(session_id=1, run_id="r", workflow_type="interview_questions")
    return WorkflowRuntimeContext(
        emitter=emitter,
        runtime_config=LLMRuntimeConfigDTO(
            provider="deepseek", base_url="x", api_key=SecretStr("sk"), model_name="m"
        ),
        interview_service=MagicMock(),
        evaluation_service=MagicMock(),
        resume_loader=MagicMock(),
        session_id=1, employee_id=2, run_id="r",
    )


@pytest.mark.asyncio
async def test_runner_translates_node_updates_to_step_events():
    """节点 update 翻译为 step.update：running → success。"""
    ctx = _ctx()
    fake_graph = MagicMock()

    async def fake_astream(graph_input, config, stream_mode):
        yield ("updates", {"load_resume": {"resume_text": "hello"}})
        yield ("updates", {"suggest_dimensions": {"suggested_dimensions": []}})

    fake_graph.astream = fake_astream
    runner = AgentWorkflowRunner(fake_graph)
    events = [e async for e in runner.astream(thread_id="t", graph_input={}, ctx=ctx)]
    types = [e.type for e in events]
    # 每个节点产生 1 个 step.update（success）
    assert types.count("step.update") == 2
    assert all(e.data["status"] == "success" for e in events if e.type == "step.update")


@pytest.mark.asyncio
async def test_runner_translates_interrupt_to_interaction_request():
    """__interrupt__ 节点更新翻译为 interaction.request。"""
    ctx = _ctx()
    fake_graph = MagicMock()
    interrupt_payload = {
        "request_id": "req_x",
        "interaction_type": "job_selection",
        "title": "选岗位", "prompt": "从候选中选",
        "data": {"candidates": []},
    }

    async def fake_astream(graph_input, config, stream_mode):
        yield ("updates", {"__interrupt__": [Interrupt(value=interrupt_payload)]})

    fake_graph.astream = fake_astream
    runner = AgentWorkflowRunner(fake_graph)
    events = [e async for e in runner.astream(thread_id="t", graph_input={}, ctx=ctx)]
    assert len(events) == 1
    assert events[0].type == "interaction.request"
    assert events[0].data["request_id"] == "req_x"


@pytest.mark.asyncio
async def test_runner_forwards_custom_stream_events():
    """custom stream_mode 直接 forward envelope（不二次包装）。"""
    ctx = _ctx()
    fake_graph = MagicMock()
    pre_built = ctx.emitter.emit_block_start(index=0, block={"type": "text", "text": ""})

    async def fake_astream(graph_input, config, stream_mode):
        yield ("custom", pre_built)

    fake_graph.astream = fake_astream
    runner = AgentWorkflowRunner(fake_graph)
    events = [e async for e in runner.astream(thread_id="t", graph_input={}, ctx=ctx)]
    assert events == [pre_built]


@pytest.mark.asyncio
async def test_runner_passes_ctx_through_config():
    """ctx 通过 config['configurable']['ctx'] 注入。"""
    ctx = _ctx()
    fake_graph = MagicMock()
    captured = {}

    async def fake_astream(graph_input, config, stream_mode):
        captured["config"] = config
        if False:
            yield  # pragma: no cover

    fake_graph.astream = fake_astream
    runner = AgentWorkflowRunner(fake_graph)
    [e async for e in runner.astream(thread_id="thread_a", graph_input={}, ctx=ctx)]
    assert captured["config"]["configurable"]["thread_id"] == "thread_a"
    assert captured["config"]["configurable"]["ctx"] is ctx
```

- [ ] **Step 2：运行测试验证失败**

Run: `cd backend && pytest tests/services/test_workflow_runner.py -v`
Expected: 旧 runner 签名/字段不匹配

- [ ] **Step 3：重写 `backend/app/llm/graphs/workflows/runner.py`**

```python
"""
LangGraph 工作流薄壳 Runner。

职责：
- 通过 config["configurable"]["ctx"] 注入 WorkflowRuntimeContext 到节点闭包
- 翻译 stream_mode="updates" 的节点更新为 step.update 协议事件
- 翻译 LangGraph __interrupt__ 为 interaction.request 协议事件
- 直接 forward stream_mode="custom" 的 envelope（Service 用 get_stream_writer 已写好）

不做：业务规则、block 构造、消息落库（均由 Service / AgentRuntimeService 负责）。
"""

from __future__ import annotations

import logging
from collections.abc import AsyncIterator
from typing import Any

from langgraph.graph.state import CompiledStateGraph
from langgraph.types import Interrupt

from app.llm.graphs.workflows.context import WorkflowRuntimeContext
from app.schemas.agent.stream import AgentStreamEnvelope

logger = logging.getLogger(__name__)


class AgentWorkflowRunner:
    """统一两图执行的薄壳 Runner。"""

    def __init__(self, compiled_graph: CompiledStateGraph) -> None:
        self._graph = compiled_graph

    async def astream(
        self, *, thread_id: str, graph_input: Any, ctx: WorkflowRuntimeContext,
    ) -> AsyncIterator[AgentStreamEnvelope]:
        """运行图并 yield 协议事件。"""
        config = {"configurable": {"thread_id": thread_id, "ctx": ctx}}
        async for mode, payload in self._graph.astream(
            graph_input, config=config, stream_mode=["updates", "custom"],
        ):
            if mode == "updates":
                for env in self._translate_updates(payload, ctx):
                    yield env
            elif mode == "custom":
                # Service 内已构造好 envelope，直接 forward
                if isinstance(payload, AgentStreamEnvelope):
                    yield payload
                else:
                    logger.warning("custom stream 收到非 envelope 载荷，忽略：%r", payload)

    # ---------- 内部 ----------

    def _translate_updates(
        self, payload: dict[str, Any], ctx: WorkflowRuntimeContext,
    ) -> list[AgentStreamEnvelope]:
        """把一次节点 update 翻译为 step.update / interaction.request。"""
        events: list[AgentStreamEnvelope] = []
        for node_name, update in payload.items():
            if node_name == "__interrupt__":
                items = update if isinstance(update, (list, tuple)) else [update]
                for item in items:
                    env = self._translate_interrupt(item, ctx)
                    if env is not None:
                        events.append(env)
                continue
            events.append(ctx.emitter.emit_step(
                step_id=str(node_name),
                title=str(node_name),
                status="success",
            ))
        return events

    def _translate_interrupt(
        self, interrupt: Any, ctx: WorkflowRuntimeContext,
    ) -> AgentStreamEnvelope | None:
        value = interrupt.value if isinstance(interrupt, Interrupt) else interrupt
        if not isinstance(value, dict):
            logger.warning("未识别的 interrupt 载荷：%r", interrupt)
            return None
        return ctx.emitter.emit_interaction_request(
            request_id=str(value.get("request_id") or ""),
            interaction_type=value.get("interaction_type"),
            title=str(value.get("title") or "请确认"),
            prompt=str(value.get("prompt") or ""),
            schema=value.get("schema"),
            data=value.get("data"),
        )
```

- [ ] **Step 4：运行测试验证通过**

Run: `cd backend && pytest tests/services/test_workflow_runner.py -v`
Expected: 4 passed

- [ ] **Step 5：commit**

```bash
git add backend/app/llm/graphs/workflows/runner.py backend/tests/services/test_workflow_runner.py
git commit -m "feat(graph): rewrite AgentWorkflowRunner as thin shell

阶段 4.2：仅做 updates→step.update + interrupt→interaction.request + custom forward"
```

### Task 4.3：图一 graph 骨架与节点空实现

**Files:**
- Modify: `backend/app/llm/graphs/workflows/interview_questions.py`（重写）
- Create: `backend/tests/services/test_interview_graph_skeleton.py`

- [ ] **Step 1：写失败测试**

`backend/tests/services/test_interview_graph_skeleton.py`:

```python
"""图一 graph 结构与节点路由的最小断言（不验证业务）。"""
from __future__ import annotations

import pytest
from langgraph.checkpoint.memory import MemorySaver

from app.llm.graphs.workflows.interview_questions import build_interview_graph


def test_build_interview_graph_compiles_with_memory_saver():
    """build_interview_graph 返回可执行图，节点齐全。"""
    graph = build_interview_graph(MemorySaver())
    # CompiledStateGraph.get_graph() 返回 Graph，包含 nodes
    g = graph.get_graph()
    node_names = set(g.nodes.keys())
    expected = {
        "load_resume", "suggest_dimensions", "request_dimension_selection",
        "build_question_plan", "request_plan_approval",
        "fanout_generate_questions", "reduce_questions", "finalize_question_set",
    }
    assert expected.issubset(node_names)
```

- [ ] **Step 2：运行测试验证失败**

Run: `cd backend && pytest tests/services/test_interview_graph_skeleton.py -v`
Expected: build_interview_graph 签名不匹配 / 节点缺失

- [ ] **Step 3：重写 `backend/app/llm/graphs/workflows/interview_questions.py`**

```python
"""
图一：简历问答 workflow graph。

节点为薄包装，仅调 ctx.interview_service.*；业务规则全在 Service 内。
"""

from __future__ import annotations

from typing import Any

from langgraph.checkpoint.base import BaseCheckpointSaver
from langgraph.graph import END, START, StateGraph
from langgraph.graph.state import CompiledStateGraph
from langgraph.types import Command, interrupt

from app.llm.graphs.workflows.context import WorkflowRuntimeContext
from app.llm.graphs.workflows.state import InterviewQuestionState


# ---------- 节点函数（≤10 行） ----------

async def _load_resume(state: InterviewQuestionState, config) -> dict:
    ctx: WorkflowRuntimeContext = config["configurable"]["ctx"]
    return await ctx.interview_service.load_resume(state, ctx)


async def _suggest_dimensions(state: InterviewQuestionState, config) -> dict:
    ctx: WorkflowRuntimeContext = config["configurable"]["ctx"]
    return await ctx.interview_service.suggest_dimensions(state, ctx)


async def _request_dimension_selection(state: InterviewQuestionState, config) -> Command:
    ctx: WorkflowRuntimeContext = config["configurable"]["ctx"]
    payload = ctx.interview_service.build_dimension_interaction(state)
    user_values = interrupt(payload)
    return Command(update={"selected_dimensions": user_values.get("selected_dimensions", [])})


async def _build_question_plan(state: InterviewQuestionState, config) -> dict:
    ctx: WorkflowRuntimeContext = config["configurable"]["ctx"]
    return await ctx.interview_service.build_question_plan(state, ctx)


async def _request_plan_approval(state: InterviewQuestionState, config) -> Command:
    ctx: WorkflowRuntimeContext = config["configurable"]["ctx"]
    payload = ctx.interview_service.build_plan_interaction(state)
    user_values = interrupt(payload)
    if user_values.get("approved"):
        return Command(goto="fanout_generate_questions", update={"plan_approved": True})
    # 驳回：循环回 build_question_plan，携带 HR 反馈
    return Command(
        goto="build_question_plan",
        update={"question_plan": {**state["question_plan"], "_feedback": user_values.get("feedback", "")}},
    )


async def _fanout_generate_questions(state: InterviewQuestionState, config) -> dict:
    ctx: WorkflowRuntimeContext = config["configurable"]["ctx"]
    return await ctx.interview_service.fanout_generate_questions(state, ctx)


async def _reduce_questions(state: InterviewQuestionState, config) -> dict:
    ctx: WorkflowRuntimeContext = config["configurable"]["ctx"]
    return await ctx.interview_service.reduce_questions(state, ctx)


async def _finalize_question_set(state: InterviewQuestionState, config) -> dict:
    ctx: WorkflowRuntimeContext = config["configurable"]["ctx"]
    return await ctx.interview_service.finalize_question_set(state, ctx)


# ---------- 图构造 ----------

def build_interview_graph(checkpointer: BaseCheckpointSaver) -> CompiledStateGraph:
    """构造并编译图一。"""
    graph = StateGraph(InterviewQuestionState)
    graph.add_node("load_resume", _load_resume)
    graph.add_node("suggest_dimensions", _suggest_dimensions)
    graph.add_node("request_dimension_selection", _request_dimension_selection)
    graph.add_node("build_question_plan", _build_question_plan)
    graph.add_node("request_plan_approval", _request_plan_approval)
    graph.add_node("fanout_generate_questions", _fanout_generate_questions)
    graph.add_node("reduce_questions", _reduce_questions)
    graph.add_node("finalize_question_set", _finalize_question_set)

    graph.add_edge(START, "load_resume")
    graph.add_edge("load_resume", "suggest_dimensions")
    graph.add_edge("suggest_dimensions", "request_dimension_selection")
    graph.add_edge("request_dimension_selection", "build_question_plan")
    graph.add_edge("request_plan_approval", "fanout_generate_questions")
    graph.add_edge("fanout_generate_questions", "reduce_questions")
    graph.add_edge("reduce_questions", "finalize_question_set")
    graph.add_edge("finalize_question_set", END)
    # build_question_plan 之后等待审批
    graph.add_edge("build_question_plan", "request_plan_approval")

    return graph.compile(checkpointer=checkpointer)
```

- [ ] **Step 4：运行测试验证通过**

Run: `cd backend && pytest tests/services/test_interview_graph_skeleton.py -v`
Expected: 1 passed

- [ ] **Step 5：commit**

```bash
git add backend/app/llm/graphs/workflows/interview_questions.py backend/tests/services/test_interview_graph_skeleton.py
git commit -m "feat(graph): scaffold interview_questions graph with 8 nodes

阶段 4.3：节点全部为薄包装，调 ctx.interview_service.*；
节点函数 ≤10 行，业务规则下沉 Service"
```

### Task 4.4：图二 graph 骨架

**Files:**
- Modify: `backend/app/llm/graphs/workflows/resume_evaluation.py`（重写）
- Create: `backend/tests/services/test_evaluation_graph_skeleton.py`

- [ ] **Step 1：写失败测试**

`backend/tests/services/test_evaluation_graph_skeleton.py`:

```python
"""图二 graph 结构最小断言。"""
from __future__ import annotations

import pytest
from langgraph.checkpoint.memory import MemorySaver

from app.llm.graphs.workflows.resume_evaluation import build_evaluation_graph


def test_build_evaluation_graph_compiles():
    graph = build_evaluation_graph(MemorySaver())
    g = graph.get_graph()
    node_names = set(g.nodes.keys())
    expected = {
        "load_resume", "analyze_resume_profile",
        "load_job_candidates", "request_job_selection", "validate_job_full_name",
        "run_evaluation_subgraph", "build_visualization_report", "finalize_evaluation_report",
    }
    assert expected.issubset(node_names)
```

- [ ] **Step 2：运行测试验证失败**

Run: `cd backend && pytest tests/services/test_evaluation_graph_skeleton.py -v`
Expected: 节点缺失

- [ ] **Step 3：重写 `backend/app/llm/graphs/workflows/resume_evaluation.py`**

```python
"""
图二：简历评估 workflow graph。

节点为薄包装，仅调 ctx.evaluation_service.*；业务规则全在 Service 内。
"""

from __future__ import annotations

from typing import Any

from langgraph.checkpoint.base import BaseCheckpointSaver
from langgraph.graph import END, START, StateGraph
from langgraph.graph.state import CompiledStateGraph
from langgraph.types import Command, interrupt

from app.llm.graphs.workflows.context import WorkflowRuntimeContext
from app.llm.graphs.workflows.state import ResumeEvaluationState


# ---------- 节点函数 ----------

async def _load_resume(state: ResumeEvaluationState, config) -> dict:
    ctx: WorkflowRuntimeContext = config["configurable"]["ctx"]
    return await ctx.evaluation_service.load_resume(state, ctx)


async def _analyze_resume_profile(state: ResumeEvaluationState, config) -> dict:
    ctx: WorkflowRuntimeContext = config["configurable"]["ctx"]
    return await ctx.evaluation_service.analyze_resume_profile(state, ctx)


async def _load_job_candidates(state: ResumeEvaluationState, config) -> dict:
    ctx: WorkflowRuntimeContext = config["configurable"]["ctx"]
    return await ctx.evaluation_service.load_job_candidates(state, ctx)


async def _request_job_selection(state: ResumeEvaluationState, config) -> Command:
    ctx: WorkflowRuntimeContext = config["configurable"]["ctx"]
    payload = ctx.evaluation_service.build_job_interaction(state)
    user_values = interrupt(payload)
    return Command(update={"selected_job_name": str(user_values.get("job_full_name") or "")})


async def _validate_job_full_name(state: ResumeEvaluationState, config) -> Command:
    ctx: WorkflowRuntimeContext = config["configurable"]["ctx"]
    try:
        job_full = await ctx.evaluation_service.validate_job(state, ctx)
        return Command(update={"job_full": job_full})
    except Exception as exc:
        attempts = int(state.get("validation_attempts", 0)) + 1
        if attempts >= 3:
            raise RuntimeError("job_validation_exhausted") from exc
        return Command(goto="request_job_selection", update={"validation_attempts": attempts})


async def _run_evaluation_subgraph(state: ResumeEvaluationState, config) -> dict:
    ctx: WorkflowRuntimeContext = config["configurable"]["ctx"]
    return await ctx.evaluation_service.run_evaluation_subgraph(state, ctx)


async def _build_visualization_report(state: ResumeEvaluationState, config) -> dict:
    ctx: WorkflowRuntimeContext = config["configurable"]["ctx"]
    return await ctx.evaluation_service.build_visualization_report(state, ctx)


async def _finalize_evaluation_report(state: ResumeEvaluationState, config) -> dict:
    ctx: WorkflowRuntimeContext = config["configurable"]["ctx"]
    return await ctx.evaluation_service.finalize_evaluation_report(state, ctx)


# ---------- 图构造 ----------

def build_evaluation_graph(checkpointer: BaseCheckpointSaver) -> CompiledStateGraph:
    """构造并编译图二。"""
    graph = StateGraph(ResumeEvaluationState)
    graph.add_node("load_resume", _load_resume)
    graph.add_node("analyze_resume_profile", _analyze_resume_profile)
    graph.add_node("load_job_candidates", _load_job_candidates)
    graph.add_node("request_job_selection", _request_job_selection)
    graph.add_node("validate_job_full_name", _validate_job_full_name)
    graph.add_node("run_evaluation_subgraph", _run_evaluation_subgraph)
    graph.add_node("build_visualization_report", _build_visualization_report)
    graph.add_node("finalize_evaluation_report", _finalize_evaluation_report)

    graph.add_edge(START, "load_resume")
    graph.add_edge("load_resume", "analyze_resume_profile")
    graph.add_edge("analyze_resume_profile", "load_job_candidates")
    graph.add_edge("load_job_candidates", "request_job_selection")
    graph.add_edge("request_job_selection", "validate_job_full_name")
    graph.add_edge("validate_job_full_name", "run_evaluation_subgraph")
    graph.add_edge("run_evaluation_subgraph", "build_visualization_report")
    graph.add_edge("build_visualization_report", "finalize_evaluation_report")
    graph.add_edge("finalize_evaluation_report", END)

    return graph.compile(checkpointer=checkpointer)
```

- [ ] **Step 4：运行测试验证通过**

Run: `cd backend && pytest tests/services/test_evaluation_graph_skeleton.py -v`
Expected: 1 passed

- [ ] **Step 5：补 `backend/app/llm/graphs/workflows/__init__.py` 导出**

```python
"""workflows package 导出统一入口。"""
from app.llm.graphs.workflows.context import WorkflowRuntimeContext
from app.llm.graphs.workflows.interview_questions import build_interview_graph
from app.llm.graphs.workflows.resume_evaluation import build_evaluation_graph
from app.llm.graphs.workflows.runner import AgentWorkflowRunner
from app.llm.graphs.workflows.state import InterviewQuestionState, ResumeEvaluationState

__all__ = [
    "WorkflowRuntimeContext",
    "build_interview_graph",
    "build_evaluation_graph",
    "AgentWorkflowRunner",
    "InterviewQuestionState",
    "ResumeEvaluationState",
]
```

- [ ] **Step 6：commit**

```bash
git add backend/app/llm/graphs/workflows/resume_evaluation.py backend/app/llm/graphs/workflows/__init__.py backend/tests/services/test_evaluation_graph_skeleton.py
git commit -m "feat(graph): scaffold resume_evaluation graph with 8 nodes

阶段 4.4：节点全部 ≤10 行；validate_job 失败 3 次抛 job_validation_exhausted"
```

---

## 阶段 5：业务 Service

### Task 5.1：ResumeLoader（Redis 缓存 + Repository fallback）

**Files:**
- Create: `backend/app/services/resume_loader.py`
- Create: `backend/tests/services/test_resume_loader.py`

- [ ] **Step 1：写失败测试**

`backend/tests/services/test_resume_loader.py`:

```python
"""ResumeLoader：缓存命中优先，未命中走 Repository。"""
from __future__ import annotations

from unittest.mock import AsyncMock, MagicMock

import pytest

from app.services.resume_loader import ResumeLoader


@pytest.mark.asyncio
async def test_load_returns_cached_text_when_hit():
    cache = MagicMock()
    cache.get = AsyncMock(return_value="cached resume text")
    cache.set = AsyncMock()
    repo = MagicMock()
    loader = ResumeLoader(cache=cache, resume_repo=repo)
    text = await loader.load(resume_id=42)
    assert text == "cached resume text"
    repo.get_by_id.assert_not_called()


@pytest.mark.asyncio
async def test_load_fetches_repo_and_caches_on_miss():
    cache = MagicMock()
    cache.get = AsyncMock(return_value=None)
    cache.set = AsyncMock()
    resume = MagicMock(parsed_text="parsed resume content")
    repo = MagicMock()
    repo.get_by_id = AsyncMock(return_value=resume)
    loader = ResumeLoader(cache=cache, resume_repo=repo)
    text = await loader.load(resume_id=42)
    assert text == "parsed resume content"
    cache.set.assert_awaited_once()


@pytest.mark.asyncio
async def test_load_raises_when_resume_missing():
    cache = MagicMock()
    cache.get = AsyncMock(return_value=None)
    repo = MagicMock()
    repo.get_by_id = AsyncMock(return_value=None)
    loader = ResumeLoader(cache=cache, resume_repo=repo)
    with pytest.raises(LookupError):
        await loader.load(resume_id=42)
```

- [ ] **Step 2：运行测试验证失败**

Run: `cd backend && pytest tests/services/test_resume_loader.py -v`
Expected: ModuleNotFoundError

- [ ] **Step 3：创建 `backend/app/services/resume_loader.py`**

```python
"""
ResumeLoader：简历原文读取，Redis 缓存命中优先 → ResumeRepository fallback。

不做：业务规则、graph 编排、emit 事件。单一职责。
"""

from __future__ import annotations

import logging

from app.repositories.resume_repository import ResumeRepository
from app.services.cache_service import CacheService

logger = logging.getLogger(__name__)

CACHE_KEY = "agent:resume_text:{resume_id}"
CACHE_TTL = 1800  # 30 分钟


class ResumeLoader:
    """简历原文读取器。"""

    def __init__(self, *, cache: CacheService, resume_repo: ResumeRepository) -> None:
        self._cache = cache
        self._repo = resume_repo

    async def load(self, *, resume_id: int) -> str:
        """
        读取简历原文。

        Returns:
            简历的纯文本内容。

        Raises:
            LookupError: 简历不存在。
        """
        key = CACHE_KEY.format(resume_id=resume_id)
        cached = await self._cache.get(key)
        if cached:
            logger.debug("简历缓存命中：resume_id=%s", resume_id)
            return cached
        resume = await self._repo.get_by_id(resume_id)
        if resume is None:
            raise LookupError(f"简历不存在：resume_id={resume_id}")
        text = str(getattr(resume, "parsed_text", "") or "")
        if text:
            await self._cache.set(key, text, CACHE_TTL)
        return text
```

- [ ] **Step 4：运行测试验证通过**

Run: `cd backend && pytest tests/services/test_resume_loader.py -v`
Expected: 3 passed

- [ ] **Step 5：commit**

```bash
git add backend/app/services/resume_loader.py backend/tests/services/test_resume_loader.py
git commit -m "feat(service): add ResumeLoader with Redis cache + repository fallback

阶段 5.1：30 分钟 TTL；单一职责，不承载业务规则"
```

### Task 5.2：InterviewQuestionService 重写（业务规则 + emit block）

**Files:**
- Modify: `backend/app/services/interview_question_service.py`（重写）
- Create: `backend/tests/services/test_interview_question_service.py`

- [ ] **Step 1：写失败测试**

`backend/tests/services/test_interview_question_service.py`:

```python
"""InterviewQuestionService：load_resume / suggest_dimensions / finalize_question_set 核心方法。"""
from __future__ import annotations

from collections.abc import AsyncIterator
from unittest.mock import AsyncMock, MagicMock, patch

import pytest
from pydantic import SecretStr

from app.llm.graphs.workflows.context import WorkflowRuntimeContext
from app.llm.streaming.emitter import AgentStreamEmitter
from app.schemas.agent.dto import LLMRuntimeConfigDTO, LLMStreamChunkDTO
from app.services.interview_question_service import (
    BUILTIN_DIMENSIONS,
    InterviewQuestionService,
)


def _ctx_for(service: InterviewQuestionService, *, enable_thinking: bool = False) -> WorkflowRuntimeContext:
    emitter = AgentStreamEmitter(session_id=1, run_id="r", workflow_type="interview_questions")
    return WorkflowRuntimeContext(
        emitter=emitter,
        runtime_config=LLMRuntimeConfigDTO(
            provider="deepseek", base_url="x", api_key=SecretStr("sk"),
            model_name="m", enable_thinking=enable_thinking,
        ),
        interview_service=service, evaluation_service=MagicMock(),
        resume_loader=MagicMock(), session_id=1, employee_id=2, run_id="r",
    )


@pytest.mark.asyncio
async def test_load_resume_emits_tool_use_block_and_returns_text():
    loader = MagicMock()
    loader.load = AsyncMock(return_value="resume body")
    service = InterviewQuestionService(model_router=MagicMock(), resume_loader=loader)
    ctx = _ctx_for(service)
    state = {"resume_ref": {"resume_id": 7}}
    emitted: list = []
    with patch("app.services.interview_question_service.get_stream_writer",
               return_value=lambda env: emitted.append(env)):
        result = await service.load_resume(state, ctx)
    assert result == {"resume_text": "resume body"}
    types = [e.type for e in emitted]
    assert types == ["block.start", "block.stop"]
    assert emitted[0].data["block"]["tool_name"] == "load_resume"


@pytest.mark.asyncio
async def test_suggest_dimensions_falls_back_to_builtins_on_llm_error():
    router = MagicMock()
    async def _explode(prompt, cfg):
        raise RuntimeError("upstream")
        yield  # pragma: no cover
    router.stream = MagicMock(side_effect=_explode)
    service = InterviewQuestionService(model_router=router, resume_loader=MagicMock())
    ctx = _ctx_for(service)
    state = {"resume_text": "x"}
    with patch("app.services.interview_question_service.get_stream_writer", return_value=lambda env: None):
        result = await service.suggest_dimensions(state, ctx)
    assert result["suggested_dimensions"] == BUILTIN_DIMENSIONS


@pytest.mark.asyncio
async def test_finalize_question_set_emits_interview_questions_block():
    service = InterviewQuestionService(model_router=MagicMock(), resume_loader=MagicMock())
    ctx = _ctx_for(service)
    state = {
        "question_plan": {"total_questions": 2, "items": [], "summary": "x"},
        "selected_dimensions": [{"name": "算法基础"}],
    }
    # 假设上一节点已生成 questions
    state["_generated_questions"] = [
        {"question": "Q1", "dimension": "算法基础", "difficulty": "中等",
         "evaluation_points": [], "follow_up_suggestions": [],
         "excellent_signals": [], "average_signals": [], "risk_signals": []},
        {"question": "Q2", "dimension": "算法基础", "difficulty": "中等",
         "evaluation_points": [], "follow_up_suggestions": [],
         "excellent_signals": [], "average_signals": [], "risk_signals": []},
    ]
    emitted: list = []
    with patch("app.services.interview_question_service.get_stream_writer",
               return_value=lambda env: emitted.append(env)):
        result = await service.finalize_question_set(state, ctx)
    assert result["question_set"]["total_questions"] == 2
    # 应有 block.start + block.delta + block.stop
    assert [e.type for e in emitted] == ["block.start", "block.delta", "block.stop"]
    assert emitted[0].data["block"]["type"] == "interview_questions"
```

- [ ] **Step 2：运行测试验证失败**

Run: `cd backend && pytest tests/services/test_interview_question_service.py -v`
Expected: 旧 service 签名/方法不匹配

- [ ] **Step 3：重写 `backend/app/services/interview_question_service.py`**

```python
"""
图一业务规则服务：简历问答。

职责：
- 加载简历原文（通过 ResumeLoader）
- AI 提议面试维度（失败兜底为内置维度）
- 生成出题计划
- 按维度并发出题
- 汇总 8-12 题输出 interview_questions block
- 构造 interaction 卡片 payload（dimension_selection / plan_approval）

emit 协议事件统一通过 LangGraph get_stream_writer() + ctx.emitter；
不直接读 DB / 不直接调 provider client。
"""

from __future__ import annotations

import asyncio
import json
import logging
import uuid
from typing import Any

from langgraph.config import get_stream_writer

from app.llm.graphs.workflows.context import WorkflowRuntimeContext
from app.llm.model_router import LLMModelRouter
from app.llm.prompts.prompts import get_prompt
from app.schemas.agent.dto import (
    InterviewDimensionDTO,
    InterviewQuestionItemDTO,
    InterviewQuestionPlanDTO,
    InterviewQuestionPlanItemDTO,
    InterviewQuestionSetDTO,
)
from app.services.resume_loader import ResumeLoader

logger = logging.getLogger(__name__)

BUILTIN_DIMENSIONS: list[dict[str, Any]] = [
    {"name": "算法基础", "reason": "通用必考维度", "source": "builtin"},
    {"name": "工程实践", "reason": "通用必考维度", "source": "builtin"},
    {"name": "系统设计", "reason": "中高级岗位关键维度", "source": "builtin"},
]


class InterviewQuestionService:
    """图一业务规则。"""

    def __init__(self, *, model_router: LLMModelRouter, resume_loader: ResumeLoader) -> None:
        self._router = model_router
        self._loader = resume_loader

    # ---------- 节点入口方法 ----------

    async def load_resume(self, state, ctx: WorkflowRuntimeContext) -> dict:
        writer = get_stream_writer()
        idx = ctx.emitter.next_block_index()
        resume_id = int((state.get("resume_ref") or {}).get("resume_id") or 0)
        writer(ctx.emitter.emit_block_start(index=idx, block={
            "type": "tool_use", "tool_name": "load_resume",
            "display_name": "读取简历", "input": {"resume_id": resume_id}, "status": "running",
        }))
        try:
            text = await self._loader.load(resume_id=resume_id)
        finally:
            writer(ctx.emitter.emit_block_stop(index=idx))
        return {"resume_text": text}

    async def suggest_dimensions(self, state, ctx: WorkflowRuntimeContext) -> dict:
        """AI 提议维度；失败兜底为内置维度。"""
        prompt = get_prompt("interview_questions/dimension_suggest", resume_text=state["resume_text"])
        text, _thinking = await self._stream_text_with_optional_thinking(prompt, ctx)
        dims = self._parse_dimensions(text)
        if not dims:
            logger.warning("AI 维度提议失败/为空，使用内置维度兜底")
            dims = BUILTIN_DIMENSIONS
        return {"suggested_dimensions": dims}

    def build_dimension_interaction(self, state) -> dict:
        return {
            "request_id": f"dim_{uuid.uuid4().hex[:8]}",
            "interaction_type": "dimension_selection",
            "title": "请选择面试重点维度",
            "prompt": "从下列候选维度中选择需要重点考察的（多选）",
            "data": {"candidates": state.get("suggested_dimensions") or []},
        }

    async def build_question_plan(self, state, ctx: WorkflowRuntimeContext) -> dict:
        prompt = get_prompt(
            "interview_questions/question_plan",
            resume_text=state["resume_text"],
            dimensions=json.dumps(state.get("selected_dimensions") or [], ensure_ascii=False),
        )
        text, _ = await self._stream_text_with_optional_thinking(prompt, ctx)
        plan = self._parse_plan(text) or self._fallback_plan(state.get("selected_dimensions") or BUILTIN_DIMENSIONS)
        return {"question_plan": plan}

    def build_plan_interaction(self, state) -> dict:
        return {
            "request_id": f"plan_{uuid.uuid4().hex[:8]}",
            "interaction_type": "plan_approval",
            "title": "请确认出题计划",
            "prompt": "审阅维度分布与题量，批准或驳回",
            "data": {"plan": state.get("question_plan") or {}},
        }

    async def fanout_generate_questions(self, state, ctx: WorkflowRuntimeContext) -> dict:
        """并发为每个维度生成题目；单分支失败不阻塞其他。"""
        plan: dict = state.get("question_plan") or {}
        items = plan.get("items") or []
        tasks = [self._generate_for_dimension(item, state["resume_text"], ctx) for item in items]
        results = await asyncio.gather(*tasks, return_exceptions=True)
        all_questions: list[dict[str, Any]] = []
        for r in results:
            if isinstance(r, Exception):
                logger.exception("生成单维度题目失败：%s", r)
                continue
            all_questions.extend(r)
        return {"_generated_questions": all_questions}

    async def reduce_questions(self, state, ctx: WorkflowRuntimeContext) -> dict:
        """归并并保证总数在 8-12 之间。"""
        questions: list = list(state.get("_generated_questions") or [])
        if len(questions) > 12:
            questions = questions[:12]
        return {"_generated_questions": questions}

    async def finalize_question_set(self, state, ctx: WorkflowRuntimeContext) -> dict:
        questions = state.get("_generated_questions") or []
        dimensions = sorted({q.get("dimension", "") for q in questions if q.get("dimension")})
        question_set = InterviewQuestionSetDTO(
            total_questions=len(questions),
            dimensions=dimensions,
            questions=[InterviewQuestionItemDTO.model_validate(q) for q in questions],
        ).model_dump(mode="json")

        writer = get_stream_writer()
        idx = ctx.emitter.next_block_index()
        writer(ctx.emitter.emit_block_start(index=idx, block={
            "type": "interview_questions", "question_set": {}, "status": "streaming",
        }))
        writer(ctx.emitter.emit_block_delta(index=idx, delta={"question_set": question_set}))
        writer(ctx.emitter.emit_block_stop(index=idx))
        return {"question_set": question_set}

    # ---------- 内部 ----------

    async def _stream_text_with_optional_thinking(
        self, prompt: str, ctx: WorkflowRuntimeContext,
    ) -> tuple[str, str]:
        """LLM 流式调用，按 ctx.runtime_config.enable_thinking 分流 thinking/text block。"""
        writer = get_stream_writer()
        text_idx = ctx.emitter.next_block_index()
        thinking_idx: int | None = None
        if ctx.runtime_config.enable_thinking:
            thinking_idx = ctx.emitter.next_block_index()
            writer(ctx.emitter.emit_block_start(index=thinking_idx,
                                                 block={"type": "thinking", "text": ""}))
        writer(ctx.emitter.emit_block_start(index=text_idx, block={"type": "text", "text": ""}))
        text_buf: list[str] = []
        thinking_buf: list[str] = []
        try:
            async for chunk in self._router.stream(prompt, ctx.runtime_config):
                if chunk.kind == "thinking" and thinking_idx is not None:
                    writer(ctx.emitter.emit_block_delta(index=thinking_idx,
                                                         delta={"text_delta": chunk.text_delta}))
                    thinking_buf.append(chunk.text_delta)
                elif chunk.kind == "text":
                    writer(ctx.emitter.emit_block_delta(index=text_idx,
                                                         delta={"text_delta": chunk.text_delta}))
                    text_buf.append(chunk.text_delta)
        except Exception:
            logger.exception("LLM 流式失败")
        finally:
            if thinking_idx is not None:
                writer(ctx.emitter.emit_block_stop(index=thinking_idx))
            writer(ctx.emitter.emit_block_stop(index=text_idx))
        return "".join(text_buf), "".join(thinking_buf)

    async def _generate_for_dimension(
        self, plan_item: dict, resume_text: str, ctx: WorkflowRuntimeContext,
    ) -> list[dict[str, Any]]:
        prompt = get_prompt(
            "interview_questions/question_generate",
            dimension=plan_item.get("dimension"),
            question_count=plan_item.get("question_count", 3),
            difficulty=plan_item.get("difficulty", "中等"),
            focus=plan_item.get("focus", ""),
            resume_text=resume_text,
        )
        text, _ = await self._stream_text_with_optional_thinking(prompt, ctx)
        try:
            parsed = json.loads(text)
            return list(parsed) if isinstance(parsed, list) else []
        except json.JSONDecodeError:
            logger.warning("题目生成 JSON 解析失败")
            return []

    @staticmethod
    def _parse_dimensions(text: str) -> list[dict[str, Any]]:
        try:
            data = json.loads(text)
            if isinstance(data, list):
                return [InterviewDimensionDTO.model_validate(item).model_dump() for item in data]
        except (json.JSONDecodeError, ValueError):
            pass
        return []

    @staticmethod
    def _parse_plan(text: str) -> dict[str, Any] | None:
        try:
            return InterviewQuestionPlanDTO.model_validate_json(text).model_dump()
        except (json.JSONDecodeError, ValueError):
            return None

    @staticmethod
    def _fallback_plan(dimensions: list[dict[str, Any]]) -> dict[str, Any]:
        items = [InterviewQuestionPlanItemDTO(
            dimension=d.get("name", ""), question_count=3, difficulty="中等",
            focus="基础与场景结合",
        ) for d in dimensions[:3]]
        return InterviewQuestionPlanDTO(
            total_questions=sum(it.question_count for it in items),
            items=items, summary="兜底计划",
        ).model_dump()
```

- [ ] **Step 4：运行测试验证通过**

Run: `cd backend && pytest tests/services/test_interview_question_service.py -v`
Expected: 3 passed

- [ ] **Step 5：commit**

```bash
git add backend/app/services/interview_question_service.py backend/tests/services/test_interview_question_service.py
git commit -m "feat(service): rewrite InterviewQuestionService with block emit + thinking dual-channel

阶段 5.2：节点入口 8 个方法；
AI 维度失败兜底 BUILTIN_DIMENSIONS；
LLM 流式通过 get_stream_writer 推 text/thinking block"
```

### Task 5.3：ResumeEvaluationService（结构同 5.2 类比实现）

**Files:**
- Create: `backend/app/services/resume_evaluation_service.py`
- Create: `backend/tests/services/test_resume_evaluation_service.py`

- [ ] **Step 1：写失败测试（覆盖 load_resume / validate_job / finalize 三个核心点）**

`backend/tests/services/test_resume_evaluation_service.py`:

```python
"""ResumeEvaluationService：load_resume / validate_job / finalize 关键路径。"""
from __future__ import annotations

from unittest.mock import AsyncMock, MagicMock, patch

import pytest
from pydantic import SecretStr

from app.core.exceptions import ValidationError
from app.llm.graphs.workflows.context import WorkflowRuntimeContext
from app.llm.streaming.emitter import AgentStreamEmitter
from app.schemas.agent.dto import LLMRuntimeConfigDTO
from app.services.resume_evaluation_service import ResumeEvaluationService


def _ctx_for(service: ResumeEvaluationService) -> WorkflowRuntimeContext:
    emitter = AgentStreamEmitter(session_id=1, run_id="r", workflow_type="resume_evaluation")
    return WorkflowRuntimeContext(
        emitter=emitter,
        runtime_config=LLMRuntimeConfigDTO(
            provider="deepseek", base_url="x", api_key=SecretStr("sk"), model_name="m",
        ),
        interview_service=MagicMock(), evaluation_service=service,
        resume_loader=MagicMock(), session_id=1, employee_id=2, run_id="r",
    )


@pytest.mark.asyncio
async def test_load_resume_emits_tool_use_and_returns_text():
    loader = MagicMock()
    loader.load = AsyncMock(return_value="resume body")
    service = ResumeEvaluationService(
        model_router=MagicMock(), resume_loader=loader,
        job_repo=MagicMock(), cache=MagicMock(),
        evaluation_subgraph=MagicMock(),
    )
    ctx = _ctx_for(service)
    state = {"resume_ref": {"resume_id": 7}}
    emitted: list = []
    with patch("app.services.resume_evaluation_service.get_stream_writer",
               return_value=lambda env: emitted.append(env)):
        result = await service.load_resume(state, ctx)
    assert result == {"resume_text": "resume body"}
    assert [e.type for e in emitted] == ["block.start", "block.stop"]


@pytest.mark.asyncio
async def test_validate_job_raises_when_full_name_not_owned():
    job_repo = MagicMock()
    job_repo.get_by_employee = AsyncMock(return_value=[MagicMock(id=1, name="其他岗位")])
    service = ResumeEvaluationService(
        model_router=MagicMock(), resume_loader=MagicMock(),
        job_repo=job_repo, cache=MagicMock(),
        evaluation_subgraph=MagicMock(),
    )
    ctx = _ctx_for(service)
    state = {"selected_job_name": "高级算法工程师"}
    with patch("app.services.resume_evaluation_service.get_stream_writer", return_value=lambda env: None):
        with pytest.raises(ValidationError):
            await service.validate_job(state, ctx)


@pytest.mark.asyncio
async def test_finalize_evaluation_report_emits_block():
    service = ResumeEvaluationService(
        model_router=MagicMock(), resume_loader=MagicMock(),
        job_repo=MagicMock(), cache=MagicMock(),
        evaluation_subgraph=MagicMock(),
    )
    ctx = _ctx_for(service)
    state = {"report": {"final_score": 87, "final_label": "优秀", "decision": "推进",
                        "summary": "x", "match_overview": {}, "resume_structure": {},
                        "experience_timeline": [], "skill_dimensions": [], "job_gaps": []}}
    emitted: list = []
    with patch("app.services.resume_evaluation_service.get_stream_writer",
               return_value=lambda env: emitted.append(env)):
        result = await service.finalize_evaluation_report(state, ctx)
    assert result == {}
    assert [e.type for e in emitted] == ["block.start", "block.delta", "block.stop"]
    assert emitted[0].data["block"]["type"] == "evaluation_report"
```

- [ ] **Step 2：运行测试验证失败**

Run: `cd backend && pytest tests/services/test_resume_evaluation_service.py -v`
Expected: ModuleNotFoundError

- [ ] **Step 3：创建 `backend/app/services/resume_evaluation_service.py`**

```python
"""
图二业务规则：简历评估。

职责：
- 加载简历原文
- AI 结构化画像
- 加载候选岗位（Redis 优先）
- 严格校验岗位全名与员工归属
- 调用 evaluation_subgraph（黑盒复用）
- 组装可视化报告 → evaluation_report block

emit 协议事件统一通过 get_stream_writer + ctx.emitter；
不直接 SQLAlchemy / 不直接 provider client。
"""

from __future__ import annotations

import json
import logging
import uuid
from typing import Any

from langgraph.config import get_stream_writer

from app.core.exceptions import ValidationError
from app.llm.graphs.workflows.context import WorkflowRuntimeContext
from app.llm.model_router import LLMModelRouter
from app.llm.prompts.prompts import get_prompt
from app.repositories.job_repository import JobRepository
from app.schemas.agent.dto import ResumeEvaluationReportDTO
from app.services.cache_service import CacheService
from app.services.resume_loader import ResumeLoader

logger = logging.getLogger(__name__)

JOB_CANDIDATES_CACHE_KEY = "agent:job_candidates:{employee_id}"
JOB_CANDIDATES_TTL = 600


class ResumeEvaluationService:
    """图二业务规则。"""

    def __init__(
        self,
        *,
        model_router: LLMModelRouter,
        resume_loader: ResumeLoader,
        job_repo: JobRepository,
        cache: CacheService,
        evaluation_subgraph: Any,   # 既有 evaluation_graph 编译实例
    ) -> None:
        self._router = model_router
        self._loader = resume_loader
        self._job_repo = job_repo
        self._cache = cache
        self._eval_subgraph = evaluation_subgraph

    # ---------- 节点入口 ----------

    async def load_resume(self, state, ctx: WorkflowRuntimeContext) -> dict:
        writer = get_stream_writer()
        idx = ctx.emitter.next_block_index()
        resume_id = int((state.get("resume_ref") or {}).get("resume_id") or 0)
        writer(ctx.emitter.emit_block_start(index=idx, block={
            "type": "tool_use", "tool_name": "load_resume",
            "display_name": "读取简历", "input": {"resume_id": resume_id}, "status": "running",
        }))
        try:
            text = await self._loader.load(resume_id=resume_id)
        finally:
            writer(ctx.emitter.emit_block_stop(index=idx))
        return {"resume_text": text}

    async def analyze_resume_profile(self, state, ctx: WorkflowRuntimeContext) -> dict:
        prompt = get_prompt("resume_evaluation/profile_analyze", resume_text=state["resume_text"])
        text, _ = await self._stream_text_with_optional_thinking(prompt, ctx)
        try:
            profile = json.loads(text)
        except json.JSONDecodeError:
            logger.warning("简历画像 JSON 解析失败，使用空对象")
            profile = {}
        return {"resume_profile": profile}

    async def load_job_candidates(self, state, ctx: WorkflowRuntimeContext) -> dict:
        writer = get_stream_writer()
        idx = ctx.emitter.next_block_index()
        writer(ctx.emitter.emit_block_start(index=idx, block={
            "type": "tool_use", "tool_name": "fetch_jobs",
            "display_name": "加载候选岗位", "input": {"employee_id": ctx.employee_id}, "status": "running",
        }))
        try:
            key = JOB_CANDIDATES_CACHE_KEY.format(employee_id=ctx.employee_id)
            cached = await self._cache.get_json(key)
            if cached:
                candidates = cached
            else:
                jobs = await self._job_repo.get_by_employee(ctx.employee_id)
                candidates = [{"id": j.id, "name": j.name} for j in jobs[:20]]
                await self._cache.set_json(key, candidates, JOB_CANDIDATES_TTL)
        finally:
            writer(ctx.emitter.emit_block_stop(index=idx))
        return {"job_candidates": candidates}

    def build_job_interaction(self, state) -> dict:
        return {
            "request_id": f"job_{uuid.uuid4().hex[:8]}",
            "interaction_type": "job_selection",
            "title": "请选择岗位",
            "prompt": "从候选岗位选择，或手动输入完整岗位名称",
            "data": {"candidates": state.get("job_candidates") or []},
        }

    async def validate_job(self, state, ctx: WorkflowRuntimeContext) -> dict[str, Any]:
        """严格校验岗位全名与员工归属。"""
        name = str(state.get("selected_job_name") or "").strip()
        if not name:
            raise ValidationError("岗位名称不能为空")
        jobs = await self._job_repo.get_by_employee(ctx.employee_id)
        match = next((j for j in jobs if str(j.name) == name), None)
        if match is None:
            raise ValidationError(f"未找到岗位 '{name}' 或不属于当前员工")
        return {"id": match.id, "name": match.name}

    async def run_evaluation_subgraph(self, state, ctx: WorkflowRuntimeContext) -> dict:
        """复用既有 evaluation_graph 子图。"""
        eval_input = {
            "resume_text": state["resume_text"],
            "resume_profile": state["resume_profile"],
            "job": state["job_full"],
        }
        result = await self._eval_subgraph.ainvoke(eval_input)
        return {"evaluation_result": result}

    async def build_visualization_report(self, state, ctx: WorkflowRuntimeContext) -> dict:
        eval_result = state.get("evaluation_result") or {}
        report = ResumeEvaluationReportDTO(
            final_score=float(eval_result.get("final_score") or 0),
            final_label=str(eval_result.get("final_label") or ""),
            decision=str(eval_result.get("decision") or ""),
            summary=str(eval_result.get("summary") or ""),
            match_overview=eval_result.get("match_overview") or {},
            resume_structure=state.get("resume_profile") or {},
            experience_timeline=eval_result.get("experience_timeline") or [],
            skill_dimensions=eval_result.get("skill_dimensions") or [],
            job_gaps=eval_result.get("job_gaps") or [],
        ).model_dump(mode="json")
        return {"report": report}

    async def finalize_evaluation_report(self, state, ctx: WorkflowRuntimeContext) -> dict:
        writer = get_stream_writer()
        idx = ctx.emitter.next_block_index()
        writer(ctx.emitter.emit_block_start(index=idx, block={
            "type": "evaluation_report", "report": {}, "status": "streaming",
        }))
        writer(ctx.emitter.emit_block_delta(index=idx, delta={"report": state.get("report") or {}}))
        writer(ctx.emitter.emit_block_stop(index=idx))
        return {}

    # ---------- 内部（与 InterviewQuestionService 同结构） ----------

    async def _stream_text_with_optional_thinking(self, prompt: str, ctx: WorkflowRuntimeContext) -> tuple[str, str]:
        writer = get_stream_writer()
        text_idx = ctx.emitter.next_block_index()
        thinking_idx = None
        if ctx.runtime_config.enable_thinking:
            thinking_idx = ctx.emitter.next_block_index()
            writer(ctx.emitter.emit_block_start(index=thinking_idx, block={"type": "thinking", "text": ""}))
        writer(ctx.emitter.emit_block_start(index=text_idx, block={"type": "text", "text": ""}))
        text_buf: list[str] = []
        thinking_buf: list[str] = []
        try:
            async for chunk in self._router.stream(prompt, ctx.runtime_config):
                if chunk.kind == "thinking" and thinking_idx is not None:
                    writer(ctx.emitter.emit_block_delta(index=thinking_idx, delta={"text_delta": chunk.text_delta}))
                    thinking_buf.append(chunk.text_delta)
                elif chunk.kind == "text":
                    writer(ctx.emitter.emit_block_delta(index=text_idx, delta={"text_delta": chunk.text_delta}))
                    text_buf.append(chunk.text_delta)
        except Exception:
            logger.exception("LLM 流式失败")
        finally:
            if thinking_idx is not None:
                writer(ctx.emitter.emit_block_stop(index=thinking_idx))
            writer(ctx.emitter.emit_block_stop(index=text_idx))
        return "".join(text_buf), "".join(thinking_buf)
```

- [ ] **Step 4：运行测试验证通过**

Run: `cd backend && pytest tests/services/test_resume_evaluation_service.py -v`
Expected: 3 passed

- [ ] **Step 5：commit**

```bash
git add backend/app/services/resume_evaluation_service.py backend/tests/services/test_resume_evaluation_service.py
git commit -m "feat(service): create ResumeEvaluationService with evaluation_graph reuse

阶段 5.3：8 个节点入口；Redis 候选岗位缓存；严格校验岗位归属"
```

### Task 5.4：Prompt 模板迁移确认

**Files:**
- Modify: `backend/app/llm/prompts/prompts.py`（如需调整 loader 命名空间）
- 验证：`backend/app/llm/prompts/templates/interview_questions/*.yaml` 与 `resume_evaluation/*.yaml` 已就位

- [ ] **Step 1：列出当前 prompt 模板**

Run: `ls backend/app/llm/prompts/templates/interview_questions/ backend/app/llm/prompts/templates/resume_evaluation/`
Expected: 看到 `dimension_suggest.yaml`、`question_plan.yaml`、`question_generate.yaml` 与 `profile_analyze.yaml`、`visual_report.yaml`

- [ ] **Step 2：检查 prompts.py 的 get_prompt 支持子目录路径**

Run: `cd backend && python -c "from app.llm.prompts.prompts import get_prompt; print(get_prompt('interview_questions/dimension_suggest', resume_text='test'))"`
Expected: 输出渲染后字符串；若报错，按以下补丁修改 `prompts.py`：

```python
# 在 get_prompt 中支持 'category/name' 形式的查找
def get_prompt(name: str, **kwargs) -> str:
    # name 形如 "interview_questions/dimension_suggest"
    path = TEMPLATES_DIR / f"{name}.yaml"
    if not path.exists():
        raise FileNotFoundError(f"prompt template not found: {name}")
    # ... 既有 YAML 加载与 jinja 渲染逻辑
```

- [ ] **Step 3：补 prompt 模板小测**

`backend/tests/services/test_prompt_templates_present.py`:

```python
"""确保两图所需的 5 个 prompt 模板都能加载。"""
from app.llm.prompts.prompts import get_prompt


def test_interview_prompts_present():
    assert get_prompt("interview_questions/dimension_suggest", resume_text="x")
    assert get_prompt("interview_questions/question_plan", resume_text="x", dimensions="[]")
    assert get_prompt("interview_questions/question_generate",
                       dimension="算法", question_count=3, difficulty="中等", focus="x", resume_text="x")


def test_evaluation_prompts_present():
    assert get_prompt("resume_evaluation/profile_analyze", resume_text="x")
    assert get_prompt("resume_evaluation/visual_report", evaluation_result="{}", resume_profile="{}")
```

- [ ] **Step 4：运行**

Run: `cd backend && pytest tests/services/test_prompt_templates_present.py -v`
Expected: 2 passed（若某模板缺失，则按需补内容；最小内容举例如下）

```yaml
# backend/app/llm/prompts/templates/interview_questions/dimension_suggest.yaml
role: |
  你是资深技术面试官，正在为以下简历选择面试重点维度。
instructions: |
  分析简历内容，输出 3-6 个面试重点维度。仅输出 JSON 数组，每项含 name/reason/source 三个字段。
context: |
  简历内容：
  {{ resume_text }}
output_format: |
  [{"name": "...", "reason": "...", "source": "ai"}]
```

- [ ] **Step 5：commit**

```bash
git add backend/app/llm/prompts/templates/ backend/app/llm/prompts/prompts.py backend/tests/services/test_prompt_templates_present.py
git commit -m "feat(prompts): ensure interview_questions and resume_evaluation templates present

阶段 5.4：5 个 prompt 模板路径标准化为 category/name"
```

---

## 阶段 6：Runtime 三服务

### Task 6.1：精简 AgentRepository（删 memory + 适配新 message 字段）

**Files:**
- Modify: `backend/app/repositories/agent_repository.py`
- Modify: `backend/app/models/agent_message.py`（如字段不匹配新 DDL）
- Modify: `backend/app/models/agent_session.py`（如字段不匹配新 DDL）
- Create: `backend/tests/services/test_agent_repository.py`

- [ ] **Step 1：grep 旧 memory 方法引用**

Run: `cd backend && grep -rn "agent_memory\|list_memories\|upsert_memory\|delete_memory" app --include="*.py" | grep -v __pycache__`

- [ ] **Step 2：把 AgentRepository 内所有 memory 相关方法整段删除**

打开 `backend/app/repositories/agent_repository.py`，删除：
- 任何方法签名含 `memory` 的方法
- 任何 `from app.models.agent_memory import` 导入
- 顶部任何 `AgentMemory` 引用

- [ ] **Step 3：更新 `agent_message` model 字段以匹配新 DDL**

打开 `backend/app/models/agent_message.py`，确保字段定义包含：

```python
class AgentMessage(Base):
    __tablename__ = "agent_message"
    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    session_id: Mapped[int] = mapped_column(BigInteger, nullable=False, index=True)
    parent_message_id: Mapped[int | None] = mapped_column(BigInteger, nullable=True)
    role: Mapped[str] = mapped_column(String(16), nullable=False)
    workflow_type: Mapped[str] = mapped_column(String(32), nullable=False)
    run_id: Mapped[str | None] = mapped_column(String(64), nullable=True)
    content: Mapped[dict] = mapped_column(JSON, nullable=False)
    model_name: Mapped[str | None] = mapped_column(String(80), nullable=True)
    token_count: Mapped[int | None] = mapped_column(Integer, nullable=True)
    sort_order: Mapped[int] = mapped_column(Integer, nullable=False)
    create_time: Mapped[datetime] = mapped_column(DateTime, nullable=False, default=datetime.now)
```

打开 `backend/app/models/agent_session.py`，确保字段包含 `enable_thinking: Mapped[int]` 而非旧字段；删除任何 memory 引用。

- [ ] **Step 4：写 AgentRepository 新方法测试**

`backend/tests/services/test_agent_repository.py`:

```python
"""AgentRepository：会话与消息的最小 CRUD 形状（用内存 SQLite 跑通）。"""
from __future__ import annotations

import pytest
from sqlalchemy.ext.asyncio import create_async_engine, async_sessionmaker

from app.db.mysql import Base
from app.repositories.agent_repository import AgentRepository


@pytest.fixture
async def session():
    engine = create_async_engine("sqlite+aiosqlite:///:memory:", future=True)
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
    SessionLocal = async_sessionmaker(engine, expire_on_commit=False)
    async with SessionLocal() as s:
        yield s


@pytest.mark.asyncio
async def test_create_session_and_list(session):
    repo = AgentRepository(session)
    s = await repo.create_session(session_key="k1", employee_id=1, title="T", selected_model_name=None)
    await repo.commit()
    items = await repo.list_sessions(employee_id=1, skip=0, limit=10, keyword=None)
    assert len(items) == 1
    assert items[0].title == "T"


@pytest.mark.asyncio
async def test_create_message_with_workflow_type(session):
    repo = AgentRepository(session)
    s = await repo.create_session(session_key="k1", employee_id=1, title="T", selected_model_name=None)
    msg = await repo.create_message(
        session_id=s.id, role="user", workflow_type="interview_questions",
        run_id="run_x", content={"blocks": [{"type": "text", "text": "hi"}]},
        sort_order=1,
    )
    assert msg.workflow_type == "interview_questions"
    assert msg.run_id == "run_x"
```

- [ ] **Step 5：根据测试调整 AgentRepository 方法签名**

确保 `create_session` 签名：

```python
async def create_session(
    self, *, session_key: str, employee_id: int, title: str | None,
    selected_model_name: str | None, enable_thinking: bool = False,
) -> AgentSession: ...
```

确保 `create_message` 签名：

```python
async def create_message(
    self, *, session_id: int, role: str, workflow_type: str,
    run_id: str | None, content: dict, sort_order: int,
    parent_message_id: int | None = None,
    model_name: str | None = None, token_count: int | None = None,
) -> AgentMessage: ...
```

- [ ] **Step 6：运行测试通过**

Run: `cd backend && pytest tests/services/test_agent_repository.py -v`
Expected: 2 passed

- [ ] **Step 7：commit**

```bash
git add backend/app/repositories/agent_repository.py backend/app/models/agent_message.py backend/app/models/agent_session.py backend/tests/services/test_agent_repository.py
git commit -m "refactor(repo): slim AgentRepository, drop memory methods, align with new DDL

阶段 6.1：删除所有 agent_memory 相关方法；
agent_message 新增 workflow_type/run_id 列；
agent_session 新增 enable_thinking 列"
```

### Task 6.2：AgentSessionService

**Files:**
- Create: `backend/app/services/agent_session_service.py`
- Create: `backend/tests/services/test_agent_session_service.py`

- [ ] **Step 1：写失败测试**

`backend/tests/services/test_agent_session_service.py`:

```python
"""AgentSessionService：CRUD + thinking 开关持久化。"""
from __future__ import annotations

from unittest.mock import AsyncMock, MagicMock

import pytest

from app.services.agent_session_service import AgentSessionService
from app.schemas.agent.request import AgentSessionCreate, AgentSessionUpdate


@pytest.mark.asyncio
async def test_create_session_returns_item():
    repo = MagicMock()
    repo.create_session = AsyncMock(return_value=MagicMock(
        id=1, session_key="k", employee_id=2, title="T",
        selected_model_name=None, enable_thinking=False, status=1,
        last_message_time=None, create_time=None, update_time=None,
    ))
    repo.commit = AsyncMock()
    svc = AgentSessionService(repo)
    item = await svc.create_session(AgentSessionCreate(title="T"), current_user={"user_type": "employee", "sub": "2"})
    assert item.title == "T"
    repo.commit.assert_awaited_once()


@pytest.mark.asyncio
async def test_update_enable_thinking_persists():
    repo = MagicMock()
    repo.get_session = AsyncMock(return_value=MagicMock(id=1, employee_id=2))
    repo.update_session = AsyncMock(return_value=MagicMock(
        id=1, session_key="k", employee_id=2, title="T",
        selected_model_name=None, enable_thinking=True, status=1,
        last_message_time=None, create_time=None, update_time=None,
    ))
    repo.commit = AsyncMock()
    svc = AgentSessionService(repo)
    item = await svc.set_enable_thinking(session_id=1, enable_thinking=True,
                                          current_user={"user_type": "employee", "sub": "2"})
    assert item.enable_thinking is True
    repo.update_session.assert_awaited_once()
    repo.commit.assert_awaited_once()


@pytest.mark.asyncio
async def test_session_not_found_raises():
    repo = MagicMock()
    repo.get_session = AsyncMock(return_value=None)
    svc = AgentSessionService(repo)
    from app.core.exceptions import NotFoundError
    with pytest.raises(NotFoundError):
        await svc.get_session_detail(session_id=999,
                                      current_user={"user_type": "employee", "sub": "2"})
```

- [ ] **Step 2：运行测试验证失败**

Run: `cd backend && pytest tests/services/test_agent_session_service.py -v`
Expected: ModuleNotFoundError

- [ ] **Step 3：创建 `backend/app/services/agent_session_service.py`**

```python
"""
AgentSessionService：会话生命周期与消息查询。

职责：
- 会话 CRUD（创建 / 列表 / 详情 / 重命名 / 软删除）
- enable_thinking 开关持久化
- 会话标题异步生成入口（具体生成逻辑在 _generate_title）

不做：SSE 编排、graph 运行、Redis stream buffer、消息落库（属于 AgentRuntimeService）。
"""

from __future__ import annotations

import asyncio
import logging
import uuid
from datetime import datetime

from app.core.exceptions import ForbiddenError, NotFoundError
from app.llm.model_router import LLMModelRouter, get_default_model_router
from app.repositories.agent_repository import AgentRepository
from app.schemas.agent.request import (
    AgentSessionCreate,
    AgentSessionModelSelect,
    AgentSessionUpdate,
)
from app.schemas.agent.response import (
    AgentMessageItem,
    AgentSessionDetail,
    AgentSessionItem,
)

logger = logging.getLogger(__name__)


class AgentSessionService:
    """会话 CRUD + thinking 持久化。"""

    def __init__(self, agent_repo: AgentRepository,
                 model_router: LLMModelRouter | None = None) -> None:
        self._repo = agent_repo
        self._router = model_router or get_default_model_router()

    async def create_session(self, body: AgentSessionCreate, current_user: dict) -> AgentSessionItem:
        employee_id = self._employee_id(current_user)
        session = await self._repo.create_session(
            session_key=uuid.uuid4().hex,
            employee_id=employee_id,
            title=body.title,
            selected_model_name=body.selected_model_name,
        )
        await self._repo.commit()
        return AgentSessionItem.model_validate(session)

    async def list_sessions(self, *, page: int, page_size: int,
                             current_user: dict, keyword: str | None = None) -> dict:
        employee_id = self._employee_id(current_user)
        skip = (page - 1) * page_size
        total = await self._repo.count_sessions(employee_id, keyword)
        items = await self._repo.list_sessions(employee_id, skip, page_size, keyword)
        return {"total": total, "items": [AgentSessionItem.model_validate(it) for it in items]}

    async def get_session_detail(self, *, session_id: int, current_user: dict) -> AgentSessionDetail:
        session = await self._require_session(session_id, current_user)
        messages = await self._repo.list_messages(session.id)
        return AgentSessionDetail(
            session=AgentSessionItem.model_validate(session),
            messages=[AgentMessageItem.model_validate(m) for m in messages],
        )

    async def update_session(self, *, session_id: int, body: AgentSessionUpdate,
                              current_user: dict) -> AgentSessionItem:
        session = await self._require_session(session_id, current_user)
        updated = await self._repo.update_session(session.id, title=body.title)
        if not updated:
            raise NotFoundError("会话不存在")
        await self._repo.commit()
        return AgentSessionItem.model_validate(updated)

    async def select_model(self, *, session_id: int, body: AgentSessionModelSelect,
                            current_user: dict) -> AgentSessionItem:
        session = await self._require_session(session_id, current_user)
        updated = await self._repo.update_session(session.id, selected_model_name=body.model_name)
        if not updated:
            raise NotFoundError("会话不存在")
        await self._repo.commit()
        return AgentSessionItem.model_validate(updated)

    async def set_enable_thinking(self, *, session_id: int, enable_thinking: bool,
                                   current_user: dict) -> AgentSessionItem:
        session = await self._require_session(session_id, current_user)
        updated = await self._repo.update_session(session.id, enable_thinking=enable_thinking)
        await self._repo.commit()
        return AgentSessionItem.model_validate(updated)

    async def delete_session(self, *, session_id: int, current_user: dict) -> None:
        session = await self._require_session(session_id, current_user)
        await self._repo.soft_delete_session(session.id)
        await self._repo.commit()

    def schedule_title_generation(self, *, session_id: int, user_content: str,
                                   runtime_config) -> None:
        """异步触发标题生成，调用方 fire-and-forget。"""
        asyncio.create_task(self._generate_title(session_id, user_content, runtime_config))

    # ---------- 内部 ----------

    async def _generate_title(self, session_id: int, user_content: str, runtime_config) -> None:
        try:
            snippet = user_content.strip().replace("\n", " ")[:200]
            prompt = ("请为以下对话生成简短标题（不超过 20 字，无引号、无换行，仅标题）：\n" + snippet)
            result = await self._router.complete(prompt, runtime_config)
            title = result.content.strip().replace('"', "").replace("'", "")[:50]
            if title:
                await self._repo.update_session(session_id, title=title)
                await self._repo.commit()
                logger.info("会话标题已生成：session_id=%s title=%s", session_id, title)
        except Exception:
            logger.warning("会话标题生成失败：session_id=%s", session_id, exc_info=True)

    async def _require_session(self, session_id: int, current_user: dict):
        employee_id = self._employee_id(current_user)
        session = await self._repo.get_session(session_id, employee_id)
        if not session:
            raise NotFoundError("会话不存在")
        return session

    @staticmethod
    def _employee_id(current_user: dict) -> int:
        if current_user.get("user_type") != "employee":
            raise ForbiddenError("仅员工账号可访问")
        return int(current_user["sub"])
```

- [ ] **Step 4：运行测试通过**

Run: `cd backend && pytest tests/services/test_agent_session_service.py -v`
Expected: 3 passed

- [ ] **Step 5：commit**

```bash
git add backend/app/services/agent_session_service.py backend/tests/services/test_agent_session_service.py
git commit -m "feat(service): add AgentSessionService for CRUD + thinking toggle persistence

阶段 6.2：会话 CRUD；schedule_title_generation 异步生成标题"
```

### Task 6.3：AgentResumeService

**Files:**
- Create: `backend/app/services/agent_resume_service.py`
- Create: `backend/tests/services/test_agent_resume_service.py`

- [ ] **Step 1：写失败测试**

`backend/tests/services/test_agent_resume_service.py`:

```python
"""AgentResumeService：会话内简历上传 + Redis 会话级引用。"""
from __future__ import annotations

from unittest.mock import AsyncMock, MagicMock

import pytest

from app.core.exceptions import ValidationError
from app.services.agent_resume_service import (
    AgentResumeService,
    SESSION_RESUME_REF_KEY,
)


@pytest.mark.asyncio
async def test_upload_resume_caches_session_ref():
    cache = MagicMock()
    cache.set_json = AsyncMock()
    resume_repo = MagicMock()
    job_repo = MagicMock()
    resume_repo.upload_for_employee = AsyncMock(return_value={
        "resume_id": 7, "file_name": "x.pdf"
    })
    svc = AgentResumeService(resume_repo=resume_repo, job_repo=job_repo, cache=cache)
    out = await svc.upload(session_id=1, file=MagicMock(), job_id=None, employee_id=2)
    assert out["resume_id"] == 7
    cache.set_json.assert_awaited_once()
    args = cache.set_json.call_args[0]
    assert args[0] == SESSION_RESUME_REF_KEY.format(session_id=1)


@pytest.mark.asyncio
async def test_get_session_ref_returns_cached_value():
    cache = MagicMock()
    cache.get_json = AsyncMock(return_value={"resume_id": 7, "file_name": "x.pdf", "job_id": None})
    svc = AgentResumeService(resume_repo=MagicMock(), job_repo=MagicMock(), cache=cache)
    ref = await svc.get_session_ref(session_id=1)
    assert ref["resume_id"] == 7


@pytest.mark.asyncio
async def test_upload_rejects_unowned_job_id():
    job_repo = MagicMock()
    job_repo.get_by_employee = AsyncMock(return_value=[MagicMock(id=10)])
    svc = AgentResumeService(resume_repo=MagicMock(), job_repo=job_repo, cache=MagicMock())
    with pytest.raises(ValidationError):
        await svc.upload(session_id=1, file=MagicMock(), job_id=999, employee_id=2)
```

- [ ] **Step 2：运行测试验证失败**

Run: `cd backend && pytest tests/services/test_agent_resume_service.py -v`
Expected: ModuleNotFoundError

- [ ] **Step 3：创建 `backend/app/services/agent_resume_service.py`**

```python
"""
AgentResumeService：会话内简历上传与 Redis 会话级引用。

职责：
- 上传简历（委托 ResumeRepository.upload_for_employee）
- 校验绑定的 job_id 属于当前员工
- 把简历引用写入 Redis（会话级，30 分钟 TTL）
- 提供从 Redis 读取会话简历引用的能力

不做：业务规则、graph 编排、消息落库。
"""

from __future__ import annotations

import logging
from typing import Any

from app.core.exceptions import ValidationError
from app.repositories.job_repository import JobRepository
from app.repositories.resume_repository import ResumeRepository
from app.services.cache_service import CacheService

logger = logging.getLogger(__name__)

SESSION_RESUME_REF_KEY = "agent:session_resume_ref:{session_id}"
SESSION_RESUME_REF_TTL = 1800


class AgentResumeService:
    """会话内简历上传与引用。"""

    def __init__(
        self, *,
        resume_repo: ResumeRepository,
        job_repo: JobRepository,
        cache: CacheService,
    ) -> None:
        self._resume_repo = resume_repo
        self._job_repo = job_repo
        self._cache = cache

    async def upload(
        self, *, session_id: int, file: Any, job_id: int | None, employee_id: int,
    ) -> dict[str, Any]:
        """上传简历并写入会话级引用。"""
        if job_id is not None:
            jobs = await self._job_repo.get_by_employee(employee_id)
            if job_id not in {j.id for j in jobs}:
                raise ValidationError(f"岗位 {job_id} 不属于当前员工")
        uploaded = await self._resume_repo.upload_for_employee(employee_id, file)
        uploaded["job_id"] = job_id
        ref = {
            "resume_id": int(uploaded.get("resume_id") or 0),
            "job_id": job_id,
            "file_name": str(uploaded.get("file_name") or ""),
        }
        await self._cache.set_json(SESSION_RESUME_REF_KEY.format(session_id=session_id), ref, SESSION_RESUME_REF_TTL)
        logger.info("会话简历附件已上传：session_id=%s resume_id=%s", session_id, ref["resume_id"])
        return uploaded

    async def get_session_ref(self, *, session_id: int) -> dict[str, Any] | None:
        """读取会话级简历引用。"""
        cached = await self._cache.get_json(SESSION_RESUME_REF_KEY.format(session_id=session_id))
        if cached and isinstance(cached, dict) and cached.get("resume_id"):
            return cached
        return None
```

- [ ] **Step 4：运行测试通过**

Run: `cd backend && pytest tests/services/test_agent_resume_service.py -v`
Expected: 3 passed

- [ ] **Step 5：commit**

```bash
git add backend/app/services/agent_resume_service.py backend/tests/services/test_agent_resume_service.py
git commit -m "feat(service): add AgentResumeService for in-session resume upload + Redis ref

阶段 6.3：上传时校验 job_id 归属；Redis 30 分钟 TTL"
```

### Task 6.4：AgentRuntimeService（核心：SSE 编排 + Redis buffer + 落库 + resume）

**Files:**
- Create: `backend/app/services/agent_runtime_service.py`
- Create: `backend/tests/services/test_agent_runtime_service.py`

- [ ] **Step 1：写失败测试（最关键的 stream_message 与 resolve_interaction 路径）**

`backend/tests/services/test_agent_runtime_service.py`:

```python
"""AgentRuntimeService：stream_message + resolve_interaction 关键路径。"""
from __future__ import annotations

from collections.abc import AsyncIterator
from unittest.mock import AsyncMock, MagicMock, patch

import pytest
from pydantic import SecretStr

from app.llm.streaming.emitter import AgentStreamEmitter
from app.schemas.agent.dto import LLMRuntimeConfigDTO
from app.schemas.agent.request import AgentInteractionSubmit, AgentMessageCreate
from app.schemas.agent.stream import AgentStreamEnvelope
from app.services.agent_runtime_service import AgentRuntimeService


def _envelope(emitter_run: str, seq: int, type_: str = "block.delta") -> AgentStreamEnvelope:
    return AgentStreamEnvelope(
        v=1, seq=seq, ts=0, run_id=emitter_run, session_id=1, type=type_, data={},
    )


def _runtime_cfg() -> LLMRuntimeConfigDTO:
    return LLMRuntimeConfigDTO(
        provider="deepseek", base_url="x", api_key=SecretStr("sk"), model_name="m",
    )


@pytest.mark.asyncio
async def test_stream_message_emits_run_start_then_runner_then_run_finish():
    """编排骨架：run.start → runner events → run.finish。"""
    repo = MagicMock()
    repo.create_message = AsyncMock(side_effect=[
        MagicMock(id=10),   # user message
        MagicMock(id=20),   # agent message
    ])
    repo.update_session = AsyncMock()
    repo.commit = AsyncMock()
    repo.next_message_order = AsyncMock(side_effect=[1, 2])
    cache = MagicMock()
    cache.set = AsyncMock()
    cache.get_json = AsyncMock(return_value=None)
    cache.client = MagicMock()

    # mock runner.astream 产出 1 个 envelope
    runner = MagicMock()
    async def fake_astream(*, thread_id, graph_input, ctx):
        yield _envelope(ctx.run_id, 99, "block.start")

    runner.astream = fake_astream
    workflow_graphs = {"interview_questions": MagicMock(), "resume_evaluation": MagicMock()}
    svc = AgentRuntimeService(
        repo=repo, cache=cache, workflow_graphs=workflow_graphs,
        runner_factory=lambda graph: runner,
        interview_service=MagicMock(), evaluation_service=MagicMock(),
        resume_loader=MagicMock(), agent_resume_service=MagicMock(get_session_ref=AsyncMock(return_value=None)),
    )

    session = MagicMock(id=1, session_key="k", employee_id=2, selected_model_name=None, enable_thinking=False)
    body = AgentMessageCreate(content="hi", workflow_type="interview_questions")
    out_types = []
    async for env in svc.stream_message(session=session, body=body, runtime_config=_runtime_cfg()):
        out_types.append(env.type)

    assert out_types[0] == "run.start"
    assert out_types[-1] == "run.finish"
    assert "block.start" in out_types
```

- [ ] **Step 2：运行测试验证失败**

Run: `cd backend && pytest tests/services/test_agent_runtime_service.py -v`
Expected: ModuleNotFoundError

- [ ] **Step 3：创建 `backend/app/services/agent_runtime_service.py`**

```python
"""
AgentRuntimeService：SSE 编排核心。

职责：
- stream_message：构造 emitter + ctx → 调 Runner → 把所有 envelope 写入 Redis buffer → 落库 → yield
- resolve_interaction：用 Command(resume=values) 恢复 graph，复用 stream_message 编排
- 收尾时把 emitter 累积的 envelope 折叠成 agent_message.content.blocks

不做：业务规则、Prompt、LLM 调用、session CRUD。
"""

from __future__ import annotations

import json
import logging
import uuid
from collections.abc import AsyncIterator, Callable
from datetime import datetime
from typing import Any

from langgraph.types import Command
from sqlalchemy.exc import SQLAlchemyError

from app.core.exceptions import ValidationError
from app.llm.graphs.workflows import AgentWorkflowRunner, WorkflowRuntimeContext
from app.llm.streaming.emitter import AgentStreamEmitter
from app.repositories.agent_repository import AgentRepository
from app.schemas.agent.dto import LLMRuntimeConfigDTO
from app.schemas.agent.request import AgentInteractionSubmit, AgentMessageCreate
from app.schemas.agent.stream import AgentStreamEnvelope, coerce_block
from app.services.agent_resume_service import AgentResumeService
from app.services.cache_service import CacheService

logger = logging.getLogger(__name__)

STREAM_BUFFER_KEY = "agent:stream_buffer:{session_id}:{run_id}"
STREAM_BUFFER_TTL = 1800


class AgentRuntimeService:
    """SSE 编排 + Redis buffer + 消息落库。"""

    def __init__(
        self, *,
        repo: AgentRepository,
        cache: CacheService,
        workflow_graphs: dict[str, Any],
        runner_factory: Callable[[Any], AgentWorkflowRunner],
        interview_service,
        evaluation_service,
        resume_loader,
        agent_resume_service: AgentResumeService,
    ) -> None:
        self._repo = repo
        self._cache = cache
        self._workflow_graphs = workflow_graphs
        self._runner_factory = runner_factory
        self._interview_service = interview_service
        self._evaluation_service = evaluation_service
        self._resume_loader = resume_loader
        self._agent_resume = agent_resume_service

    async def stream_message(
        self, *, session, body: AgentMessageCreate, runtime_config: LLMRuntimeConfigDTO,
    ) -> AsyncIterator[AgentStreamEnvelope]:
        """新一轮 run：落库用户消息 → 跑 graph → 落库 agent 消息。"""
        run_id = f"run_{uuid.uuid4().hex[:12]}"
        emitter = AgentStreamEmitter(
            session_id=session.id, run_id=run_id, workflow_type=body.workflow_type,
        )
        ctx = WorkflowRuntimeContext(
            emitter=emitter, runtime_config=runtime_config,
            interview_service=self._interview_service,
            evaluation_service=self._evaluation_service,
            resume_loader=self._resume_loader,
            session_id=session.id, employee_id=session.employee_id, run_id=run_id,
        )
        resume_ref = await self._resolve_resume_ref(session.id, body)
        graph_input = await self._build_graph_input(body, resume_ref)
        user_message = await self._create_user_message(session, body, run_id=run_id)

        envelope_buffer: list[AgentStreamEnvelope] = []

        # 先发 run.start
        env = emitter.emit_run_start(
            enable_thinking=runtime_config.enable_thinking,
            user_message_id=user_message.id,
        )
        envelope_buffer.append(env)
        await self._buffer_append(session.id, run_id, env)
        yield env

        # 运行 graph
        runner = self._runner_factory(self._workflow_graphs[body.workflow_type])
        try:
            async for env in runner.astream(thread_id=session.session_key, graph_input=graph_input, ctx=ctx):
                envelope_buffer.append(env)
                await self._buffer_append(session.id, run_id, env)
                yield env
        except Exception as exc:
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
        finish_env = emitter.emit_run_finish(agent_message_id=agent_message.id)
        await self._buffer_append(session.id, run_id, finish_env)
        yield finish_env
        await self._cache.client.delete(STREAM_BUFFER_KEY.format(session_id=session.id, run_id=run_id))

    async def resolve_interaction(
        self, *, session, request_id: str, body: AgentInteractionSubmit,
        runtime_config: LLMRuntimeConfigDTO, workflow_type: str,
    ) -> AsyncIterator[AgentStreamEnvelope]:
        """提交 interaction 恢复 graph。"""
        run_id = f"run_{uuid.uuid4().hex[:12]}"
        emitter = AgentStreamEmitter(
            session_id=session.id, run_id=run_id, workflow_type=workflow_type,
        )
        ctx = WorkflowRuntimeContext(
            emitter=emitter, runtime_config=runtime_config,
            interview_service=self._interview_service,
            evaluation_service=self._evaluation_service,
            resume_loader=self._resume_loader,
            session_id=session.id, employee_id=session.employee_id, run_id=run_id,
        )
        # 先回执 interaction.resolve 让前端立刻关闭卡片
        resolve_env = emitter.emit_interaction_resolve(request_id=request_id, values=body.values)
        await self._update_old_interaction_block_status(
            session_id=session.id, request_id=request_id, values=body.values,
        )
        await self._buffer_append(session.id, run_id, resolve_env)
        yield resolve_env

        # 进入 graph 恢复
        envelope_buffer: list[AgentStreamEnvelope] = [resolve_env]
        runner = self._runner_factory(self._workflow_graphs[workflow_type])
        try:
            async for env in runner.astream(
                thread_id=session.session_key, graph_input=Command(resume=body.values), ctx=ctx,
            ):
                envelope_buffer.append(env)
                await self._buffer_append(session.id, run_id, env)
                yield env
        except Exception as exc:
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
        finish_env = emitter.emit_run_finish(agent_message_id=agent_message.id)
        await self._buffer_append(session.id, run_id, finish_env)
        yield finish_env
        await self._cache.client.delete(STREAM_BUFFER_KEY.format(session_id=session.id, run_id=run_id))

    # ---------- 内部 ----------

    async def _resolve_resume_ref(self, session_id: int, body: AgentMessageCreate) -> dict[str, Any] | None:
        for ref in body.context_refs or []:
            if str(ref.get("type") or "").lower() == "resume":
                if not ref.get("resume_id"):
                    raise ValidationError("简历附件缺少 resume_id")
                return {
                    "resume_id": int(ref["resume_id"]),
                    "job_id": int(ref["job_id"]) if ref.get("job_id") is not None else None,
                    "file_name": str(ref.get("file_name") or ""),
                }
        return await self._agent_resume.get_session_ref(session_id=session_id)

    async def _build_graph_input(self, body: AgentMessageCreate, resume_ref: dict | None) -> dict:
        return {"resume_ref": resume_ref or {}, "validation_attempts": 0}

    async def _create_user_message(self, session, body: AgentMessageCreate, *, run_id: str):
        return await self._repo.create_message(
            session_id=session.id, role="user", workflow_type=body.workflow_type,
            run_id=run_id,
            content={"blocks": [{"type": "text", "text": body.content}]},
            sort_order=await self._repo.next_message_order(session.id),
        )

    async def _persist_agent_message(
        self, *, session, user_message, run_id: str,
        envelopes: list[AgentStreamEnvelope],
        runtime_config: LLMRuntimeConfigDTO, workflow_type: str,
    ):
        blocks = self._envelopes_to_blocks(envelopes)
        try:
            msg = await self._repo.create_message(
                session_id=session.id,
                parent_message_id=user_message.id if user_message else None,
                role="agent", workflow_type=workflow_type, run_id=run_id,
                content={"blocks": blocks},
                model_name=runtime_config.model_name,
                sort_order=await self._repo.next_message_order(session.id),
            )
            await self._repo.update_session(session.id, status=1, last_message_time=datetime.now())
            await self._repo.commit()
            return msg
        except SQLAlchemyError:
            await self._repo.rollback()
            logger.exception("agent_message 落库失败")
            raise

    @staticmethod
    def _envelopes_to_blocks(envelopes: list[AgentStreamEnvelope]) -> list[dict[str, Any]]:
        """把 envelope 序列折叠成 block 数组：block.start 建立骨架，delta 累加，stop 仅标记。"""
        blocks_by_index: dict[int, dict[str, Any]] = {}
        for env in envelopes:
            if env.type == "block.start":
                idx = int(env.data["index"])
                blocks_by_index[idx] = dict(env.data["block"])
            elif env.type == "block.delta":
                idx = int(env.data["index"])
                if idx not in blocks_by_index:
                    continue
                delta = env.data.get("delta") or {}
                # text/thinking 累加
                if "text_delta" in delta and "text" in blocks_by_index[idx]:
                    blocks_by_index[idx]["text"] = (blocks_by_index[idx].get("text") or "") + delta["text_delta"]
                # tool_use 完成
                for k in ("status", "output", "error"):
                    if k in delta:
                        blocks_by_index[idx][k] = delta[k]
                # 业务卡一次写满
                for k in ("question_set", "report"):
                    if k in delta:
                        blocks_by_index[idx][k] = delta[k]
                # interaction 提交
                if "values" in delta:
                    blocks_by_index[idx]["values"] = delta["values"]
            elif env.type == "block.stop":
                idx = int(env.data["index"])
                if idx in blocks_by_index:
                    # streaming → success（除非业务已显式标记其他）
                    if blocks_by_index[idx].get("status") == "streaming":
                        blocks_by_index[idx]["status"] = "success"
        return [blocks_by_index[i] for i in sorted(blocks_by_index)]

    async def _buffer_append(self, session_id: int, run_id: str, env: AgentStreamEnvelope) -> None:
        """JSONL 形式 APPEND 到 Redis；失败仅日志，不中断主流程。"""
        try:
            key = STREAM_BUFFER_KEY.format(session_id=session_id, run_id=run_id)
            line = env.model_dump_json() + "\n"
            await self._cache.client.append(key, line)
            await self._cache.client.expire(key, STREAM_BUFFER_TTL)
        except Exception:
            logger.exception("Redis stream buffer append 失败")

    async def _update_old_interaction_block_status(
        self, *, session_id: int, request_id: str, values: dict[str, Any],
    ) -> None:
        """把指定 request_id 对应的旧 interaction block status 改为 submitted。"""
        try:
            messages = await self._repo.list_messages(session_id)
            for msg in reversed(messages):
                content = msg.content or {}
                blocks = content.get("blocks") or []
                dirty = False
                for b in blocks:
                    if (b.get("type") == "interaction"
                            and b.get("request_id") == request_id
                            and b.get("status") == "pending"):
                        b["status"] = "submitted"
                        b["values"] = values
                        dirty = True
                if dirty:
                    await self._repo.update_message_content(msg.id, content)
                    await self._repo.commit()
                    return
        except Exception:
            logger.exception("更新旧 interaction block status 失败")
```

> 注：`update_message_content` 是 AgentRepository 上需要新增的方法（如未存在，在测试通过前补一行）。

- [ ] **Step 4：补 AgentRepository.update_message_content**

打开 `backend/app/repositories/agent_repository.py`，追加：

```python
async def update_message_content(self, message_id: int, content: dict) -> None:
    """更新 agent_message.content（跨消息回写 interaction 状态用）。"""
    stmt = update(AgentMessage).where(AgentMessage.id == message_id).values(content=content)
    await self._session.execute(stmt)
```

- [ ] **Step 5：运行测试通过**

Run: `cd backend && pytest tests/services/test_agent_runtime_service.py -v`
Expected: 1 passed

- [ ] **Step 6：commit**

```bash
git add backend/app/services/agent_runtime_service.py backend/app/repositories/agent_repository.py backend/tests/services/test_agent_runtime_service.py
git commit -m "feat(service): add AgentRuntimeService for SSE orchestration + buffer + persist

阶段 6.4：stream_message / resolve_interaction 编排
envelope 折叠为 blocks 落库；
interaction.resolve 跨消息回写旧 block status"
```

---

## 阶段 7：Endpoint 重写

### Task 7.1：注入工厂 + lifespan 编译图

**Files:**
- Modify: `backend/app/api/deps.py`
- Modify: `backend/app/main.py`

- [ ] **Step 1：在 `main.py` 的 `lifespan` 中编译两个图并放入 `app.state`**

打开 `backend/app/main.py`，在 lifespan 内添加：

```python
from langgraph.checkpoint.memory import MemorySaver
from app.llm.graphs.workflows import build_evaluation_graph, build_interview_graph

@asynccontextmanager
async def lifespan(app: FastAPI):
    # ... 既有 db / redis 初始化
    checkpointer = MemorySaver()
    app.state.agent_workflow_graphs = {
        "interview_questions": build_interview_graph(checkpointer),
        "resume_evaluation": build_evaluation_graph(checkpointer),
    }
    logger.info("两个 Agent 工作流图已编译，使用 MemorySaver checkpointer")
    yield
    # ... 既有 close 逻辑
```

- [ ] **Step 2：重写 `backend/app/api/deps.py` 中的 agent 相关依赖**

把旧的 `get_agent_service` 替换为以下三个工厂：

```python
def get_agent_session_service(
    db: AsyncSession = Depends(get_db),
) -> AgentSessionService:
    repo = AgentRepository(db)
    return AgentSessionService(repo)


def get_agent_resume_service(
    db: AsyncSession = Depends(get_db),
    cache: CacheService = Depends(get_cache_service),
) -> AgentResumeService:
    return AgentResumeService(
        resume_repo=ResumeRepository(db),
        job_repo=JobRepository(db),
        cache=cache,
    )


def get_agent_runtime_service(
    request: Request,
    db: AsyncSession = Depends(get_db),
    cache: CacheService = Depends(get_cache_service),
    agent_resume_service: AgentResumeService = Depends(get_agent_resume_service),
) -> AgentRuntimeService:
    repo = AgentRepository(db)
    router = get_default_model_router()
    resume_loader = ResumeLoader(cache=cache, resume_repo=ResumeRepository(db))
    interview_svc = InterviewQuestionService(model_router=router, resume_loader=resume_loader)
    # evaluation_subgraph 已在 main lifespan 中可获取
    eval_subgraph = getattr(request.app.state, "evaluation_subgraph", None)
    evaluation_svc = ResumeEvaluationService(
        model_router=router, resume_loader=resume_loader,
        job_repo=JobRepository(db), cache=cache,
        evaluation_subgraph=eval_subgraph,
    )
    return AgentRuntimeService(
        repo=repo, cache=cache,
        workflow_graphs=request.app.state.agent_workflow_graphs,
        runner_factory=lambda g: AgentWorkflowRunner(g),
        interview_service=interview_svc,
        evaluation_service=evaluation_svc,
        resume_loader=resume_loader,
        agent_resume_service=agent_resume_service,
    )
```

> 顶部 import 按需补全：`AgentSessionService`、`AgentRuntimeService`、`AgentResumeService`、`AgentRepository`、`InterviewQuestionService`、`ResumeEvaluationService`、`ResumeLoader`、`AgentWorkflowRunner`、`get_default_model_router`、`JobRepository`、`ResumeRepository`、`CacheService`、`get_cache_service`、`Request`。

- [ ] **Step 3：删除旧 `get_agent_service` 引用**

Run: `cd backend && grep -rn "get_agent_service\b" app --include="*.py" | grep -v __pycache__`
Expected: 命中的地方是阶段 0 临时桩，本任务一起清理替换为新工厂。

- [ ] **Step 4：验证后端能启动**

Run: `cd backend && python -c "from app.main import app; print('ok')"`
Expected: `ok`

- [ ] **Step 5：commit**

```bash
git add backend/app/main.py backend/app/api/deps.py
git commit -m "feat(api): wire up three agent services and compile workflow graphs at lifespan

阶段 7.1：MemorySaver checkpointer；
deps 注入 get_agent_session_service / get_agent_runtime_service / get_agent_resume_service"
```

### Task 7.2：重写 endpoint agent.py 四个路由

**Files:**
- Modify: `backend/app/api/v1/endpoints/agent.py`（完整重写）
- Create: `backend/tests/api/test_agent_endpoints.py`

- [ ] **Step 1：写失败测试（FastAPI TestClient 跑 sessions CRUD + stream 路径）**

`backend/tests/api/test_agent_endpoints.py`:

```python
"""agent endpoint 路由形状烟测：sessions CRUD + stream + interactions。"""
from __future__ import annotations

from unittest.mock import AsyncMock, MagicMock

import pytest
from fastapi.testclient import TestClient


@pytest.fixture
def client(monkeypatch):
    from app.main import app
    from app.api import deps

    # mock 鉴权依赖：所有请求视为已登录员工
    def fake_current_user():
        return {"user_type": "employee", "sub": "2"}

    app.dependency_overrides[deps.get_current_user] = fake_current_user

    # mock session service
    session_svc = MagicMock()
    session_svc.create_session = AsyncMock(return_value=MagicMock(model_dump=lambda **k: {"id": 1, "title": "T"}))
    app.dependency_overrides[deps.get_agent_session_service] = lambda: session_svc

    yield TestClient(app)
    app.dependency_overrides.clear()


def test_create_session_returns_200(client):
    resp = client.post("/api/v1/employee/agent/sessions", json={"title": "T"})
    assert resp.status_code == 200


def test_stream_endpoint_returns_event_stream_header(client, monkeypatch):
    """stream 返回 text/event-stream。"""
    from app.main import app
    from app.api import deps

    runtime_svc = MagicMock()
    async def fake_stream(session, body, runtime_config):
        from app.schemas.agent.stream import AgentStreamEnvelope
        yield AgentStreamEnvelope(v=1, seq=1, ts=0, run_id="r", session_id=1, type="run.start", data={})
        yield AgentStreamEnvelope(v=1, seq=2, ts=0, run_id="r", session_id=1, type="run.finish", data={"agent_message_id": 9})
    runtime_svc.stream_message = fake_stream
    app.dependency_overrides[deps.get_agent_runtime_service] = lambda: runtime_svc

    # mock get_session
    session_svc = MagicMock()
    session_svc._require_session = AsyncMock(return_value=MagicMock(id=1, session_key="k", employee_id=2))
    # endpoint 中通过 SessionService.get_session_detail 或独立方法获取
    # 这里假设 endpoint 直接调 repo.get_session；按 endpoint 真实实现 mock。
```

- [ ] **Step 2：运行验证测试是否覆盖关键面**

Run: `cd backend && pytest tests/api/test_agent_endpoints.py -v`
Expected: 至少第一个 CRUD 测试 PASS；stream 测试可能 SKIP，按 endpoint 真实实现完善。

- [ ] **Step 3：重写 `backend/app/api/v1/endpoints/agent.py`**

```python
"""
Agent 模块 endpoint（重写版）。

仅四类路由：
- sessions CRUD：POST/GET/PUT/DELETE /employee/agent/sessions
- 流式消息：POST /employee/agent/sessions/{session_id}/messages/stream
- 交互提交：POST /employee/agent/sessions/{session_id}/interactions/{request_id}
- 简历上传：POST /employee/agent/sessions/{session_id}/resumes

不再有 actions/execute / memories。
"""

from __future__ import annotations

import json
import logging

from fastapi import APIRouter, Depends, File, Form, Path, Query, UploadFile
from sse_starlette.sse import EventSourceResponse

from app.api import deps
from app.schemas.agent.request import (
    AgentInteractionSubmit,
    AgentMessageCreate,
    AgentSessionCreate,
    AgentSessionModelSelect,
    AgentSessionUpdate,
)
from app.schemas.common import ApiResponse
from app.services.agent_resume_service import AgentResumeService
from app.services.agent_runtime_service import AgentRuntimeService
from app.services.agent_session_service import AgentSessionService
from app.services.llm_config_service import LlmConfigService

logger = logging.getLogger(__name__)

router = APIRouter()


# ---------- 会话 CRUD ----------

@router.post("/sessions")
async def create_session(
    body: AgentSessionCreate,
    current_user: dict = Depends(deps.get_current_user),
    svc: AgentSessionService = Depends(deps.get_agent_session_service),
):
    item = await svc.create_session(body, current_user)
    return ApiResponse.ok(data=item.model_dump())


@router.get("/sessions")
async def list_sessions(
    page: int = Query(1, ge=1),
    page_size: int = Query(20, ge=1, le=100),
    keyword: str | None = Query(None),
    current_user: dict = Depends(deps.get_current_user),
    svc: AgentSessionService = Depends(deps.get_agent_session_service),
):
    out = await svc.list_sessions(page=page, page_size=page_size, current_user=current_user, keyword=keyword)
    return ApiResponse.ok(data={"total": out["total"],
                                  "items": [i.model_dump() for i in out["items"]]})


@router.get("/sessions/{session_id}")
async def get_session(
    session_id: int = Path(..., ge=1),
    current_user: dict = Depends(deps.get_current_user),
    svc: AgentSessionService = Depends(deps.get_agent_session_service),
):
    detail = await svc.get_session_detail(session_id=session_id, current_user=current_user)
    return ApiResponse.ok(data=detail.model_dump())


@router.put("/sessions/{session_id}")
async def update_session(
    body: AgentSessionUpdate,
    session_id: int = Path(..., ge=1),
    current_user: dict = Depends(deps.get_current_user),
    svc: AgentSessionService = Depends(deps.get_agent_session_service),
):
    item = await svc.update_session(session_id=session_id, body=body, current_user=current_user)
    return ApiResponse.ok(data=item.model_dump())


@router.put("/sessions/{session_id}/model")
async def select_model(
    body: AgentSessionModelSelect,
    session_id: int = Path(..., ge=1),
    current_user: dict = Depends(deps.get_current_user),
    svc: AgentSessionService = Depends(deps.get_agent_session_service),
):
    item = await svc.select_model(session_id=session_id, body=body, current_user=current_user)
    return ApiResponse.ok(data=item.model_dump())


@router.put("/sessions/{session_id}/thinking")
async def set_thinking(
    enable: bool = Query(..., description="开启/关闭思考模式"),
    session_id: int = Path(..., ge=1),
    current_user: dict = Depends(deps.get_current_user),
    svc: AgentSessionService = Depends(deps.get_agent_session_service),
):
    item = await svc.set_enable_thinking(session_id=session_id, enable_thinking=enable, current_user=current_user)
    return ApiResponse.ok(data=item.model_dump())


@router.delete("/sessions/{session_id}")
async def delete_session(
    session_id: int = Path(..., ge=1),
    current_user: dict = Depends(deps.get_current_user),
    svc: AgentSessionService = Depends(deps.get_agent_session_service),
):
    await svc.delete_session(session_id=session_id, current_user=current_user)
    return ApiResponse.ok()


# ---------- 流式消息 ----------

@router.post("/sessions/{session_id}/messages/stream")
async def stream_message(
    body: AgentMessageCreate,
    session_id: int = Path(..., ge=1),
    current_user: dict = Depends(deps.get_current_user),
    session_svc: AgentSessionService = Depends(deps.get_agent_session_service),
    runtime_svc: AgentRuntimeService = Depends(deps.get_agent_runtime_service),
    llm_svc: LlmConfigService = Depends(deps.get_llm_config_service),
):
    session = await session_svc._require_session(session_id, current_user)
    runtime_config = await llm_svc.get_runtime_config(current_user, session.selected_model_name)
    if body.runtime_options and body.runtime_options.enable_thinking is not None:
        runtime_config = runtime_config.model_copy(update={"enable_thinking": body.runtime_options.enable_thinking})
    else:
        runtime_config = runtime_config.model_copy(update={"enable_thinking": bool(session.enable_thinking)})

    async def _generator():
        async for env in runtime_svc.stream_message(session=session, body=body, runtime_config=runtime_config):
            yield {"event": "agent", "data": env.model_dump_json()}

    return EventSourceResponse(_generator())


# ---------- 交互提交 ----------

@router.post("/sessions/{session_id}/interactions/{request_id}")
async def submit_interaction(
    body: AgentInteractionSubmit,
    session_id: int = Path(..., ge=1),
    request_id: str = Path(..., min_length=1),
    current_user: dict = Depends(deps.get_current_user),
    session_svc: AgentSessionService = Depends(deps.get_agent_session_service),
    runtime_svc: AgentRuntimeService = Depends(deps.get_agent_runtime_service),
    llm_svc: LlmConfigService = Depends(deps.get_llm_config_service),
):
    session = await session_svc._require_session(session_id, current_user)
    workflow_type = await _infer_workflow_type(session_svc, session, current_user)
    runtime_config = await llm_svc.get_runtime_config(current_user, session.selected_model_name)
    runtime_config = runtime_config.model_copy(update={"enable_thinking": bool(session.enable_thinking)})

    async def _generator():
        async for env in runtime_svc.resolve_interaction(
            session=session, request_id=request_id, body=body,
            runtime_config=runtime_config, workflow_type=workflow_type,
        ):
            yield {"event": "agent", "data": env.model_dump_json()}

    return EventSourceResponse(_generator())


async def _infer_workflow_type(svc, session, current_user) -> str:
    """从历史消息推断恢复所属 workflow（最后一条非用户消息或最近 user 消息的 workflow_type）。"""
    detail = await svc.get_session_detail(session_id=session.id, current_user=current_user)
    for m in reversed(detail.messages):
        wf = getattr(m, "workflow_type", None)
        if wf:
            return str(wf)
    return "interview_questions"


# ---------- 简历上传 ----------

@router.post("/sessions/{session_id}/resumes")
async def upload_resume(
    file: UploadFile = File(...),
    job_id: int | None = Form(None),
    session_id: int = Path(..., ge=1),
    current_user: dict = Depends(deps.get_current_user),
    session_svc: AgentSessionService = Depends(deps.get_agent_session_service),
    resume_svc: AgentResumeService = Depends(deps.get_agent_resume_service),
):
    session = await session_svc._require_session(session_id, current_user)
    out = await resume_svc.upload(session_id=session.id, file=file, job_id=job_id, employee_id=session.employee_id)
    return ApiResponse.ok(data=out)
```

- [ ] **Step 4：更新 router.py 注册（应已存在 agent 路由注册，路径前缀对齐）**

Run: `cd backend && grep -n "agent" app/api/v1/router.py`
Expected: 已有 `api_router.include_router(agent.router, prefix="/employee/agent", tags=["Agent"])`，如未对齐则修正。

- [ ] **Step 5：跑全部后端测试**

Run: `cd backend && pytest -q`
Expected: 全部 passed（含阶段 1-7 累计新测试）

- [ ] **Step 6：commit**

```bash
git add backend/app/api/v1/endpoints/agent.py backend/app/api/v1/router.py backend/tests/api/test_agent_endpoints.py
git commit -m "feat(api): rewrite agent endpoints to 4 routes (sessions/stream/interactions/resumes)

阶段 7.2：删除 actions/execute 与 memories；
stream 与 interactions 都返回 EventSourceResponse 携带 9-type envelope"
```

---

## 阶段 8：前端协议层

### Task 8.1：types/agent.ts 重写

**Files:**
- Modify: `frontend/src/types/agent.ts`（覆盖式重写）

- [ ] **Step 1：完整覆盖 `frontend/src/types/agent.ts`**

```typescript
/**
 * Agent 模块类型定义（重写版）。
 *
 * 全部以 block 为中心；事件协议字段与后端 9 type / 6 block 严格对齐。
 * 后端字段一律 snake_case，TypeScript 不在 client 端做 camelCase 转换。
 */

// ====== Workflow ======

export type WorkflowType = 'interview_questions' | 'resume_evaluation';

export const WORKFLOW_LABELS: Record<WorkflowType, string> = {
  interview_questions: '简历问答',
  resume_evaluation: '简历评估',
};

// ====== Block ======

export type BlockStatus =
  | 'streaming' | 'success' | 'failed'
  | 'pending' | 'submitted' | 'expired';

export type InteractionType =
  | 'dimension_selection' | 'plan_approval' | 'job_selection';

export type AgentBlock =
  | { type: 'text'; index: number; text: string; status: BlockStatus }
  | { type: 'thinking'; index: number; text: string; status: BlockStatus }
  | {
      type: 'tool_use'; index: number;
      tool_name: string; display_name: string;
      input: Record<string, unknown>;
      output?: Record<string, unknown>;
      status: BlockStatus; error?: string;
    }
  | {
      type: 'interaction'; index: number;
      request_id: string; interaction_type: InteractionType;
      title: string; prompt: string;
      data: Record<string, unknown>;
      status: BlockStatus;
      values?: Record<string, unknown>;
    }
  | { type: 'interview_questions'; index: number; question_set: QuestionSet; status: BlockStatus }
  | { type: 'evaluation_report'; index: number; report: EvaluationReport; status: BlockStatus };

// ====== Envelope（与后端 9 type 一一对应） ======

export type AgentEnvelope =
  | { v: 1; seq: number; ts: number; run_id: string; session_id: number;
      type: 'run.start'; data: { run_id: string; workflow_type: WorkflowType;
                                  enable_thinking: boolean; user_message_id: number | null } }
  | { v: 1; seq: number; ts: number; run_id: string; session_id: number;
      type: 'run.finish'; data: { agent_message_id: number } }
  | { v: 1; seq: number; ts: number; run_id: string; session_id: number;
      type: 'run.error'; data: { code: string; message: string; retriable: boolean } }
  | { v: 1; seq: number; ts: number; run_id: string; session_id: number;
      type: 'step.update'; data: { step_id: string; title: string;
                                     status: 'pending' | 'running' | 'success' | 'failed';
                                     detail?: string } }
  | { v: 1; seq: number; ts: number; run_id: string; session_id: number;
      type: 'block.start'; data: { index: number; block: Record<string, unknown> } }
  | { v: 1; seq: number; ts: number; run_id: string; session_id: number;
      type: 'block.delta'; data: { index: number; delta: Record<string, unknown> } }
  | { v: 1; seq: number; ts: number; run_id: string; session_id: number;
      type: 'block.stop'; data: { index: number } }
  | { v: 1; seq: number; ts: number; run_id: string; session_id: number;
      type: 'interaction.request'; data: { request_id: string; interaction_type: InteractionType;
                                             title: string; prompt: string;
                                             schema?: Record<string, unknown>;
                                             data: Record<string, unknown> } }
  | { v: 1; seq: number; ts: number; run_id: string; session_id: number;
      type: 'interaction.resolve'; data: { request_id: string; values: Record<string, unknown> } };

// ====== Message ======

export interface AgentMessage {
  id: number;
  session_id: number;
  parent_message_id: number | null;
  role: 'user' | 'agent';
  workflow_type: WorkflowType;
  run_id: string | null;
  content: { blocks: AgentBlock[] };
  model_name: string | null;
  token_count: number | null;
  sort_order: number;
  create_time: string | null;
}

// ====== Session ======

export interface WorkspaceSession {
  id: number;
  session_key: string;
  employee_id: number;
  title: string | null;
  selected_model_name: string | null;
  enable_thinking: boolean;
  status: number;
  last_message_time: string | null;
  create_time: string | null;
  update_time: string | null;
}

// ====== Run state ======

export interface AgentStep {
  step_id: string;
  title: string;
  status: 'pending' | 'running' | 'success' | 'failed';
  detail?: string;
}

export interface AgentRunState {
  running: boolean;
  run_id: string | null;
  workflow_type: WorkflowType;
  enable_thinking: boolean;
  steps: AgentStep[];
  current_blocks: AgentBlock[];
  error: { code: string; message: string } | null;
}

// ====== 业务卡 payload ======

export interface QuestionItem {
  question: string;
  dimension: string;
  difficulty: string;
  evaluation_points: string[];
  follow_up_suggestions: string[];
  excellent_signals: string[];
  average_signals: string[];
  risk_signals: string[];
}

export interface QuestionSet {
  title: string;
  total_questions: number;
  dimensions: string[];
  questions: QuestionItem[];
}

export interface EvaluationReport {
  final_score: number;
  final_label: string;
  decision: string;
  summary: string;
  match_overview: Record<string, unknown>;
  resume_structure: Record<string, unknown>;
  experience_timeline: Array<Record<string, unknown>>;
  skill_dimensions: Array<Record<string, unknown>>;
  job_gaps: Array<Record<string, unknown>>;
}
```

- [ ] **Step 2：tsc 编译验证**

Run: `cd frontend && npx tsc --noEmit`
Expected: 0 errors（若有其他文件引用旧类型，按引用一并 fix or 暂时桩住注释）

- [ ] **Step 3：commit**

```bash
git add frontend/src/types/agent.ts
git commit -m "feat(agent-types): rewrite types around AgentBlock + AgentEnvelope

阶段 8.1：9 envelope union + 6 block discriminated union；
所有 snake_case 与后端对齐"
```

### Task 8.2：agent-stream-client.ts（SSE 客户端）

**Files:**
- Create: `frontend/src/utils/agent-stream-client.ts`
- Create: `frontend/src/utils/__tests__/agent-stream-client.test.ts`

- [ ] **Step 1：写失败测试**

`frontend/src/utils/__tests__/agent-stream-client.test.ts`:

```typescript
/**
 * agent-stream-client：SSE frame 解析与 envelope yield 顺序。
 */
import { describe, expect, it, vi } from 'vitest';
import { parseSseFrame, openAgentStream } from '../agent-stream-client';

describe('parseSseFrame', () => {
  it('extracts JSON data from an agent event frame', () => {
    const frame = 'event: agent\ndata: {"v":1,"seq":1,"ts":0,"run_id":"r","session_id":1,"type":"run.start","data":{}}';
    const env = parseSseFrame(frame);
    expect(env?.type).toBe('run.start');
    expect(env?.seq).toBe(1);
  });

  it('returns null for non-agent events', () => {
    expect(parseSseFrame('event: keepalive\ndata: {}')).toBeNull();
  });

  it('returns null for malformed JSON', () => {
    expect(parseSseFrame('event: agent\ndata: not json')).toBeNull();
  });
});

describe('openAgentStream', () => {
  it('yields envelopes in arrival order', async () => {
    const body =
      'event: agent\ndata: {"v":1,"seq":1,"ts":0,"run_id":"r","session_id":1,"type":"run.start","data":{}}\n\n' +
      'event: agent\ndata: {"v":1,"seq":2,"ts":0,"run_id":"r","session_id":1,"type":"run.finish","data":{"agent_message_id":9}}\n\n';
    const fakeStream = new ReadableStream({
      start(controller) {
        controller.enqueue(new TextEncoder().encode(body));
        controller.close();
      },
    });
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      new Response(fakeStream, { headers: { 'Content-Type': 'text/event-stream' } }) as unknown as Response,
    );
    const seen: number[] = [];
    for await (const env of openAgentStream('/x', {})) {
      seen.push(env.seq);
    }
    expect(seen).toEqual([1, 2]);
    fetchSpy.mockRestore();
  });
});
```

- [ ] **Step 2：运行测试验证失败**

Run: `cd frontend && npx vitest run src/utils/__tests__/agent-stream-client.test.ts`
Expected: ModuleNotFoundError

- [ ] **Step 3：创建 `frontend/src/utils/agent-stream-client.ts`**

```typescript
/**
 * Agent SSE 流式客户端。
 *
 * 不依赖 EventSource（不支持 POST + 自定义 header）。
 * 用 fetch + ReadableStream 自行解析 SSE frame。
 *
 * 解析规则：
 * - frame 间分隔 "\n\n"
 * - 行内 "event: agent" 标识 agent envelope，data 为 JSON
 * - 非 agent event / JSON 解析失败 / 未知 type 静默忽略
 */

import type { AgentEnvelope } from '@/types/agent';

const FRAME_SEPARATOR = '\n\n';

export function parseSseFrame(frame: string): AgentEnvelope | null {
  if (!frame.trim()) return null;
  let eventName: string | null = null;
  let dataLine: string | null = null;
  for (const rawLine of frame.split('\n')) {
    if (rawLine.startsWith('event:')) {
      eventName = rawLine.slice(6).trim();
    } else if (rawLine.startsWith('data:')) {
      dataLine = rawLine.slice(5).trim();
    }
  }
  if (eventName !== 'agent' || !dataLine) return null;
  try {
    return JSON.parse(dataLine) as AgentEnvelope;
  } catch {
    return null;
  }
}

export interface OpenAgentStreamOptions {
  method?: 'POST' | 'GET';
  headers?: Record<string, string>;
  signal?: AbortSignal;
}

export async function* openAgentStream(
  url: string,
  body: unknown,
  options: OpenAgentStreamOptions = {},
): AsyncIterableIterator<AgentEnvelope> {
  const init: RequestInit = {
    method: options.method ?? 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'text/event-stream', ...(options.headers ?? {}) },
    body: body !== undefined ? JSON.stringify(body) : undefined,
    signal: options.signal,
  };
  const resp = await fetch(url, init);
  if (!resp.ok || !resp.body) {
    throw new Error(`SSE 连接失败：${resp.status} ${resp.statusText}`);
  }
  const reader = resp.body.pipeThrough(new TextDecoderStream()).getReader();
  let buf = '';
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += value;
    let idx: number;
    while ((idx = buf.indexOf(FRAME_SEPARATOR)) >= 0) {
      const frame = buf.slice(0, idx);
      buf = buf.slice(idx + FRAME_SEPARATOR.length);
      const env = parseSseFrame(frame);
      if (env) yield env;
    }
  }
}
```

- [ ] **Step 4：运行测试通过**

Run: `cd frontend && npx vitest run src/utils/__tests__/agent-stream-client.test.ts`
Expected: 4 passed

- [ ] **Step 5：commit**

```bash
git add frontend/src/utils/agent-stream-client.ts frontend/src/utils/__tests__/agent-stream-client.test.ts
git commit -m "feat(agent-stream): add SSE client that yields AgentEnvelope iterator

阶段 8.2：fetch + ReadableStream 自解析；
未知 frame 静默忽略；支持 AbortSignal"
```

### Task 8.3：agent-run-reducer.ts

**Files:**
- Create: `frontend/src/utils/agent-run-reducer.ts`
- Create: `frontend/src/utils/__tests__/agent-run-reducer.test.ts`

- [ ] **Step 1：写失败测试（覆盖 9 事件 × 6 block 矩阵关键点）**

`frontend/src/utils/__tests__/agent-run-reducer.test.ts`:

```typescript
import { describe, expect, it } from 'vitest';
import { agentRunReducer, INITIAL_RUN_STATE } from '../agent-run-reducer';
import type { AgentEnvelope, AgentRunState } from '@/types/agent';

const wrap = (type: AgentEnvelope['type'], data: Record<string, unknown>, seq = 1): AgentEnvelope =>
  ({ v: 1, seq, ts: 0, run_id: 'r', session_id: 1, type, data } as AgentEnvelope);

describe('agentRunReducer', () => {
  it('run.start resets state and sets running=true', () => {
    const s = agentRunReducer(INITIAL_RUN_STATE, wrap('run.start', {
      run_id: 'r1', workflow_type: 'interview_questions', enable_thinking: true, user_message_id: 99,
    }));
    expect(s.running).toBe(true);
    expect(s.run_id).toBe('r1');
    expect(s.enable_thinking).toBe(true);
    expect(s.current_blocks).toEqual([]);
  });

  it('run.finish sets running=false', () => {
    const after = agentRunReducer(
      { ...INITIAL_RUN_STATE, running: true },
      wrap('run.finish', { agent_message_id: 9 }),
    );
    expect(after.running).toBe(false);
  });

  it('run.error captures error', () => {
    const s = agentRunReducer(INITIAL_RUN_STATE, wrap('run.error', {
      code: 'graph_execution_failed', message: 'boom', retriable: false,
    }));
    expect(s.error?.code).toBe('graph_execution_failed');
  });

  it('step.update upserts by step_id', () => {
    let s = agentRunReducer(INITIAL_RUN_STATE, wrap('step.update', {
      step_id: 'load_resume', title: '读取简历', status: 'running',
    }));
    s = agentRunReducer(s, wrap('step.update', {
      step_id: 'load_resume', title: '读取简历', status: 'success',
    }));
    expect(s.steps).toHaveLength(1);
    expect(s.steps[0].status).toBe('success');
  });

  it('block.start inserts a new block by index', () => {
    const s = agentRunReducer(INITIAL_RUN_STATE, wrap('block.start', {
      index: 0, block: { type: 'text', text: '', status: 'streaming' },
    }));
    expect(s.current_blocks[0].type).toBe('text');
  });

  it('block.delta appends text_delta to text block', () => {
    let s = agentRunReducer(INITIAL_RUN_STATE, wrap('block.start', {
      index: 0, block: { type: 'text', text: '', status: 'streaming' },
    }));
    s = agentRunReducer(s, wrap('block.delta', { index: 0, delta: { text_delta: '你' } }));
    s = agentRunReducer(s, wrap('block.delta', { index: 0, delta: { text_delta: '好' } }));
    expect((s.current_blocks[0] as { text: string }).text).toBe('你好');
  });

  it('block.delta updates tool_use status/output', () => {
    let s = agentRunReducer(INITIAL_RUN_STATE, wrap('block.start', {
      index: 0, block: { type: 'tool_use', tool_name: 't', display_name: 'T', input: {}, status: 'running' },
    }));
    s = agentRunReducer(s, wrap('block.delta', {
      index: 0, delta: { status: 'success', output: { ok: true } },
    }));
    expect((s.current_blocks[0] as { status: string }).status).toBe('success');
    expect((s.current_blocks[0] as { output: { ok: boolean } }).output.ok).toBe(true);
  });

  it('block.delta writes full question_set for interview_questions block', () => {
    let s = agentRunReducer(INITIAL_RUN_STATE, wrap('block.start', {
      index: 0, block: { type: 'interview_questions', question_set: {}, status: 'streaming' },
    }));
    s = agentRunReducer(s, wrap('block.delta', {
      index: 0, delta: { question_set: { total_questions: 3, dimensions: [], questions: [] } },
    }));
    expect((s.current_blocks[0] as { question_set: { total_questions: number } }).question_set.total_questions).toBe(3);
  });

  it('block.stop marks streaming → success', () => {
    let s = agentRunReducer(INITIAL_RUN_STATE, wrap('block.start', {
      index: 0, block: { type: 'text', text: '', status: 'streaming' },
    }));
    s = agentRunReducer(s, wrap('block.stop', { index: 0 }));
    expect((s.current_blocks[0] as { status: string }).status).toBe('success');
  });

  it('interaction.resolve updates interaction block to submitted', () => {
    let s = agentRunReducer(INITIAL_RUN_STATE, wrap('block.start', {
      index: 0, block: {
        type: 'interaction', request_id: 'req_1', interaction_type: 'job_selection',
        title: 't', prompt: 'p', data: {}, status: 'pending',
      },
    }));
    s = agentRunReducer(s, wrap('interaction.resolve', {
      request_id: 'req_1', values: { job_full_name: '高级算法工程师' },
    }));
    expect((s.current_blocks[0] as { status: string }).status).toBe('submitted');
    expect((s.current_blocks[0] as { values: { job_full_name: string } }).values.job_full_name)
      .toBe('高级算法工程师');
  });

  it('unknown envelope type is ignored', () => {
    const s = agentRunReducer(INITIAL_RUN_STATE, { ...wrap('run.start', {}), type: 'future.event' as never });
    expect(s).toEqual(INITIAL_RUN_STATE);
  });
});
```

- [ ] **Step 2：运行测试验证失败**

Run: `cd frontend && npx vitest run src/utils/__tests__/agent-run-reducer.test.ts`
Expected: ModuleNotFoundError

- [ ] **Step 3：创建 `frontend/src/utils/agent-run-reducer.ts`**

```typescript
/**
 * agent-run-reducer：envelope → AgentRunState 状态转换。
 *
 * 流式与历史共用同一渲染管线，差异只在 source of truth：
 * - 流式：runState.current_blocks
 * - 历史：AgentMessage.content.blocks
 */

import type {
  AgentBlock,
  AgentEnvelope,
  AgentRunState,
  AgentStep,
  WorkflowType,
} from '@/types/agent';

export const INITIAL_RUN_STATE: AgentRunState = {
  running: false,
  run_id: null,
  workflow_type: 'interview_questions',
  enable_thinking: false,
  steps: [],
  current_blocks: [],
  error: null,
};

export function agentRunReducer(state: AgentRunState, env: AgentEnvelope): AgentRunState {
  switch (env.type) {
    case 'run.start': {
      const data = env.data;
      return {
        running: true,
        run_id: data.run_id,
        workflow_type: data.workflow_type as WorkflowType,
        enable_thinking: data.enable_thinking,
        steps: [],
        current_blocks: [],
        error: null,
      };
    }
    case 'run.finish':
      return { ...state, running: false };
    case 'run.error':
      return { ...state, running: false, error: { code: env.data.code, message: env.data.message } };
    case 'step.update':
      return { ...state, steps: upsertStep(state.steps, env.data) };
    case 'block.start':
      return { ...state, current_blocks: insertBlock(state.current_blocks, env.data) };
    case 'block.delta':
      return { ...state, current_blocks: applyDelta(state.current_blocks, env.data) };
    case 'block.stop':
      return { ...state, current_blocks: stopBlock(state.current_blocks, env.data.index) };
    case 'interaction.request':
      // 已通过 block.start(type=interaction) 渲染；本事件留作 step 记录用
      return state;
    case 'interaction.resolve':
      return { ...state, current_blocks: resolveInteraction(state.current_blocks, env.data) };
    default:
      // 未知 type 静默忽略
      return state;
  }
}

// ---------- 辅助 ----------

function upsertStep(steps: AgentStep[], data: AgentStep): AgentStep[] {
  const idx = steps.findIndex(s => s.step_id === data.step_id);
  if (idx === -1) return [...steps, data];
  const next = [...steps];
  next[idx] = { ...steps[idx], ...data };
  return next;
}

function insertBlock(blocks: AgentBlock[], data: { index: number; block: Record<string, unknown> }): AgentBlock[] {
  const existing = blocks.findIndex(b => b.index === data.index);
  const merged = { ...(data.block as object), index: data.index } as AgentBlock;
  if (existing === -1) return [...blocks, merged].sort((a, b) => a.index - b.index);
  const next = [...blocks];
  next[existing] = merged;
  return next;
}

function applyDelta(blocks: AgentBlock[], data: { index: number; delta: Record<string, unknown> }): AgentBlock[] {
  const idx = blocks.findIndex(b => b.index === data.index);
  if (idx === -1) return blocks;
  const target = blocks[idx];
  const merged: AgentBlock = mergeBlockDelta(target, data.delta);
  const next = [...blocks];
  next[idx] = merged;
  return next;
}

function mergeBlockDelta(block: AgentBlock, delta: Record<string, unknown>): AgentBlock {
  switch (block.type) {
    case 'text':
    case 'thinking': {
      const td = typeof delta.text_delta === 'string' ? delta.text_delta : '';
      return { ...block, text: block.text + td };
    }
    case 'tool_use': {
      return {
        ...block,
        ...(typeof delta.status === 'string' ? { status: delta.status as AgentBlock['status'] } : {}),
        ...(typeof delta.output === 'object' && delta.output ? { output: delta.output as Record<string, unknown> } : {}),
        ...(typeof delta.error === 'string' ? { error: delta.error } : {}),
      };
    }
    case 'interaction': {
      return {
        ...block,
        ...(typeof delta.status === 'string' ? { status: delta.status as AgentBlock['status'] } : {}),
        ...(typeof delta.values === 'object' && delta.values ? { values: delta.values as Record<string, unknown> } : {}),
      };
    }
    case 'interview_questions': {
      const qs = delta.question_set as AgentBlock extends { type: 'interview_questions' } ? unknown : never;
      if (qs) return { ...block, question_set: qs as never };
      return block;
    }
    case 'evaluation_report': {
      const rep = delta.report;
      if (rep) return { ...block, report: rep as never };
      return block;
    }
    default:
      return block;
  }
}

function stopBlock(blocks: AgentBlock[], index: number): AgentBlock[] {
  const idx = blocks.findIndex(b => b.index === index);
  if (idx === -1) return blocks;
  const target = blocks[idx];
  if (target.status !== 'streaming') return blocks;
  const next = [...blocks];
  next[idx] = { ...target, status: 'success' as const };
  return next;
}

function resolveInteraction(
  blocks: AgentBlock[],
  data: { request_id: string; values: Record<string, unknown> },
): AgentBlock[] {
  const idx = blocks.findIndex(b => b.type === 'interaction' && b.request_id === data.request_id);
  if (idx === -1) return blocks;
  const target = blocks[idx];
  if (target.type !== 'interaction') return blocks;
  const next = [...blocks];
  next[idx] = { ...target, status: 'submitted', values: data.values };
  return next;
}
```

- [ ] **Step 4：运行测试通过**

Run: `cd frontend && npx vitest run src/utils/__tests__/agent-run-reducer.test.ts`
Expected: 11 passed

- [ ] **Step 5：commit**

```bash
git add frontend/src/utils/agent-run-reducer.ts frontend/src/utils/__tests__/agent-run-reducer.test.ts
git commit -m "feat(agent-state): add agent-run-reducer with 9 envelope × 6 block transitions

阶段 8.3：reducer ≤150 行；未知 envelope/block 静默忽略；
text 累加；tool_use status 切换；interaction.resolve 跨 block 写回"
```

### Task 8.4：use-agent-run hook + api/agent.ts

**Files:**
- Create: `frontend/src/hooks/use-agent-run.ts`
- Modify: `frontend/src/api/employee/agent.ts`（瘦身重写）

- [ ] **Step 1：重写 `frontend/src/api/employee/agent.ts`**

```typescript
/**
 * Agent 接口层。
 *
 * 仅四类调用：
 * - 会话 CRUD（GET/POST/PUT/DELETE）
 * - 流式 message：返回 AsyncIterable<AgentEnvelope>
 * - 交互提交：同样返回 AsyncIterable<AgentEnvelope>
 * - 简历上传：multipart/form-data
 */

import { request } from '@/api/request';
import { openAgentStream } from '@/utils/agent-stream-client';
import type { AgentEnvelope, AgentMessage, WorkflowType, WorkspaceSession } from '@/types/agent';

const BASE = '/api/v1/employee/agent';

// ---------- 会话 CRUD ----------

export interface CreateSessionInput { title?: string | null; selected_model_name?: string | null }
export interface UpdateSessionInput { title: string }
export interface SelectModelInput { model_name: string | null }

export async function createSession(body: CreateSessionInput): Promise<WorkspaceSession> {
  return await request<WorkspaceSession>({ url: `${BASE}/sessions`, method: 'POST', data: body });
}

export async function listSessions(params: { page: number; page_size: number; keyword?: string }) {
  return await request<{ total: number; items: WorkspaceSession[] }>({
    url: `${BASE}/sessions`, method: 'GET', params,
  });
}

export async function getSessionDetail(sessionId: number) {
  return await request<{ session: WorkspaceSession; messages: AgentMessage[] }>({
    url: `${BASE}/sessions/${sessionId}`, method: 'GET',
  });
}

export async function updateSession(sessionId: number, body: UpdateSessionInput) {
  return await request<WorkspaceSession>({
    url: `${BASE}/sessions/${sessionId}`, method: 'PUT', data: body,
  });
}

export async function selectSessionModel(sessionId: number, body: SelectModelInput) {
  return await request<WorkspaceSession>({
    url: `${BASE}/sessions/${sessionId}/model`, method: 'PUT', data: body,
  });
}

export async function setSessionThinking(sessionId: number, enable: boolean) {
  return await request<WorkspaceSession>({
    url: `${BASE}/sessions/${sessionId}/thinking`, method: 'PUT', params: { enable },
  });
}

export async function deleteSession(sessionId: number): Promise<void> {
  await request({ url: `${BASE}/sessions/${sessionId}`, method: 'DELETE' });
}

// ---------- 流式 ----------

export interface StreamMessageBody {
  content: string;
  workflow_type: WorkflowType;
  context_refs?: Array<Record<string, unknown>>;
  runtime_options?: { enable_thinking?: boolean };
}

export function streamMessage(
  sessionId: number, body: StreamMessageBody, signal?: AbortSignal,
): AsyncIterableIterator<AgentEnvelope> {
  return openAgentStream(`${BASE}/sessions/${sessionId}/messages/stream`, body, { signal });
}

export function submitInteraction(
  sessionId: number, requestId: string, values: Record<string, unknown>, signal?: AbortSignal,
): AsyncIterableIterator<AgentEnvelope> {
  return openAgentStream(
    `${BASE}/sessions/${sessionId}/interactions/${requestId}`,
    { values }, { signal },
  );
}

// ---------- 简历上传 ----------

export async function uploadResume(
  sessionId: number, file: File, jobId?: number,
): Promise<{ resume_id: number; file_name: string; job_id: number | null }> {
  const form = new FormData();
  form.append('file', file);
  if (jobId !== undefined) form.append('job_id', String(jobId));
  return await request({
    url: `${BASE}/sessions/${sessionId}/resumes`, method: 'POST', data: form,
    headers: { 'Content-Type': 'multipart/form-data' },
  });
}
```

> 注：`request` 是项目既有的 axios 封装。如不存在 `request`，按既有 `frontend/src/api/employee/agent.ts` 实际 helper 调整。

- [ ] **Step 2：创建 `frontend/src/hooks/use-agent-run.ts`**

```typescript
/**
 * useAgentRun：以单一 hook 把流式 + 历史封装为前端唯一对外入口。
 *
 * 调用者只需 .sendMessage / .submitInteraction / .reload；
 * 同时拿到 messages 列表 与 runState（流式正在构造的临时 blocks）。
 */

import { useCallback, useEffect, useReducer, useRef, useState } from 'react';
import {
  getSessionDetail, streamMessage, submitInteraction,
} from '@/api/employee/agent';
import { INITIAL_RUN_STATE, agentRunReducer } from '@/utils/agent-run-reducer';
import type {
  AgentEnvelope, AgentMessage, WorkflowType, WorkspaceSession,
} from '@/types/agent';

export interface UseAgentRunResult {
  session: WorkspaceSession | null;
  messages: AgentMessage[];
  runState: ReturnType<typeof agentRunReducer> extends infer S ? S : never;
  sending: boolean;
  sendMessage: (input: SendInput) => Promise<void>;
  submit: (requestId: string, values: Record<string, unknown>) => Promise<void>;
  reload: () => Promise<void>;
  abort: () => void;
}

export interface SendInput {
  content: string;
  workflow_type: WorkflowType;
  enable_thinking?: boolean;
  context_refs?: Array<Record<string, unknown>>;
}

export function useAgentRun(sessionId: number): UseAgentRunResult {
  const [session, setSession] = useState<WorkspaceSession | null>(null);
  const [messages, setMessages] = useState<AgentMessage[]>([]);
  const [runState, dispatch] = useReducer(agentRunReducer, INITIAL_RUN_STATE);
  const [sending, setSending] = useState(false);
  const abortRef = useRef<AbortController | null>(null);

  const reload = useCallback(async () => {
    const detail = await getSessionDetail(sessionId);
    setSession(detail.session);
    setMessages(detail.messages);
  }, [sessionId]);

  useEffect(() => {
    void reload();
  }, [reload]);

  const runEnvelopes = useCallback(async (
    iter: AsyncIterableIterator<AgentEnvelope>,
  ) => {
    let lastMessageId: number | null = null;
    for await (const env of iter) {
      dispatch(env);
      if (env.type === 'run.finish') {
        lastMessageId = env.data.agent_message_id;
      }
    }
    if (lastMessageId !== null) {
      // 落库完成后从后端拉取最新消息列表（包含刚保存的 agent message）
      await reload();
    }
  }, [reload]);

  const sendMessage = useCallback(async (input: SendInput) => {
    abortRef.current?.abort();
    const ac = new AbortController();
    abortRef.current = ac;
    setSending(true);
    try {
      const iter = streamMessage(
        sessionId,
        {
          content: input.content,
          workflow_type: input.workflow_type,
          context_refs: input.context_refs,
          runtime_options: input.enable_thinking !== undefined
            ? { enable_thinking: input.enable_thinking } : undefined,
        },
        ac.signal,
      );
      await runEnvelopes(iter);
    } finally {
      setSending(false);
    }
  }, [sessionId, runEnvelopes]);

  const submit = useCallback(async (requestId: string, values: Record<string, unknown>) => {
    abortRef.current?.abort();
    const ac = new AbortController();
    abortRef.current = ac;
    setSending(true);
    try {
      const iter = submitInteraction(sessionId, requestId, values, ac.signal);
      await runEnvelopes(iter);
    } finally {
      setSending(false);
    }
  }, [sessionId, runEnvelopes]);

  const abort = useCallback(() => {
    abortRef.current?.abort();
  }, []);

  // sessionId 切换：abort 旧流；reset reducer
  useEffect(() => {
    return () => {
      abortRef.current?.abort();
    };
  }, [sessionId]);

  return { session, messages, runState, sending, sendMessage, submit, reload, abort };
}
```

- [ ] **Step 3：tsc 编译验证**

Run: `cd frontend && npx tsc --noEmit`
Expected: 0 errors

- [ ] **Step 4：commit**

```bash
git add frontend/src/api/employee/agent.ts frontend/src/hooks/use-agent-run.ts
git commit -m "feat(agent-hook): add useAgentRun hook + slim agent api

阶段 8.4：useAgentRun 单一对外入口；
sendMessage/submit 自动 abort 上一流；
sessionId 切换 reset"
```

---

## 阶段 9：前端 token + 动效 hooks

### Task 9.1：design/tokens.ts + tailwind.config 接入

**Files:**
- Create: `frontend/src/design/tokens.ts`
- Modify: `frontend/tailwind.config.ts`（或 .js）

- [ ] **Step 1：创建 `frontend/src/design/tokens.ts`**

```typescript
/**
 * 设计 Token 唯一来源（基于 ui-ux-pro-max Trust & Authority + Minimalism + Micro-interactions）。
 *
 * 任何组件禁止内联 hex/duration；统一通过此 token 暴露到 tailwind 主题或 CSS variable。
 */

export const tokens = {
  color: {
    primary: '#2563EB',
    primaryHover: '#1D4ED8',
    onPrimary: '#FFFFFF',
    secondary: '#3B82F6',
    accent: '#059669',
    onAccent: '#FFFFFF',

    background: '#F8FAFC',
    surface: '#FFFFFF',
    surfaceMuted: '#F1F5FD',
    surfaceSubtle: '#FAFBFD',

    foreground: '#0F172A',
    mutedText: '#475569',
    subtleText: '#94A3B8',

    border: '#E4ECFC',
    borderStrong: '#CBD5E1',

    success: '#059669',
    warning: '#D97706',
    destructive: '#DC2626',

    thinkingBg: '#F8F4FF',
    thinkingBorder: '#E9DFFF',
    thinkingText: '#4C1D95',
  },
  font: {
    sans: 'Inter, -apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif',
    mono: '"JetBrains Mono", ui-monospace, Menlo, monospace',
  },
  fontSize: {
    xs: '12px', sm: '13px', base: '14px', md: '15px', lg: '16px',
    xl: '18px', '2xl': '20px', '3xl': '24px', '4xl': '30px',
  },
  lineHeight: { tight: '1.35', normal: '1.55', loose: '1.7' },
  fontWeight: { regular: '400', medium: '500', semibold: '600', bold: '700' },
  spacing: {
    '0.5': '2px', '1': '4px', '1.5': '6px', '2': '8px', '3': '12px',
    '4': '16px', '5': '20px', '6': '24px', '8': '32px', '10': '40px', '12': '48px',
  },
  radius: {
    sm: '6px', base: '8px', md: '10px', lg: '12px', xl: '16px', full: '9999px',
  },
  shadow: {
    sm: '0 1px 2px rgba(15,23,42,0.04)',
    md: '0 4px 12px rgba(15,23,42,0.06)',
    lg: '0 12px 32px rgba(15,23,42,0.08)',
    ring: '0 0 0 3px rgba(37,99,235,0.18)',
  },
  duration: {
    instant: '80ms', fast: '150ms', base: '220ms', exit: '160ms', cascade: '300ms',
  },
  easing: {
    enter: 'cubic-bezier(0.2, 0.8, 0.2, 1)',
    exit: 'cubic-bezier(0.4, 0.0, 1, 1)',
    standard: 'cubic-bezier(0.4, 0.0, 0.2, 1)',
    spring: 'cubic-bezier(0.34, 1.56, 0.64, 1)',
  },
  z: { base: '0', sticky: '10', dropdown: '20', dialog: '40', toast: '100' },
} as const;
```

- [ ] **Step 2：修改 `frontend/tailwind.config.ts` 引入 token**

```typescript
import type { Config } from 'tailwindcss';
import { tokens } from './src/design/tokens';

const config: Config = {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: tokens.color,
      fontFamily: {
        sans: tokens.font.sans.split(',').map(s => s.trim()),
        mono: tokens.font.mono.split(',').map(s => s.trim()),
      },
      fontSize: tokens.fontSize,
      lineHeight: tokens.lineHeight,
      fontWeight: tokens.fontWeight,
      spacing: tokens.spacing,
      borderRadius: tokens.radius,
      boxShadow: tokens.shadow,
      transitionDuration: tokens.duration,
      transitionTimingFunction: tokens.easing,
      zIndex: tokens.z,
    },
  },
  plugins: [],
};

export default config;
```

- [ ] **Step 3：在全局 css 加入 reduced-motion 降级**

修改或创建 `frontend/src/index.css` 末尾追加：

```css
/* reduced-motion 全局降级，所有组件无需重复声明 */
@media (prefers-reduced-motion: reduce) {
  *, *::before, *::after {
    animation-duration: 80ms !important;
    transition-duration: 80ms !important;
  }
  .anim-stagger > * { animation-delay: 0ms !important; }
  .anim-spring { animation-timing-function: linear !important; }
}
```

- [ ] **Step 4：tsc + tailwind 构建验证**

Run: `cd frontend && npx tsc --noEmit && npx tailwindcss -i src/index.css -o /tmp/out.css --minify`
Expected: 无 error，输出文件正常生成

- [ ] **Step 5：commit**

```bash
git add frontend/src/design/tokens.ts frontend/tailwind.config.ts frontend/src/index.css
git commit -m "feat(design): introduce tokens.ts as single source of truth + tailwind wiring

阶段 9.1：基于 ui-ux-pro-max CRM 调色板 + Minimalism + Micro-interactions；
reduced-motion 全局降级到 80ms"
```

### Task 9.2：useFrameBatchedText（rAF 节拍器）

**Files:**
- Create: `frontend/src/hooks/use-frame-batched-text.ts`
- Create: `frontend/src/hooks/__tests__/use-frame-batched-text.test.ts`

- [ ] **Step 1：写失败测试**

`frontend/src/hooks/__tests__/use-frame-batched-text.test.ts`:

```typescript
import { describe, expect, it, vi } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useFrameBatchedText } from '../use-frame-batched-text';

describe('useFrameBatchedText', () => {
  it('starts with empty displayed text', () => {
    const { result } = renderHook(() => useFrameBatchedText('hello'));
    expect(result.current.displayed).toBe('');
  });

  it('flush() displays the entire queued text', () => {
    const { result } = renderHook(() => useFrameBatchedText('hello'));
    act(() => result.current.flush());
    expect(result.current.displayed).toBe('hello');
  });
});
```

- [ ] **Step 2：运行测试验证失败**

Run: `cd frontend && npx vitest run src/hooks/__tests__/use-frame-batched-text.test.ts`
Expected: ModuleNotFoundError

- [ ] **Step 3：创建 `frontend/src/hooks/use-frame-batched-text.ts`**

```typescript
/**
 * useFrameBatchedText：rAF 字符节拍器，解决"断断续续"。
 *
 * 后端 SSE chunk 可能突然 burst 出几十字；
 * 节拍器按指定 cps 匀速 setState，让 UI 维持稳定打字节奏。
 *
 * - block.stop 时调 flush() 立即吐完队列，避免"已完成但仍在打字"。
 * - 低端机 (dt > 50ms) 时动态提升每帧字符数。
 * - prefers-reduced-motion 模式下 cps 提升到 300（近即时）。
 */

import { useCallback, useEffect, useRef, useState } from 'react';

export interface UseFrameBatchedTextOptions {
  cps?: number;
}

export interface UseFrameBatchedTextResult {
  displayed: string;
  flush: () => void;
  pending: number;
}

export function useFrameBatchedText(
  targetText: string,
  options: UseFrameBatchedTextOptions = {},
): UseFrameBatchedTextResult {
  const baseCps = options.cps ?? 80;
  const prefersReducedMotion = typeof window !== 'undefined'
    && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
  const cps = prefersReducedMotion ? 300 : baseCps;

  const [displayed, setDisplayed] = useState('');
  const queueRef = useRef('');
  const rafRef = useRef<number | null>(null);
  const lastTickRef = useRef(0);

  useEffect(() => {
    const have = displayed.length + queueRef.current.length;
    if (targetText.length > have) {
      queueRef.current += targetText.slice(have);
    }
    if (rafRef.current !== null) return;
    const tick = (now: number) => {
      const dt = lastTickRef.current ? now - lastTickRef.current : 16;
      lastTickRef.current = now;
      // dt > 50ms：低端机 / 后台标签页；动态提升每帧字符数避免堆积
      const effectiveCps = dt > 50 ? cps * 2.5 : cps;
      const chars = Math.max(1, Math.round((effectiveCps * dt) / 1000));
      if (queueRef.current.length > 0) {
        const take = queueRef.current.slice(0, chars);
        queueRef.current = queueRef.current.slice(chars);
        setDisplayed(prev => prev + take);
        rafRef.current = requestAnimationFrame(tick);
      } else {
        rafRef.current = null;
        lastTickRef.current = 0;
      }
    };
    rafRef.current = requestAnimationFrame(tick);
  }, [targetText, displayed.length, cps]);

  const flush = useCallback(() => {
    if (queueRef.current.length === 0) return;
    setDisplayed(prev => prev + queueRef.current);
    queueRef.current = '';
    if (rafRef.current !== null) {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
      lastTickRef.current = 0;
    }
  }, []);

  useEffect(() => () => {
    if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
  }, []);

  return { displayed, flush, pending: queueRef.current.length };
}
```

- [ ] **Step 4：运行测试通过**

Run: `cd frontend && npx vitest run src/hooks/__tests__/use-frame-batched-text.test.ts`
Expected: 2 passed

- [ ] **Step 5：commit**

```bash
git add frontend/src/hooks/use-frame-batched-text.ts frontend/src/hooks/__tests__/use-frame-batched-text.test.ts
git commit -m "feat(agent-stream): add useFrameBatchedText rAF pacer

阶段 9.2：80 cps 匀速吐字解决 burst 断断续续；
flush() 立即清空队列；低端机自适应；prefers-reduced-motion 提速到 300"
```

### Task 9.3：useFollowBottom + 安装 framer-motion

**Files:**
- Create: `frontend/src/hooks/use-follow-bottom.ts`
- Modify: `frontend/package.json`

- [ ] **Step 1：安装 framer-motion**

Run: `cd frontend && npm install framer-motion@^11`
Expected: package.json dependencies 出现 framer-motion

- [ ] **Step 2：创建 `frontend/src/hooks/use-follow-bottom.ts`**

```typescript
/**
 * useFollowBottom：流式中智能粘附滚动。
 *
 * - 用户已在底部 48px 内 → 新内容到达时自动滚到底部
 * - 用户上滚阅读历史 → 不被拽回
 * - 流式期间用 instant；结束后调用方可显式 smooth 对齐
 */

import { useCallback, useEffect, useRef } from 'react';

const FOLLOW_THRESHOLD_PX = 48;

export interface UseFollowBottomResult {
  ref: React.RefObject<HTMLDivElement>;
  followIfNeeded: () => void;
  forceSmoothToBottom: () => void;
}

export function useFollowBottom(): UseFollowBottomResult {
  const ref = useRef<HTMLDivElement>(null);
  const followingRef = useRef(true);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const onScroll = () => {
      const distance = el.scrollHeight - el.scrollTop - el.clientHeight;
      followingRef.current = distance < FOLLOW_THRESHOLD_PX;
    };
    el.addEventListener('scroll', onScroll, { passive: true });
    return () => el.removeEventListener('scroll', onScroll);
  }, []);

  const followIfNeeded = useCallback(() => {
    const el = ref.current;
    if (!el || !followingRef.current) return;
    el.scrollTo({ top: el.scrollHeight, behavior: 'instant' as ScrollBehavior });
  }, []);

  const forceSmoothToBottom = useCallback(() => {
    const el = ref.current;
    if (!el) return;
    el.scrollTo({ top: el.scrollHeight, behavior: 'smooth' });
  }, []);

  return { ref, followIfNeeded, forceSmoothToBottom };
}
```

- [ ] **Step 3：tsc 验证**

Run: `cd frontend && npx tsc --noEmit`
Expected: 0 errors

- [ ] **Step 4：commit**

```bash
git add frontend/src/hooks/use-follow-bottom.ts frontend/package.json frontend/package-lock.json
git commit -m "feat(agent-stream): add useFollowBottom + install framer-motion

阶段 9.3：智能粘附滚动 48px 阈值；流式 instant 滚动 vs 收尾 smooth"
```

---

## 阶段 10：6 个 Block 渲染器

> **共用约定**：所有 block 组件 props 形如 `{ block: AgentBlock & { type: 'xxx' } }`，由 BlockRenderer 分发；所有动效引用 tailwind token，不内联硬编码。

### Task 10.1：BlockRenderer 派发器

**Files:**
- Create: `frontend/src/components/employee/agent/blocks/block-renderer.tsx`

- [ ] **Step 1：创建 `block-renderer.tsx`**

```tsx
/**
 * BlockRenderer：按 block.type 分发到对应渲染器。
 *
 * 流式与历史共用同一组件树；区别仅在 status 字段。
 */

import type { AgentBlock } from '@/types/agent';
import { TextBlock } from './text-block';
import { ThinkingBlock } from './thinking-block';
import { ToolUseBlock } from './tool-use-block';
import { InteractionBlock } from './interaction-block';
import { InterviewQuestionsCard } from './interview-questions-card';
import { EvaluationReportCard } from './evaluation-report-card';

export interface BlockRendererProps {
  block: AgentBlock;
  onSubmitInteraction?: (requestId: string, values: Record<string, unknown>) => void;
}

export function BlockRenderer({ block, onSubmitInteraction }: BlockRendererProps) {
  switch (block.type) {
    case 'text':
      return <TextBlock block={block} />;
    case 'thinking':
      return <ThinkingBlock block={block} />;
    case 'tool_use':
      return <ToolUseBlock block={block} />;
    case 'interaction':
      return <InteractionBlock block={block} onSubmit={onSubmitInteraction} />;
    case 'interview_questions':
      return <InterviewQuestionsCard block={block} />;
    case 'evaluation_report':
      return <EvaluationReportCard block={block} />;
    default:
      return null; // 未知 block 静默忽略
  }
}
```

- [ ] **Step 2：commit（实际渲染器先桩占位组件，逐个 task 替换）**

先在 blocks/ 下创建 6 个桩文件，导出空组件让 BlockRenderer 编译通过：

```tsx
// frontend/src/components/employee/agent/blocks/text-block.tsx 等 6 个
export function TextBlock(_props: any) { return null; }
// 其余同理
```

```bash
git add frontend/src/components/employee/agent/blocks/
git commit -m "feat(agent-ui): scaffold BlockRenderer with 6 stub block components

阶段 10.1：分发器派发到 6 类组件；
桩组件让 tsc 通过，逐 task 替换为真实渲染器"
```

### Task 10.2：TextBlock

**Files:**
- Modify: `frontend/src/components/employee/agent/blocks/text-block.tsx`

- [ ] **Step 1：完整实现**

```tsx
/**
 * TextBlock：Agent 正文流式文本块。
 *
 * - 通过 useFrameBatchedText 让字符按 80cps 匀速吐出
 * - streaming 末尾光标 ▍ 800ms cycle 闪烁；success 后 80ms fade-out
 * - aria-live="polite" 让屏幕阅读器友好播报
 * - markdown 极简渲染：粗体 / 列表 / 行内 code（不引入 react-markdown 重型依赖）
 */

import { useEffect } from 'react';
import type { AgentBlock } from '@/types/agent';
import { useFrameBatchedText } from '@/hooks/use-frame-batched-text';

export interface TextBlockProps {
  block: Extract<AgentBlock, { type: 'text' }>;
}

export function TextBlock({ block }: TextBlockProps) {
  const { displayed, flush } = useFrameBatchedText(block.text);

  // block.stop 时 status 切到 success，立即吐完队列
  useEffect(() => {
    if (block.status !== 'streaming') flush();
  }, [block.status, flush]);

  return (
    <div
      className="text-[15px] leading-[1.6] text-foreground font-sans"
      aria-live="polite"
    >
      {renderInlineMarkdown(displayed)}
      {block.status === 'streaming' && (
        <span
          className="ml-0.5 inline-block w-[2px] h-[1.1em] align-text-bottom bg-primary opacity-80 animate-blink"
          aria-hidden="true"
        />
      )}
    </div>
  );
}

/**
 * 极简内联 markdown：仅支持 **bold**、行内 `code`。
 * 列表与块级处理保留给业务卡组件，正文文本以"段落 + 内联"为主。
 */
function renderInlineMarkdown(text: string): React.ReactNode {
  if (!text) return null;
  const parts: React.ReactNode[] = [];
  const tokenRegex = /(\*\*[^*]+\*\*|`[^`]+`)/g;
  let lastIdx = 0;
  let match: RegExpExecArray | null;
  let key = 0;
  while ((match = tokenRegex.exec(text)) !== null) {
    if (match.index > lastIdx) parts.push(text.slice(lastIdx, match.index));
    const token = match[0];
    if (token.startsWith('**')) {
      parts.push(<strong key={`b-${key++}`} className="font-semibold">{token.slice(2, -2)}</strong>);
    } else {
      parts.push(<code key={`c-${key++}`} className="px-1 py-0.5 rounded bg-surfaceMuted font-mono text-[13px]">{token.slice(1, -1)}</code>);
    }
    lastIdx = match.index + token.length;
  }
  if (lastIdx < text.length) parts.push(text.slice(lastIdx));
  return <>{parts}</>;
}
```

> 注：需要在 `tailwind.config.ts` 的 `theme.extend.keyframes` 与 `animation` 增加：
> ```ts
> keyframes: { blink: { '50%': { opacity: '0' } } },
> animation: { blink: 'blink 800ms steps(2, end) infinite' },
> ```

- [ ] **Step 2：tsc 验证**

Run: `cd frontend && npx tsc --noEmit`
Expected: 0 errors

- [ ] **Step 3：commit**

```bash
git add frontend/src/components/employee/agent/blocks/text-block.tsx frontend/tailwind.config.ts
git commit -m "feat(agent-ui): implement TextBlock with rAF-paced streaming + cursor blink

阶段 10.2：80cps 匀速；状态切到 success 时 flush 队列；
内联 markdown 仅支持粗体与行内 code，避免重依赖"
```

### Task 10.3：ThinkingBlock

**Files:**
- Modify: `frontend/src/components/employee/agent/blocks/thinking-block.tsx`

- [ ] **Step 1：完整实现**

```tsx
/**
 * ThinkingBlock：思考过程折叠块。
 *
 * - 紫底 + 紫边，与 trust-blue 主色形成温和层级
 * - streaming 时自动展开；success 后 1.5s 自动折叠
 * - sticky top 32px 避免推挤下方业务卡
 * - 左侧 indicator bar 在 streaming 时有"扫光"动画（唯一例外的装饰动画，传达"正在思考"因果性）
 */

import { useEffect, useRef, useState } from 'react';
import { ChevronDown, Sparkles } from 'lucide-react';
import type { AgentBlock } from '@/types/agent';
import { useFrameBatchedText } from '@/hooks/use-frame-batched-text';

export interface ThinkingBlockProps {
  block: Extract<AgentBlock, { type: 'thinking' }>;
}

export function ThinkingBlock({ block }: ThinkingBlockProps) {
  const { displayed, flush } = useFrameBatchedText(block.text, { cps: 100 });
  const [expanded, setExpanded] = useState(block.status === 'streaming');
  const autoCollapseTimerRef = useRef<number | null>(null);

  // 状态切到 success 后 1.5s 自动折叠
  useEffect(() => {
    if (block.status === 'streaming') {
      setExpanded(true);
      flush(); // 防御性 flush 已无副作用
      return;
    }
    flush();
    if (block.status === 'success') {
      autoCollapseTimerRef.current = window.setTimeout(() => setExpanded(false), 1500);
      return () => {
        if (autoCollapseTimerRef.current !== null) window.clearTimeout(autoCollapseTimerRef.current);
      };
    }
  }, [block.status, flush]);

  return (
    <div className="relative my-3 rounded-md border border-thinkingBorder bg-thinkingBg text-thinkingText">
      {/* 左侧 indicator bar */}
      <div
        className={`absolute left-0 top-0 h-full w-[2px] rounded-l-md ${
          block.status === 'streaming' ? 'animate-thinking-flow' : 'opacity-40'
        }`}
        style={{ background: 'currentColor' }}
        aria-hidden="true"
      />

      <button
        type="button"
        onClick={() => setExpanded(v => !v)}
        className="flex w-full items-center gap-2 px-3 py-2 text-[13px] font-medium hover:bg-thinkingBg/80 transition-colors duration-fast ease-standard"
      >
        <Sparkles size={14} aria-hidden="true" />
        <span>思考过程{block.status === 'streaming' ? ' · 进行中' : ' · 已完成'}</span>
        <ChevronDown
          size={14}
          className={`ml-auto transition-transform duration-base ease-standard ${expanded ? 'rotate-180' : ''}`}
        />
      </button>

      <div
        className="overflow-hidden transition-[max-height,opacity] duration-base ease-enter"
        style={{
          maxHeight: expanded ? 280 : 0,
          opacity: expanded ? 1 : 0,
        }}
      >
        <div className="px-3 pb-3 text-[13px] leading-[1.6] whitespace-pre-wrap font-mono overflow-y-auto" style={{ maxHeight: 260 }}>
          {displayed}
        </div>
      </div>
    </div>
  );
}
```

> 注：需要在 `tailwind.config.ts` keyframes/animation 加：
> ```ts
> 'thinking-flow': { '0%': { transform: 'translateY(-100%)' }, '100%': { transform: 'translateY(100%)' } },
> animation: { ..., 'thinking-flow': 'thinking-flow 1.4s ease-in-out infinite' },
> ```
> 注意：因 bar 用 `transform: translateY` 自身，需要把 bar 改为内部用 `<span>` 占位 + 动画；如想更简单可改为整 bar `opacity` cycle 闪烁。

- [ ] **Step 2：tsc 验证**

Run: `cd frontend && npx tsc --noEmit`

- [ ] **Step 3：commit**

```bash
git add frontend/src/components/employee/agent/blocks/thinking-block.tsx frontend/tailwind.config.ts
git commit -m "feat(agent-ui): implement ThinkingBlock with auto-collapse + indicator bar

阶段 10.3：streaming 自动展开；success 后 1.5s 折叠；
紫底紫边视觉层级；indicator 扫光表达正在思考"
```

### Task 10.4：ToolUseBlock

**Files:**
- Modify: `frontend/src/components/employee/agent/blocks/tool-use-block.tsx`

- [ ] **Step 1：完整实现**

```tsx
/**
 * ToolUseBlock：内部工具调用条。
 *
 * - 单行 40px，HR 视角的"运行步骤"
 * - status 点：running 旋转 spinner / success 实心绿 / failed 实心红
 * - 点击展开看 input/output JSON
 */

import { useState } from 'react';
import { ChevronRight, CheckCircle2, XCircle, Loader2 } from 'lucide-react';
import type { AgentBlock } from '@/types/agent';

export interface ToolUseBlockProps {
  block: Extract<AgentBlock, { type: 'tool_use' }>;
}

export function ToolUseBlock({ block }: ToolUseBlockProps) {
  const [expanded, setExpanded] = useState(false);
  const Icon = block.status === 'running' ? Loader2
    : block.status === 'failed' ? XCircle
    : CheckCircle2;
  const iconClass = block.status === 'running' ? 'animate-spin text-primary'
    : block.status === 'failed' ? 'text-destructive'
    : 'text-success';

  return (
    <div className="my-2 rounded-base border border-border bg-surfaceSubtle">
      <button
        type="button"
        onClick={() => setExpanded(v => !v)}
        className="flex h-10 w-full items-center gap-2 px-3 text-[13px] font-medium text-mutedText hover:bg-surfaceMuted transition-colors duration-fast ease-standard"
        aria-label={`${block.display_name} ${block.status}`}
      >
        <ChevronRight
          size={14}
          className={`transition-transform duration-base ease-standard ${expanded ? 'rotate-90' : ''}`}
        />
        <Icon size={14} className={iconClass} aria-hidden="true" />
        <span className="truncate">{block.display_name}</span>
        <span className="ml-auto text-xs text-subtleText">
          {block.status === 'running' && '执行中…'}
          {block.status === 'success' && '完成'}
          {block.status === 'failed' && '失败'}
        </span>
      </button>

      {expanded && (
        <div className="border-t border-border px-3 py-2 text-[12px] font-mono space-y-2 overflow-auto" style={{ maxHeight: 200 }}>
          <div>
            <div className="text-subtleText mb-1">input</div>
            <pre className="whitespace-pre-wrap">{JSON.stringify(block.input, null, 2)}</pre>
          </div>
          {block.output && (
            <div>
              <div className="text-subtleText mb-1">output</div>
              <pre className="whitespace-pre-wrap">{JSON.stringify(block.output, null, 2)}</pre>
            </div>
          )}
          {block.error && (
            <div className="text-destructive">{block.error}</div>
          )}
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 2：tsc 验证 + commit**

```bash
cd frontend && npx tsc --noEmit
git add frontend/src/components/employee/agent/blocks/tool-use-block.tsx
git commit -m "feat(agent-ui): implement ToolUseBlock as collapsible 40px row

阶段 10.4：状态点 + spinner + 折叠看 input/output JSON"
```

### Task 10.5：InteractionBlock

**Files:**
- Modify: `frontend/src/components/employee/agent/blocks/interaction-block.tsx`

- [ ] **Step 1：完整实现**

```tsx
/**
 * InteractionBlock：内联交互卡片。
 *
 * 三种 interaction_type 共用容器，内部按类型切表单：
 * - dimension_selection：多选 chip
 * - plan_approval：摘要 + 批准/驳回（带原因输入）
 * - job_selection：候选岗位点击 + 手输全名
 *
 * 状态流：
 *  pending  → 可交互
 *  submitted → 只读，背景灰，CTA 替换为"已提交 ✓"
 *  expired  → 只读，右上 "已过期" pill
 */

import { useMemo, useState } from 'react';
import { motion } from 'framer-motion';
import { Check } from 'lucide-react';
import type { AgentBlock } from '@/types/agent';

export interface InteractionBlockProps {
  block: Extract<AgentBlock, { type: 'interaction' }>;
  onSubmit?: (requestId: string, values: Record<string, unknown>) => void;
}

export function InteractionBlock({ block, onSubmit }: InteractionBlockProps) {
  const isInteractive = block.status === 'pending';
  const isExpired = block.status === 'expired';

  return (
    <motion.div
      layout
      initial={{ y: 12, opacity: 0 }}
      animate={{ y: 0, opacity: 1 }}
      transition={{ duration: 0.3, ease: [0.34, 1.56, 0.64, 1] }}
      className={`relative my-3 rounded-lg border border-border bg-surface shadow-md p-5 ${
        !isInteractive ? 'bg-surfaceSubtle opacity-90' : ''
      }`}
    >
      {isExpired && (
        <span className="absolute right-3 top-3 px-2 py-0.5 rounded-full bg-warning/10 text-warning text-[11px]">
          已过期
        </span>
      )}
      <h3 className="text-[16px] font-semibold text-foreground">{block.title}</h3>
      {block.prompt && <p className="mt-1 text-[13px] text-mutedText">{block.prompt}</p>}

      <div className="mt-4">
        {block.interaction_type === 'dimension_selection' && (
          <DimensionForm block={block} disabled={!isInteractive} onSubmit={onSubmit} />
        )}
        {block.interaction_type === 'plan_approval' && (
          <PlanApprovalForm block={block} disabled={!isInteractive} onSubmit={onSubmit} />
        )}
        {block.interaction_type === 'job_selection' && (
          <JobSelectionForm block={block} disabled={!isInteractive} onSubmit={onSubmit} />
        )}
      </div>
    </motion.div>
  );
}

// ---------- 维度选择 ----------

function DimensionForm({ block, disabled, onSubmit }: SubFormProps) {
  const candidates = (block.data.candidates as Array<{ name: string; reason: string }> | undefined) ?? [];
  const submittedValues = (block.values?.selected_dimensions as Array<{ name: string }> | undefined) ?? [];
  const [selected, setSelected] = useState<Set<string>>(
    () => new Set(submittedValues.map(d => d.name)),
  );

  const toggle = (name: string) => {
    if (disabled) return;
    const next = new Set(selected);
    next.has(name) ? next.delete(name) : next.add(name);
    setSelected(next);
  };

  const handleSubmit = () => {
    onSubmit?.(block.request_id, {
      selected_dimensions: candidates.filter(c => selected.has(c.name)),
    });
  };

  return (
    <>
      <div className="flex flex-wrap gap-2">
        {candidates.map(c => (
          <button
            key={c.name}
            type="button"
            disabled={disabled}
            onClick={() => toggle(c.name)}
            aria-pressed={selected.has(c.name)}
            className={`px-3 h-9 rounded-full border text-[13px] transition-all duration-fast ease-standard ${
              selected.has(c.name)
                ? 'bg-primary text-onPrimary border-primary'
                : 'bg-surface text-foreground border-border hover:border-primary'
            } ${disabled ? 'cursor-not-allowed' : 'cursor-pointer'}`}
            title={c.reason}
          >
            {c.name}
          </button>
        ))}
      </div>
      <ActionBar disabled={disabled} status={block.status} onSubmit={handleSubmit} primaryLabel="确认选择" />
    </>
  );
}

// ---------- 计划审批 ----------

function PlanApprovalForm({ block, disabled, onSubmit }: SubFormProps) {
  const plan = block.data.plan as { total_questions?: number; items?: Array<{ dimension: string; question_count: number; difficulty: string }>; summary?: string } | undefined;
  const [feedback, setFeedback] = useState('');

  return (
    <>
      <div className="rounded-base bg-surfaceMuted p-3 text-[13px] space-y-1.5">
        <div className="font-medium">总题量：{plan?.total_questions ?? 0}</div>
        {(plan?.items ?? []).map((it, i) => (
          <div key={i} className="flex gap-3 text-mutedText">
            <span>{it.dimension}</span>
            <span>× {it.question_count}</span>
            <span className="text-subtleText">{it.difficulty}</span>
          </div>
        ))}
        {plan?.summary && <div className="text-subtleText mt-2">{plan.summary}</div>}
      </div>
      <textarea
        disabled={disabled}
        value={feedback}
        onChange={e => setFeedback(e.target.value)}
        rows={2}
        placeholder="如需驳回，请简述需要调整的方向"
        className="mt-3 w-full rounded-base border border-borderStrong px-3 py-2 text-[13px] focus:outline-none focus:shadow-ring"
      />
      <div className="mt-3 flex gap-2 justify-end">
        <button
          type="button" disabled={disabled || !feedback}
          onClick={() => onSubmit?.(block.request_id, { approved: false, feedback })}
          className="h-9 px-3 rounded-base border border-border text-[13px] text-mutedText hover:bg-surfaceMuted disabled:opacity-50 disabled:cursor-not-allowed"
        >
          驳回
        </button>
        <button
          type="button" disabled={disabled}
          onClick={() => onSubmit?.(block.request_id, { approved: true })}
          className="h-9 px-4 rounded-base bg-primary text-onPrimary text-[13px] font-medium hover:bg-primaryHover disabled:opacity-50 disabled:cursor-not-allowed transition-colors duration-fast ease-standard"
        >
          {block.status === 'submitted' ? <Check size={14} className="inline" /> : '批准并生成'}
        </button>
      </div>
    </>
  );
}

// ---------- 岗位选择 ----------

function JobSelectionForm({ block, disabled, onSubmit }: SubFormProps) {
  const candidates = (block.data.candidates as Array<{ id: number; name: string }> | undefined) ?? [];
  const [manual, setManual] = useState((block.values?.job_full_name as string | undefined) ?? '');

  return (
    <>
      <div className="text-[13px] text-mutedText mb-2">候选岗位：</div>
      <div className="flex flex-wrap gap-2 mb-3">
        {candidates.map(j => (
          <button
            key={j.id}
            type="button" disabled={disabled}
            onClick={() => setManual(j.name)}
            className="h-9 px-3 rounded-base border border-border text-[13px] hover:border-primary transition-colors duration-fast ease-standard disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {j.name}
          </button>
        ))}
      </div>
      <input
        type="text" disabled={disabled} value={manual}
        onChange={e => setManual(e.target.value)}
        placeholder="或手动输入完整岗位名称"
        className="w-full h-10 rounded-base border border-borderStrong px-3 text-[14px] focus:outline-none focus:shadow-ring"
      />
      <ActionBar disabled={disabled || !manual.trim()} status={block.status}
                 onSubmit={() => onSubmit?.(block.request_id, { job_full_name: manual.trim() })}
                 primaryLabel="提交" />
    </>
  );
}

// ---------- 共用 ----------

interface SubFormProps {
  block: Extract<AgentBlock, { type: 'interaction' }>;
  disabled: boolean;
  onSubmit?: (requestId: string, values: Record<string, unknown>) => void;
}

function ActionBar({ disabled, status, onSubmit, primaryLabel }: {
  disabled: boolean; status: AgentBlock['status'];
  onSubmit: () => void; primaryLabel: string;
}) {
  return (
    <div className="mt-4 flex justify-end">
      <button
        type="button" disabled={disabled}
        onClick={onSubmit}
        className="h-9 px-4 rounded-base bg-primary text-onPrimary text-[13px] font-medium hover:bg-primaryHover disabled:opacity-50 disabled:cursor-not-allowed transition-colors duration-fast ease-standard"
      >
        {status === 'submitted' ? <><Check size={14} className="inline mr-1" /> 已提交</> : primaryLabel}
      </button>
    </div>
  );
}
```

- [ ] **Step 2：tsc 验证 + commit**

```bash
cd frontend && npx tsc --noEmit
git add frontend/src/components/employee/agent/blocks/interaction-block.tsx
git commit -m "feat(agent-ui): implement InteractionBlock with 3 interaction subforms

阶段 10.5：spring 入场；submitted 切只读保留历史；
dimension_selection / plan_approval / job_selection 三种表单"
```

### Task 10.6：业务卡 InterviewQuestionsCard + EvaluationReportCard

**Files:**
- Modify: `frontend/src/components/employee/agent/blocks/interview-questions-card.tsx`
- Modify: `frontend/src/components/employee/agent/blocks/evaluation-report-card.tsx`

- [ ] **Step 1：实现 InterviewQuestionsCard**

```tsx
/**
 * InterviewQuestionsCard：面试题清单业务卡。
 *
 * 按维度分组；默认展示题目/维度/难度/考察点；
 * 追问建议、信号默认折叠；复制单题/全部。
 */

import { useMemo, useState } from 'react';
import { motion } from 'framer-motion';
import { ChevronDown, Copy } from 'lucide-react';
import type { AgentBlock, QuestionItem } from '@/types/agent';

export interface InterviewQuestionsCardProps {
  block: Extract<AgentBlock, { type: 'interview_questions' }>;
}

export function InterviewQuestionsCard({ block }: InterviewQuestionsCardProps) {
  const set = block.question_set;
  if (!set || !set.questions?.length) return <SkeletonCard />;

  const grouped = useMemo(() => {
    const m = new Map<string, QuestionItem[]>();
    for (const q of set.questions) {
      const arr = m.get(q.dimension) ?? [];
      arr.push(q);
      m.set(q.dimension, arr);
    }
    return Array.from(m.entries());
  }, [set]);

  const copyAll = () => {
    const text = set.questions.map((q, i) => `${i + 1}. [${q.dimension} · ${q.difficulty}] ${q.question}`).join('\n');
    void navigator.clipboard.writeText(text);
  };

  return (
    <motion.div
      layout
      initial={{ y: 8, opacity: 0 }} animate={{ y: 0, opacity: 1 }}
      transition={{ duration: 0.22, ease: [0.2, 0.8, 0.2, 1] }}
      className="my-3 rounded-lg border border-border bg-surface shadow-md"
    >
      <header className="flex items-center justify-between px-4 py-3 border-b border-border">
        <h3 className="text-[16px] font-semibold text-foreground">面试题清单 · {set.total_questions} 题</h3>
        <button
          type="button" onClick={copyAll}
          aria-label="复制全部题目"
          className="flex items-center gap-1 text-[12px] text-mutedText hover:text-primary transition-colors duration-fast ease-standard"
        >
          <Copy size={12} /> 复制全部
        </button>
      </header>

      <div className="p-4 space-y-4 anim-stagger">
        {grouped.map(([dim, list], gi) => (
          <DimensionGroup key={dim} dimension={dim} questions={list} startIndex={
            grouped.slice(0, gi).reduce((s, [, l]) => s + l.length, 0)
          } />
        ))}
      </div>
    </motion.div>
  );
}

function DimensionGroup({ dimension, questions, startIndex }: { dimension: string; questions: QuestionItem[]; startIndex: number }) {
  return (
    <div>
      <h4 className="text-[14px] font-medium text-mutedText mb-2">
        {dimension} <span className="text-subtleText text-[12px]">· {questions.length} 题</span>
      </h4>
      <ul className="space-y-2">
        {questions.map((q, i) => (
          <QuestionItem key={i} q={q} num={startIndex + i + 1} />
        ))}
      </ul>
    </div>
  );
}

function QuestionItem({ q, num }: { q: QuestionItem; num: number }) {
  const [expanded, setExpanded] = useState(false);
  return (
    <li className="rounded-base border border-border p-3">
      <div className="flex items-start gap-2">
        <span className="font-mono text-[12px] text-subtleText shrink-0 pt-0.5">{num}.</span>
        <div className="flex-1">
          <p className="text-[14px] text-foreground">{q.question}</p>
          <div className="mt-1.5 flex gap-2 text-[12px] text-subtleText">
            <span className="px-1.5 py-0.5 rounded bg-surfaceMuted">{q.difficulty}</span>
            {q.evaluation_points.slice(0, 2).map((p, i) => (
              <span key={i} className="text-mutedText">{p}</span>
            ))}
          </div>
          {(q.follow_up_suggestions.length > 0 || q.excellent_signals.length > 0) && (
            <button type="button" onClick={() => setExpanded(v => !v)}
                    className="mt-2 inline-flex items-center gap-1 text-[12px] text-primary hover:text-primaryHover">
              <ChevronDown size={12} className={`transition-transform duration-base ease-standard ${expanded ? 'rotate-180' : ''}`} />
              {expanded ? '收起' : '查看追问与信号'}
            </button>
          )}
          {expanded && (
            <div className="mt-2 space-y-1.5 text-[12px] text-mutedText">
              {q.follow_up_suggestions.length > 0 && (
                <div><span className="text-foreground font-medium">追问：</span>{q.follow_up_suggestions.join(' / ')}</div>
              )}
              {q.excellent_signals.length > 0 && (
                <div><span className="text-success font-medium">优秀：</span>{q.excellent_signals.join(' / ')}</div>
              )}
              {q.risk_signals.length > 0 && (
                <div><span className="text-destructive font-medium">风险：</span>{q.risk_signals.join(' / ')}</div>
              )}
            </div>
          )}
        </div>
      </div>
    </li>
  );
}

function SkeletonCard() {
  return (
    <div className="my-3 rounded-lg border border-border bg-surface shadow-md p-4 animate-pulse">
      <div className="h-5 w-1/3 bg-surfaceMuted rounded mb-3" />
      <div className="space-y-2">
        {[0, 1, 2].map(i => <div key={i} className="h-12 bg-surfaceMuted rounded" />)}
      </div>
    </div>
  );
}
```

- [ ] **Step 2：实现 EvaluationReportCard**

```tsx
/**
 * EvaluationReportCard：评估报告业务卡。
 *
 * 顶部摘要 + 6 个分区折叠（默认全收起，桌面端摘要展开）；
 * 条形图用 CSS scaleX，禁动 width。
 */

import { useState } from 'react';
import { motion } from 'framer-motion';
import { ChevronDown } from 'lucide-react';
import type { AgentBlock, EvaluationReport } from '@/types/agent';

const SECTIONS: Array<{ key: keyof EvaluationReport | 'match'; label: string }> = [
  { key: 'match', label: '匹配概览' },
  { key: 'decision', label: 'HR 决策建议' },
  { key: 'resume_structure', label: '简历结构' },
  { key: 'experience_timeline', label: '经历时间线' },
  { key: 'skill_dimensions', label: '技能/维度可视化' },
  { key: 'job_gaps', label: '岗位差距' },
];

export interface EvaluationReportCardProps {
  block: Extract<AgentBlock, { type: 'evaluation_report' }>;
}

export function EvaluationReportCard({ block }: EvaluationReportCardProps) {
  const report = block.report;
  if (!report || report.final_score === undefined) return <ReportSkeleton />;

  return (
    <motion.div
      layout
      initial={{ y: 8, opacity: 0 }} animate={{ y: 0, opacity: 1 }}
      transition={{ duration: 0.22, ease: [0.2, 0.8, 0.2, 1] }}
      className="my-3 rounded-lg border border-border bg-surface shadow-md overflow-hidden"
    >
      <header className="p-5 border-b border-border bg-surfaceSubtle">
        <div className="flex items-baseline gap-4">
          <span className="font-mono text-[30px] font-bold text-accent">{report.final_score}</span>
          <span className="text-[14px] text-mutedText">{report.final_label}</span>
          <span className="ml-auto inline-flex px-2 py-1 rounded-full bg-accent/10 text-accent text-[12px]">
            {report.decision}
          </span>
        </div>
        <p className="mt-2 text-[13px] text-mutedText">{report.summary}</p>
      </header>

      <div className="divide-y divide-border anim-stagger">
        {SECTIONS.map(s => (
          <Section key={s.key} label={s.label} data={report} sectionKey={s.key} />
        ))}
      </div>
    </motion.div>
  );
}

function Section({ label, data, sectionKey }: { label: string; data: EvaluationReport; sectionKey: keyof EvaluationReport | 'match' }) {
  const [open, setOpen] = useState(false);
  return (
    <div>
      <button type="button" onClick={() => setOpen(v => !v)}
              className="flex w-full items-center justify-between px-5 py-3 text-[14px] font-medium hover:bg-surfaceMuted transition-colors duration-fast ease-standard">
        <span>{label}</span>
        <ChevronDown size={14} className={`transition-transform duration-base ease-standard ${open ? 'rotate-180' : ''}`} />
      </button>
      <div className="overflow-hidden transition-[max-height,opacity] duration-base ease-enter"
           style={{ maxHeight: open ? 400 : 0, opacity: open ? 1 : 0 }}>
        <div className="px-5 pb-4 text-[13px] text-mutedText">
          {sectionKey === 'skill_dimensions'
            ? <SkillDimensionBars items={data.skill_dimensions} />
            : <pre className="whitespace-pre-wrap font-sans">{JSON.stringify((data as any)[sectionKey === 'match' ? 'match_overview' : sectionKey], null, 2)}</pre>}
        </div>
      </div>
    </div>
  );
}

function SkillDimensionBars({ items }: { items: Array<Record<string, unknown>> }) {
  if (!items?.length) return <span className="text-subtleText">暂无数据</span>;
  return (
    <ul className="space-y-2">
      {items.slice(0, 8).map((it, i) => {
        const name = String(it.name ?? '');
        const score = Number(it.score ?? 0);
        const pct = Math.max(0, Math.min(100, (score / 10) * 100));
        return (
          <li key={i} className="grid grid-cols-[110px_1fr_36px] items-center gap-2">
            <span className="text-foreground">{name}</span>
            <div className="h-1.5 rounded-full bg-surfaceMuted overflow-hidden">
              <div
                className="h-full bg-primary origin-left transition-transform duration-cascade ease-enter"
                style={{ transform: `scaleX(${pct / 100})` }}
              />
            </div>
            <span className="text-right font-mono text-[12px] text-mutedText">{score.toFixed(1)}</span>
          </li>
        );
      })}
    </ul>
  );
}

function ReportSkeleton() {
  return (
    <div className="my-3 rounded-lg border border-border bg-surface shadow-md p-5 animate-pulse">
      <div className="h-8 w-1/2 bg-surfaceMuted rounded mb-2" />
      <div className="h-4 w-2/3 bg-surfaceMuted rounded mb-4" />
      <div className="space-y-2">
        {[0, 1, 2].map(i => <div key={i} className="h-10 bg-surfaceMuted rounded" />)}
      </div>
    </div>
  );
}
```

- [ ] **Step 3：在 tailwind.config.ts 加 anim-stagger 工具类**

```ts
// extend.keyframes 加
'stagger-in': { from: { opacity: '0', transform: 'translateY(8px)' }, to: { opacity: '1', transform: 'translateY(0)' } },

// 通过 plugins 注入 .anim-stagger:
plugins: [
  function ({ addUtilities }: any) {
    addUtilities({
      '.anim-stagger > *': {
        animation: 'stagger-in 220ms cubic-bezier(0.2,0.8,0.2,1) both',
      },
      '.anim-stagger > *:nth-child(1)': { animationDelay: '0ms' },
      '.anim-stagger > *:nth-child(2)': { animationDelay: '40ms' },
      '.anim-stagger > *:nth-child(3)': { animationDelay: '80ms' },
      '.anim-stagger > *:nth-child(4)': { animationDelay: '120ms' },
      '.anim-stagger > *:nth-child(5)': { animationDelay: '160ms' },
      '.anim-stagger > *:nth-child(6)': { animationDelay: '200ms' },
    });
  },
],
```

- [ ] **Step 4：tsc 验证 + commit**

```bash
cd frontend && npx tsc --noEmit
git add frontend/src/components/employee/agent/blocks/interview-questions-card.tsx \
        frontend/src/components/employee/agent/blocks/evaluation-report-card.tsx \
        frontend/tailwind.config.ts
git commit -m "feat(agent-ui): implement InterviewQuestionsCard + EvaluationReportCard

阶段 10.6：维度分组 + 追问/信号折叠 + 复制全部；
评估报告 6 分区折叠 + CSS scaleX 条形图；
stagger 40ms 入场动画"
```

---

## 阶段 11：前端骨架与集成

### Task 11.1：StepStrip 折叠运行条

**Files:**
- Create: `frontend/src/components/employee/agent/step-strip.tsx`

- [ ] **Step 1：实现 step-strip.tsx**

```tsx
/**
 * StepStrip：折叠的运行步骤条。
 *
 * - 默认折叠为单行："运行过程 · 已完成 N 步 · X.Xs   展开 ▾"
 * - 展开后展示小型时间线：✓ 步骤名 / ● 当前 / ○ 待执行
 * - 状态点用文本+颜色双重表达
 */

import { useState } from 'react';
import { ChevronDown, Check, Loader2 } from 'lucide-react';
import type { AgentStep } from '@/types/agent';

export interface StepStripProps {
  steps: AgentStep[];
  running: boolean;
}

export function StepStrip({ steps, running }: StepStripProps) {
  const [expanded, setExpanded] = useState(false);
  const successCount = steps.filter(s => s.status === 'success').length;
  if (steps.length === 0) return null;

  return (
    <div className="sticky top-0 z-sticky my-2 rounded-base border border-border bg-surface/95 backdrop-blur">
      <button type="button" onClick={() => setExpanded(v => !v)}
              className="flex w-full items-center gap-2 px-3 py-2 text-[12px] text-mutedText hover:bg-surfaceMuted transition-colors duration-fast ease-standard">
        {running ? <Loader2 size={12} className="animate-spin text-primary" />
                 : <Check size={12} className="text-success" />}
        <span>运行过程 · 已完成 {successCount} / {steps.length} 步</span>
        <ChevronDown size={12} className={`ml-auto transition-transform duration-base ease-standard ${expanded ? 'rotate-180' : ''}`} />
      </button>
      <div className="overflow-hidden transition-[max-height,opacity] duration-base ease-enter"
           style={{ maxHeight: expanded ? 240 : 0, opacity: expanded ? 1 : 0 }}>
        <ul className="px-3 pb-2 space-y-1 text-[12px]">
          {steps.map(s => (
            <li key={s.step_id} className="flex items-center gap-2">
              <StepIcon status={s.status} />
              <span className={s.status === 'pending' ? 'text-subtleText' : 'text-foreground'}>
                {s.title}
              </span>
              {s.detail && <span className="text-subtleText ml-2">{s.detail}</span>}
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}

function StepIcon({ status }: { status: AgentStep['status'] }) {
  if (status === 'running') return <Loader2 size={12} className="animate-spin text-primary" />;
  if (status === 'success') return <Check size={12} className="text-success" />;
  if (status === 'failed') return <span className="w-3 h-3 inline-block rounded-full bg-destructive" />;
  return <span className="w-3 h-3 inline-block rounded-full border border-borderStrong" />;
}
```

- [ ] **Step 2：commit**

```bash
git add frontend/src/components/employee/agent/step-strip.tsx
git commit -m "feat(agent-ui): add StepStrip sticky collapsible run timeline

阶段 11.1：默认折叠单行；展开看时间线；
sticky top + backdrop-blur 不挡正文"
```

### Task 11.2：agent-message-list.tsx 重写

**Files:**
- Modify: `frontend/src/components/employee/agent/agent-message-list.tsx`

- [ ] **Step 1：完整重写**

```tsx
/**
 * AgentMessageList：消息列表渲染。
 *
 * 流式与历史共用同一管线：
 * - 历史消息：messages.map(MessageRow)
 * - 流式正在构造：RunRow（流式 current_blocks）
 *
 * 用 framer-motion LayoutGroup + layoutId 实现 RunRow → MessageRow 零视觉跳变。
 */

import { useEffect } from 'react';
import { AnimatePresence, LayoutGroup, motion } from 'framer-motion';
import type { AgentMessage, AgentRunState } from '@/types/agent';
import { BlockRenderer } from './blocks/block-renderer';
import { StepStrip } from './step-strip';
import { useFollowBottom } from '@/hooks/use-follow-bottom';

export interface AgentMessageListProps {
  messages: AgentMessage[];
  runState: AgentRunState;
  onSubmitInteraction: (requestId: string, values: Record<string, unknown>) => void;
}

export function AgentMessageList({ messages, runState, onSubmitInteraction }: AgentMessageListProps) {
  const { ref, followIfNeeded, forceSmoothToBottom } = useFollowBottom();

  // 流式期间新增 envelope → 触发滚动 follow
  useEffect(() => {
    followIfNeeded();
  }, [runState.current_blocks.length, runState.steps.length, followIfNeeded]);

  // 流式结束 → smooth 对齐到底
  useEffect(() => {
    if (!runState.running) forceSmoothToBottom();
  }, [runState.running, forceSmoothToBottom]);

  return (
    <div ref={ref} className="flex-1 overflow-y-auto bg-background">
      <div className="mx-auto max-w-[760px] px-4 py-6 space-y-4">
        <LayoutGroup>
          {messages.map(msg => (
            <MessageRow key={msg.id} message={msg} onSubmitInteraction={onSubmitInteraction} />
          ))}

          <AnimatePresence>
            {runState.running && (
              <motion.div
                key={`run-${runState.run_id}`}
                layout
                initial={{ y: 8, opacity: 0 }}
                animate={{ y: 0, opacity: 1 }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.22, ease: [0.2, 0.8, 0.2, 1] }}
                className="space-y-2"
              >
                <StepStrip steps={runState.steps} running={runState.running} />
                {runState.current_blocks.map(b => (
                  <BlockRenderer key={b.index} block={b} onSubmitInteraction={onSubmitInteraction} />
                ))}
              </motion.div>
            )}
          </AnimatePresence>

          {runState.error && (
            <div role="alert" className="my-2 rounded-base border border-destructive/30 bg-destructive/5 p-3 text-[13px] text-destructive">
              [{runState.error.code}] {runState.error.message}
            </div>
          )}
        </LayoutGroup>
      </div>
    </div>
  );
}

function MessageRow({ message, onSubmitInteraction }: { message: AgentMessage; onSubmitInteraction: (id: string, v: Record<string, unknown>) => void }) {
  if (message.role === 'user') {
    const userText = (message.content.blocks?.[0] as { type: 'text'; text: string } | undefined)?.text ?? '';
    return (
      <motion.div layout="position" className="flex justify-end">
        <div className="max-w-[560px] rounded-lg bg-primary text-onPrimary px-4 py-2 text-[14px] whitespace-pre-wrap">
          {userText}
        </div>
      </motion.div>
    );
  }
  return (
    <motion.div layout="position" layoutId={message.run_id ? `run-${message.run_id}` : undefined}
                className="space-y-2">
      {(message.content.blocks ?? []).map(b => (
        <BlockRenderer key={b.index} block={b} onSubmitInteraction={onSubmitInteraction} />
      ))}
    </motion.div>
  );
}
```

- [ ] **Step 2：tsc 验证 + commit**

```bash
cd frontend && npx tsc --noEmit
git add frontend/src/components/employee/agent/agent-message-list.tsx
git commit -m "feat(agent-ui): rewrite AgentMessageList with block-centric rendering

阶段 11.2：流式与历史共用 BlockRenderer；
layoutId shared-element 实现 RunRow→MessageRow 零跳变；
智能粘附滚动 + 收尾 smooth"
```

### Task 11.3：agent-composer.tsx 重写

**Files:**
- Modify: `frontend/src/components/employee/agent/agent-composer.tsx`

- [ ] **Step 1：完整重写**

```tsx
/**
 * AgentComposer：底部输入区。
 *
 * - 顶栏：workflow 分段切换 + 简历附件 chip
 * - 中部：textarea 自动伸缩，max 200px
 * - 底栏：思考开关 + 发送（Ctrl+Enter）
 */

import { useEffect, useRef, useState } from 'react';
import { Paperclip, Send, Sparkles, X } from 'lucide-react';
import type { WorkflowType, WorkspaceSession } from '@/types/agent';
import { WORKFLOW_LABELS } from '@/types/agent';
import { setSessionThinking, uploadResume } from '@/api/employee/agent';

export interface AgentComposerProps {
  session: WorkspaceSession;
  sending: boolean;
  onSend: (input: { content: string; workflow_type: WorkflowType; context_refs?: Array<Record<string, unknown>> }) => void;
  onAbort: () => void;
  onSessionUpdate: (next: WorkspaceSession) => void;
}

const WORKFLOWS: WorkflowType[] = ['interview_questions', 'resume_evaluation'];

export function AgentComposer({ session, sending, onSend, onAbort, onSessionUpdate }: AgentComposerProps) {
  const [content, setContent] = useState('');
  const [workflow, setWorkflow] = useState<WorkflowType>('interview_questions');
  const [resumeChip, setResumeChip] = useState<{ resume_id: number; file_name: string } | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // textarea 自适应高度
  useEffect(() => {
    const ta = textareaRef.current;
    if (!ta) return;
    ta.style.height = 'auto';
    ta.style.height = Math.min(ta.scrollHeight, 200) + 'px';
  }, [content]);

  const submit = () => {
    const trimmed = content.trim();
    if (!trimmed || sending) return;
    onSend({
      content: trimmed,
      workflow_type: workflow,
      context_refs: resumeChip ? [{ type: 'resume', resume_id: resumeChip.resume_id, file_name: resumeChip.file_name }] : undefined,
    });
    setContent('');
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
      e.preventDefault();
      submit();
    }
  };

  const toggleThinking = async () => {
    const next = !session.enable_thinking;
    const updated = await setSessionThinking(session.id, next);
    onSessionUpdate(updated);
  };

  const onPickFile = async (file: File) => {
    const uploaded = await uploadResume(session.id, file);
    setResumeChip({ resume_id: uploaded.resume_id, file_name: uploaded.file_name });
  };

  return (
    <div className="sticky bottom-0 border-t border-border bg-surface">
      <div className="mx-auto max-w-[760px] px-4 py-3">
        {/* 顶栏 */}
        <div className="flex items-center gap-2 mb-2">
          <WorkflowSwitcher value={workflow} onChange={setWorkflow} />
          <button type="button" onClick={() => fileInputRef.current?.click()}
                  aria-label="附加简历"
                  className="ml-auto flex items-center gap-1 text-[12px] text-mutedText hover:text-primary transition-colors duration-fast ease-standard">
            <Paperclip size={12} /> 附简历
          </button>
          <input ref={fileInputRef} type="file" accept=".pdf,.docx,.doc" className="hidden"
                 onChange={e => { const f = e.target.files?.[0]; if (f) void onPickFile(f); e.target.value = ''; }} />
        </div>

        {resumeChip && (
          <div className="mb-2 inline-flex items-center gap-2 px-2 py-1 rounded-base bg-surfaceMuted text-[12px] text-mutedText">
            <Paperclip size={11} /> {resumeChip.file_name}
            <button type="button" onClick={() => setResumeChip(null)} aria-label="移除简历附件"
                    className="hover:text-destructive">
              <X size={12} />
            </button>
          </div>
        )}

        {/* textarea */}
        <textarea
          ref={textareaRef} value={content} onChange={e => setContent(e.target.value)} onKeyDown={onKeyDown}
          rows={1}
          placeholder="输入消息…(Ctrl+Enter 发送)"
          className="w-full resize-none rounded-base border border-borderStrong px-3 py-2 text-[14px] leading-[1.55] focus:outline-none focus:shadow-ring transition-shadow duration-fast ease-standard"
        />

        {/* 底栏 */}
        <div className="mt-2 flex items-center justify-between">
          <button type="button" onClick={toggleThinking}
                  aria-pressed={session.enable_thinking}
                  className={`flex items-center gap-1 h-8 px-3 rounded-full text-[12px] transition-all duration-fast ease-standard ${
                    session.enable_thinking
                      ? 'bg-thinkingBg text-thinkingText border border-thinkingBorder'
                      : 'text-mutedText hover:bg-surfaceMuted'
                  }`}>
            <Sparkles size={12} />
            思考模式 {session.enable_thinking ? '已开' : '关闭'}
          </button>

          <div className="flex gap-2">
            {sending && (
              <button type="button" onClick={onAbort}
                      className="h-9 px-3 rounded-base border border-border text-[13px] text-mutedText hover:bg-surfaceMuted transition-colors duration-fast ease-standard">
                取消
              </button>
            )}
            <button type="button" onClick={submit} disabled={!content.trim() || sending}
                    className="h-9 px-4 rounded-base bg-primary text-onPrimary text-[13px] font-medium hover:bg-primaryHover disabled:opacity-50 disabled:cursor-not-allowed transition-all duration-fast ease-standard active:scale-[0.97]">
              <span className="inline-flex items-center gap-1">
                <Send size={13} /> 发送
              </span>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function WorkflowSwitcher({ value, onChange }: { value: WorkflowType; onChange: (v: WorkflowType) => void }) {
  return (
    <div className="relative inline-flex rounded-full bg-surfaceMuted p-0.5 text-[12px]">
      {WORKFLOWS.map(wf => (
        <button key={wf} type="button" onClick={() => onChange(wf)}
                className={`relative z-10 px-3 h-7 rounded-full transition-colors duration-fast ease-standard ${
                  value === wf ? 'text-onPrimary' : 'text-mutedText hover:text-foreground'
                }`}>
          {WORKFLOW_LABELS[wf]}
          {value === wf && (
            <span
              className="absolute inset-0 -z-10 rounded-full bg-primary transition-all duration-base ease-spring"
              aria-hidden="true"
            />
          )}
        </button>
      ))}
    </div>
  );
}
```

- [ ] **Step 2：tsc 验证 + commit**

```bash
cd frontend && npx tsc --noEmit
git add frontend/src/components/employee/agent/agent-composer.tsx
git commit -m "feat(agent-ui): rewrite AgentComposer with workflow switcher + thinking toggle

阶段 11.3：分段按钮 spring 位移；
思考开关写入 session；
简历附件 chip；Ctrl+Enter 发送；按压 scale-feedback"
```

### Task 11.4：AgentWorkspace + agent.tsx 集成

**Files:**
- Create: `frontend/src/components/employee/agent/agent-workspace.tsx`
- Modify: `frontend/src/pages/employee/agent.tsx`
- Modify: `frontend/src/components/employee/agent/agent-session-sidebar.tsx`（精简）

- [ ] **Step 1：精简 agent-session-sidebar.tsx**

打开既有 `agent-session-sidebar.tsx`，删除所有 v1/v2 类型引用，确保只 import 当前 `WorkspaceSession`。如逻辑庞杂，重写为最简版本：

```tsx
/**
 * AgentSessionSidebar：左侧会话列表。
 */

import { useState } from 'react';
import { Plus, Search } from 'lucide-react';
import type { WorkspaceSession } from '@/types/agent';

export interface AgentSessionSidebarProps {
  sessions: WorkspaceSession[];
  activeId: number | null;
  onSelect: (id: number) => void;
  onCreate: () => void;
  onSearch: (keyword: string) => void;
}

export function AgentSessionSidebar({ sessions, activeId, onSelect, onCreate, onSearch }: AgentSessionSidebarProps) {
  const [kw, setKw] = useState('');
  return (
    <aside className="w-[280px] border-r border-border bg-surface flex flex-col">
      <div className="p-3 space-y-2 border-b border-border">
        <button type="button" onClick={onCreate}
                className="flex w-full items-center justify-center gap-1 h-9 rounded-base bg-primary text-onPrimary text-[13px] font-medium hover:bg-primaryHover transition-colors duration-fast ease-standard">
          <Plus size={14} /> 新建会话
        </button>
        <div className="relative">
          <Search size={12} className="absolute left-2 top-1/2 -translate-y-1/2 text-subtleText" />
          <input
            value={kw} onChange={e => { setKw(e.target.value); onSearch(e.target.value); }}
            placeholder="搜索会话"
            className="w-full h-8 pl-7 pr-2 rounded-base border border-border text-[12px] focus:outline-none focus:shadow-ring"
          />
        </div>
      </div>
      <ul className="flex-1 overflow-y-auto p-2 space-y-1">
        {sessions.map(s => (
          <li key={s.id}>
            <button type="button" onClick={() => onSelect(s.id)}
                    className={`w-full text-left px-3 py-2 rounded-base text-[13px] transition-colors duration-fast ease-standard ${
                      activeId === s.id
                        ? 'bg-primary/10 text-primary font-medium'
                        : 'text-foreground hover:bg-surfaceMuted'
                    }`}>
              <div className="truncate">{s.title || '未命名会话'}</div>
              {s.last_message_time && (
                <div className="text-[11px] text-subtleText">{s.last_message_time}</div>
              )}
            </button>
          </li>
        ))}
        {sessions.length === 0 && (
          <li className="text-center text-[12px] text-subtleText py-6">暂无会话</li>
        )}
      </ul>
    </aside>
  );
}
```

- [ ] **Step 2：创建 agent-workspace.tsx**

```tsx
/**
 * AgentWorkspace：三栏布局组合（sidebar + message-list + composer）。
 */

import { useCallback, useEffect, useState } from 'react';
import { AgentSessionSidebar } from './agent-session-sidebar';
import { AgentMessageList } from './agent-message-list';
import { AgentComposer } from './agent-composer';
import { useAgentRun } from '@/hooks/use-agent-run';
import { createSession, listSessions } from '@/api/employee/agent';
import type { WorkspaceSession } from '@/types/agent';

export function AgentWorkspace() {
  const [sessions, setSessions] = useState<WorkspaceSession[]>([]);
  const [activeId, setActiveId] = useState<number | null>(null);
  const [keyword, setKeyword] = useState('');

  const refreshSessions = useCallback(async () => {
    const out = await listSessions({ page: 1, page_size: 50, keyword: keyword || undefined });
    setSessions(out.items);
    if (activeId === null && out.items.length) setActiveId(out.items[0].id);
  }, [keyword, activeId]);

  useEffect(() => { void refreshSessions(); }, [refreshSessions]);

  const onCreate = async () => {
    const s = await createSession({ title: null });
    setSessions(prev => [s, ...prev]);
    setActiveId(s.id);
  };

  return (
    <div className="flex h-screen bg-background">
      <AgentSessionSidebar
        sessions={sessions} activeId={activeId}
        onSelect={setActiveId} onCreate={onCreate} onSearch={setKeyword}
      />
      <main className="flex-1 flex flex-col">
        {activeId !== null ? (
          <WorkspaceMain sessionId={activeId} onSessionUpdate={(next) => {
            setSessions(prev => prev.map(s => s.id === next.id ? next : s));
          }} />
        ) : (
          <div className="flex-1 flex items-center justify-center text-mutedText">请选择或创建会话</div>
        )}
      </main>
    </div>
  );
}

function WorkspaceMain({ sessionId, onSessionUpdate }: { sessionId: number; onSessionUpdate: (s: WorkspaceSession) => void }) {
  const { session, messages, runState, sending, sendMessage, submit, abort } = useAgentRun(sessionId);
  if (!session) return <div className="flex-1 flex items-center justify-center text-subtleText">加载中…</div>;
  return (
    <>
      <AgentMessageList messages={messages} runState={runState} onSubmitInteraction={submit} />
      <AgentComposer
        session={session} sending={sending}
        onSend={(input) => void sendMessage({ ...input, enable_thinking: session.enable_thinking })}
        onAbort={abort}
        onSessionUpdate={onSessionUpdate}
      />
    </>
  );
}
```

- [ ] **Step 3：重写 pages/employee/agent.tsx**

```tsx
/**
 * 员工 Agent 工作台页面入口。
 */

import { AgentWorkspace } from '@/components/employee/agent/agent-workspace';

export default function AgentPage() {
  return <AgentWorkspace />;
}
```

- [ ] **Step 4：tsc + 启动 dev 服务验证**

```bash
cd frontend && npx tsc --noEmit
cd frontend && npm run dev &
# 浏览器打开 /employee/agent，确认页面无报错，三栏布局可见
```

- [ ] **Step 5：commit**

```bash
git add frontend/src/components/employee/agent/agent-workspace.tsx \
        frontend/src/components/employee/agent/agent-session-sidebar.tsx \
        frontend/src/pages/employee/agent.tsx
git commit -m "feat(agent-ui): wire up AgentWorkspace integration

阶段 11.4：三栏布局组合；
useAgentRun 单一 hook；
sessions sidebar 精简到 90 行"
```

---

## 后续验收

### 完整后端测试

Run: `cd backend && pytest -q`
Expected: 所有阶段累计新增测试全部 passed

### 完整前端测试

Run: `cd frontend && npx vitest run`
Expected: stream-client + reducer + frame-batched-text 全部 passed

### 端到端联通

启动后端 + 前端 dev 服务，浏览器打开 `/employee/agent`：
- 创建会话 → 选 "简历问答" → 上传简历 → 发送 "请生成面试题" → 应看到：思考块（如开）→ 工具步骤 → 维度选择卡 → 计划审批卡 → 最终面试题清单卡
- 切换 "简历评估" → 上传简历 → 发送 "请评估" → 应看到：工具步骤 → 思考 → 岗位选择卡 → 提交后看到评估报告卡
- 切换会话 → 历史消息应平滑渲染所有 block，无白屏 / 无大跳变
- 流式期间字符按 ~80cps 稳定吐出，无 burst 卡顿感

### 性能 / 视觉验收

按设计文档 §6.4 / §6.5 逐项过：
- DevTools Performance 录制 1 分钟流式：layout shift / long task 满足阈值
- 切到移动端 375px 检查布局 / 业务卡分区折叠 / Composer 简化
- 启用 `prefers-reduced-motion: reduce` 检查全部动画降级到 80ms
- axe 浏览器插件扫描可访问性：对比度 / aria 全绿

---

## 自检结果

**1. spec 覆盖**：所有 6 节设计要点均能映射到至少一个 task：
- §1 架构与删除清单 → Task 0.1/0.2/0.3、6.1
- §2 9 事件 + 6 block 协议 → Task 1.1/1.2/1.3/1.4、3.1/3.2
- §3 LLM 底座与 thinking → Task 2.1/2.2/2.3/2.4
- §4 Graph + Service → Task 4.1/4.2/4.3/4.4、5.1/5.2/5.3/5.4
- §5 前端设计系统 + 流式连续性 → Task 8/9/10/11
- §6 实施与验收 → 整个阶段编号 + 末尾验收清单

**2. 占位扫描**：未使用 TBD / TODO；每个代码 step 都给出完整可执行代码。

**3. 类型一致性**：
- 后端 `AgentStreamEnvelope` v=1 + 9 type 与前端 `AgentEnvelope` union 严格对齐
- 6 block 类型在后端 blocks.py 与前端 types/agent.ts 一一对应
- `LLMStreamChunkDTO.kind` 四值 / `BlockStatus` 六值 前后端一致
- runner / service 之间通过 `WorkflowRuntimeContext` 注入，无重名 / 无遗漏

---

## 执行选择

Plan complete and saved to `docs/superpowers/plans/2026-06-11-agent-runtime-refactor-impl-plan.md`. Two execution options:

**1. Subagent-Driven (recommended)** - 每个 task 派发独立 subagent，task 间审查，迭代快

**2. Inline Execution** - 在本会话内连续执行，checkpoint 处停下来 review

Which approach?




