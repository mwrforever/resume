# Agent 工作台 4 处 bug 修复 · 设计 Spec

**日期**：2026-06-19
**作者**：HR Agent 工作台
**状态**：待用户审核

---

## 一、目标

修复 Agent 工作台 4 个 bug，**含后端协议级重构**：

1. **bug 1（步骤进度跳回）**：驳回循环时，前端 StepStrip 显示的"当前活跃步骤"会跳回到模板里靠前的某个节点（甚至"读取简历"），与后端实际正在跑的节点不一致。**根因是 step.update 协议设计本身的语义缺陷 + 前端 mergeStepsWithTemplate 用模板拓扑顺序丢失了 runtime 顺序**。本 spec 顺手把协议升级到"running/success 两态"。
2. **bug 2（驳回语义偏差）**：用户驳回反馈（如"还需要新增一个分析团队沟通协作能力的维度"）没传到 LLM prompt，LLM 自由发挥产出无关维度。三个 reject/regenerate 路径全部修复（dimension / plan_approval / job_selection）。
3. **bug 3（侧栏会话计数）**：移除「会话 27」chip，替换为"运行中数量徽标"，仅在有运行中任务时显示。
4. **bug 4（侧栏收起动画）**：把 300ms 动画升级为 500ms 分段层次感动画（旧 fade-out → 宽度切换 → 新 fade-in，纯 CSS）。

**不在范围**（YAGNI）：
- 不改 LangGraph workflow 拓扑结构
- 不引入 framer-motion（本次纯 CSS 即可达到 taste-skill-v1 §4 motion 标准）
- 不重构 prompt 模板的整体结构（仅在三个驳回模板里加 feedback / previous_* 占位符）

---

## 二、整体架构

```
backend/
├── app/llm/streaming/emitter.py            ← bug 1：emit_step 新增 status 参数（"running"|"success"|"failed"），保留向后兼容
├── app/llm/graphs/workflows/runner.py      ← bug 1：emit step.update 时，节点开始 emit running、节点结束 emit success
├── app/llm/graphs/workflows/interview_questions.py   ← bug 2：_request_dimension_selection / _request_plan_approval 把 feedback 写入 state
├── app/llm/graphs/workflows/resume_evaluation.py     ← bug 2：_request_job_selection 同样
├── app/llm/graphs/workflows/state.py       ← bug 2：state schema 已有 dimension_feedback 等字段（无需改）
├── app/llm/prompts/templates/interview_questions/dimension_suggest.yaml   ← bug 2：加 feedback + previous_dimensions 占位符
├── app/llm/prompts/templates/interview_questions/question_plan.yaml       ← bug 2：复用现有 review_feedback，新增 previous_plan
├── app/services/interview_question_service.py   ← bug 2：suggest_dimensions / build_question_plan 节点拼 prompt 时传入 feedback / previous_*
└── app/services/resume_evaluation_service.py    ← bug 2：load_job_candidates 节点处理 job_feedback 的策略（见 §五）

frontend/
├── src/utils/agent-run-reducer.ts          ← bug 1：upsertStep 处理新的 running 状态语义
├── src/types/agent.ts                      ← bug 1：AgentEnvelope 的 step.update.data.status 已含 'running'，无需改
├── src/components/employee/agent/workflow-step-templates.ts  ← bug 1：mergeStepsWithTemplate 改为按 runtime 顺序输出，模板仅做"未到达项 pending 占位 + title 标准化"
├── src/components/employee/agent/step-strip.tsx       ← bug 1：activeStep 改用 status==='running' 项；分子分母不变
├── src/components/employee/agent/__tests__/workflow-step-templates.test.ts  ← bug 1：单测同步新语义
├── src/components/employee/agent/layout/agent-sidebar-drawer.tsx   ← bug 3 + bug 4：替换 chip + 升级动画
└── src/index.css                           ← bug 4（如果需要新加 keyframes/动画类）
```

