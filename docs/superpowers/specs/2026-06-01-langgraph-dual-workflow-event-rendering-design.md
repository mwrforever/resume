# LangGraph 双图重构与事件渲染协议设计

## 1. 背景与目标

本设计用于重构招聘 Agent 后端运行时与前端事件渲染体验。目标是基于 LangGraph 建立两个独立业务图，并通过统一、轻量、可恢复的事件协议，为 HR 提供流畅、免打扰、可追溯的智能面试辅助体验。

本次重构一次完整落地，包含：

- 后端双业务图独立编译与运行时路由。
- 图一“简历问答”：基于简历生成结构化面试题清单。
- 图二“简历评估”：基于简历和岗位生成完整评估报告，仅展示不写业务评估表。
- SSE v2 事件协议升级，区分思考内容、正式正文、业务事件和结构化卡片。
- Redis 临时流式缓冲，完成后一次性写入 `agent_message`。
- LangGraph checkpoint 负责中断后的继续执行。
- `agent_message` 只保存前端渲染所需业务数据与事件快照。
- 前端实现轻量事件时间线、内联交互卡片、结构化业务卡片和历史恢复。

## 2. 已确认产品决策

- 采用方案 B：两个业务图独立编译，`AgentService` 按消息级 `workflow_type` 选择 Runner。
- 前端 workflow 展示文案：
  - `interview_questions`：简历问答。
  - `resume_evaluation`：简历评估。
- 默认 workflow 为 `interview_questions`。
- 图一“简历问答”的最终产出是面试题清单，不做泛化简历聊天。
- 图一 HR 维度来源为 AI 基于简历提议维度；AI 失败或信息不足时退化为固定内置维度。
- 图一每次生成前必须走规划审批，HR 批准或修改后再并行生成题目。
- 图一默认输出标准版 8-12 题。
- 图二“简历评估”只展示不落库，不写现有评估表或匹配表。
- 图二岗位交互支持候选岗位点击和手动输入岗位全名。
- 图二岗位提交后必须严格校验岗位全名存在且归属当前员工，并支持重试。
- 图二最终卡片展示完整报告：匹配、决策建议、简历结构、经历时间线、技能/维度可视化和岗位差距。
- 历史会话需要恢复完整流式事件的渲染效果。
- 未完成交互重开后仍可显示为可操作卡片；真正能否继续执行由 LangGraph checkpoint 决定。
- 思考内容只在开启思考模式时输出，必须和正式正文分开渲染。
- 流式 chunk 先写 Redis 临时缓冲，通过 Redis `APPEND` 原子追加并设置 30 分钟 TTL；回答结束后读取完整内容一次性写入数据库。

## 3. 后端架构

### 3.1 分层原则

保持现有项目分层，不越层调用：

```text
endpoint → service → repository / redis → schema
              ↓
       workflow runner → graph node → service
```

职责边界：

- Endpoint：只负责请求体校验、依赖注入、调用 Service、返回 SSE。
- `AgentService`：负责会话生命周期、用户消息落库、workflow 路由、SSE 输出协调、最终 Agent 消息落库。
- 业务 Service：负责业务规则、Prompt 渲染、LLM 调用编排、数据组合和异常兜底。
- Graph Node：只负责读取 state、调用 Service、返回 state patch 或 interrupt。
- Repository：只负责数据库读写。
- `CacheService` / Redis：负责缓存与临时流式缓冲，不在节点内直接实例化。

### 3.2 新增后端服务

建议新增或拆分以下服务：

```text
backend/app/services/interview_question_service.py
backend/app/services/resume_evaluation_workflow_service.py
backend/app/services/agent_stream_buffer_service.py
```

职责：

- `InterviewQuestionService`
  - 加载简历原文。
  - AI 提议面试维度。
  - 维度失败兜底为固定内置维度。
  - 生成出题计划。
  - 按维度生成面试题。
  - 汇总面试题清单 block。

- `ResumeEvaluationWorkflowService`
  - 加载简历原文。
  - 生成简历结构化画像。
  - 查询 Redis / 岗位库得到候选岗位。
  - 校验岗位全名与员工归属。
  - 调用现有评估子图。
  - 组合完整评估报告 block。

