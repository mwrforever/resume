# Agent 工作台 8 项打磨设计（评估报告 / 思考模式 / 侧栏 / 关联简历 / 已完成步骤 / 字体 / 示例问答）

- 日期：2026-06-16
- 分支：dev
- 状态：待评审
- 关联：与 `2026-06-16-agent-workspace-enhancements-design.md`（会话管理+驳回+task_id 隔离）无重叠，是两批独立改动。

## 一、背景与目标

需求方提出 8 项 Agent 工作台的体验/质量问题。经前后端探查 + 官方文档核对，已定位每项根因，并与需求方逐项确认方案。本设计把这 8 项收敛成一份统一实现计划。

核心约束（来自 AGENTS.md 与既有架构）：
- 调用链路 `endpoint → service → repository → db/redis → schema`，不越层。
- `agent_message.content.blocks` 仅服务前端展示，绝不反向解析为工作流上下文。
- LLM 调用走 `model_router → gateway → provider client`；思考参数注入只在 `gateway`。

## 二、关键决策（已与需求方确认）

| # | 需求 | 决策 | 依据 |
|---|------|------|------|
| 1 | 关联简历展示名字 + 可取消 | **纯前端：`react-file-icon` 按扩展名展示图标 + 发送后清除，无预览、无后端改动** | 需求方明确：不需要预览（故无需落库 `context_refs`）、不改关联作用域；仅要文件图标展示 + 发送后输入框清除。 |
| 2 | 侧栏收起→单图标 + 悬浮列表 + 时间降序 | **方案 A：Popover 白卡片** + 显式按 `last_message_time` 降序排序 | 现状是收起态一排 20 个图标，且 `groupSessions()` 只分组不组内排序。 |
| 3 | 动画字体看不见 | 加纯色 fallback + 修正 Tailwind 任意值动画类 purge 风险 | `wave-text.tsx` 用 `bg-clip-text text-transparent` + `animate-[shimmer_...]`，动画失效时文字全透明。 |
| 4 | 评估报告技能维度写成"维度1/维度2" | Agent 报告链路用真实维度名兜底 + prompt 约束 | `evaluation_graph.py:296` 已携带 `dimension_name`，但最终报告是单独 LLM 调用可能生成占位名；需后端用评估结果的维度名兜底覆盖。 |
| 5 | 已完成步骤展示之前内容（默认折叠）+ 隐藏操作按钮 | **方案 A：每步独立折叠**，复用 `showDetail` 模式 | `interaction-block.tsx:25-52` 终态早返回只剩一行字；后端已确认原始 `data` 在 `agent_message.content.blocks` 保留完整。 |
| 6 | 简历问答最终结果给示例问答 + 标"仅供参考" | **每题下方加参考答案**（`reference_answer` 字段 + `question_generate` prompt） | 需扩 `InterviewQuestionItemDTO` 与 prompt 输出。 |
| 7 | 评估报告过于简陋 → 一起规划内容 | **方案 B：专业评估报告** + 附带 ⑦ 综合评语（零成本，复用已算出的 `advantage_comment`/`disadvantage_comment`） | 后端子图已算出 `skill_hits`/权重/总评但被 `ResumeEvaluationReportDTO` 丢弃。 |
| 8 | 开启思考模式仍无推理输出 | **修复 `gateway.py` 思考参数**（阿里云 DashScope/Qwen） | 官方文档核对：`enable_thinking` 正确但缺 `stream_options`；`thinking_budget_tokens` 命名错误（应为 `thinking_budget`）；DeepSeek 分支 key 错误。 |

## 三、详细设计

### 3.1 [#8 优先级最高] 思考模式参数修复（gateway.py）

**根因（核对阿里云百炼官方文档确认）：**
- 阿里云 DashScope OpenAI 兼容接口开启思考需 `enable_thinking: true`，且流式返回 `reasoning_content`。当前代码 `gateway.py:34-38` 的 `THINKING_PARAM_MAP["qwen"]={"enable_thinking": True}` 参数名正确，但：
  - **缺 `stream_options`**：部分 Qwen 模型在流式时需 `stream_options: {"include_usage": true}` 才会回吐 `reasoning_content` 增量，否则 `additional_kwargs.reasoning_content` 为空 → 触发"当前模型未返回推理过程"兜底。
  - **`thinking_budget_tokens` 命名错误**：应为 `thinking_budget`（Qwen）。
  - **DeepSeek 分支 key 错误**：`{"thinking": {"type": "enabled"}}` DeepSeek 不接受，DeepSeek-R1 默认就出 `reasoning_content`，不该注入任何 key。