---

## 三、Bug 1：step.update 协议升级 + 步骤进度跳回修复

### 3.1 当前协议的语义缺陷

后端 `runner.py:_translate_updates`（第 67-74 行）：
```python
events.append(ctx.emitter.emit_step(
    step_id=str(node_name),
    title=title,
    status="success",  # ← 永远 success，永远不发 running
    detail=running_detail,
))
```

LangGraph `stream_mode="updates"` 的特性：节点**完成产出后**才触发 update（`step_labels.py:7-10` 注释明确）。这导致：

- 后端从来不发 `status='running'`，活跃步骤的状态信息**只能靠"steps 数组的最后一项 success"反推**
- 当 graph 走条件边回到上游节点（驳回循环）时，runtime steps 数组累积形如 `[load_resume, suggest_dimensions, request_dimension_selection, suggest_dimensions(重做)]`
- 前端 `mergeStepsWithTemplate` 把它**按模板拓扑顺序**重排，丢失了"最后到达 = 当前活跃"的语义
- `StepStrip.activeStep = mergedSteps.find(s => s.status !== 'success')` 在所有命中节点都 success 后，找的是**模板里第一个未到达的 pending 项**——驳回循环时永远命中 `build_question_plan`（看起来像"跳前了"）；如果 `run.start(resume=true)` 没正确清流但 reducer 走了 else 分支清空 steps 的话，则会跳回 `load_resume`

无论哪种情况，**问题根因是协议本身没表达"当前正在哪步"**，前端只能猜。

### 3.2 协议升级方案

**后端 emit_step 改为发两次**：

```python
# 节点开始（在 LangGraph node 函数体进入处由节点自行 emit）
ctx.emitter.emit_step(step_id=node_name, title=title, status="running", detail=running_detail)

# 节点结束（runner._translate_updates 在 update payload 到达时 emit）
ctx.emitter.emit_step(step_id=node_name, title=title, status="success", detail=success_detail)
```

但要让节点函数主动 emit "running" 需要修改每个节点的实现——改动面太大。**更简单的方案**：

**runner._translate_updates 在发 success 之前，主动通过 stream_writer 发一条 running**——但这违反"节点完成后才触发"的 LangGraph 时序，running 会和 success 同时到。

**最终选定方案**：**只在 runner 层做 emit 顺序调整 + 保留后端整体逻辑**：

不改 emit 时机，但**重写前端 reducer 与 mergeStepsWithTemplate 的语义**——把"runtime steps 数组里最后到达的 success step"识别为"刚完成、即下一步活跃"的语义信号；模板的角色降级为"未到达节点的 pending 占位"。

具体规则：

```
mergeStepsWithTemplate(workflow, runtimeSteps) 新语义：
  let merged = []
  let seenStepIds = new Set()

  // 第一遍：按 runtime 顺序输出已到达的 step（保留模板 title）
  for step of runtimeSteps:
    if seenStepIds.has(step.step_id):
      // 重入：把 merged 中已存在的同 id 项移到末尾，并更新状态
      移除旧项,  push 新项到 merged 末尾
    else:
      seenStepIds.add(step.step_id)
      push { step_id, title=模板title || step.title, status, detail }

  // 第二遍：把模板中未到达的 step 按拓扑顺序追加到末尾，状态 pending
  for tmpl of WORKFLOW_STEP_TEMPLATES[workflow]:
    if !seenStepIds.has(tmpl.step_id):
      push { step_id, title, status: 'pending' }

  return merged
```

**StepStrip activeStep 判定** 从"找第一个非 success"改为：

```ts
// 找最后一个 success（即"刚完成的"），其后的下一个 step 是当前活跃
// 如果最后到达的就是数组最后一个 step，则它本身就是 activeStep（即将被下一个 step.update 替换）
const lastSuccessIdx = mergedSteps.findLastIndex(s => s.status === 'success');
const activeStep = mergedSteps[lastSuccessIdx + 1] ?? mergedSteps[lastSuccessIdx] ?? mergedSteps[0];
```