- `AgentStreamBufferService`
  - 使用 Redis `APPEND` 保存 JSONL 事件。
  - 每次追加后刷新 30 分钟 TTL。
  - 完成或中断时读取事件。
  - 写库完成后清理 Redis key。
  - Redis 异常时支持内存缓冲兜底。

### 3.3 图单例编译

FastAPI `lifespan` 中编译两个业务图：

```text
app.state.agent_workflow_graphs = {
  "interview_questions": compiled_interview_question_graph,
  "resume_evaluation": compiled_resume_evaluation_graph,
}
```

运行时通过 state 注入：

- `workflow_type`
- `employee_id`
- `session_id`
- `user_message_id`
- `run_id`
- `resume_ref`
- `runtime_config`
- `service_context`
- `interaction_payload`

图结构进程级复用，业务配置运行时动态绑定。

### 3.4 与现有 Coordinator 的关系

本次两个新业务流不再以通用 supervisor 作为主入口。现有 `CoordinatorRunner + sub_agents` 可以保留，用于兼容现有通用 Agent 能力，但新 workflow 默认走双图 Runner。

本次不新增 `general_chat`，避免扩大范围。

## 4. 请求协议

`AgentMessageCreate` 增加字段：

```text
workflow_type: "interview_questions" | "resume_evaluation" = "interview_questions"
```

前端展示文案：

```text
interview_questions → 简历问答
resume_evaluation  → 简历评估
```

非法 workflow 返回业务校验错误，不进入图运行。

## 5. 双图 State 与节点设计

### 5.1 共享 State

```text
AgentWorkflowState
- workflow_type
- employee_id
- session_id
- user_message_id
- run_id
- resume_ref
- runtime_config
- interaction_payload
- final_blocks
- error_message
```

说明：

- `resume_ref` 来自消息 `context_refs` 或上传简历后的引用。
- `interaction_payload` 来自表单恢复接口。
- `final_blocks` 存放最终要写入 `agent_message.content.blocks` 的结构化 block。
- 执行恢复状态不保存在 `agent_message`，由 LangGraph checkpoint 管理。

### 5.2 图一 State

```text
InterviewQuestionState
- resume_text
- suggested_dimensions
- selected_dimensions
- question_plan
- generated_question_groups
- question_set
```

### 5.3 图一流程

```text
START
 → load_resume
 → suggest_dimensions
 → request_dimension_selection
 → build_question_plan
 → request_plan_approval
 → fanout_generate_questions
 → reduce_questions
 → finalize_question_set
 → END
```

节点职责：

- `load_resume`：调用 `InterviewQuestionService.load_resume_text()`。
- `suggest_dimensions`：调用 `InterviewQuestionService.suggest_dimensions()`，失败时由 Service 返回内置维度。
- `request_dimension_selection`：发出 `interaction_request`，类型为 `dimension_selection`，等待 HR 多选。
- `build_question_plan`：调用 `InterviewQuestionService.build_question_plan()`。
- `request_plan_approval`：发出 `interaction_request`，类型为 `plan_approval`，每次必须出现。
- `fanout_generate_questions`：按维度并行 `Send`，每个分支调用 `InterviewQuestionService.generate_questions_for_dimension()`。
- `reduce_questions`：汇总、排序并保证总题量 8-12。
- `finalize_question_set`：生成 `interview_question_set` block。

### 5.4 图二 State

```text
ResumeEvaluationState
- resume_text
- resume_profile
- job_candidates
- selected_job
- validation_attempts
- evaluation_result
- visualization_report
```

### 5.5 图二流程

```text
START
 → load_resume
 → analyze_resume_profile
 → load_job_candidates
 → request_job_selection
 → validate_job_full_name
 → run_evaluation_subgraph
 → build_visualization_report
 → finalize_evaluation_report
 → END
```

节点职责：

