# Agent 工作台与模型运行配置重构设计

## 1. 背景与目标

本次重构覆盖两个区域：员工端 Agent 工作台与模型配置管理。目标是把当前“可用但信息分散”的 Agent/LLM 体验升级为企业级 HR SaaS 的专业 Agent 控制台：主对话区域优先、运行过程可观测、模型参数可配置且真实生效，并支持模型配置列表后端分页与前端滚动加载。

已确认的产品方向：采用 B 方案，即“ChatGPT 主对话 + 可折叠 Trace/配置面板”。左侧会话列表也需要支持折叠收起。模型运行参数采用“模型默认参数 + 用户个人模型参数”的持久化模型：模型创建时保存默认参数，用户选择某个模型时异步初始化并保存一份个人对该模型的参数配置，后续工作台默认继续使用用户上次选择的模型。

## 2. 范围

### 2.1 包含

- 删除 Agent 工作台页面内 `Workspace / Agent 工作台` 大标题区域，让聊天区域获得更多高度。
- Agent 工作台左侧会话列表支持展开/折叠。
- Agent 工作台右侧功能面板支持展开/折叠，并按配置、工具、记忆、Trace、指标分组。
- Agent 回复内容使用项目已集成的 `react-markdown` 渲染。
- Agent 流式生成过程展示动态状态，并把工具调用以内联时间线方式展示在当前回复附近。
- 新增模型运行参数持久化能力：模型默认参数 + 用户个人模型参数。
- Agent 发送消息时使用当前员工对选中模型的个人运行配置，配置真实影响本次模型调用、工具调用、前缀缓存和记忆上下文行为。
- 模型配置管理列表改为后端分页接口 + 前端无限滚动加载，并对触底、搜索、筛选、刷新做节流和防重复请求。
- 模型参数配置控件化：布尔值用 Switch，数值用 Slider + 手动输入，枚举/多选用下拉选择 + 自定义输入。

### 2.2 不包含

- 不更换前端技术栈，不引入新的重量级 UI 框架。
- 不重构无关员工、用户、简历、岗位、评估页面。
- 不改变现有模型连接配置的权限规则、软删除规则和 API Key 加密存储方式。
- 不取消现有 Agent SSE 流式协议，只扩展必要字段和事件承载能力。

## 3. 数据模型设计

### 3.1 模型默认运行参数

模型创建时需要保存一份模型默认运行参数。该默认参数属于 `llm_model_config` 对应的模型连接配置，用于给首次使用该模型的员工初始化个人模型参数。

建议字段：

- `enable_thinking`：是否开启思考模式。
- `enable_tools`：是否启用工具调用。
- `enable_prompt_cache`：是否启用 LLM 前缀缓存。
- `enable_memory`：是否启用上下文记忆。
- `temperature`：生成随机性。
- `top_p`：核采样参数。
- `max_tokens`：最大输出 Token。
- `presence_penalty`：话题出现惩罚。
- `frequency_penalty`：频率惩罚。
- `extra_body`：高级扩展参数 JSON。
- `create_time`、`update_time`：审计时间。

这些字段可以直接扩展到 `llm_model_config`，也可以单独新增 `llm_model_default_runtime_config` 表并通过 `llm_config_id` 关联。推荐直接扩展 `llm_model_config`，因为默认参数随模型连接配置一起创建、编辑、软删除，权限边界一致。默认值建议为：`enable_thinking=false`、`enable_tools=true`、`enable_prompt_cache=false`、`enable_memory=true`、`temperature=0.7`、`top_p=0.9`、`max_tokens=2048`、`presence_penalty=0`、`frequency_penalty=0`。

### 3.2 用户个人模型运行配置

新增 `agent_user_model_runtime_config` 表，用于保存“某个员工对某个已创建模型配置”的个人运行配置。该配置属于用户个人与模型配置组合，不属于会话。用户在工作台选择某个已创建模型配置时，如果该员工尚无该模型个人配置，则后端异步或快速 upsert 一份记录，默认值从该模型创建时的默认运行参数复制而来。

建议字段：

