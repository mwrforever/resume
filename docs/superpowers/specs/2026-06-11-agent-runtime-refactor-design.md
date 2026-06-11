# Agent 运行时与渲染重构设计

**日期**：2026-06-11
**作者**：mwr
**状态**：已与用户确认，待 review

---

## 0. 背景与目标

招聘 Agent 模块的后端与前端实现都因长期补丁堆积而失控：
- 后端 `agent_service.py` 908 行职责混杂；事件协议先后叠加 v1 / v2 / workflow 三层（共 18 种事件、11 个节点 ID + 6 个 sub-agent ID），同一概念被分裂为多套（`form.*` vs `interaction.*`、`action.*` vs `data.card`）；节点用 ContextVar + asyncio.Queue 在切换缝隙塞出思考事件，时机不可控；模型路由没有"思考/非思考"双模式概念。
- 前端 `agent-stream-handler.ts` 761 行同时维护 v1/v2/legacy 三套解析路径；21 个组件与 9 个 setter 把同一个"运行时事件"切成 status-timeline / tool-timeline / run-compact-timeline / thinking-panel / thinking-renderer 等多套渲染器；`plan-review-tree` / `plan-repair-hints` 是 supervisor 时代残留死代码。
- 多个 bug 来自这种"概念分裂"和"渲染断裂"。

本次重构**一次完整推倒重建**，不允许保留任何 v1 / v2 / legacy 兼容路径。目标：

1. 后端只保留**两个固定业务图**（简历问答 / 简历评估），节点函数 ≤ 10 行，业务规则全部下沉到 Service。
2. 事件协议参考 **Claude Code Messages SSE 的 content_block 模型**重写为 **9 种事件 + 6 种 block**，统一前后端心智模型。
3. **同模型 `enable_thinking` 开关切换思考模式**，gateway 自动注入 provider 参数并分流 `reasoning_content`。
4. 前端推倒重建为 **block 为中心的渲染管线**（13 个文件，相比当前 21 个组件瘦身约 50%），共用一套 reducer + 渲染器，流式与历史走相同路径。
5. 基于 ui-ux-pro-max 设计系统重做前端：**Minimalism + Micro-interactions + Trust & Authority** 风格 / Inter 字体 / `#2563EB` 主色 / `#059669` 完成色；专章解决"断断续续"问题（rAF 节拍器、智能粘附滚动、layoutId shared-element、骨架先入场）。
6. **清库重来**：drop & recreate `agent_session` / `agent_message`，删除 `agent_memory`、Action 写操作框架、AgentContextService 长期记忆。

---

## 1. 架构总览与分层

### 1.1 设计原则

只做两件事：
1. **Workflow 编排**：两个固定流程，每一步是一个 LangGraph 节点，节点内只调用 Service。
2. **流式渲染**：后端如实把"消息正在被一段段构造"传给前端；前端按统一 block 模型增量渲染。

为此重新整理三个边界——**协议、运行时、UI**，三者各只承担一件事。

### 1.2 后端分层

```text
Endpoint  (api/v1/endpoints/agent.py)
   ↓ 仅校验 + 调用 service + 返回 SSE
Service
   ├─ AgentSessionService     会话 CRUD + 消息读写 + 标题
   ├─ AgentRuntimeService     SSE 编排 + Redis buffer + 落库 + checkpoint resume
   ├─ AgentResumeService      会话内简历上传 + Redis 会话引用
   ├─ InterviewQuestionService     图一业务规则（Prompt / LLM / 数据组装）
   └─ ResumeEvaluationService      图二业务规则
   ↓
LangGraph (llm/graphs/)
   ├─ interview_questions_graph     单一图，编译期单例
   ├─ resume_evaluation_graph
   └─ runner.py                       统一 Runner（薄壳）
   ↓
llm 底座
   ├─ model_router.py    思考模式路由 / fallback / retry
   ├─ gateway.py         OpenAI 兼容 + reasoning_content 抽取
   └─ clients/           Provider SDK 封装
```

### 1.3 删除清单（**全删，不留兼容**）

**后端：**
- `app/services/agent_context_service.py`
- `app/services/agent_resume_pipeline_service.py`（功能搬入 AgentResumeService）
- `app/services/agent_service.py`（推倒重建为三个服务）
- `app/services/agent_stream_buffer_service.py`（并入 AgentRuntimeService）
- `app/llm/graphs/workflows/_ctx.py`（ContextVar 传服务的 hack）
- 所有 `Action*` payload、`execute_action` 端点、`application.update_status` capability
- `AgentNodeId` 中的 `SUB_AGENT_RUNNER / FORM_REQUEST / ACTION_PROPOSER` 及 6 个 sub-agent 枚举
- `AgentStreamEventType` 中 `form.*` / `action.*` / `data.card` / `data.evaluation_report`（被 block 模型替代）
- `agent_memory` 表 + 相关 endpoint/repository 方法
- `backend/app/llm/prompts/templates/_deprecated/` 整目录

**前端：**
- `utils/agent-stream-v1.ts`、`utils/agent-stream-v2.ts`、`utils/agent-stream-handler.ts`
- `components/employee/agent/agent-action-card.tsx`
- `components/employee/agent/agent-interaction-card.tsx`（按新 block 重写）
- `components/employee/agent/agent-status-timeline.tsx`、`agent-tool-timeline.tsx`、`agent-run-compact-timeline.tsx`
- `components/employee/agent/agent-thinking-panel.tsx`、`thinking-renderer.tsx`
- `components/employee/agent/agent-markdown-content.tsx`、`agent-workspace-header.tsx`、`agent-session-dialogs.tsx`、`agent-ui-utils.ts`
- `components/employee/agent/plan-review-tree.tsx`、`plan-repair-hints.tsx`、`repair-suggestions-panel.tsx`、`tool-execution-card.tsx`
- `components/employee/agent/agent-preferences-dialog.tsx`（thinking 开关移到 Composer）
- `components/employee/agent/interview-question-set-card.tsx`（重写到 blocks/）
- `components/employee/agent/resume-evaluation-report-card.tsx`（重写到 blocks/）

类型层 `types/agent.ts` 删除：`IPlanReviewUiState`、`IAgentActionStreamItem`、`IAgentInteractionRequestItem`、`IAgentRuntimeFeedItem`、`IAgentToolStreamItem`、`IAgentThinkingStreamItem`、`IAgentBusinessCardItem`、`IAgentStreamEnvelopeV1`、`IAgentStreamEnvelopeV2`、`IAgentReply`、`IAgentMemoryItem`、所有 legacy event 类型。

### 1.4 数据库（清库重建）

`sql/init.sql` 中 drop 后重建：

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
);