- 提供商探测 `llm_config_service.py:360-368` 按 base_url 含 `qwen`/`dashscope` 归为 `"qwen"`，但**阿里云默认 base_url `https://dashscope.aliyuncs.com/compatible-mode/v1` 含 dashscope**，可命中——需确认用户实际配置的 base_url。

**改动：**
1. `gateway.py:34-38` 修正 `THINKING_PARAM_MAP`：
   ```python
   THINKING_PARAM_MAP: dict[str, dict[str, Any]] = {
       "deepseek": {},                                   # DeepSeek-R1 默认出 reasoning，不注入
       "qwen":     {"enable_thinking": True},            # 保留
       "other":    {"enable_thinking": True},            # 默认按 Qwen 兼容
   }
   ```
2. `gateway.py:67-86` `_chat_kwargs`：
   - `enable_thinking` 时同时注入 `stream_options={"include_usage": True}`。经 langchain `ChatOpenAI` 调用时，非 SDK 原生字段（如 Qwen 的 `enable_thinking`、`thinking_budget`、`stream_options`）统一放 `extra_body` 透传给 DashScope 兼容端点。
   - `thinking_budget_tokens` 字段名改为 `thinking_budget`，并只在 provider 为 `qwen`/`other` 时注入（DeepSeek 不支持）。
3. `gateway.py:88-98` `_extract_reasoning` 保留（读 `additional_kwargs.reasoning_content`）——参数修对后会有值。
4. `models/agent_session.py` / DTO 的 `thinking_budget_tokens` 字段名不动（对外语义不变），只在 gateway 注入时改名。

**验证：** 用真实阿里云 qwen-plus/qwen3 模型开启思考模式跑一次评估，确认前端收到 thinking 增量（不再显示"当前模型未返回推理过程"）。

> 注意：本项只让"思考内容能产出"，展示位置改造见 3.7。

### 3.2 [#4] 评估报告维度名修复

**根因：** Agent 评估链路 `evaluation_graph.py:294-301` 的 `_dimension_eval_node` 已正确写入 `dimension.dimension_name`（来自 DB 模板），但**最终报告**是 `resume_evaluation_service.py:183-215` 的 `build_visualization_report` 节点用 `visual_report.yaml` prompt 单独 LLM 调用生成，LLM 可能输出"维度1/维度2"占位名。

**改动（后端兜底，不依赖 LLM 自觉）：**
`resume_evaluation_service.py` `build_visualization_report`，在 `model_validate_json` 成功后，用 `state["evaluation_result"]["dimension_results"]` 里的真实 `dimension_name` 覆盖报告 `skill_dimensions` 的维度名。对齐方式用 `dimension_id` 主键精确匹配（两份数据都带 `dimension_id`，稳定唯一）：
```python
# 模板维度名是权威来源，覆盖 LLM 可能生成的占位名（维度1/维度2）
eval_dims = {d["dimension_id"]: d for d in (state.get("evaluation_result") or {}).get("dimension_results") or []}
for sd in report.get("skill_dimensions") or []:
    # report 的 skill_dimensions 无 dimension_id 时，按"名称是否为占位"+"列表顺序"二次对齐：
    #   1) 若 sd.dimension_name 命中占位正则 r"维度\d+" → 视为需覆盖
    #   2) 占位项按在 skill_dimensions 中的顺序，依次取 eval_dims 中尚未匹配的维度名
    ...
```
（实现时优先 `dimension_id` 匹配；若报告项缺 `dimension_id`，退化为"占位名正则 + 顺序对齐"。）同时在 `visual_report.yaml` 指令第 10 条强化："skill_dimensions 的 dimension_name 必须与评估结果中各维度的 dimension_name 完全一致，禁止使用'维度1/维度2'等占位名"。

### 3.3 [#7] 评估报告内容升级（方案 B + ⑦）