但这也不完美（"刚 success 的下一步"未必正在跑——可能 graph 在等 interrupt）。**最准确的方案**：直接显示"runtime 中最后到达的那个 step 的 title"，因为它的 detail 就是 `running_detail`（"正在结合岗位需求分析考察维度…"）。

```ts
// 最后到达的 step（runtime 顺序，不是模板顺序）就是当前正在做的事
// 因为后端总是在节点完成后才 emit，所以"最后一个到达的 success" = "刚完成、正在转交下一节点 / 等用户输入"
const lastArrivedStep = runtimeSteps[runtimeSteps.length - 1];

// 但分子分母仍然用 mergedSteps（去重后的总进度，不计重入）
const successCount = uniqueByStepId(runtimeSteps).filter(s => s.status === 'success').length;
const totalCount = WORKFLOW_STEP_TEMPLATES[workflow]?.length ?? mergedSteps.length;
```

显示文案：
```
运行中 · {successCount} / {totalCount} 步 · {lastArrivedStep?.title ?? '准备中…'}
```

驳回循环场景验证（用户驳回 `request_dimension_selection`）：
- 第一轮 runtime steps：`[load_resume, suggest_dimensions, request_dimension_selection]` 全 success
- 驳回 → 第二轮 step.update 第一条到达：`request_dimension_selection`（因为 graph 从该节点的 interrupt 行处恢复，先把节点剩余代码跑完产出 update）
- runtime 数组 push 第 4 项 `request_dimension_selection`（重入）
- `lastArrivedStep.title = '选择维度'` → 文案："运行中 · 3/8 步 · 选择维度" ✅
- 接着 `suggest_dimensions` 重做完成 → push 第 5 项
- `lastArrivedStep.title = '分析维度'` → 文案："运行中 · 3/8 步 · 分析维度" ✅
- successCount 用 uniqueByStepId 去重，仍然是 3（不增加分母也不重置分子）

### 3.3 前端 reducer 不变

`agent-run-reducer.ts` 的 `upsertStep` 现在按 step_id 替换或追加——本次保留行为，但**驳回时 step.update 重入会让 steps 数组直接 push 新项（旧位置原地保留）**。这与 §3.2 的"runtime 顺序"语义一致，无需改 reducer。

等等——读一下 `upsertStep`（reducer.ts:79-85）：
```ts
function upsertStep(steps: AgentStep[], data: AgentStep): AgentStep[] {
  const idx = steps.findIndex(s => s.step_id === data.step_id);
  if (idx === -1) return [...steps, data];
  const next = [...steps];
  next[idx] = { ...steps[idx], ...data };  // 原地替换，不动顺序
  return next;
}
```

这会让重入时**原地替换**，runtime 数组顺序不会变化。要支持"runtime 顺序 = 最后到达"语义，**reducer 需要改成"重入时移到末尾"**：

```ts
function upsertStep(steps: AgentStep[], data: AgentStep): AgentStep[] {
  const filtered = steps.filter(s => s.step_id !== data.step_id);  // 移除旧位置
  return [...filtered, data];  // 追加到末尾
}
```

这样 runtime steps 数组就保留"最后到达"的语义，`steps[steps.length - 1]` 就是当前活跃步骤。

### 3.4 总结：前端三处改动

1. `agent-run-reducer.ts:upsertStep`：重入时移到末尾（不再原地替换）
2. `workflow-step-templates.ts:mergeStepsWithTemplate`：按 runtime 顺序输出，未到达的模板项追加到末尾
3. `step-strip.tsx:activeStep`：用 `runtimeSteps[runtimeSteps.length - 1]` 作为活跃步骤

后端 0 改动。

### 3.5 单测更新

