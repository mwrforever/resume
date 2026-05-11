# Agent 工作台与模型运行配置重构设计

## 1. 背景与目标

本次重构覆盖两个区域：员工端 Agent 工作台与模型配置管理。目标是把当前“可用但信息分散”的 Agent/LLM 体验升级为企业级 HR SaaS 的专业 Agent 控制台：主对话区域优先、运行过程可观测、模型参数可配置且真实生效，并支持模型配置列表后端分页与前端滚动加载。

已确认的产品方向：采用 B 方案，即“ChatGPT 主对话 + 可折叠 Trace/配置面板”。左侧会话列表也需要支持折叠收起。模型运行参数采用“用户默认配置 + 会话覆盖”的持久化模型。

## 2. 范围

### 2.1 包含

- 删除 Agent 工作台页面内 `Workspace / Agent 工作台` 大标题区域，让聊天区域获得更多高度。
- Agent 工作台左侧会话列表支持展开/折叠。
- Agent 工作台右侧功能面板支持展开/折叠，并按配置、工具、记忆、Trace、指标分组。
- Agent 回复内容使用项目已集成的 `react-markdown` 渲染。
- Agent 流式生成过程展示动态状态，并把工具调用以内联时间线方式展示在当前回复附近。
- 新增模型运行参数持久化能力：用户默认配置 + 会话级覆盖。
- Agent 发送消息时使用会话级运行配置，配置真实影响本次模型调用、工具调用和记忆上下文行为。
- 模型配置管理列表改为后端分页接口 + 前端无限滚动加载，并对触底、搜索、筛选、刷新做节流和防重复请求。
- 模型参数配置控件化：布尔值用 Switch，数值用 Slider + 手动输入，枚举/多选用下拉选择 + 自定义输入。

### 2.2 不包含

- 不更换前端技术栈，不引入新的重量级 UI 框架。
- 不重构无关员工、用户、简历、岗位、评估页面。
- 不改变现有模型连接配置的权限规则、软删除规则和 API Key 加密存储方式。
- 不取消现有 Agent SSE 流式协议，只扩展必要字段和事件承载能力。

## 3. 数据模型设计

### 3.1 新增用户默认运行配置表

新增 `agent_runtime_preference` 表，用于保存员工默认 Agent 运行配置。

建议字段：

- `id`：主键。
- `employee_id`：员工 ID，唯一。
- `selected_model_name`：默认模型名称，空值表示配置文件默认模型。
- `enable_thinking`：是否开启思考模式。
- `enable_tools`：是否启用工具调用。
- `enable_memory`：是否启用上下文记忆。
- `temperature`：生成随机性。
- `top_p`：核采样参数。
- `max_tokens`：最大输出 Token。
- `presence_penalty`：话题出现惩罚。
- `frequency_penalty`：频率惩罚。
- `extra_body`：高级扩展参数 JSON。
- `create_time`、`update_time`：审计时间。

唯一约束：`employee_id` 唯一。该表只保存用户默认偏好，不存储 API Key 或 Base URL。默认值建议为：`enable_thinking=false`、`enable_tools=true`、`enable_memory=true`、`temperature=0.7`、`top_p=0.9`、`max_tokens=2048`、`presence_penalty=0`、`frequency_penalty=0`。

### 3.2 会话级运行配置

会话需要保存从用户默认配置继承而来的可覆盖运行配置。优先方案是在 `agent_session` 增加会话级配置字段：

- 复用现有 `selected_model_name`、`selected_model_source`。
- 新增 `enable_thinking`、`enable_tools`、`enable_memory`。
- 新增 `temperature`、`top_p`、`max_tokens`、`presence_penalty`、`frequency_penalty`。
- 新增 `extra_body`。

这样每个会话可以独立保存自己的模型和参数。用户默认配置变化只影响新会话，不影响已有会话，避免历史会话打开后配置漂移。

### 3.3 运行 Trace 快照

每次 Agent run 的 `input_payload` 中写入本次实际使用的运行配置快照：