- `load_resume`：调用 `ResumeEvaluationWorkflowService.load_resume_text()`。
- `analyze_resume_profile`：生成结构化简历画像。
- `load_job_candidates`：优先查 Redis，未命中查 `JobRepository.get_by_employee()` 并写缓存。
- `request_job_selection`：发出 `interaction_request`，类型为 `job_selection`，支持候选点击和手输全名。
- `validate_job_full_name`：严格校验岗位全名和员工归属。失败时回到 `request_job_selection`。
- `run_evaluation_subgraph`：复用现有 `evaluation_graph.arun()`，只拿结构化结果，不写业务表。
- `build_visualization_report`：组合匹配、决策建议、简历结构、时间线、技能/维度数据和岗位差距。
- `finalize_evaluation_report`：生成 `resume_evaluation_report` block。

### 5.6 节点约束

节点代码必须保持极简：

```text
async def node(state):
    service = state["service_context"].interview_question_service
    return await service.some_action(state)
```

节点禁止：

- 直接查询 DB。
- 直接查询 Redis。
- 直接拼 Prompt。
- 直接调用 provider client。
- 直接写 `agent_message`。
- 承载复杂业务规则。

## 6. SSE 事件协议

### 6.1 统一 SSE 事件名

SSE 外层事件名统一为：

```text
agent
```

所有差异放在 JSON 信封内。

### 6.2 信封结构

```text
AgentStreamEnvelope
- schema_version: "2.0"
- seq
- ts
- run_id
- session_id
- workflow_type
- node_id
- event_type
- display_name
- payload
```

说明：

- `seq`：后端单调递增。
- `ts`：毫秒时间戳。
- 前端排序规则：`ts` 升序，`seq` 升序。
- `display_name`：业务化名称，不展示技术节点名。
- `payload`：只包含当前事件必要数据。

### 6.3 事件类型全集

```text
thinking_status
thinking_stream
text_stream
tool_call
tool_result
planning
interaction_request
interaction_result
execution_status
data_card
error
completed
```

### 6.4 思考内容边界

思考内容只在 `runtime_options.enable_thinking = true` 时输出。

- 模型 reasoning delta → `thinking_stream`
- 模型正式回答 delta → `text_stream`
- 业务状态 → `execution_status` / `tool_call` / `tool_result`
- 结构化结果 → `data_card`
- 交互中断 → `interaction_request`

如果 provider 没有显式 reasoning 字段，不从普通 content 中猜测思考内容，只发送 `thinking_status` 表示不可用或已完成。

思考内容约束：

- 不进入最终正文。
- 不参与结构化报告解析。
- 不作为业务事实来源。
- 不展示 prompt、密钥、私密工具参数。
- 前端默认折叠显示。

### 6.5 交互请求类型

统一通过 `interaction_request`：

```text
dimension_selection
plan_approval
job_selection
```

对应完成事件为 `interaction_result`。前端历史恢复时通过相同 `request_id` 判断交互是否已完成。

## 7. Redis 临时流式缓冲

### 7.1 Redis key

```text
agent:stream_buffer:{session_id}:{run_id}
```

### 7.2 写入方式

每条 envelope 序列化为 JSON Lines：

```text
APPEND key "{json}\n"
EXPIRE key 1800
```

约束：

- 使用 Redis `APPEND` 原子追加。
- 每次追加后刷新 TTL 为 30 分钟。
- 流式过程中不频繁写 MySQL。
- 完成后读取 Redis buffer，一次性构建 `agent_message.content.blocks`。

### 7.3 正常完成

```text
completed event sent
 → read Redis JSONL
 → parse AgentStreamEnvelope[]
 → build text / stream_events / business card blocks
 → insert agent_message
 → delete Redis key
```

### 7.4 错误结束

```text
error event sent
 → read Redis JSONL
 → build error summary + stream_events blocks
 → insert agent_message
 → delete Redis key
```

### 7.5 中断点

中断点可写入阶段性 `agent_message`，但其目的只是前端刷新后能展示截至当前的业务事件和交互卡片。

执行恢复来源仍然是 LangGraph checkpoint。

```text
interaction_request sent
 → Redis buffer 包含当前渲染事件
 → read Redis buffer
 → write/update agent_message render snapshot
 → checkpoint 保存真实恢复状态
```