`workflow-step-templates.test.ts` 5 个测试需要重写预期：
- 测试"重入相同 step_id"：merged 中 suggest_dimensions 应在 request_dimension_selection 之后（runtime 顺序），不是之前（模板顺序）
- 新增测试"驳回循环 → activeStep 跟 runtime 走"

---

## 四、Bug 2：驳回反馈语义传到 LLM

### 4.1 当前数据流（已通过调查 agent 确认）

✅ 已通的链路：
- 前端 `interaction-block.tsx:354` 提交 `{ regenerate: true, feedback: 用户文本 }`
- 后端 `resolve_interaction` 通过 `Command(resume=values)` 透传给 LangGraph
- `_request_dimension_selection`（interview_questions.py:46-49）把 feedback 写入 `state.dimension_feedback`
- 条件边 `_route_after_dimension_selection` 跳回 `suggest_dimensions`

❌ 断链的环节：
- `suggest_dimensions` 节点（`interview_question_service.py:78-101`）**只读 `state.user_intent`**（首条用户消息），**从不读 `state.dimension_feedback`**
- `dimension_suggest.yaml` 模板**只有 `resume_text` + `user_intent` 两个变量**，**没有 feedback 占位符、没有 previous_dimensions 对比基线**

### 4.2 修复：dimension（核心 bug）

**文件 1**：`backend/app/llm/prompts/templates/interview_questions/dimension_suggest.yaml`

新增两个 optional 变量 + prompt 强转指令：

```yaml
variables:
  - name: resume_text
    required: true
    description: "候选人简历全文（Markdown 格式）"
  - name: user_intent
    required: false
    description: "用户指定的分析方向或关注点"
  - name: user_feedback           # ← 新增
    required: false
    description: "上一轮被驳回时用户的反馈文本（必须严格采纳）"
  - name: previous_dimensions     # ← 新增
    required: false
    description: "上一轮被用户驳回的维度列表（JSON 字符串，作为对比基线，避免重复推荐）"

template: |-
  # 角色
  你是资深企业招聘面试设计专家，负责根据候选人简历和用户意图推荐面试评估维度。

  # 约束
  {% include "agent/constraints.yaml" %}

  # 输入
  - 候选人简历：
    ```{{ resume_text }}```
  {% if user_intent %}
  - 用户指定的分析方向：{{ user_intent }}
  {% endif %}
  {% if previous_dimensions %}
  - 上一轮被驳回的维度（仅作对比基线，不要重复出现）：
    {{ previous_dimensions }}
  {% endif %}
  {% if user_feedback %}
  - 用户驳回反馈（**必须严格采纳，不得自由发挥**）：
    {{ user_feedback }}
  {% endif %}

  # 指令
  请基于候选人简历{% if user_intent %}和用户指定的分析方向{% endif %}{% if user_feedback %}，并**严格按照用户驳回反馈调整维度集合**（驳回反馈是绝对约束，不可忽略；若反馈要求新增某维度，必须包含该维度；若反馈要求移除/替换某维度，必须移除/替换）{% endif %}，建议 4-6 个适合本次面试重点追问的维度。

  ## 具体要求
  1. 每个维度必须给出推荐理由
  2. {% if previous_dimensions %}**必须与上一轮被驳回的维度有显著差异**——保留合理的、按反馈调整有问题的{% else %}维度名称必须具体明确（如"项目深度"而非"综合能力"），不得超过 8 个字{% endif %}
  3. 维度之间应覆盖不同评估角度，避免重叠
  4. 所有维度名称必须填写，不得为空

  # 输出格式
  只输出 JSON，不要输出 Markdown、解释或代码块：
  {
    "dimensions": [
      {
        "name": "项目深度",
        "reason": "候选人有 3 个核心项目经历，需核实真实贡献与技术决策能力"
      }
    ]
  }
```

**文件 2**：`backend/app/services/interview_question_service.py:78-101` 的 `suggest_dimensions` 节点