CREATE TABLE agent_message (
  id              BIGINT PRIMARY KEY AUTO_INCREMENT,
  session_id      BIGINT NOT NULL,
  parent_message_id BIGINT,
  role            VARCHAR(16) NOT NULL,        -- user | agent
  workflow_type   VARCHAR(32) NOT NULL,        -- interview_questions | resume_evaluation
  run_id          VARCHAR(64),
  content         JSON NOT NULL,                -- { blocks: [...] }
  model_name      VARCHAR(80),
  token_count     INT,
  sort_order      INT NOT NULL,
  create_time     DATETIME NOT NULL,
  INDEX idx_session_order (session_id, sort_order)
);
```

`agent_message.content.blocks` 是新事件协议的"重放序列"（详见 §2）。

---

## 2. 事件协议与 Block 模型

### 2.1 设计思路：对齐 Claude Code 的 content block 模型

Claude Code 的消息流核心是 **content block 模型**：
- 一条 assistant 消息由若干 **content block** 组成：text / thinking / tool_use / tool_result / ……
- 每个 block 有完整生命周期：`block_start → block_delta（多次）→ block_stop`
- 消息整体有 `message_start → ...blocks... → message_stop`
- 前端拿到事件后只做一件事：**根据 block 索引追加/替换 block 内容**

这套模型统一多种内容类型，前端没有"事件分发到不同区域"的负担。

### 2.2 协议传输

- 端点：
  - `POST /api/v1/employee/agent/sessions/{session_id}/messages/stream`（用户消息触发的运行）
  - `POST /api/v1/employee/agent/sessions/{session_id}/interactions/{request_id}`（提交交互结果，**继续走 SSE**）
- SSE 顶层 `event:` 恒为 `agent`；区分全在信封 JSON 内。
- 编码 UTF-8，禁 BOM；信封字段保持 snake_case，与后端一致。

### 2.3 信封（最终版本）

```json
{
  "v": 1,
  "seq": 17,
  "ts": 1717920000123,
  "run_id": "run_a7f...",
  "session_id": 42,
  "type": "block.delta",
  "data": { ... }
}
```

- `v` 协议版本，固定 `1`，不再出现 2.0 / v1 / v2 这种历史多版本
- `seq` 同 run 内单调递增；`ts` 仅用于辅助调试，不参与排序
- `type` 取 §2.4 9 个值之一
- `data` 按 `type` 分支

### 2.4 完整事件类型表（**只有 9 个**）

| type | 含义 | data 关键字段 |
|---|---|---|
| `run.start` | 一次 run 开始 | `run_id`, `workflow_type`, `enable_thinking`, `user_message_id` |
| `run.finish` | 正常结束 | `agent_message_id`（落库后的 ID） |
| `run.error` | 异常结束 | `code`, `message`, `retriable` |
| `step.update` | 工作流步骤状态（节点级，仅用于"运行条"） | `step_id`, `title`, `status: pending\|running\|success\|failed`, `detail?` |
| `block.start` | 某个 block 开始构造 | `index`, `block`（带 type 的初始对象，见 §2.5） |
| `block.delta` | block 内容增量 | `index`, `delta`（按 block 类型分形） |
| `block.stop` | block 构造结束 | `index` |
| `interaction.request` | 需要用户输入并暂停 graph | `request_id`, `interaction_type`, `title`, `prompt`, `schema`, `data` |
| `interaction.resolve` | 服务端 ACK 用户已提交 | `request_id`, `values` |

> 取消独立的 `message.start / message.stop`：一次 run 在协议层就是"一条 agent message 的构造过程"，run 的开始即消息开始，run 的结束即消息结束。
> 取消独立的 `tool.*` / `thinking.*` / `data.card`：全部通过 **block** 表达。

### 2.5 Block 类型（**6 类，覆盖所有渲染场景**）

每个 block 形如 `{ "type": "...", ...字段 }`。`block.start` 给出空骨架，`block.delta` 给增量，`block.stop` 收尾。

| block.type | 用途 | 初始字段 | delta 形态 |
|---|---|---|---|
| `text` | Agent 正文流式文本 | `{type:"text", text:""}` | `{text_delta: "...partial..."}` |
| `thinking` | 思考过程流式文本（仅 `enable_thinking=true` 时） | `{type:"thinking", text:""}` | `{text_delta: "..."}` |
| `tool_use` | 内部工具调用（如 `load_resume`、`fetch_jobs`），HR 视角只是"运行步骤" | `{type:"tool_use", tool_name, display_name, input:{...}, status:"running"}` | `{status:"success\|failed", output:{...}, error?:string}` |
| `interaction` | 内联交互卡片（维度选择 / 计划审批 / 岗位选择） | `{type:"interaction", request_id, interaction_type, title, prompt, schema, data, status:"pending"}` | `{status:"submitted\|expired", values?}` |
| `interview_questions` | 业务卡：面试题清单 | `{type:"interview_questions", question_set:{}}` | 一次性 push 完整 question_set，无增量 delta |
| `evaluation_report` | 业务卡：简历评估报告 | `{type:"evaluation_report", report:{}}` | 一次性 push，无增量 delta |

业务卡片采用"start + 一次 delta 写满 + stop"——之所以仍走 block 模型而不用专属事件，是因为前端只用一套渲染管线就够了。

### 2.6 关键约束

1. **block 顺序即渲染顺序**：`index` 单调递增；同 `index` 仅对应一个 block。
2. **thinking 永远独立 block，不与 text 混入**：即使节点同时 stream 推理和正文，protocol 层会拆成两个 block。
3. **tool_use 与业务无关展示**：前端用统一"步骤"组件渲染，不为每个工具名定制 UI。
4. **interaction block 是 graph interrupt 的唯一出口**：一旦发出，本 run 结束（紧跟 `run.finish`）；前端把卡片放到 `status:"pending"`。
5. **未知 type / 未知 block.type / 未知字段一律静默忽略**，前后端独立演进。
6. **没有"快照"概念**：消息落库时直接把走过的所有 `block.start/delta/stop` 折叠成 `agent_message.content.blocks` 数组；历史会话恢复就是把数组按顺序当成已完成的 block 重放。

### 2.7 一次完整 run 的事件流示例（图二 · 岗位选择前后）

```text
→ run.start                {run_id, workflow_type:"resume_evaluation", enable_thinking:true}
→ step.update              {step_id:"load_resume", status:"running", title:"读取简历"}
→ block.start  index=0     tool_use {tool_name:"load_resume", status:"running"}
→ block.stop   index=0
→ step.update              {step_id:"load_resume", status:"success"}
→ step.update              {step_id:"analyze_profile", status:"running"}
→ block.start  index=1     thinking
→ block.delta  index=1     {text_delta:"先看候选人..."}
→ block.delta  index=1     {text_delta:"主修方向是..."}
→ block.stop   index=1
→ step.update              {step_id:"analyze_profile", status:"success"}
→ block.start  index=2     interaction {interaction_type:"job_selection", status:"pending", data:{candidates:[...]}}
→ run.finish               {agent_message_id:889}

// 用户在卡片里点选岗位 → POST /interactions/{request_id}
// 触发新一轮 SSE，新的 run_id

→ run.start                {run_id, workflow_type:"resume_evaluation"}
→ interaction.resolve      {request_id, values:{job_full_name:"..."}}
→ block.start  index=0     tool_use {tool_name:"validate_job"}
→ block.stop   index=0
→ block.start  index=1     text
→ block.delta  index=1     {text_delta:"匹配度 87 分..."}
→ block.stop   index=1
→ block.start  index=2     evaluation_report (一次性写满)
→ block.stop   index=2
→ run.finish               {agent_message_id:890}
```

落库时第二个 agent_message 的 `content.blocks` 数组就是 `[tool_use, text, evaluation_report]`——前端拿这个数组重放即可，不需要二次解析事件。

> `interaction.resolve` 不作为 block 落到下一条消息里——它属于"上一条 pending 卡片状态变更"。后端落库时把 `request_id` 对应的旧 interaction block 的 `status` 改写为 `submitted` + `values`。这是唯一一处"跨消息回写"。

### 2.8 与 LangGraph 对接

| 后端来源 | 翻译为 |
|---|---|
| `graph.astream(stream_mode="updates")` 节点更新 | `step.update` |
| Service 用 `LLMModelRouter.stream()` 流式输出 reasoning_content | `block(thinking).delta` |
| Service 流式输出 content | `block(text).delta` |
| Service 显式 emit 工具调用（load_resume 这类内部步骤） | `block(tool_use).start/stop` |
| `interrupt({...})` | `block(interaction).start` + `run.finish` |
| `Command(resume=values)` 进入 | 新 run 的 `interaction.resolve` |
| 节点 return `final_blocks=[...]` | `block(interview_questions \| evaluation_report).start/delta/stop` |

---

## 3. 动态模型路由与思考模式

### 3.1 现状问题

- `model_router.py` 只有 fallback chain，没有思考模式概念。
- `LLMRuntimeConfigDTO` 里有 `enable_thinking` 字段，但 gateway 怎么翻译成 provider 参数、怎么抽 `reasoning_content` 完全靠当下临时拼装。
- thinking 内容通过 `asyncio.Queue` + `ContextVar` 在 graph 节点缝隙塞出，时机不可控。

### 3.2 目标边界

只解决三件事：
1. **用户/会话级 `enable_thinking` 开关** → 路由到正确的 provider 参数。
2. **流式输出区分 reasoning_content 和 content** → 给上层一个明确的"双 channel"。
3. **失败回退** → fallback 模型继承 `enable_thinking` 语义。

### 3.3 三层职责（厘清后）

```text
LLMModelRouter             选模型 + 重试 + fallback；不关心思考模式细节
   ↓
OpenAICompatibleGateway    把 enable_thinking 翻译成 provider 参数；归一化响应
   ↓