### 7.6 Redis 异常兜底

如果 Redis 追加失败：

- 不中断 SSE 主流程。
- 记录 ERROR 日志和完整堆栈。
- 退化为进程内事件列表缓冲。
- 最终仍尝试保存数据库消息。

如果 Redis 读取失败：

- 使用内存缓冲。
- 若 Redis 和内存缓冲都不可用，至少保存最终 text/card/error block。

## 8. checkpoint 与 agent_message 职责边界

### 8.1 checkpoint 负责执行恢复

继续执行依赖 LangGraph checkpoint。

```text
request_id + values
 → AgentService 校验 session / employee
 → 根据 thread_id / run_id 定位 checkpoint
 → graph resume
```

### 8.2 agent_message 负责前端展示

`agent_message.content.blocks` 只保存前端渲染所需业务数据：

- `text`
- `stream_events`
- `interview_question_set`
- `resume_evaluation_report`
- 交互卡片展示快照
- 错误摘要

`agent_message` 不保存：

- 图内部可执行状态。
- service context。
- provider 密钥或私密 runtime 配置。
- checkpoint state。

### 8.3 checkpoint 过期

如果用户提交 pending 卡片时 checkpoint 不存在：

- 后端返回业务错误：“这个操作已过期，请重新发起一次流程。”
- 前端将卡片标记为过期态。
- 历史消息仍保留，不删除。

## 9. agent_message 保存结构

### 9.1 图一消息

```json
{
  "context_refs": [],
  "blocks": [
    {
      "type": "text",
      "text": "已生成本次面试题清单。"
    },
    {
      "type": "stream_events",
      "schema_version": "2.0",
      "events": []
    },
    {
      "type": "interview_question_set",
      "question_set": {}
    }
  ]
}
```

### 9.2 图二消息

```json
{
  "context_refs": [],
  "blocks": [
    {
      "type": "text",
      "text": "已完成本次简历评估。"
    },
    {
      "type": "stream_events",
      "schema_version": "2.0",
      "events": []
    },
    {
      "type": "resume_evaluation_report",
      "report": {}
    }
  ]
}
```

## 10. 前端 UI 设计

### 10.1 总体原则

前端遵循企业级 HR SaaS 风格：专业蓝色体系、高对比文本、清晰层级、扁平化卡片、内联交互、可访问表单控件。

视觉优先级：

```text
正文内容 > 结构化业务卡片 > 交互卡片 > 精简事件状态 > 思考折叠面板
```

事件渲染必须精小，不影响正文内容展示。

### 10.2 Workflow 选择器

输入区展示轻量分段按钮：

```text
[ 简历问答 ] [ 简历评估 ]
```

规则：

- 默认选中“简历问答”。
- 切换不清空输入。
- 发送消息时携带 `workflow_type`。
- 不展示技术枚举名。

### 10.3 事件运行条

运行事件默认折叠为紧凑条：

```text
运行过程 · 已完成 5 步 · 2.4s    展开
```

展开后显示小型时间线：

```text
✓ 解析简历
✓ 生成面试维度
● 等待你选择重点
```

默认折叠事件：

- `execution_status`
- `tool_call`
- `tool_result`
- `planning` 摘要
- `completed`

默认展开事件：

- `interaction_request`
- `data_card`
- `error`
- `text_stream` 聚合后的正文

### 10.4 思考面板

开启思考模式时展示折叠面板：

```text
思考过程 · 已完成    展开查看
```

规则：

- 默认折叠。
- 不和正式正文混排。
- 历史恢复后仍默认折叠。
- 展开后限制最大高度，超出滚动。
- 模型不返回 reasoning 时不伪造内容。

### 10.5 交互卡片

#### 维度选择卡

用于图一 `dimension_selection`。

- 多选 checkbox chip。
- 展示维度名称和简短原因。
- 支持确认选择。
- 卡片内展示错误，不弹窗。

#### 规划审批卡

用于图一 `plan_approval`。

- 展示总题量、维度题量、难度分布。
- 默认摘要，展开后可编辑。
- 主按钮：批准并生成。
- 次按钮：驳回并说明。
- 每次面试题生成必须出现。