- `runtime_config.selected_model_name`
- `runtime_config.model_source`
- `runtime_config.enable_thinking`
- `runtime_config.enable_tools`
- `runtime_config.enable_memory`
- `runtime_config.temperature`
- `runtime_config.top_p`
- `runtime_config.max_tokens`
- `runtime_config.presence_penalty`
- `runtime_config.frequency_penalty`
- `runtime_config.extra_body`

该快照用于 Trace 回放和问题排查，不依赖后续用户默认配置变化。

## 4. 后端设计

### 4.1 分层结构

遵循现有调用链：`endpoint → service → repository → db/redis → schema`。

新增或调整：

- `models/agent_runtime_preference.py`
- `repositories/agent_runtime_preference_repository.py`
- `services/agent_runtime_config_service.py`
- `schemas/agent/request.py` 增加运行配置请求结构。
- `schemas/agent/response.py` 增加运行配置响应结构。
- `api/v1/endpoints/agent.py` 增加用户默认运行配置与会话运行配置接口。
- `repositories/llm_config_repository.py` 增加分页查询与计数方法。
- `services/llm_config_service.py` 增加分页列表方法。

### 4.2 LLM 配置分页接口

现有 `GET /employee/llm-configs` 从返回列表调整为支持分页返回 `PageData`。

请求参数：

- `page`：默认 1。
- `page_size`：默认 20，最大 100。
- `keyword`：按配置名称、模型名、Base URL 搜索。
- `biz_type`：`employee`、`dept` 或空。
- `status`：`0`、`1` 或空。

响应：`ApiResponse[PageData]`，其中 `items` 为 `LlmConfigItem[]`。

为了兼容前端新实现，前端统一按分页响应读取，不再依赖一次性数组返回。

### 4.3 运行配置接口

新增接口：

- `GET /employee/agent/runtime-preference`：获取当前员工默认运行配置；没有记录时返回系统默认值。
- `PUT /employee/agent/runtime-preference`：保存当前员工默认运行配置。
- `GET /employee/agent/sessions/{session_id}/runtime-config`：获取会话运行配置。
- `PUT /employee/agent/sessions/{session_id}/runtime-config`：更新会话运行配置。

会话创建逻辑调整：创建会话时读取用户默认配置，并写入 `agent_session` 的会话级配置字段。

### 4.4 Agent 执行逻辑

Agent 执行时按以下顺序解析运行配置：

1. 读取当前会话级运行配置。
2. 根据 `selected_model_name` 调用现有 `LlmConfigService.get_runtime_config()` 获取模型连接信息。
3. 将会话级生成参数合并到 `LLMRuntimeConfigDTO.extra_body`，其中 `enable_thinking` 显式覆盖同名扩展参数。
4. 如果 `enable_memory=false`，跳过偏好记忆写入、长期记忆读取和 session window prompt 拼接，仅使用用户原始输入作为 prompt。
5. 如果 `enable_tools=false`，传给 LangGraph 的 `tool_context` 标记禁用工具，并让 graph 的 planner/tools 节点跳过工具计划与执行。
6. 将最终运行配置快照写入 `agent_run.input_payload`。

需要保留现有错误兜底：模型调用失败仍构建失败回复，SSE 返回 `error` 事件。

## 5. 前端设计

### 5.1 Agent 工作台布局

页面采用三栏布局：

- 左侧：会话列表，可折叠。展开宽度约 280px，折叠后只保留图标栏。
- 中间：主聊天区，最大化可用高度。顶部仅保留轻量模型/状态栏，不再显示大标题卡片。
- 右侧：功能面板，可折叠。展开宽度约 320px，折叠后保留竖向图标入口。

`AdminLayout` 使用时不传 `title`，避免渲染 `Workspace / Agent 工作台` 标题卡片。

### 5.2 Agent 组件拆分

建议拆分为：