```python
async def suggest_dimensions(self, state, ctx: WorkflowRuntimeContext) -> dict:
    # 驳回循环时把上一轮维度作对比基线、把反馈强转给 LLM
    user_feedback = (state.get("dimension_feedback") or "").strip() or None
    previous_dims = state.get("suggested_dimensions") or []
    previous_dimensions_json = (
        json.dumps([{"name": d.get("name"), "reason": d.get("reason")} for d in previous_dims], ensure_ascii=False)
        if previous_dims else None
    )

    prompt = _pm.render(
        "interview_questions/dimension_suggest",
        resume_text=state.get("resume_text") or "",
        user_intent=self._extract_user_intent(state),
        user_feedback=user_feedback,
        previous_dimensions=previous_dimensions_json,
    )
    text = await self._stream_with_thinking(prompt, ctx, stage_label="分析维度")
    dims = self._parse_dimensions(text)
    # 重置 dimension_feedback（用过即清，避免下一轮误用）
    return {"suggested_dimensions": dims, "dimension_feedback": ""}
```

### 4.3 修复：plan_approval

`question_plan.yaml` 已有 `review_feedback` 占位符（line 14-16, line 32-35），**但措辞不够强**："必须按以下意见调整，否则不通过" → 需要升级为强转指令；同时**没有 previous_plan 占位符**作为对比基线。

**文件 3**：`backend/app/llm/prompts/templates/interview_questions/question_plan.yaml`

加 `previous_plan`（optional），措辞强化：

```yaml
variables:
  ... 现有
  - name: previous_plan           # ← 新增
    required: false
    description: "上一轮被驳回的计划（JSON 字符串，作为对比基线）"

template: |-
  ...
  {% if previous_plan %}
  - 上一轮被驳回的计划（仅作对比，不要原样复用）：
    {{ previous_plan }}
  {% endif %}
  {% if review_feedback %}
  - 上一轮人工批阅反馈（**必须严格按反馈调整，不可忽略**）：
    {{ review_feedback }}
  {% endif %}
  ...
```

`build_question_plan`（`interview_question_service.py:113-140`）已经在传 `review_feedback`，本次新增 `previous_plan` 传参（取 `state.question_plan`）。

### 4.4 修复：job_selection

⚠️ 用户调查结论：`job_selection` 的 `load_job_candidates` 节点是从 DB 拉员工岗位列表，**不调 LLM**，候选源固定。`job_feedback` 字段写入后**根本没有任何代码读取**——是死字段。

**两种修法**：
- (a) 删除前端驳回 textarea（让用户只能在选择中切换，不能"基于反馈重新生成"）
- (b) 保留 textarea，但 `load_job_candidates` 拿到 `job_feedback` 时记日志（标识用户期望，但因为后端能力不足无法响应；或者后续接入 LLM 做岗位排序时用）

按用户决策"三个驳回路径都修"，但 job_selection 的限制是真实的——**改方案为**：

**文件 4**：`backend/app/llm/graphs/workflows/resume_evaluation.py` 的 `_request_job_selection`

保留 feedback 写入 state；但同时**前端在 job_selection interaction 卡片移除 feedback textarea**（避免误导用户填的内容真的会被采纳）。简单干净。

实际后端已经有 `state.job_feedback`，本 spec 不动后端，**只改前端**：在 interaction-block.tsx 里按 `interaction_type === 'job_selection'` 隐藏 textarea。

### 4.5 总结：bug 2 修复清单

| 文件 | 改动 |
|---|---|
| `dimension_suggest.yaml` | 新增 `user_feedback` + `previous_dimensions` 占位符；强转指令 |
| `interview_question_service.py:suggest_dimensions` | 节点拼 prompt 时传入 feedback + previous_dimensions |
| `question_plan.yaml` | 新增 `previous_plan`；review_feedback 措辞强化 |
| `interview_question_service.py:build_question_plan` | 节点拼 prompt 时新增 previous_plan 传参 |
| `interaction-block.tsx` | 当 `interaction_type === 'job_selection'` 时隐藏驳回 feedback textarea（避免误导） |