#### 岗位选择卡

用于图二 `job_selection`。

- 展示候选岗位。
- 支持手动输入岗位全名。
- 候选点击只填入岗位名，仍走后端严格校验。
- 校验失败在卡片内显示。
- 最多重试 3 次。

### 10.6 面试题清单卡

`interview_question_set` 渲染为结构化卡片。

默认字段：

- 题目。
- 维度。
- 难度。
- 考察点。
- 追问建议。
- 优秀信号。
- 一般信号。
- 风险信号。

渲染规则：

- 按维度分组。
- 默认展示题目、维度、难度、考察点。
- 追问建议和信号可折叠。
- 支持复制单题和复制全部。
- 不用大段 Markdown 替代结构化卡片。

### 10.7 简历评估报告卡

`resume_evaluation_report` 渲染为分区卡片。

顶部摘要：

- 总分。
- 等级。
- 是否建议推进。
- 一句话匹配总结。

分区：

- 匹配概览。
- HR 决策建议。
- 简历结构。
- 经历时间线。
- 技能/维度可视化。
- 岗位差距。

可视化规则：

- 优先 CSS/SVG 轻量条形图。
- 不引入重型图表库。
- 移动端可折叠。

### 10.8 历史恢复

打开会话时：

```text
messages → blocks → renderer
```

恢复规则：

- `stream_events` 重建运行条、思考面板、交互卡片状态。
- `interview_question_set` / `resume_evaluation_report` 直接渲染业务卡片。
- `interaction_request` 没有对应 `interaction_result` 时显示为 pending。
- 用户提交 pending 卡片后，后端通过 checkpoint 判断是否可继续。
- checkpoint 过期时卡片变为已过期。

### 10.9 视觉规范

推荐基础设计系统：

- 主色：`#2563EB`
- 辅助蓝：`#3B82F6`
- 背景：`#F8FAFC`
- 正文：`#1E293B`
- 弱文本：`#475569`
- 边框：`#E2E8F0`
- 成功：`#059669`
- 警告：`#D97706`
- 错误：`#DC2626`

交互规范：

- 不使用 emoji 作为图标。
- 统一使用 Lucide React。
- 点击元素有 `cursor-pointer`。
- hover 不使用导致布局跳动的 scale。
- 动画控制在 150-300ms。
- 支持 `prefers-reduced-motion`。

### 10.10 可访问性

必须满足：

- 所有按钮可键盘操作。
- 输入框有 label。
- 状态变化使用 `aria-live="polite"`。
- 错误区域使用 `role="alert"`。
- 选中状态不只靠颜色，也用边框、图标或文字。
- 时间线状态有文本说明。

## 11. Prompt 与 LLM 分层

Prompt 资产放在：

```text
backend/app/llm/prompts/templates/
```

建议新增：

- `interview_dimension_suggest.yaml`
- `interview_question_plan.yaml`
- `interview_question_generate.yaml`
- `resume_profile_analyze.yaml`
- `resume_evaluation_visual_report.yaml`

LLM 调用仍走：

```text
model_router → gateway → provider client
```

业务 Service 使用 `model_router`，不得直接调用 provider client。

Prompt 必须包含：

- Role。
- Context。
- Instructions。
- Output Format。
- Few-shot 或明确 JSON 示例。

输出要求：

- 结构化 JSON 时只输出 JSON。
- 不输出 Markdown 包裹。
- 不使用不确定弱判断表达作为结论。
- 证据必须来自简历原文、岗位信息或评估模板。

## 12. DDL 与数据结构影响

实施前必须先检查并更新 `sql/init.sql`。

当前设计优先复用已有 `agent_message.content` JSON 字段，不强制新增表。

如需要将 `workflow_type` 持久化为查询字段，可考虑给 `agent_message` 增加字段：

```text
workflow_type varchar(50) null
run_id varchar(80) null
```

但如果 `workflow_type` 和 `run_id` 已能通过 `content.blocks[type=stream_events]` 满足展示与恢复，则不新增字段，避免过度设计。

Redis buffer 不需要 DDL。