- `AgentChatLayout`：整体三栏布局与左右折叠状态。
- `AgentSessionSidebar`：会话列表、新建、搜索、重命名、删除。
- `AgentMessageList`：消息列表、空状态、错误状态、自动滚动。
- `AgentMessageItem`：用户/Agent 消息展示。
- `AgentMarkdownContent`：复用 `react-markdown` 的正文渲染。
- `AgentComposer`：底部输入区。
- `AgentToolCallTimeline`：工具调用内联动效时间线。
- `AgentTracePanel`：右侧 Trace/工具/记忆/指标分组面板。
- `AgentRuntimeConfigPanel`：会话运行配置编辑。
- `AgentActionCard`：保留现有 Action 确认卡片能力。

拆分目标是降低 `employee/agent.tsx` 文件复杂度，不做过度抽象。

### 5.3 工具调用视觉反馈

工具事件分为：

- `pending`：准备调用。
- `running`：工具执行中。
- `success`：工具成功。
- `failed`：工具失败。

前端现有 SSE `tool_call` 和 `tool_result` 可直接驱动状态。`tool_call` 创建 running 项，`tool_result` 更新对应工具项为 success 或 failed。若无法匹配，则追加结果项。

视觉表现：

- 工具调用卡片以内联时间线显示在当前 Agent 回复附近。
- running 状态使用蓝色呼吸点或流动边框。
- 成功使用绿色状态点，失败使用红色状态点。
- 右侧 Trace 面板保留完整 JSON 详情，聊天区只展示面向用户的简短说明。

### 5.4 Markdown 渲染

新增轻量 `AgentMarkdownContent` 组件，基于 `react-markdown`。样式要求：

- 标题、段落、列表、引用、代码块、表格有清晰间距。
- 代码块背景使用深色或浅灰卡片，不撑破布局。
- 长链接和长代码可换行或横向滚动。
- 用户消息保持纯文本展示，Agent 消息使用 Markdown 渲染。

### 5.5 Agent 配置真实生效

右侧配置面板展示并保存会话运行配置：

- 模型选择：下拉选择 + 配置文件默认模型。
- 思考模式：Switch。
- 工具调用：Switch。
- 上下文记忆：Switch。
- `temperature`、`top_p`、`max_tokens`、`presence_penalty`、`frequency_penalty`：Slider + 数字输入。
- 高级扩展参数：折叠 JSON 编辑。

保存策略：配置变更先更新本地状态，再调用会话运行配置接口保存。保存中、成功、失败都要有轻量反馈。

### 5.6 模型配置管理页面

模型配置管理页面拆成两个清晰区域：

- 模型连接配置：维护 `llm_model_config` 中的 API Base URL、API Key、模型名、兜底模型、状态和权限归属。
- 默认运行参数：维护 `agent_runtime_preference` 中的当前默认模型、思考模式、工具、记忆和生成参数。

`llm_model_config.extra_body` 仅保留协议兼容所需的高级连接扩展，不再作为主要的大模型生成参数配置入口。用户可见的 temperature、top_p、max_tokens、思考模式等运行参数统一保存到新运行配置表，并由新会话继承。

模型连接配置列表区改为后端分页 + 无限滚动：

- 首屏请求第一页。
- 滚动到底部触发下一页。
- 使用节流避免短时间重复触发。
- 搜索、筛选变化时重置到第一页，并清空旧列表。
- 刷新按钮使用节流回调。
- 底部展示加载中、加载失败重试、没有更多数据。

模型连接配置表单区重构为分组：

- 基础信息：配置名称、归属类型、归属主体、状态。
- API 连接：协议、Base URL、API Key、模型名、兜底模型。
- 高级连接参数：协议扩展 JSON，默认折叠。
- 测试连接：显示未测试、测试中、成功、失败。

默认运行参数区使用控件化表单：

- 当前默认模型：下拉选择 + 配置文件默认模型。
- 布尔参数：Switch。
- 数值参数：Slider + 数字输入 + 推荐值标记。
- 高级运行参数：扩展 JSON，默认折叠。

按钮要求垂直居中，图标和文字对齐，hover 不造成布局跳动。

## 6. 数据流

### 6.1 新会话创建