provider client            只发 HTTP，不懂业务
```

协议层目前实际只有一种：`OpenAICompatibleGateway`。DeepSeek、Qwen、智谱、月之暗面等都走这一个网关——只是 `base_url + model_name + extra_body` 不同。Anthropic 原生协议没接入，也不在本次范围。

### 3.4 LLMRuntimeConfigDTO（精简）

```python
class LLMRuntimeConfigDTO(BaseModel):
    # 模型路由
    protocol: Literal["openai_compatible"]
    provider: Literal["deepseek", "qwen", "other"]   # 新增，驱动 THINKING_PARAM_MAP
    base_url: str
    api_key: SecretStr
    model_name: str
    fallback_model_name: str | None = None

    # 运行参数
    temperature: float = 0.7
    max_tokens: int | None = None
    max_retries: int = 1
    timeout_seconds: int = 60

    # 思考模式（核心）
    enable_thinking: bool = False
    thinking_budget_tokens: int | None = None
```

删除：`enable_memory`（无人用）、`source`（运行时不该出现配置来源）、`enable_prompt_cache`（与本次无关）、`top_p` / `presence_penalty` / `frequency_penalty`（未实际使用）。

### 3.5 LLMStreamChunkDTO（双 channel）

```python
class LLMStreamChunkDTO(BaseModel):
    """流式增量。同一 chunk 至多承载一种 delta。"""
    kind: Literal["text", "thinking", "usage", "done"]
    text_delta: str = ""               # kind=text|thinking 时非空
    usage: TokenUsage | None = None    # kind=usage 时
    finish_reason: str | None = None   # kind=done 时
```

Gateway 内部把 `reasoning_content` 与 `content` 两路分别抽出，封装成不同 `kind` 的 chunk 推给上层；上层只看 `kind`，不再字段嗅探。

### 3.6 Provider 适配规则（同一 Gateway 内）

`enable_thinking=true` 时往 `extra_body` 注入参数；响应里抽 `delta.reasoning_content`。各 provider 的差异用一张映射表收口：

```python
THINKING_PARAM_MAP = {
    "deepseek": {"thinking": {"type": "enabled"}},
    "qwen":     {"enable_thinking": True},
    "other":    {"enable_thinking": True},  # 大部分 OpenAI-compat 兼容此键
}
```

- `provider_key` 由 `LLMRuntimeConfigDTO.provider` 给出，不做"按 model_name 字符串嗅探"。
- 响应抽取走两路 fallback：`delta.reasoning_content` → `delta.thinking` → 无（仅发文本 chunk，不发 thinking chunk）。

### 3.7 LLMModelRouter（保持极简）

```python
class LLMModelRouter:
    async def stream(self, prompt, runtime_config) -> AsyncIterator[LLMStreamChunkDTO]:
        """主模型 → fallback；fallback 继承 enable_thinking。"""
```

只做路由到 gateway + 失败转 fallback。**不再支持"按节点切换思考策略"**——节点策略由调用者（Service）决定传什么 runtime_config 进来。

### 3.8 enable_thinking 的来源优先级

```text
本次请求 body.runtime_options.enable_thinking
   ↓ 未指定
会话 agent_session.enable_thinking
   ↓ 未指定
全局默认（false）
```

- 前端 Composer 上有 thinking 开关，**实时切换写入 agent_session**（避免每条消息都带，且历史会话能恢复）。
- 单次消息可临时覆盖（用于"这一条想要看思考"）。

### 3.9 节点级使用约定

业务 Service 内调用 LLM 的统一姿势：

```python
async for chunk in router.stream(prompt, runtime_config):
    if chunk.kind == "thinking":
        await emitter.emit_block_delta(thinking_block_idx, text_delta=chunk.text_delta)
    elif chunk.kind == "text":
        await emitter.emit_block_delta(text_block_idx, text_delta=chunk.text_delta)
    elif chunk.kind == "usage":
        usage = chunk.usage
```

- `thinking` block 是否开启由 `runtime_config.enable_thinking` 决定（Service 在调用前判断，决定要不要 `emit_block_start("thinking")`）。
- 不再有 ContextVar / asyncio.Queue / drain 时机这些 hack。**思考事件随流式 chunk 顺序自然到达**——这是双 channel 模型给的红利。

### 3.10 自愈降级

`enable_thinking=true` 但模型不支持时（Gateway 抛 `LLMGatewayError` 且错误信息匹配 thinking 不支持的特征），Service 自动重试一次 `enable_thinking=false`，日志 WARNING 记录。仅这一种自愈，避免静默差异。

---

## 4. Graph 节点与 Service 设计

### 4.1 总原则

- 节点函数 ≤ 10 行：拿到 state → 调 Service → 返回 state patch / `interrupt(...)`。**禁止**在节点里读 DB、读 Redis、拼 Prompt、调 LLM。
- Service 是业务规则唯一所在地：Prompt 渲染、LLM 调用、数据组合、异常兜底、emit 流事件。
- Service 通过**依赖注入**（不再用 ContextVar）拿到 emitter——`Runner` 编译时把 `WorkflowRuntimeContext` 注入到节点闭包里。

### 4.2 Runner 重构（极简）

```python
class AgentWorkflowRunner:
    def __init__(self, compiled_graph: CompiledStateGraph) -> None:
        self._graph = compiled_graph

    async def astream(
        self,
        *,
        thread_id: str,
        graph_input: dict | Command,
        ctx: WorkflowRuntimeContext,
    ) -> AsyncIterator[AgentStreamEvent]:
        config = {"configurable": {"thread_id": thread_id, "ctx": ctx}}
        async for mode, payload in self._graph.astream(
            graph_input, config=config, stream_mode=["updates", "custom"]
        ):
            if mode == "updates":
                yield from self._translate_updates(payload, ctx)
            elif mode == "custom":
                # Service 内通过 get_stream_writer() 直接 push 出来的事件
                yield payload
```

关键点：
- **业务流式事件用 LangGraph 原生 `get_stream_writer()`** 推（custom stream_mode），不再自己造 asyncio.Queue。
- 节点拿 `ctx` 走 `config["configurable"]["ctx"]`。
- Runner 只翻译节点 `updates` → `step.update`；其余事件（block.*、interaction.request）由 Service 自己 emit。

### 4.3 WorkflowRuntimeContext（替代 ContextVar）

```python
@dataclass
class WorkflowRuntimeContext:
    emitter: AgentStreamEmitter            # 发协议事件
    runtime_config: LLMRuntimeConfigDTO    # 含 enable_thinking
    interview_service: InterviewQuestionService
    evaluation_service: ResumeEvaluationService
    resume_loader: ResumeLoader
    session_id: int
    employee_id: int
    run_id: str
```

节点内：

```python
async def load_resume_node(state: InterviewQuestionState, config) -> dict:
    ctx: WorkflowRuntimeContext = config["configurable"]["ctx"]
    return await ctx.interview_service.load_resume(state, ctx)
```

### 4.4 AgentStreamEmitter（重写，对齐 §2 协议）

只有 9 个公开方法：

```python
class AgentStreamEmitter:
    def emit_run_start(self, *, workflow_type, enable_thinking, user_message_id) -> AgentStreamEvent
    def emit_run_finish(self, *, agent_message_id) -> AgentStreamEvent
    def emit_run_error(self, *, code, message, retriable=False) -> AgentStreamEvent
    def emit_step(self, *, step_id, title, status, detail=None) -> AgentStreamEvent
    def emit_block_start(self, *, index, block: BlockInit) -> AgentStreamEvent
    def emit_block_delta(self, *, index, delta: dict) -> AgentStreamEvent
    def emit_block_stop(self, *, index) -> AgentStreamEvent
    def emit_interaction_request(self, *, request_id, ...) -> AgentStreamEvent
    def emit_interaction_resolve(self, *, request_id, values) -> AgentStreamEvent
```

`seq` 单调递增内部维护；不再有 13 种 payload 类。

Service 内推事件靠 LangGraph `get_stream_writer()`：

```python
from langgraph.config import get_stream_writer

writer = get_stream_writer()
writer(ctx.emitter.emit_block_start(index=idx, block={"type":"text","text":""}))
```

Runner 在 `stream_mode="custom"` 路径上直接转发——零中间层。

### 4.5 State 定义（每图一个，扁平）

```python
class InterviewQuestionState(TypedDict):
    resume_ref: dict
    resume_text: str
    suggested_dimensions: list[Dimension]
    selected_dimensions: list[Dimension]      # 来自 interrupt 恢复
    question_plan: QuestionPlan
    plan_approved: bool                       # 来自 interrupt 恢复
    question_set: QuestionSet | None          # 最终业务卡