**数据来源已验证可用**（`evaluation_graph.py` 的 `EvaluationResult` / `EvaluationDimensionResult` 已产出但被丢弃）：`skill_hits`、`weight`、`advantage_comment`、`disadvantage_comment`。

**改动：**
1. `schemas/agent/dto.py` `ResumeEvaluationReportDTO`（约 120-130 行）扩展：
   - 顶层加 `profile_summary: CandidateProfileSummaryDTO`（从业年限/最高学历/核心技术栈/稳定性一句话），从 `profile_analyze` 结果复用，不新增 LLM 调用。
   - `skill_dimensions` 每项加：`weight: float`、`matched_skills: list[str]`（命中技能标签）、`comment: str`（优势/风险点评，合并 advantage+disadvantage）。
   - 顶层加 `interview_suggestions: list[{focus, reason}]`（面试重点考察项，由 job_gaps + 低分维度反推，可在 prompt 内生成或服务层拼装）。
   - 顶层加 `comprehensive_comment: {advantages: str, risks: str}`（⑦，复用 `advantage_comment`/`disadvantage_comment`，零 LLM 成本）。
2. `llm/prompts/templates/resume_evaluation/visual_report.yaml`：扩输出 JSON schema 到上述字段，强化"必须使用评估结果中的真实维度名/命中技能"约束。
3. `resume_evaluation_service.py` `build_visualization_report`：
   - 成功路径：把 `evaluation_result` 的 `skill_hits`/`weight`/总评 merge 进 prompt 输入与报告回填。
   - 兜底路径（JSON 解析失败，约 196-214 行）：从 `evaluation_result` 直接拼装完整报告（含 profile_summary / interview_suggestions / comprehensive_comment），避免兜底报告过空。
4. 前端 `types/agent.ts` `EvaluationReport`（约 160-170 行）+ `evaluation-report-card.tsx`：渲染新增段落（画像摘要、维度命中技能标签、面试建议、综合评语）。

### 3.4 [#2] 侧栏收起态：单图标 + Popover + 时间降序

**改动（`agent-sidebar-drawer.tsx`）：**
1. 收起态分支（现 248-269 行的 20 个图标列表）替换为：一个 `Bot`/消息图标按钮；外包 Popover（hover/focus 触发，鼠标移出收起），Popover 内复用展开态的会话列表 markup。
2. **排序**：`groupSessions()`（38-62 行）与 `refreshSessions`（store/agent.ts:91-109）补显式按 `last_message_time` 降序——组间已是今天>昨天>更早，补组内排序。建议在 `refreshSessions` 拿到 `items` 后整体 `[...items].sort((a,b)=> (b.last_message_time||'').localeCompare(a.last_message_time||''))`，一处生效全局（展开态/收起态/搜索都受益）。
3. Popover 用现有依赖里的 Popover（Radix 若有）或轻量 `group-hover` 面板；保持蓝色体系样式（`#E0F2FE`/`#0369A1`）。

### 3.5 [#5] 已完成步骤展示原文（每步独立折叠）

**改动（`blocks/interaction-block.tsx`）：**
1. 删除/重写终态早返回（现 29-52 行 `submitted`/`rejected`/`expired` 三分支）：不再只返回一行状态字，而是渲染「状态徽标 + 标题 + 一句摘要 + 展开回看 ▾」的可折叠头。
2. 展开后用只读方式渲染原始 `data`：
   - `DimensionSelection`：列出候选维度 + 高亮当时 `values` 选中的项（只读，不可改）。
   - `PlanApproval`：渲染计划表（步骤列表），只读。
   - `JobSelection`：列出候选岗位 + 高亮当时选中项，只读。
3. **操作按钮硬约束**：确认/驳回等按钮（现 194-215 / 347-368 / 416-437 行）只在 `status === 'pending'` 渲染；终态一律不渲染。建议给三个子组件加 `readOnly`/`resolved` prop，按钮行据此隐藏，避免重复表单代码。
4. 复用现有 `useState(false)` + 折叠按钮模式（参照 `evaluation-report-card.tsx:79,102-109`）。
5. 无需改后端（原始 `data` 已在 `agent_message.content.blocks` 保留）。

### 3.6 [#1] 关联简历展示（文件图标 + 发送后清除，纯前端）