## 13. 测试验收标准

### 13.1 后端 Workflow 路由

- `workflow_type = interview_questions` 进入图一。
- `workflow_type = resume_evaluation` 进入图二。
- 不传时默认图一。
- 非法值返回校验错误。

### 13.2 图一

- 能加载简历原文。
- AI 维度失败退化为固定内置维度。
- 维度选择触发 `interaction_request`。
- 每次生成前都触发规划审批。
- 审批后并行生成题目。
- 最终题量 8-12。
- 输出 `interview_question_set` block。

### 13.3 图二

- 能加载并解析简历。
- 岗位候选优先查 Redis。
- Redis 未命中查岗位库并写缓存。
- 候选点击与手输都走全名校验。
- 岗位必须归属当前员工。
- 校验失败支持最多 3 次重试。
- 复用现有 `evaluation_graph.arun()`。
- 不写业务评估表或匹配表。
- 输出 `resume_evaluation_report` block。

### 13.4 SSE 与 Redis buffer

- 每个 envelope 追加到 Redis JSONL。
- 使用 Redis `APPEND`。
- 每次追加刷新 TTL 为 30 分钟。
- 完成后一次性写入 `agent_message`。
- 写库后清理 Redis key。
- Redis 失败时退化到内存缓冲。
- `thinking_stream` 不混入 `text_stream`。
- 所有事件可按 `ts + seq` 稳定排序。

### 13.5 checkpoint 与中断恢复

- 继续执行依赖 checkpoint。
- `agent_message` 只作为渲染快照。
- 中断后刷新能看到交互卡片。
- 提交 pending 卡片时通过 checkpoint resume。
- checkpoint 失效时返回业务化过期错误。
- 过期卡片只读展示，不删除历史。

### 13.6 前端

- 输入区展示“简历问答 / 简历评估”。
- 默认选中“简历问答”。
- 发送时携带 `workflow_type`。
- 事件运行条默认折叠。
- 思考内容默认折叠且不进入正文。
- `text_stream` 渲染正式正文。
- `data_card` 渲染结构化业务卡。
- 错误内联展示。
- 历史会话恢复事件、思考、交互卡片和业务卡片。

### 13.7 视觉与可访问性

- 不使用 emoji 图标。
- 统一使用 Lucide React。
- 文本对比度满足 WCAG。
- focus 状态可见。
- 点击元素有 `cursor-pointer`。
- 375px、768px、1024px、1440px 下无横向滚动。
- 支持 `prefers-reduced-motion`。

## 14. 实施顺序

实施时按以下顺序推进：

```text
1. 检查并更新 sql/init.sql
2. 后端 schema：workflow_type、事件 block 类型
3. Redis stream buffer service
4. 双图 state / graph / runner
5. InterviewQuestionService
6. ResumeEvaluationWorkflowService
7. AgentService workflow 路由与持久化
8. 前端 types/api workflow_type
9. 前端 stream handler 与历史恢复
10. 前端交互卡片与业务卡片
11. 测试与回归验证
```

## 15. 风险与控制

### 15.1 改动范围大

控制方式：按 DDL、协议、后端图、前端渲染、测试分阶段提交，每阶段保持可运行。

### 15.2 事件协议与现有 v2 兼容

控制方式：保留现有 v2 兼容解析，新增事件类型走显式分支，不破坏旧 `message.delta` / `message.done` 逻辑。

### 15.3 checkpoint 与渲染快照混淆

控制方式：代码和文档中明确：checkpoint 负责执行恢复，`agent_message` 负责展示恢复。

### 15.4 Redis buffer 失败

控制方式：Redis 失败不影响 SSE，退化内存缓冲，日志记录完整异常栈。

### 15.5 前端事件过度占用空间

控制方式：事件默认折叠，正文和业务卡片保持主视觉。

## 16. 不在本次范围内

- 不新增通用聊天 workflow。
- 不将图二评估结果写入现有评估/匹配业务表。
- 不引入重型图表库。
- 不把 `agent_message` 作为 LangGraph 恢复状态来源。
- 不在 Graph Node 中直接实现复杂业务逻辑。