class ResumeEvaluationState(TypedDict):
    resume_ref: dict
    resume_text: str
    resume_profile: ResumeProfile
    job_candidates: list[JobCandidate]
    selected_job_name: str                    # 来自 interrupt 恢复
    job_full: JobFull | None
    validation_attempts: int
    evaluation_result: EvaluationResult | None
    report: EvaluationReport | None           # 最终业务卡
```

> 删除：`workflow_type`、`employee_id`、`session_id`、`run_id`、`runtime_config`、`service_context`、`tool_context`、`interaction_payload`、`final_blocks`、`final_text`、`messages` 等——这些都进了 `WorkflowRuntimeContext` 或不再需要（业务卡是节点返回的 patch，不是 state 字段）。

### 4.6 Graph 1：interview_questions

```text
START
 → load_resume                       (tool_use block: load_resume)
 → suggest_dimensions                (thinking? + 内部 LLM 调用)
 → request_dimension_selection       (interaction.request + interrupt)
 → build_question_plan               (thinking? + LLM)
 → request_plan_approval             (interaction.request + interrupt)
 → fanout_generate_questions         (Send 并发，每分支一个 LLM 调用，各自一个 text block)
 → reduce_questions                  (汇总 8-12 题)
 → finalize_question_set             (push interview_questions block)
 → END
```

驳回时 `request_plan_approval` 返回 `Command(goto="build_question_plan", update={...})`，自然循环。

### 4.7 Graph 2：resume_evaluation

```text
START
 → load_resume                       (tool_use block)
 → analyze_resume_profile            (thinking? + LLM)
 → load_job_candidates               (tool_use block: fetch_jobs, Redis 优先)
 → request_job_selection             (interaction.request + interrupt)
 → validate_job_full_name            (校验失败回到 request_job_selection, attempts++; >3 返 run.error)
 → run_evaluation_subgraph           (复用 evaluation_graph.arun)
 → build_visualization_report        (组装数据)
 → finalize_evaluation_report        (push evaluation_report block)
 → END
```

### 4.8 节点示例（图二 · validate_job_full_name）

```python
async def validate_job_node(state: ResumeEvaluationState, config) -> Command:
    ctx: WorkflowRuntimeContext = config["configurable"]["ctx"]
    try:
        job_full = await ctx.evaluation_service.validate_job(
            state["selected_job_name"], ctx.employee_id, ctx
        )
        return Command(update={"job_full": job_full})
    except JobValidationError:
        attempts = state["validation_attempts"] + 1
        if attempts >= 3:
            raise
        return Command(
            goto="request_job_selection",
            update={"validation_attempts": attempts},
        )
```

业务规则（校验细节、Redis 写入、emit tool_use block）全在 `ctx.evaluation_service.validate_job` 内。

### 4.9 Service 拆分（接 §1）

| Service | 职责 | 不做 |
|---|---|---|
| **InterviewQuestionService** | 加载简历、AI 提议维度（带兜底）、生成出题计划、按维度并发出题、汇总 8-12 题、emit thinking/text/tool_use/interview_questions block | 不直接写 DB、不直接读 Redis（通过 ResumeLoader） |
| **ResumeEvaluationService** | 加载简历、生成结构化画像、加载岗位候选（带 Redis）、校验岗位全名、调用 evaluation_graph、组装可视化报告、emit block | 同上 |
| **ResumeLoader** | 读简历原文（Redis 缓存命中优先 → ResumeRepository fallback） | 业务规则 |
| **AgentSessionService** | session/message CRUD、`enable_thinking` 持久化、标题异步生成 | SSE / graph |
| **AgentRuntimeService** | 构造 `WorkflowRuntimeContext`、调 Runner、Redis stream buffer、消息落库、interrupt resolve | 业务规则 |
| **AgentResumeService** | 会话内简历上传、Redis 会话级引用 | graph |

`agent_stream_buffer_service` 合并入 `AgentRuntimeService`。

### 4.10 Service 内 emit block 的标准姿势

```python
async def suggest_dimensions(self, state, ctx) -> dict:
    writer = get_stream_writer()
    text_idx = self._next_block_index(ctx)
    thinking_idx = None

    if ctx.runtime_config.enable_thinking:
        thinking_idx = self._next_block_index(ctx)
        writer(ctx.emitter.emit_block_start(index=thinking_idx, block={"type":"thinking","text":""}))

    writer(ctx.emitter.emit_block_start(index=text_idx, block={"type":"text","text":""}))

    raw = []
    try:
        async for chunk in self._router.stream(prompt, ctx.runtime_config):
            if chunk.kind == "thinking" and thinking_idx is not None:
                writer(ctx.emitter.emit_block_delta(index=thinking_idx, delta={"text_delta": chunk.text_delta}))
            elif chunk.kind == "text":
                writer(ctx.emitter.emit_block_delta(index=text_idx, delta={"text_delta": chunk.text_delta}))
                raw.append(chunk.text_delta)
    finally:
        if thinking_idx is not None:
            writer(ctx.emitter.emit_block_stop(index=thinking_idx))
        writer(ctx.emitter.emit_block_stop(index=text_idx))

    dimensions = self._parse_dimensions("".join(raw)) or BUILTIN_DIMENSIONS
    return {"suggested_dimensions": dimensions}
```

### 4.11 文件结构（最终）

```text
backend/app/llm/graphs/
├── __init__.py
├── evaluation_graph.py                # 既有现成评估子图（保留，黑盒复用）
└── workflows/
    ├── __init__.py                    # 暴露 build_interview_graph / build_evaluation_graph / AgentWorkflowRunner
    ├── interview_questions.py         # 图一定义 + 节点
    ├── resume_evaluation.py           # 图二定义 + 节点
    ├── state.py                       # InterviewQuestionState / ResumeEvaluationState
    ├── context.py                     # WorkflowRuntimeContext
    └── runner.py                      # AgentWorkflowRunner（薄壳）

backend/app/llm/streaming/
└── emitter.py                          # AgentStreamEmitter（重写）

backend/app/services/
├── agent_session_service.py
├── agent_runtime_service.py
├── agent_resume_service.py
├── interview_question_service.py
├── resume_evaluation_service.py
└── resume_loader.py
```

### 4.12 Checkpoint

LangGraph `interrupt()` + `Command(resume=...)`，checkpointer 用进程内 `MemorySaver`。
- 业务上明确"页面刷新可继续，进程重启需重发"。
- 提交过期 interaction 返回业务错误：`{"code": "interaction_expired", "message": "这个操作已过期，请重新发起一次流程。"}`。
- 前端把过期卡片标记为只读 `status: "expired"`，历史消息仍保留。

---

## 5. 前端设计系统与渲染

### 5.1 设计 Token（写入 `tailwind.config.ts`，唯一来源）

基于 ui-ux-pro-max 推荐：
- **风格**：Minimalism & Swiss Style（主结构）+ Micro-interactions（动效层）+ Trust & Authority（视觉权威感）
- **配色**：CRM & Client Management 调色板（`#2563EB` primary + `#059669` success accent + `#F8FAFC` background）
- **字体**：Inter