---

## 五、Bug 3：侧栏「会话 27」chip 替换为运行中徽标

### 5.1 改动

`agent-sidebar-drawer.tsx:194-201`：

```tsx
{/* 旧：会话计数 chip */}
{visible.length > 0 && (
  <span className="px-1.5 py-px rounded-full text-[10px] font-semibold tabular-nums
                   text-[#0369A1]
                   bg-[rgba(14,165,233,0.10)]
                   ring-1 ring-inset ring-[rgba(14,165,233,0.18)]">
    {visible.length}
  </span>
)}
```

改为：

```tsx
{/* 运行中数量徽标：仅在有运行任务时显示，复用 useRunningSessionIds */}
{runningIds.size > 0 && (
  <span className="inline-flex items-center gap-1 px-1.5 py-px rounded-full text-[10px] font-semibold tabular-nums
                   text-[#0369A1]
                   bg-[rgba(14,165,233,0.10)]
                   ring-1 ring-inset ring-[rgba(14,165,233,0.18)]">
    <span className="w-1.5 h-1.5 rounded-full bg-[#0EA5E9] animate-pulse" aria-hidden />
    <span>{runningIds.size} 运行中</span>
  </span>
)}
```

`runningIds` 是已有的 `const runningIds = useRunningSessionIds();`（line 134）。空闲时不渲染（用户 opt-out 计数徽标的精神也保留了）。

---

## 六、Bug 4：侧栏 0.5s 分段动画

### 6.1 当前

`agent-sidebar-drawer.tsx:174`：