- `id`：主键。
- `employee_id`：员工 ID。
- `llm_config_id`：模型连接配置 ID，不能为空。
- `model_name`：模型名称，冗余快照字段，来源于 `llm_model_config.model_name`。
- `model_source`：模型来源，如 `employee`、`dept`；不保存 `env`。
- `enable_thinking`：是否开启思考模式。
- `enable_tools`：是否启用工具调用。
- `enable_prompt_cache`：是否启用 LLM 前缀缓存。
- `enable_memory`：是否启用上下文记忆。
- `temperature`、`top_p`、`max_tokens`、`presence_penalty`、`frequency_penalty`：生成参数。
- `extra_body`：高级运行参数 JSON。
- `last_used_at`：该用户最近使用此模型的时间。
- `create_time`、`update_time`：审计时间。

唯一约束：`employee_id + llm_config_id`。用户再次进入工作台时，优先读取工作台偏好中的最近选中模型；如果最近选中的是已创建模型配置，则读取或初始化对应个人模型配置；如果最近选中的是配置文件默认模型，则返回系统默认运行参数，但不向 `agent_user_model_runtime_config` 写入空外键记录。

### 3.3 工作台模型选择偏好

新增 `agent_workspace_preference` 表，用于保存员工进入 Agent 工作台时默认选中的模型。该表只保存选择状态，不保存生成参数。

建议字段：

- `id`：主键。
- `employee_id`：员工 ID，唯一。
- `selected_model_name`：选中模型名称；配置文件默认模型可为空。
- `selected_model_source`：模型来源，如 `env`、`employee`、`dept`。
- `selected_llm_config_id`：模型连接配置 ID；配置文件默认模型为空。
- `last_selected_at`：最近选择时间。
- `create_time`、`update_time`：审计时间。

该表解决“配置文件默认模型没有 `llm_config_id`，但仍需要记住用户上次选择”的问题，避免让个人模型参数表出现空外键。

### 3.4 会话模型选择快照

会话不再保存完整运行参数。会话只保留当前或历史选中的模型信息，用于打开会话时恢复上下文和展示：

- 复用现有 `selected_model_name`、`selected_model_source`。
- 如需更强 Trace 展示，可新增 `selected_user_model_config_id`，指向用户个人模型配置。

会话运行时读取“当前员工 + 会话选中模型”的个人模型参数。个人模型参数变化会影响下一次运行；每次运行仍会把实际参数写入 `agent_run.input_payload`，保证历史 Trace 可复现。

### 3.5 运行 Trace 快照

每次 Agent run 的 `input_payload` 中写入本次实际使用的运行配置快照：

- `runtime_config.selected_model_name`
- `runtime_config.model_source`
- `runtime_config.enable_thinking`
- `runtime_config.enable_tools`
- `runtime_config.enable_prompt_cache`
- `runtime_config.enable_memory`
- `runtime_config.temperature`
- `runtime_config.top_p`
- `runtime_config.max_tokens`
- `runtime_config.presence_penalty`
- `runtime_config.frequency_penalty`
- `runtime_config.extra_body`

该快照用于 Trace 回放和问题排查，不依赖后续模型默认参数或用户个人模型参数变化。

## 4. 后端设计

### 4.1 分层结构

遵循现有调用链：`endpoint → service → repository → db/redis → schema`。

新增或调整：

- `models/agent_user_model_runtime_config.py`
- `models/agent_workspace_preference.py`
- `repositories/agent_user_model_runtime_config_repository.py`
- `repositories/agent_workspace_preference_repository.py`
- `services/agent_runtime_config_service.py`
- `schemas/agent/request.py` 增加运行配置请求结构。
- `schemas/agent/response.py` 增加运行配置响应结构。
- `api/v1/endpoints/agent.py` 增加用户个人模型运行配置、最近使用模型与会话模型选择接口。
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