```typescript
export const tokens = {
  color: {
    // 品牌
    primary:        '#2563EB',
    primaryHover:   '#1D4ED8',
    onPrimary:      '#FFFFFF',
    secondary:      '#3B82F6',
    accent:         '#059669',
    onAccent:       '#FFFFFF',
    // 表面
    background:     '#F8FAFC',
    surface:        '#FFFFFF',
    surfaceMuted:   '#F1F5FD',
    surfaceSubtle:  '#FAFBFD',
    // 文本
    foreground:     '#0F172A',
    mutedText:      '#475569',
    subtleText:     '#94A3B8',
    // 边界
    border:         '#E4ECFC',
    borderStrong:   '#CBD5E1',
    // 状态
    success:        '#059669',
    warning:        '#D97706',
    destructive:    '#DC2626',
    // 思考块专用
    thinkingBg:     '#F8F4FF',
    thinkingBorder: '#E9DFFF',
    thinkingText:   '#4C1D95',
  },
  font: {
    sans: 'Inter, -apple-system, BlinkMacSystemFont, "Segoe UI", system-ui',
    mono: '"JetBrains Mono", ui-monospace, Menlo, monospace',
  },
  fontSize: { xs: '12px', sm: '13px', base: '14px', md: '15px', lg: '16px',
              xl: '18px', '2xl': '20px', '3xl': '24px', '4xl': '30px' },
  lineHeight: { tight: 1.35, normal: 1.55, loose: 1.7 },
  fontWeight: { regular: 400, medium: 500, semibold: 600, bold: 700 },
  spacing: { 0.5: '2px', 1: '4px', 1.5: '6px', 2: '8px', 3: '12px',
             4: '16px', 5: '20px', 6: '24px', 8: '32px', 10: '40px', 12: '48px' },
  radius: { sm: '6px', base: '8px', md: '10px', lg: '12px', xl: '16px', full: '9999px' },
  shadow: {
    sm:  '0 1px 2px rgba(15,23,42,0.04)',
    md:  '0 4px 12px rgba(15,23,42,0.06)',
    lg:  '0 12px 32px rgba(15,23,42,0.08)',
    ring: '0 0 0 3px rgba(37,99,235,0.18)',
  },
  duration: { instant: '80ms', fast: '150ms', base: '220ms', exit: '160ms', cascade: '300ms' },
  easing: {
    enter:    'cubic-bezier(0.2, 0.8, 0.2, 1)',
    exit:     'cubic-bezier(0.4, 0.0, 1, 1)',
    standard: 'cubic-bezier(0.4, 0.0, 0.2, 1)',
    spring:   'cubic-bezier(0.34, 1.56, 0.64, 1)',
  },
  z: { base: 0, sticky: 10, dropdown: 20, dialog: 40, toast: 100 },
}
```

### 5.2 整体布局（三栏，桌面优先；移动端折叠）

```text
┌────────────┬──────────────────────────────────────────┐
│            │  WORKSPACE HEADER (workflow 状态 + 模型)   │
│  SESSIONS  ├──────────────────────────────────────────┤
│  SIDEBAR   │                                          │
│            │            MESSAGE LIST                  │
│  280px     │            (max-w 760px 居中)             │
│  收起→56px │                                          │
│            ├──────────────────────────────────────────┤
│            │            COMPOSER (sticky-bottom)      │
└────────────┴──────────────────────────────────────────┘
```

- 消息列表 `max-width: 760px` 居中，符合 `line-length-control`（60-75 字符/行）。
- Sidebar 在 `<1024px` 改为抽屉，触发器在 Header 左侧。
- Composer 始终 sticky bottom；上方留 16px 渐变蒙层避免硬切。

### 5.3 信息层级

```text
正文 (TextBlock)            > 业务卡 (InterviewQuestions / EvaluationReport)
> 交互卡 (InteractionBlock) > 思考折叠区 (ThinkingBlock)
> 工具步骤 (ToolUseBlock)   > 步骤条 (StepStrip)
```

视觉手段（按优先级，不依赖颜色）：
1. **字号**：正文 15px → 卡片标题 16px → 业务标题 18px → 摘要数字 24px
2. **字重**：正文 400 / 标签 500 / 标题 600
3. **空间**：block 间距 16px / 区域间距 24px / 业务卡内分区 20px
4. **背景**：正文透明 / 业务卡白底+md 阴影 / 思考紫底 / 工具浅灰边框无阴影

### 5.4 文件结构（最终）

```text
frontend/src/
├── design/
│   ├── tokens.ts                          # §5.1 tokens 对象
│   └── motion.ts                          # CSS-in-JS 动效 helper
├── api/employee/agent.ts
├── types/agent.ts
├── utils/
│   ├── agent-stream-client.ts
│   └── agent-run-reducer.ts
├── hooks/
│   ├── use-agent-run.ts
│   └── use-frame-batched-text.ts          # 流式 token rAF 节拍器（§5.5 R1）
├── pages/employee/agent.tsx
└── components/employee/agent/
    ├── agent-workspace.tsx
    ├── agent-session-sidebar.tsx
    ├── agent-message-list.tsx
    ├── agent-composer.tsx
    ├── step-strip.tsx
    └── blocks/
        ├── block-renderer.tsx
        ├── text-block.tsx
        ├── thinking-block.tsx
        ├── tool-use-block.tsx
        ├── interaction-block.tsx
        ├── interview-questions-card.tsx
        └── evaluation-report-card.tsx
```

### 5.5 流式连续性专章（解决"断断续续"）

"断断续续"的根因有 6 个，逐一对症。

#### R1：token 到达节奏抖动（LLM SSE chunk 可能 50ms 静默后 burst 出 30 字）

**方案：`useFrameBatchedText` rAF 节拍器**

```typescript
// hooks/use-frame-batched-text.ts
export function useFrameBatchedText(targetText: string, options = { cps: 80 }) {
  const [displayed, setDisplayed] = useState('');
  const queueRef = useRef('');
  const rafRef = useRef<number | null>(null);
  const lastTickRef = useRef(0);

  useEffect(() => {
    if (targetText.length > displayed.length + queueRef.current.length) {
      queueRef.current += targetText.slice(displayed.length + queueRef.current.length);
    }
    if (rafRef.current === null) {
      const tick = (now: number) => {
        const dt = lastTickRef.current ? now - lastTickRef.current : 16;
        lastTickRef.current = now;
        const chars = Math.max(1, Math.round((options.cps * dt) / 1000));
        if (queueRef.current.length) {
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
    }
  }, [targetText]);

  const flush = useCallback(() => {
    if (queueRef.current) {
      setDisplayed(prev => prev + queueRef.current);
      queueRef.current = '';
    }
  }, []);

  return { displayed, flush, pending: queueRef.current.length };
}
```

- 后端 burst 几十字 → 前端按 80 字/秒匀速吐出（约人类阅读速度）
- `block.stop` 时调用 `flush()` 立即显完队列，避免"已结束但还在打字"
- `prefers-reduced-motion: reduce` 模式下 cps 提升到 300（基本即时）
- 用户体验：永远像在打字机上看见自然节奏，不会卡顿一秒再蹦出一段

#### R2：block 切换瞬间的高度跳动

**方案：StreamingContainer 的 height 由 `min-height` 撑起，不动 height**

```tsx
<div className="streaming-container" style={{ minHeight: '24px' }}>
  {block.text || <PulseDot />}
</div>
```

不使用 `height` 过渡（违反 transform-performance）；新 block 入场用 `translateY(8px) → 0` + opacity。

#### R3：思考与正文穿插造成上方内容上下抖动

**方案：思考块 sticky-top 浮起，不挤压上方布局**

```tsx
<div className="agent-message">
  <StepStrip />                            {/* sticky top: 0; z: 10 */}
  <ThinkingBlock />                        {/* sticky top: 40px; z: 5; 折叠态高度恒定 32px */}
  <BlockList>{ blocks.map(...) }</BlockList>
</div>
```

ThinkingBlock 在 streaming 状态下 sticky 在顶部，**折叠态高度固定 32px** —— 内部展开/折叠走 absolute 浮层，不撑高 sticky 占位。

#### R4：业务卡片"突然出现"的视觉断裂

**方案：业务卡入场前先放骨架，骨架 crossfade 替换为内容**

- `interview_questions` / `evaluation_report` 在 `block.start` 时立即渲染骨架（与最终卡同尺寸）
- `block.delta`（一次写满）到达后，骨架 `opacity: 0` 出（exit 160ms），内容 `opacity: 0 → 1` 进（enter 220ms），共享同一容器尺寸
- 不出现"白屏 → 砰一下出现"的瞬间

#### R5：自动滚动撕裂感

**方案：智能粘附滚动**

```typescript
function useFollowBottom(scrollRef) {
  const followingRef = useRef(true);
  const onScroll = () => {
    const el = scrollRef.current; if (!el) return;
    followingRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 48;
  };
  const followIfNeeded = () => {
    if (!followingRef.current) return;
    const el = scrollRef.current;
    el?.scrollTo({ top: el.scrollHeight, behavior: 'instant' as ScrollBehavior });
  };
  return { onScroll, followIfNeeded };
}
```

- 用户上滚阅读历史时不被强行拽回
- 一旦回到底部 48px 内，重新进入 follow 模式
- 流式期间使用 `instant`，结束后（`run.finish`）的最终对齐用 `smooth`

#### R6：RunRow 与 AgentMessage 的"二次挂载"闪烁

**方案：shared element via `layoutId` + `LayoutGroup`**