**需求方最终决策（已确认）：**
1. 文件图标用 `react-file-icon` 按文件名扩展名匹配展示（替代现状 chip 里的纯文字 + `Check` 图标）。
2. **不需要预览**——点击图标无动作。因此 **`context_refs` 无需落库**，无需回看历史消息的关联。
3. **关联作用域不改**：不把 Redis 会话引用改成 task_id 作用域（预览/落库取消后，作用域问题随之消失）。
4. **发送完成后，消息输入框的文件名展示自动消除**（修复 `submit()` 未重置 `upload` 的脏携带 bug）。

> 说明：本项原计划含"预览 + context_refs 落库 + task_id 作用域"三块后端改动，需求方评估后认为预览价值有限、且已有 `ResumePreviewDialog` 在简历库等页面可用，Agent 工作台仅需图标即可，故全部砍掉，回归纯前端。

**改动（`agent-composer.tsx` + 新增依赖）：**
1. 新增依赖 `react-file-icon`（当前 `package.json` 未安装），封装一个 `ResumeFileIcon`：按 `upload.fileName` 的扩展名（pdf/doc/docx）匹配 `react-file-icon` 的 `FileIcon` + `defaultColors`/`defaultStyles` 渲染对应文件类型图标。
2. `UploadChip`（约 238-282 行）的 success 分支：用 `<ResumeFileIcon fileName={...} />` 替换现有 `Check` 图标；文件名文本保留，X 按钮语义不变（取消本次关联）。
3. `submit()`（约 73-81 行）发送成功后 `setUpload({ kind: 'idle' })`，使输入框的文件名/图标在发送后自动清除——这是本项核心修复，同时杜绝脏携带。
4. **不改后端、不加接口、不动模型、不落库 context_refs。**

### 3.7 [#8 续 + #展示] 思考内容嵌入对应节点组件（不单独卡片）

**改动（前端 block 渲染层）：**
现状 `thinking` 是独立 block（`block-renderer.tsx:26-27` case + `thinking-block.tsx`），与 text/interaction 块并列。需求要求"思考内容不要单独卡片，而是在对应节点组件内默认收起、可展开"。

采用 **前端分组方案**（不动流式协议，改动局部）：
1. `agent-message-card.tsx:40-52` 与 `agent-message-list.tsx:78-89` 渲染 block 列表前，先把连续的 `thinking` 块"吸附"到其后紧跟的业务块（text/interaction/report）上，作为该块的 `reasoning` prop 传入；孤立 thinking（无后续业务块）吸附到前一个块。
2. 抽取 `thinking-block.tsx` 的折叠头（chevron + Sparkles + 收起/展开）为共享子组件 `<ReasoningSection reasoning={...} />`，默认收起，内嵌进 `TextBlock` / `InteractionBlock` / `EvaluationReportCard` / `InterviewQuestionsCard`。
3. `block-renderer.tsx` 移除 `case 'thinking'`（不再顶层渲染独立卡片）。
4. 后端 fallback 文案"（当前模型未返回推理过程）"保留：当 `reasoning` 为空字符串时，`ReasoningSection` 折叠头提示"模型未返回推理过程"，展开为空——与 3.1 修复后正常情况区分（修复成功则展示真实推理）。
5. `utils/agent-run-reducer.ts:115-119` 的 thinking 累积逻辑不变。

> 为什么不选"改流式协议、把 reasoning 挂到业务块"的后端方案：它要动 block schema + 流式 delta 协议 + 历史消息兼容，风险高；前端分组方案只动渲染层，历史消息也兼容（thinking 块已持久化在 blocks 里）。

### 3.8 [#3] 动画字体可见性

**改动（`wave-text.tsx`）：**
1. 给 `<span>` 加纯色 fallback `color: #0369A1`（`text-[#0369A1]`），保证 `bg-clip-text text-transparent` 失效时仍可见。
2. 核对 `frontend/tailwind.config.*` 的 `content` glob 是否覆盖 `components/employee/agent/**`（任意值动画类 `animate-[shimmer_...]`/`animate-[wave_...]` 被 purge 是最可能根因）。若未覆盖则补路径。
3. （可选，更稳）把 `bg-clip-text text-transparent` 渐变挪到每个字符 span 上，不依赖父级裁剪穿透嵌套 inline-block。
4. 顺带核对 `agent-message-list.tsx:135,138,140` 的 `QuestionSkeleton` shimmer 同类问题。