- `GET /employee/agent/model-runtime-configs/recent`：获取当前员工工作台最近选择的模型配置；没有偏好记录时返回配置文件默认模型与系统默认参数。
- `GET /employee/agent/model-runtime-configs/{model_name}`：获取当前员工对指定已创建模型配置的个人运行配置；没有记录时从模型默认参数初始化后返回。若为配置文件默认模型，则返回系统默认运行参数，不创建个人配置。
- `PUT /employee/agent/model-runtime-configs/{model_name}`：保存当前员工对指定已创建模型配置的个人运行配置。配置文件默认模型不支持保存个人参数。
- `PUT /employee/agent/model-runtime-configs/{model_name}/select`：选择模型并刷新工作台模型选择偏好；若为已创建模型配置，同时确保个人配置存在并刷新 `last_used_at`。
- `PUT /employee/agent/sessions/{session_id}/model`：更新会话选中模型，同时更新工作台模型选择偏好；若为已创建模型配置，同时确保用户个人模型配置存在并刷新 `last_used_at`。

模型名称在路径中需要 URL 编码。若模型名称为空表示配置文件默认模型，前端使用约定值 `__env_default__` 与后端交互，后端内部再转换为空模型名。

### 4.4 Agent 执行逻辑

Agent 执行时按以下顺序解析运行配置：

1. 读取会话选中的 `selected_model_name`；如果会话没有选中模型，则读取当前员工工作台模型选择偏好。
2. 根据模型名调用现有 `LlmConfigService.get_runtime_config()` 获取模型连接信息。
3. 如果选中的是已创建模型配置，读取或初始化当前员工对该模型配置的个人运行配置，初始化来源为模型创建时保存的默认运行参数；如果选中的是配置文件默认模型，则使用系统默认运行参数。
4. 将个人生成参数合并到 `LLMRuntimeConfigDTO.extra_body`，其中 `enable_thinking` 显式覆盖同名扩展参数。
5. 如果 `enable_memory=false`，跳过偏好记忆写入、长期记忆读取和 session window prompt 拼接，仅使用用户原始输入作为 prompt。
6. 如果 `enable_prompt_cache=false`，不读取也不写入 LLM 前缀缓存；如果为 true，才启用 prompt prefix cache 的 key 构建、读取、命中记录和写入。
7. 如果 `enable_tools=false`，传给 LangGraph 的 `tool_context` 标记禁用工具，并让 graph 的 planner/tools 节点跳过工具计划与执行。
8. 刷新工作台模型选择偏好；若使用已创建模型配置，同时刷新该个人模型配置的 `last_used_at`。
9. 将最终运行配置快照写入 `agent_run.input_payload`。

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
- `AgentRuntimeConfigPanel`：当前用户对选中模型的个人运行配置编辑。
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

右侧配置面板展示当前选中模型的运行配置；已创建模型配置可保存为当前员工的个人运行配置，配置文件默认模型只展示系统默认参数，不写入个人模型参数表：

- 模型选择：下拉选择 + 配置文件默认模型。
- 思考模式：Switch。
- 工具调用：Switch。
- 前缀缓存：Switch。
- 上下文记忆：Switch。
- `temperature`、`top_p`、`max_tokens`、`presence_penalty`、`frequency_penalty`：Slider + 数字输入。
- 高级扩展参数：折叠 JSON 编辑。

保存策略：切换模型时先更新会话选中模型和工作台选择偏好；如果选择已创建模型配置，则异步确保个人模型配置存在并刷新 `last_used_at`。参数变更保存到当前员工对该模型配置的个人配置；配置文件默认模型不支持保存个人参数。保存中、成功、失败都要有轻量反馈。

### 5.6 模型配置管理页面

模型配置管理页面拆成两个清晰区域：

- 模型连接配置：维护 `llm_model_config` 中的 API Base URL、API Key、模型名、兜底模型、状态和权限归属。
- 模型默认运行参数：维护模型创建时的默认思考模式、工具、前缀缓存、记忆和生成参数。

`llm_model_config.extra_body` 仅保留协议兼容所需的高级连接扩展，不再作为主要的大模型生成参数配置入口。用户可见的 temperature、top_p、max_tokens、思考模式、前缀缓存等运行参数在模型创建时保存为模型默认参数；员工首次选择该模型时复制为个人模型参数。

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

模型默认运行参数区使用控件化表单：

- 布尔参数：Switch。
- 数值参数：Slider + 数字输入 + 推荐值标记。
- 高级运行参数：扩展 JSON，默认折叠。