```tsx
{messages.map(m => (
  <motion.div key={`msg-${m.id}`} layout="position" layoutId={`run-${m.run_id}`}>
    <MessageRow message={m} />
  </motion.div>
))}
{runState.running && (
  <motion.div key={`run-${runState.run_id}`} layoutId={`run-${runState.run_id}`}>
    <RunRow blocks={runState.current_blocks} />
  </motion.div>
)}
```

`layoutId` 相同 → Framer Motion 在 RunRow 卸载 / 新 AgentMessage 挂载时做 layout transition，DOM 节点位移可视化为零跳变。

### 5.6 6 个 Block 视觉规范

#### TextBlock
- 字号 15px / 行高 1.6 / 字重 400 / 颜色 `foreground`
- 链接 `primary` + 下划线，hover `primaryHover`
- 代码段 `surfaceMuted` 背景 / mono 字体 / 6px radius
- 末尾光标 `▍`：`@keyframes blink { 50% { opacity: 0 } }` cycle 800ms
- `block.stop` 后光标 `opacity 1 → 0` over 80ms exit
- markdown 仅支持粗体/列表/code，避免引入 react-markdown 重型依赖

#### ThinkingBlock
- 背景 `thinkingBg` / 边框 `thinkingBorder` 1px / radius `md`
- 标题 13px / `thinkingText` / 字重 500
- 左侧 2px 紫色 indicator bar，streaming 时 `@keyframes flowDown` 从上往下扫光（唯一例外的装饰动画——表达"正在思考"的因果性，符合 motion-meaning）
- 折叠态高度 32px（仅 header）；展开 `max-height: 280px` + `overflow-y: auto`
- streaming 时自动展开；`block.stop` 后 1.5s 自动折叠

#### ToolUseBlock
- 单行 40px / 背景 `surfaceSubtle` / 边框 `border` 1px / radius `base`
- icon 16px lucide / 状态点 6px 圆点（running 旋转 / success 实心绿 / failed 实心红）
- 点击行展开看 input/output（mono 字体 JSON，限高 200px）
- running 状态：状态点旋转 + 文字尾跟省略号动画

#### InteractionBlock
- 背景 `surface` / 阴影 `md` / radius `lg` / padding 20px
- 三种 `interaction_type` 共用容器，内部按类型切表单：
  - `dimension_selection`：维度多选 chip
  - `plan_approval`：计划摘要 + 批准/驳回（带原因输入）
  - `job_selection`：候选岗位点击 + 手输全名 + 错误提示
- pending → submitted：背景 crossfade 到 `surfaceSubtle`，所有控件 `opacity: 0.5`，主 CTA 替换为"已提交 ✓"，**不卸载**
- expired：右上角加"已过期" pill chip（warning 色）
- 校验错误：输入框边变 destructive + 下方红字提示，`role="alert"`
- 入场动画：`translateY(12px) + opacity 0 → 1`，**300ms cascade + spring easing**

#### InterviewQuestionsCard
- 卡片 `surface` / shadow `md` / radius `lg`
- 维度标题 14px / semibold；难度 chip 12px / muted
- 题目编号 mono 字体便于对齐
- 追问/信号默认折叠，展开 220ms enter
- 复制按钮 hover `primary` 色，点击触发 toast (3s)
- 维度分组按 `stagger: 40ms` 逐项 `translateY(8px) + opacity` 入场

#### EvaluationReportCard
- 顶部摘要条：分数 30px / `accent` 色 / mono 字体；等级 + 推进建议 chip
- 6 个分区折叠面板：默认全收起；点击展开 220ms enter
- 条形图 `transform-origin: left` + `transform: scaleX(0 → target)` 持续 300ms enter
- 移动端：分区全部默认折叠，避免一屏塞满
- 桌面端：顶部摘要展开 / 6 个分区默认收起

### 5.7 动效系统

引用 ui-ux-pro-max 命中规则（已在 §5.1 写入 token）：
- `duration-timing`：micro 150-300ms，禁 >500ms
- `easing`：ease-out 入场 / ease-in 出场 / spring 仅按压回弹与卡片落位
- `transform-performance`：仅动 `transform/opacity`；`scaleX` 替代 `width`
- `excessive-motion`：每视图 1-2 个关键动画，禁止全屏装饰
- `reduced-motion`：全局 media query 一处生效
- `loading-states`：所有 >300ms 异步用骨架屏
- `exit-faster-than-enter`：exit (160ms) ≈ enter (220ms) × 0.7
- `interruptible / no-blocking-animation`：用户操作随时可打断；动画期间 UI 保持可交互

CSS 全局降级：
```css
@media (prefers-reduced-motion: reduce) {
  * { animation-duration: 80ms !important; transition-duration: 80ms !important; }
  .anim-stagger > * { animation-delay: 0ms !important; }
  .anim-spring   { animation-timing-function: linear !important; }
}
```

技术选型：
- **CSS transitions / `@keyframes`** 处理 90% 场景
- **Framer Motion** 仅用于：shared-element transition（RunRow ↔ AgentMessage layoutId）、InteractionBlock 的 spring 入场、Step Strip 的 indicator 位移
- 禁止引入 GSAP / Lottie / anime.js
- 所有 transition 走 token：`className="transition-transform duration-base ease-enter"`

跨场景动效：
- **Step Strip**：进入新 step 时高亮条 translateX 到当前位置，220ms spring；状态点 pending → running → success 颜色 crossfade
- **消息进入**：用户消息和 Agent 消息容器都 translateY(8px) + opacity，220ms enter；**内部 block 的入场动画在容器入场后才开始**——避免 reflow 与嵌套动画冲突
- **Composer**：thinking 开关 toggle 圆点 translateX 180ms spring；workflow 切换分段按钮高亮底条 translateX 共享元素；发送按钮按下 scale 0.97 → 1.0 spring；发送中按钮 spinner，textarea 仍可输入下一条
- **Session 切换**：消息列表区 crossfade 160ms exit → 160ms enter
- **错误状态**：ErrorRow `translateY(-4px) + opacity` 180ms enter，禁止 shake / 红色闪烁

反模式（明确禁止）：
- 任何 `width / height / top / left` 动画
- 流式文本的 token-by-token fade-in（与打字节奏冲突）
- 任何超过 400ms 的过场动画
- 整页 fade / slide 切换会话
- spinner 居中遮罩 + 整页禁用
- 装饰性背景动画（粒子、渐变扫描等）

### 5.8 可访问性

- 所有图标按钮带 `aria-label`
- 流式文本容器 `aria-live="polite"`；error 容器 `role="alert"`
- focus 可见：3px primary ring，不可被组件移除
- tab 顺序与视觉顺序一致
- color-not-only：所有状态除颜色外配图标/文本
- 支持系统 Dynamic Type（不固定 px，使用 rem）
- 对比度核查：foreground 在 surface 上 19.2:1 / mutedText 7.5:1 / primary 6.1:1，全部 ≥ WCAG AA

### 5.9 响应式断点

| 断点 | 布局变化 |
|---|---|
| **< 768px** | Sidebar → 抽屉；消息列表全宽，左右 padding 16px；业务卡分区全部默认折叠；Composer 底栏简化为单行 |
| **768-1023px** | Sidebar 折叠为 56px icon-only；消息列表 max-w 640px |
| **≥ 1024px** | Sidebar 展开 280px；消息列表 max-w 760px 居中 |
| **≥ 1440px** | 同 1024，Sidebar 可拖宽至 360px |

### 5.10 核心数据模型与 reducer

```typescript
export type BlockStatus = 'streaming' | 'success' | 'failed' | 'pending' | 'submitted' | 'expired';

export type AgentBlock =
  | { type: 'text';       index: number; text: string; status: BlockStatus }
  | { type: 'thinking';   index: number; text: string; status: BlockStatus }
  | { type: 'tool_use';   index: number; tool_name: string; display_name: string;
                          input: Record<string, unknown>; output?: Record<string, unknown>;
                          status: BlockStatus; error?: string }
  | { type: 'interaction'; index: number; request_id: string;
                          interaction_type: 'dimension_selection' | 'plan_approval' | 'job_selection';
                          title: string; prompt: string; data: Record<string, unknown>;
                          status: BlockStatus; values?: Record<string, unknown> }
  | { type: 'interview_questions'; index: number; question_set: QuestionSet; status: BlockStatus }
  | { type: 'evaluation_report';   index: number; report: EvaluationReport;  status: BlockStatus };

export interface AgentMessage {
  id: number;
  session_id: number;
  role: 'user' | 'agent';
  workflow_type: WorkflowType;
  run_id: string | null;
  blocks: AgentBlock[];
  create_time: string;
}

export interface AgentRunState {
  running: boolean;
  run_id: string | null;
  workflow_type: WorkflowType;
  enable_thinking: boolean;
  steps: Array<{ step_id: string; title: string; status: 'pending'|'running'|'success'|'failed'; detail?: string }>;
  current_blocks: AgentBlock[];
  error: { code: string; message: string } | null;
}
```