### 3.9 [#6] 简历问答每题加参考答案（仅供参考）

**改动：**
1. `schemas/agent/dto.py` `InterviewQuestionItemDTO`（约 100-109 行）加 `reference_answer: str`。
2. `llm/prompts/templates/interview_questions/question_generate.yaml`：输出 JSON 每题加 `reference_answer` 字段，prompt 约束"给出一个示例性参考答案"。
3. `interview_question_service.py` `_parse_questions`（约 344-357 行）已透传 dict key，DTO 放开字段后自动流入。
4. 前端 `types/agent.ts` `QuestionItem`（约 140-157 行）加 `reference_answer: string`；`interview-questions-card.tsx` 每题展开区（现 79-120 行 `expandedQ`）下方加"参考答案（仅供参考）"折叠块。

## 四、错误处理与边界

- **#8 参数修复后仍无推理**：保留 `model_router.py` 的 thinking 自愈（provider 报错则关 thinking 重试）；fallback 文案保留。若用户 base_url 不含 qwen/dashscope 会被归为 `other`（也走 enable_thinking），需确认实际配置。
- **#4 维度名对齐失败**：若评估结果 `dimension_results` 为空（极端兜底），保留 LLM 原始维度名，不强覆盖。
- **#7 prompt JSON 解析失败**：兜底路径已覆盖（3.3.3），保证不白屏。
- **#5 终态 data 缺失**：理论上后端已保留完整 data；若历史旧消息 data 为空，折叠展开显示"（无历史内容）"占位，不报错。
- **#1 发送后重置**：仅在发送成功（`onSend` 调用后）重置，不影响发送失败重试。
- **#3 动画**：fallback 纯色保证可读优先于动画美观。

## 五、验收标准

1. **#8** 阿里云 qwen 模型开启思考模式，评估/问答流程前端能看到真实推理内容（非"未返回推理过程"）。
2. **#8 展示** 思考内容嵌入到对应节点卡片内（默认收起，点击展开），无独立思考卡片。
3. **#4** 评估报告 `skill_dimensions` 维度名为真实维度名（技术深度/沟通能力等），无"维度1/维度2"。
4. **#7** 评估报告含：画像摘要、维度命中技能标签+权重+点评、面试建议、综合评语；兜底路径不白屏。
5. **#2** 侧栏收起态显示单图标，悬浮弹出白卡片会话列表，按 `last_message_time` 降序（组内也是新的在上）。
6. **#5** 已提交/已驳回/已过期步骤显示状态徽标 + 可展开回看原文（维度候选/计划/岗位），终态无操作按钮。
7. **#1** composer 内简历附件用 `react-file-icon` 按扩展名（pdf/doc/docx）展示对应文件图标（非纯文字/通用图标）；X 按钮可取消本次关联；**发送消息后输入框的文件名/图标自动清除**，不会脏携带到下一条消息。无预览、无后端改动。
8. **#3** 会话中 WaveText 动画文字始终可见（动画失效也有蓝色 fallback）。
9. **#6** 面试问答结果每题展开后有"参考答案（仅供参考）"块。

## 六、不在本次范围

- 会话级持久 resume badge + 解绑接口（#1 的更强形态，另立项）。
- 历史消息回看关联简历（需持久化 context_refs，改动大）。
- 持久化 checkpointer（与 enhancements 设计一致，另立项）。
- 评估报告方案 C 的离职动机/薪资匹配（数据源不稳定，暂不做）。

## 七、实现顺序建议（供 writing-plans 拆解）

1. #8 gateway 参数修复（解锁 #8 展示，且独立可测）。
2. #3 字体 fallback（小、独立）。
3. #1 composer 重置（小、独立）。
4. #2 侧栏 Popover + 排序（前端独立）。
5. #5 已完成步骤折叠（前端，依赖 #8 展示的 ReasoningSection 子组件可并行抽）。
6. #8 展示 思考嵌入（前端，抽 ReasoningSection + 分组渲染）。
7. #4 维度名兜底（后端，独立）。
8. #6 参考答案（后端 prompt + DTO + 前端，端到端）。
9. #7 报告升级（后端 DTO/prompt/服务 + 前端卡片，最大，最后）。