1. 前端创建本地会话。
2. 用户首次发送消息时调用创建会话接口。
3. 后端读取当前员工 `agent_runtime_preference`。
4. 会话继承默认模型和参数。
5. 前端拿到已持久化会话后，继续发送 SSE 消息。

### 6.2 会话配置修改

1. 用户在右侧配置面板修改参数。
2. 前端调用 `PUT /employee/agent/sessions/{session_id}/runtime-config`。
3. 后端校验会话归属后保存会话配置。
4. 下一次消息发送使用新配置。

### 6.3 默认配置修改

1. 用户在模型配置管理或 Agent 设置入口修改默认运行配置。
2. 前端调用 `PUT /employee/agent/runtime-preference`。
3. 后端 upsert 员工默认配置。
4. 后续新会话继承该默认配置；已有会话不被自动覆盖。

## 7. 错误处理

- 分页列表接口失败：前端保留已有列表，底部显示失败重试。
- 运行配置保存失败：回滚本地乐观状态或提示用户重新保存。
- JSON 扩展参数格式错误：前端阻止提交并在字段附近显示错误。
- 模型不可用：后端返回业务错误，前端展示错误提示，不清空用户输入。
- SSE 中断：保留已生成 token，显示错误卡片，并允许用户重试。

## 8. 测试与验证

### 8.1 后端

- `agent_runtime_preference` repository/service 的创建、读取、更新测试。
- LLM 配置分页接口：keyword、biz_type、status、page/page_size 测试。
- 会话创建继承默认配置测试。
- 会话配置覆盖后 Agent 运行使用会话配置测试。
- `enable_memory=false` 时不拼接记忆上下文。
- `enable_tools=false` 时不执行工具节点。

### 8.2 前端

- TypeScript 编译通过。
- Agent 工作台左右面板折叠不造成主聊天区溢出。
- Agent Markdown 内容正确渲染。
- 工具调用 running/success/failed 状态正确展示。
- 模型配置列表滚动触底只触发一次下一页请求。
- 搜索/筛选重置分页并节流请求。
- 参数控件能正确组装请求 payload。

### 8.3 构建验证

- 后端关键文件 `py_compile`。
- 前端 `npx tsc --noEmit --pretty false`。
- 前端 `npm run build`。

## 9. 文件影响范围

预计影响文件：

- `backend/app/models/agent_runtime_preference.py`
- `backend/app/models/agent_session.py`
- `backend/app/repositories/agent_runtime_preference_repository.py`
- `backend/app/repositories/agent_repository.py`
- `backend/app/repositories/llm_config_repository.py`
- `backend/app/services/agent_runtime_config_service.py`
- `backend/app/services/agent_service.py`
- `backend/app/services/llm_config_service.py`
- `backend/app/schemas/agent/request.py`
- `backend/app/schemas/agent/response.py`
- `backend/app/api/v1/endpoints/agent.py`
- `sql/init.sql`
- `frontend/src/types/agent.ts`
- `frontend/src/api/employee/agent.ts`
- `frontend/src/pages/employee/agent.tsx`
- `frontend/src/pages/employee/llm-configs.tsx`
- `frontend/src/components/employee/agent/*`
- `frontend/src/components/employee/llm-configs/*`

## 10. 实施顺序建议

1. 后端新增运行配置数据模型、schema、repository、service 和接口。
2. 后端改造 Agent 会话创建、配置保存、消息执行配置解析。
3. 后端改造 LLM 配置分页列表。
4. 前端补齐类型和 API 方法。
5. 前端拆分 Agent 工作台组件并接入会话运行配置。
6. 前端重构模型配置管理列表与表单控件。
7. 运行后端和前端验证命令。

## 11. 已确认决策

- Agent 工作台采用 B 方案。
- 左侧会话列表可折叠。
- 右侧 Trace/配置面板可折叠。
- Agent 配置必须真实生效。
- 模型参数配置使用“用户默认配置 + 会话覆盖”。
- 模型配置管理使用后端分页，并在前端做滚动加载和节流。