```typescript
export function agentRunReducer(state: AgentRunState, envelope: AgentEnvelope): AgentRunState {
  switch (envelope.type) {
    case 'run.start':   return { ...state, running: true, run_id: envelope.data.run_id,
                                 workflow_type: envelope.data.workflow_type,
                                 enable_thinking: envelope.data.enable_thinking,
                                 steps: [], current_blocks: [], error: null };
    case 'run.finish':  return { ...state, running: false };
    case 'run.error':   return { ...state, running: false, error: envelope.data };
    case 'step.update': return { ...state, steps: upsertStep(state.steps, envelope.data) };
    case 'block.start': return { ...state, current_blocks: insertBlock(state.current_blocks, envelope.data) };
    case 'block.delta': return { ...state, current_blocks: applyDelta(state.current_blocks, envelope.data) };
    case 'block.stop':  return { ...state, current_blocks: stopBlock(state.current_blocks, envelope.data.index) };
    case 'interaction.request': return state;  // 已通过 block.start(type=interaction) 渲染
    case 'interaction.resolve':
      return { ...state, current_blocks: resolveInteraction(state.current_blocks, envelope.data) };
    default: return state;
  }
}
```

100 行内完成，**替代当前 761 行 stream-handler**。

### 5.11 useAgentRun hook（唯一对外接口）

```typescript
export function useAgentRun(sessionId: number) {
  const [state, dispatch] = useReducer(agentRunReducer, INITIAL_STATE);
  const [messages, setMessages] = useState<AgentMessage[]>([]);

  const sendMessage = useCallback(async (content, opts) => {
    optimisticAppendUserMessage(...);
    const stream = openAgentStream(`/api/v1/employee/agent/sessions/${sessionId}/messages/stream`, body);
    for await (const envelope of stream) {
      dispatch(envelope);
      if (envelope.type === 'run.finish') {
        appendAgentMessage(state.current_blocks, envelope.data.agent_message_id);
      }
    }
  }, [sessionId]);

  const submitInteraction = useCallback(async (requestId, values) => {
    /* 同上，走 /interactions/{request_id} */
  }, [sessionId]);

  return { messages, runState: state, sendMessage, submitInteraction };
}
```

### 5.12 SSE 客户端

```typescript
export async function* openAgentStream(url: string, body: unknown): AsyncIterableIterator<AgentEnvelope> {
  const resp = await fetch(url, { method: 'POST', body: JSON.stringify(body),
                                   headers: {'Content-Type': 'application/json'} });
  if (!resp.body) throw new Error('SSE no body');
  const reader = resp.body.pipeThrough(new TextDecoderStream()).getReader();
  let buf = '';
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += value;
    let idx;
    while ((idx = buf.indexOf('\n\n')) >= 0) {
      const frame = buf.slice(0, idx); buf = buf.slice(idx + 2);
      const payload = parseSSEFrame(frame);
      if (payload) yield payload as AgentEnvelope;
    }
  }
}
```

50 行内。不再依赖 EventSource（不支持 POST）、不依赖 v1/v2 双解析路径。

### 5.13 Composer 设计

```text
┌───────────────────────────────────────────────────┐
│  [简历问答] [简历评估]              [📎 简历]     │
├───────────────────────────────────────────────────┤
│                                                   │
│  textarea (auto-resize, max 200px)                │
│                                                   │
├───────────────────────────────────────────────────┤
│  ⚡思考模式 ⚪ Off  ⚪ On      [取消] [发送 Ctrl⏎] │
└───────────────────────────────────────────────────┘
```

- workflow 切换：分段按钮，默认"简历问答"，切换不清空输入
- 思考开关：本次会话级（修改后写 `agent_session.enable_thinking`）
- 简历附件：保留独立上传接口；上传后在 textarea 上方显示"已附简历: xxx.pdf [移除]" 芯片

---

## 6. 实施顺序、验收与风险

### 6.1 实施阶段总览（12 阶段，每阶段独立可运行）