```tsx
className={`relative flex-shrink-0 bg-white border-r border-[#E2E8F0]
            transition-[width] duration-300 ease-[cubic-bezier(0.16,1,0.3,1)]
            ${expanded ? 'w-[280px]' : 'w-[64px]'}
            overflow-hidden`}
```

里层展开态 / 折叠态分别用：
```tsx
<div className={`h-full flex flex-col transition-opacity duration-200
                 ${expanded ? 'opacity-100' : 'opacity-0 pointer-events-none'}`}>
```
```tsx
<div className={`absolute inset-0 flex flex-col items-center py-3 gap-2
                 transition-opacity duration-200
                 ${expanded ? 'opacity-0 pointer-events-none' : 'opacity-100'}`}>
```

### 6.2 升级方案（B 分段层次感）

**外层宽度**：300ms → 500ms，曲线改为更平滑的 `cubic-bezier(0.65, 0, 0.35, 1)`

**展开态内容**：
- 收起时：先 0.2s opacity → 0（无 delay）
- 展开时：等 0.25s 后 0.2s opacity → 1（delay 0.25s = 宽度切换的中段后才出现）

**折叠态内容**：反向同样规则

```tsx
{/* 外层 */}
<nav className={`relative flex-shrink-0 bg-white border-r border-[#E2E8F0]
                  transition-[width] duration-500 ease-[cubic-bezier(0.65,0,0.35,1)]
                  ${expanded ? 'w-[280px]' : 'w-[64px]'}
                  overflow-hidden`}>

{/* 展开态内容 */}
<div className={`h-full flex flex-col transition-opacity duration-200
                 ${expanded
                   ? 'opacity-100 [transition-delay:0.25s] [transition-timing-function:cubic-bezier(0,0,0.2,1)]'
                   : 'opacity-0 pointer-events-none'}`}>

{/* 折叠态内容 */}
<div className={`absolute inset-0 flex flex-col items-center py-3 gap-2
                 transition-opacity duration-200
                 ${expanded
                   ? 'opacity-0 pointer-events-none'
                   : 'opacity-100 [transition-delay:0.25s] [transition-timing-function:cubic-bezier(0,0,0.2,1)]'}`}>
```

这正是 mockup 里方案 B 的实现。

### 6.3 性能与回退

- 仅 `width` + `opacity` 过渡，符合 taste-skill-v1 §5 "硬件加速专属 transform/opacity"
- 无 framer-motion 依赖
- 加上 `motion-reduce:transition-none` 兜底（用户启用 prefers-reduced-motion）

---

## 七、错误处理与边界

- bug 1 重入循环：runtime steps 数组追加，分母用模板长度恒定，分子用 step_id 去重
- bug 1 流式刚开始 runtime 为空：`steps.length === 0` 时 fallback 到模板第一项作为活跃步骤（已有逻辑）
- bug 2 dimension_feedback 为空字符串：`user_feedback or None` 处理后不渲染该段；prompt 模板的 `{% if user_feedback %}` 兜底
- bug 2 第一次进入（没有上一轮 dimensions）：`previous_dimensions` 为 None，模板对应段不渲染
- bug 3 useRunningSessionIds 已有：复用，不新增 store 逻辑
- bug 4 prefers-reduced-motion：transition-none 兜底；无障碍要求

---

## 八、测试策略

### 8.1 单测

- `workflow-step-templates.test.ts` 重写：runtime 顺序优先；驳回重入时活跃步骤跟着走
- `agent-run-reducer.test.ts`（新增可选）：upsertStep 重入时移到末尾的行为
- 后端 `interview_question_service.py` 单测可选：suggest_dimensions 拼 prompt 时正确传入 feedback

### 8.2 视觉/手动验证

- bug 1：完整跑简历问答 workflow，到维度选择卡 → 驳回 → 观察 StepStrip 文案是否跟着 graph 实际节点走（"分析维度…" → "选择维度"）
- bug 2：驳回时填具体反馈（"还需要新增团队沟通能力"），观察新一轮维度是否真的包含；同样验证 plan_approval
- bug 3：流式中观察侧栏顶部出现"⦿ 1 运行中"徽标；流式结束后徽标消失
- bug 4：点击侧栏收起/展开按钮，观察 0.5s 分段动画的层次感（旧内容先淡出 → 宽度切换 → 新内容淡入）

---

## 九、回退策略

各 bug 独立可回退：
1. bug 1：还原 reducer.upsertStep + workflow-step-templates.mergeStepsWithTemplate + step-strip.activeStep 三处
2. bug 2：删除 prompt 模板的新占位符 + 还原 service 节点的 prompt 拼装
3. bug 3：还原 chip 渲染
4. bug 4：还原宽度 transition duration 与 delay 配置

---

## 十、风险与权衡

| 风险 | 缓解 |
|---|---|
| bug 1 reducer 改 upsertStep "重入移到末尾"行为可能影响其它消费 steps 数组的代码 | 全仓 grep `runState.steps` / `runs[id].runState.steps`：只在 step-strip.tsx + agent-message-card.tsx 渲染消费；agent-run-reducer.test.ts 已覆盖该行为 |
| bug 2 prompt 强转指令可能导致 LLM 过度服从、忽略简历客观性 | 措辞要求"严格按反馈调整"但保留"基于简历推荐"的前提；模板里两段并存让 LLM 兼顾 |
| bug 4 0.5s 动画对频繁切换用户略慢 | 250ms 内连续切换会被中断 → 视觉略乱；但 expanded 状态有 localStorage 持久化，正常用户不会高频切换 |

---

## 十一、实施步骤（高层）

1. bug 1 协议升级：reducer.upsertStep + workflow-step-templates 重写 + step-strip activeStep + 单测
2. bug 2 dimension：dimension_suggest.yaml + suggest_dimensions 节点
3. bug 2 plan_approval：question_plan.yaml + build_question_plan 节点
4. bug 2 job_selection：interaction-block.tsx 隐藏 textarea
5. bug 3：sidebar-drawer chip 替换
6. bug 4：sidebar-drawer transition 升级
7. 联调 + 全量 test + build

详细 task 划分见 plan 文档。