按钮要求垂直居中，图标和文字对齐，hover 不造成布局跳动。

## 6. 数据流

### 6.1 新会话创建

1. 前端创建本地会话。
2. 后端读取当前员工工作台模型选择偏好。
3. 如果没有偏好记录，则使用配置文件默认模型和系统默认参数，不创建个人模型配置。
4. 会话记录选中的模型名称和模型来源，不复制完整运行参数。
5. 前端拿到已持久化会话后，继续发送 SSE 消息。

### 6.2 模型选择与个人参数初始化

1. 用户在工作台选择模型。
2. 前端调用 `PUT /employee/agent/sessions/{session_id}/model` 更新会话选中模型。
3. 后端校验会话归属和模型可见性。
4. 后端更新 `agent_workspace_preference`；如果选中的是已创建模型配置，则确保 `agent_user_model_runtime_config` 中存在该员工对该模型配置的个人配置，不存在时从模型默认参数复制。
5. 后端刷新偏好的 `last_selected_at`；如果存在个人模型配置，同时刷新其 `last_used_at`，下次进入工作台继续默认选择该模型。

### 6.3 个人模型参数修改

1. 用户在右侧配置面板修改当前模型的运行参数。
2. 前端调用 `PUT /employee/agent/model-runtime-configs/{model_name}`。
3. 如果当前模型是已创建模型配置，后端保存当前员工对该模型配置的个人参数配置；如果是配置文件默认模型，后端拒绝保存并提示该模型不支持个人参数持久化。
4. 下一次使用该模型发送消息时使用新的个人配置。

### 6.4 模型默认参数修改

1. 管理者或有权限员工在模型配置管理页面修改模型默认运行参数。
2. 后端更新模型默认参数。
3. 该修改只影响之后首次选择该模型、尚未生成个人模型配置的员工。
4. 已存在的用户个人模型配置不被覆盖，避免用户偏好被管理员修改意外重置。

## 7. 错误处理

- 分页列表接口失败：前端保留已有列表，底部显示失败重试。
- 运行配置保存失败：回滚本地乐观状态或提示用户重新保存。
- JSON 扩展参数格式错误：前端阻止提交并在字段附近显示错误。
- 模型不可用：后端返回业务错误，前端展示错误提示，不清空用户输入。
- SSE 中断：保留已生成 token，显示错误卡片，并允许用户重试。

## 8. 测试与验证

### 8.1 后端

- `agent_user_model_runtime_config` repository/service 的初始化、读取、更新测试，并验证 `llm_config_id` 不能为空。
- `agent_workspace_preference` repository/service 的最近选择模型测试。
- LLM 配置分页接口：keyword、biz_type、status、page/page_size 测试。
- 模型创建时默认运行参数保存测试。
- 用户首次选择模型时从模型默认参数复制个人模型配置测试。
- 再次进入工作台恢复上次使用模型测试。
- Agent 运行使用当前员工对选中模型的个人参数测试。
- `enable_memory=false` 时不拼接记忆上下文。
- `enable_prompt_cache=false` 时不读写前缀缓存。
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

- `backend/app/models/agent_user_model_runtime_config.py`
- `backend/app/models/agent_workspace_preference.py`
- `backend/app/models/agent_session.py`
- `backend/app/models/llm_model_config.py`
- `backend/app/repositories/agent_user_model_runtime_config_repository.py`
- `backend/app/repositories/agent_workspace_preference_repository.py`
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
5. 前端拆分 Agent 工作台组件并接入用户个人模型运行配置。
6. 前端重构模型配置管理列表与表单控件。
7. 运行后端和前端验证命令。

## 11. 已确认决策

- Agent 工作台采用 B 方案。
- 左侧会话列表可折叠。
- 右侧 Trace/配置面板可折叠。
- Agent 配置必须真实生效。
- LLM 前缀缓存必须有显式配置开关，关闭时不读写缓存。
- 模型参数配置使用“模型默认参数 + 用户个人模型参数”，不属于会话。
- 用户选择模型时异步或快速保存个人模型配置，并刷新最近使用时间；下次进入工作台继续使用上次模型。
- 模型配置管理使用后端分页，并在前端做滚动加载和节流。