| 阶段 | 主题 | 关键产物 | 验收方式 |
|---|---|---|---|
| **0** | 破坏性清理 | DDL 重建 + 删除清单 | 仓库可编译，所有 import 错误已修正或注释 |
| **1** | 协议层 schema | envelope.py / events.py / blocks.py / 精简 dto | pydantic 单测：9 事件 × 6 block 序列化往返通过 |
| **2** | LLM 底座 | gateway 双 channel / model_router 简化 / thinking 降级 | 真实 deepseek 流式跑通，reasoning_content 分流正确 |
| **3** | 流式发射器 | emitter.py 9 个 emit_* 方法 | 单测断言信封字段与 seq 单调 |
| **4** | 图与 runner | state / context / runner + 两图骨架 | mock service 跑通 interrupt + Command resume |
| **5** | 业务 Service | InterviewQuestion / ResumeEvaluation / ResumeLoader + prompts 迁移 | 两图端到端 mock LLM 跑通，断言 final blocks 形态 |
| **6** | Runtime 三服务 | session / runtime / resume + repository 瘦身 | endpoint 集成测试覆盖 CRUD + stream + interactions |
| **7** | Endpoint 重写 | agent.py 路由四个 + 删除 actions/memory | curl SSE 协议匹配 |
| **8** | 前端协议层 | types / stream-client / reducer / hook | reducer 单测 ≥ 30 用例覆盖 9×6 矩阵 |
| **9** | 前端 token + 动效 | design/tokens.ts / motion.ts / tailwind 接入 / useFrameBatchedText | Storybook mock 验证字符节奏 80cps |
| **10** | 前端 6 个 block 渲染器 | blocks/*.tsx | 每个 block 三种状态 Storybook 跑通 |
| **11** | 前端骨架与集成 | workspace / sidebar / message-list / composer / step-strip + shared-element | 两个 workflow 真实端到端走通 |

### 6.2 Commit 粒度

每阶段一次 commit，message 模板：
```
refactor(agent): <stage X> <one-line summary>

- 子改动 1
- 子改动 2

验收：<本阶段验证方式简述>
```

阶段 0 是唯一一次大规模删除，单独立 commit。

### 6.3 完整后端验收清单

**协议层（阶段 1）**
- [ ] 9 种 `envelope.type`：`run.start / run.finish / run.error / step.update / block.start / block.delta / block.stop / interaction.request / interaction.resolve`，无遗漏、无多余
- [ ] 6 种 `block.type`：`text / thinking / tool_use / interaction / interview_questions / evaluation_report`，无遗漏、无多余
- [ ] envelope 字段：`v=1 / seq / ts / run_id / session_id / type / data`，无其他
- [ ] 未知 type 通过 `extra="allow"` 静默接受
- [ ] 6 block 通过 `Discriminated Union` 序列化往返一致

**LLM 底座（阶段 2）**
- [ ] `enable_thinking=true` 时 gateway 注入正确 `extra_body`
- [ ] `delta.reasoning_content` 分流为 `LLMStreamChunkDTO(kind="thinking")`
- [ ] 模型不支持 thinking 时自动降级 false 重试 1 次，日志 WARNING
- [ ] fallback 模型继承 `enable_thinking` 语义
- [ ] `LLMStreamChunkDTO` 4 个 `kind`：text / thinking / usage / done
- [ ] `provider` 字段驱动 THINKING_PARAM_MAP，无字符串嗅探

**Graph 与中断（阶段 4-5）**
- [ ] 图一 8 节点全部走通，最终 `blocks` 含 1 个 `interview_questions`
- [ ] 图一 维度选择 + 计划审批两次 interrupt 都能 resume
- [ ] 图一 AI 维度提议失败时退化为内置维度，单测覆盖
- [ ] 图一 fanout_generate_questions 并发分支，单分支失败不阻塞其他
- [ ] 图二 8 节点全部走通，最终 `blocks` 含 1 个 `evaluation_report`
- [ ] 图二 岗位校验失败 3 次后 `run.error`，code = `job_validation_exhausted`
- [ ] 图二 复用 `evaluation_graph.arun()`，不写业务评估表
- [ ] MemorySaver 进程重启 thread 失效，提交过期 interaction 返回 `interaction_expired`

**Service 边界（阶段 5-6）**
- [ ] 节点函数代码行数全部 ≤ 10 行（grep 验证）
- [ ] 节点文件无 `await db.` / `await self._cache.` / `prompt_loader` / `router.stream` 直接出现
- [ ] AgentSessionService / AgentRuntimeService / AgentResumeService 之间无相互调用
- [ ] 所有 emit_* 调用均来自 Service
- [ ] `get_stream_writer()` 仅出现在 Service 文件

**事件流正确性（阶段 6-7）**
- [ ] 一次 run 严格符合 `run.start → ...blocks/steps... → (run.finish | run.error)` 结构
- [ ] 每个 `block.start` 必有匹配 `block.stop`（同 index）
- [ ] `seq` 同 run 内单调递增、无跳号、无重复
- [ ] `interaction.request` 出现后紧跟 `run.finish`（同 run 内）
- [ ] Redis buffer key (`agent:stream_buffer:{session_id}:{run_id}`) 在落库后删除
- [ ] Redis 失败时降级内存缓冲，主流程不中断；日志 ERROR
- [ ] `interaction.resolve` 回写旧 block.status 为 `submitted` + `values`

**持久化（阶段 6）**
- [ ] `agent_message.content.blocks` 是事件序列折叠结果（不重复 stream_events）
- [ ] 历史会话查询返回完整 `blocks`，前端能直接重放
- [ ] thinking 开关写入 `agent_session.enable_thinking`，刷新后保留
- [ ] 不存在 v1/v2/legacy 字段（grep `schema_version`、`agent.v1`、`stream_events` 应零命中）

### 6.4 完整前端验收清单

**协议层（阶段 8）**
- [ ] reducer 单测 ≥ 30 用例，覆盖 9 事件 × 6 block 主要矩阵
- [ ] 未知 envelope.type / block.type 静默忽略，无 console.error
- [ ] `agent-stream-client.ts` ≤ 80 行
- [ ] `agent-run-reducer.ts` ≤ 150 行
- [ ] `types/agent.ts` ≤ 180 行

**设计 Token（阶段 9）**
- [ ] tailwind.config 内 motion / color / spacing token 唯一来源
- [ ] grep 组件，无内联 `duration-[XXXms]`、内联 hex
- [ ] `prefers-reduced-motion: reduce` 模式下 stagger / spring / rAF 全部降级
- [ ] light 模式对比度全部 ≥ 4.5:1（axe 工具扫描）

**6 个 block 渲染器（阶段 10）**
- [ ] **TextBlock**：流式 cursor 闪烁 800ms；完成后 80ms fade-out；rAF 节拍器 80cps
- [ ] **ThinkingBlock**：紫底 + 紫边；streaming sticky-top 32px；indicator bar 扫光动画；1.5s 后自动折叠
- [ ] **ToolUseBlock**：单行 40px；running 旋转 spinner + 省略号；点击展开 input/output
- [ ] **InteractionBlock**：三种 interaction_type 表单分别可交互；submitted 后只读历史；错误 `role="alert"`
- [ ] **InterviewQuestionsCard**：骨架→内容 crossfade；维度分组；追问折叠；复制按钮 toast
- [ ] **EvaluationReportCard**：顶部摘要；6 分区折叠；scaleX 条形图；移动端默认全收起

**流式连续性（阶段 9-10 重点）**
- [ ] 长 prompt 触发后，TextBlock 字符以 ~80cps 稳定吐出
- [ ] block.stop 时 flush() 立即显完队列，无"尾巴拖延"
- [ ] 流式期间用户上滚阅读历史，不被强行拽回底部
- [ ] 一旦回到底部 48px 内，重新进入 follow 模式
- [ ] 思考块展开/折叠不导致下方业务卡跳动
- [ ] InterviewQuestionsCard / EvaluationReportCard 出现时先骨架后内容
- [ ] RunRow → AgentMessage 切换无视觉跳变（layoutId）
- [ ] DevTools Performance 录制：流式 1 分钟无 layout shift > 0.05，无 long task > 50ms

**Composer（阶段 11）**
- [ ] workflow 切换不清空输入；切换后底条用 spring 位移
- [ ] 思考开关变更立即写入会话
- [ ] 简历附件上传后显示 chip
- [ ] Ctrl+Enter 发送
- [ ] 发送中按钮 spinner，textarea 仍可输入下一条

**可访问性**
- [ ] 所有图标按钮 `aria-label`
- [ ] 流式 TextBlock `aria-live="polite"`
- [ ] 错误 / interaction-error `role="alert"`
- [ ] focus 可见 3px ring
- [ ] tab 顺序与视觉一致
- [ ] color-not-only
- [ ] 375 / 768 / 1024 / 1440 四断点无横向滚动

### 6.5 性能验收

| 指标 | 目标 | 验证方式 |
|---|---|---|
| First delta to UI | ≤ 1.2s（本地 mock） | curl + DevTools Network |
| 流式期间主线程长任务 | ≤ 50ms / frame | DevTools Performance |
| 字符吐出节奏稳定性 | 偏差 ≤ ±10%（target 80cps） | 录制 30s 文本流计数 |
| 50 条历史消息会话打开 | ≤ 300ms 可滚动 | DevTools Network + LCP |
| layout shift | CLS ≤ 0.05 | Performance Insights |
| Redis buffer TTL | 30 分钟，过期自动清理 | redis-cli TTL 抽样 |
| 内存：单会话 100 条消息 | heap 增量 ≤ 30MB | DevTools Memory snapshot |

### 6.6 风险与控制

| 风险 | 影响 | 控制方式 |
|---|---|---|
| MemorySaver 进程重启丢失 checkpoint | 中断中的 run 无法继续 | UI 显示 `interaction_expired`；HR 重新发起；上线后观察一周，若频繁出现再切 RedisSaver |
| `delta.reasoning_content` 在新 provider 上字段名不同 | thinking 内容显示不出 | Gateway 内做两路 fallback 抽取；接入新 provider 只需 1 行 |
| `get_stream_writer()` 在 LangGraph 升级时签名变化 | runner 报错 | runner 初始化时探测可用性；锁 langgraph 次版本 |
| shared-element transition 在 React 19 StrictMode 二次挂载触发 layout flash | 视觉闪烁 | Framer Motion `layoutId` 配 `LayoutGroup`；fallback 为 crossfade |
| rAF 节拍器在低端机表现不佳 | 字符吐出更慢 | 监测 `dt > 50ms` 时动态提升 cps 至 200，避免堆积 |
| Redis 网络抖动导致 buffer append 失败 | 历史 stream_events 丢失 | 内存缓冲兜底；最终 agent_message 仍能写入 |
| 两图并发触发同一会话 | checkpoint thread 冲突 | endpoint 层加会话级 asyncio.Lock；UI running 期间禁用发送 |
| Inter 字体 CDN 失败 | 退回 system-ui，视觉降级 | `font-display: optional`；本地存一份 Inter woff2 fallback |
| 大评估报告 JSON 落库 > 1MB | 单条 query 慢 | 单 block 上限 256KB；超长字段放静态资源（本期暂不实现，验收检查上限断言） |
| 流式期间用户切会话 | 上一 run 事件错位渲染 | useAgentRun 在 session_id 变化时 abort SSE + reset reducer |

### 6.7 不在本次范围内

- 通用聊天 workflow（general_chat）
- 评估结果写入业务评估表 / 匹配表
- 接入 Anthropic 原生协议（仍只用 OpenAI-compatible）
- Action 写操作框架（已删除，未来再设计）
- 长期记忆（已删除，按需再回来）
- RedisSaver（MemorySaver 够用前不引入）
- 重型图表库
- 多模型并行对比

### 6.8 落地里程碑

```text
里程碑 A  (阶段 0-3)：后端协议骨架 + LLM 底座            ── 单元可测
里程碑 B  (阶段 4-7)：后端两图端到端 + Endpoint           ── 后端可独立运行
里程碑 C  (阶段 8-10)：前端协议层 + 6 个 block            ── 前后端能联通跑通
里程碑 D  (阶段 11)：完整集成 + 验收                       ── 上线候选版
```
