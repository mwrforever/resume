# Agent 工作台全面整改设计

> 日期：2026-06-14
> 分支：worktree-agent-workspace-overhaul
> 范围：后端 agent workflow 修复 + 前端 bug 修复 + UI/UX 全面升级

---

## 一、背景与问题诊断

### 1.1 用户反馈的 5 个问题

| # | 问题 | 根因定位 |
|---|---|---|
| 1 | 最终问题生成每次都返回空 | **BUG-1**：`_generated_questions` 不在 state schema，LangGraph 丢弃 |
| 2 | 后端没有流式输出、响应极慢 | **BUG-2**：fanout 期间无任何前端反馈，体感卡顿（实际已真 SSE） |
| 3 | 思考内容仍然不展示 | **BUG-3A**：前端 thinking-block 默认折叠；**BUG-3B**：模型不返回 reasoning_content 时无兜底 |
| 4 | 思考内容展示逻辑有问题 | **ISSUE-4**：流式/结束态无自动展开收起策略 |
| 5 | 前端 UI 简陋、不合理 | 全局视觉层次、动效、信息密度不足 |

### 1.2 已经做对的部分（不动）

- **事件协议**（9 type / 6 block / envelope 带 `v/seq/ts/run_id`）—— 完全对标 Claude Code Messages SSE
- **SSE 传输**：`EventSourceResponse` 真 SSE + 前端 `fetch + ReadableStream` 解析
- **Redis buffer**：`agent:stream_buffer:{session_id}:{run_id}` JSONL append，TTL 30min
- **批量落库**：`_persist_agent_message` 在 run 收尾一次性折叠 envelope→blocks→落库
- **reducer / stream-client**：seq 排序、401 refresh、frame 解析健壮
- **LangGraph 编排**：节点薄壳 + interrupt + Command(resume) 清晰

> 用户要求的「参考 Claude Code 协议 + Redis 缓存中间结果 + 末尾批量落库」后端架构已全部满足，本次只修实现层 bug 和 UI。

### 1.3 关键证据

- `langgraph==1.1.10`：TypedDict state schema 外的字段会被静默丢弃
- `interview_question_service.py:157/164/168` 三处使用 `_generated_questions`，但 `state.py:14-26` 的 `InterviewQuestionState` 无此字段
- 对比 `resume_evaluation.py` 所有节点返回 key 都在 schema 内，故评估流程无此 bug

---

## 二、设计目标

1. **功能跑通**：面试题生成能产出 8-12 道真实题目
2. **体验流畅**：长任务期间有持续视觉反馈（步骤提示 + 进度 block + 动画）
3. **交互合理**：思考内容默认可见、终止按钮直觉、标题即时更新
4. **视觉专业**：企业级 HR SaaS 深蓝专业风，层次清晰、动效连贯

### 不在本次范围

- 不改协议（events/blocks/envelope）
- 不改 SSE 传输、Redis buffer、落库时机
- 不改 LangGraph 图拓扑（只改节点内部 emit 和 state 字段）
- 不改鉴权、session CRUD、简历上传

---

## 三、后端修复方案

### 3.1 修复 BUG-1（致命）：state schema 补字段

**文件**：`backend/app/llm/graphs/workflows/state.py`

```python
class InterviewQuestionState(TypedDict, total=False):
    """图一 state：简历问答。"""
    resume_ref: dict[str, Any]
    resume_text: str
    user_intent: str
    suggested_dimensions: list[dict[str, Any]]
    selected_dimensions: list[dict[str, Any]]
    dimension_feedback: str
    question_plan: dict[str, Any]
    plan_approved: bool
    # ↓ 新增：fanout 产出的原始题目列表，供 reduce/finalize 读取
    generated_questions: list[dict[str, Any]]
    question_set: dict[str, Any] | None
```

**文件**：`backend/app/services/interview_question_service.py`

3 处改名 `_generated_questions` → `generated_questions`：
- `fanout_generate_questions`（:157）`return {"generated_questions": all_questions}`
- `reduce_questions`（:161, :164）读写 `state.get("generated_questions")`
- `finalize_question_set`（:168）`questions = state.get("generated_questions") or []`

### 3.2 修复 BUG-2：fanout 期间进度反馈

**文件**：`backend/app/services/interview_question_service.py`

`fanout_generate_questions` 改造：为每个维度开一个 `tool_use` block，维度完成后更新 status。

```python
async def fanout_generate_questions(self, state, ctx):
    plan = state.get("question_plan") or {}
    items = plan.get("items") or []
    writer = get_stream_writer()
    # 为每个维度预分配 tool_use block index
    dim_indices = {i: ctx.emitter.next_block_index() for i in range(len(items))}
    for i, item in enumerate(items):
        dim_name = str(item.get("dimension") or f"维度{i+1}")
        writer(ctx.emitter.emit_block_start(index=dim_indices[i], block={
            "type": "tool_use", "tool_name": "generate_questions",
            "display_name": f"生成【{dim_name}】题目",
            "input": {"dimension": dim_name, "count": item.get("question_count")},
            "status": "running",
        }))
    tasks = [
        self._generate_for_dimension(item, state["resume_text"], ctx, dim_indices[i])
        for i, item in enumerate(items)
    ]
    results = await asyncio.gather(*tasks, return_exceptions=True)
    all_questions = []
    for i, r in enumerate(results):
        if isinstance(r, Exception):
            logger.exception("生成单维度题目失败：%s", r)
            writer(ctx.emitter.emit_block_delta(index=dim_indices[i], delta={
                "status": "failed", "error": str(r),
            }))
            writer(ctx.emitter.emit_block_stop(index=dim_indices[i]))
            continue
        all_questions.extend(r)
        writer(ctx.emitter.emit_block_delta(index=dim_indices[i], delta={
            "status": "success", "output": {"count": len(r)},
        }))
        writer(ctx.emitter.emit_block_stop(index=dim_indices[i]))
    return {"generated_questions": all_questions}
```

`_generate_for_dimension` 增加 `block_index` 入参，内部 thinking（若开启）流进该维度对应的 thinking block，让用户看到每个维度的推理过程。

### 3.3 修复 BUG-3B：thinking 空内容兜底

**文件**：`backend/app/services/interview_question_service.py` `_stream_with_thinking`

收尾逻辑增加：若 `enable_thinking=True` 但 thinking 文本为空，emit 一条提示。

```python
finally:
    if thinking_idx is not None:
        # 兜底：开启思考但模型未返回任何 reasoning_content
        if not thinking_text:
            writer(ctx.emitter.emit_block_delta(index=thinking_idx, delta={
                "text_delta": "（当前模型未返回推理过程）",
            }))
        writer(ctx.emitter.emit_block_stop(index=thinking_idx))
```

> 同样的兜底加到 `resume_evaluation_service._stream_text_with_optional_thinking`。

### 3.4 步骤友好提示（新增，支撑前端动画）

**新建文件**：`backend/app/llm/graphs/workflows/step_labels.py`

```python
"""节点名 → 中文友好提示映射。

runner 翻译 LangGraph updates 时用此映射生成 step.update 的 title/detail，
让前端步骤条显示「正在收集需求并规划出题」而不是英文节点名 build_question_plan。
"""

# 映射：(title, running_detail, success_detail)
STEP_LABELS: dict[str, tuple[str, str, str]] = {
    # 图一
    "load_resume":              ("读取简历",   "正在解析简历内容…",     "简历解析完成"),
    "suggest_dimensions":       ("分析维度",   "正在结合岗位需求分析考察维度…", "维度分析完成"),
    "build_question_plan":      ("规划出题",   "正在收集需求并规划出题…", "出题方案已生成"),
    "fanout_generate_questions":("生成题目",   "正在并行生成各维度题目…", "题目生成完成"),
    "reduce_questions":         ("汇总整理",   "正在汇总去重…",         "汇总完成"),
    "finalize_question_set":    ("输出题库",   "正在整理最终题库…",      "题库已就绪"),
    # 图二
    "analyze_resume_profile":   ("分析画像",   "正在结构化解析简历…",    "画像分析完成"),
    "load_job_candidates":      ("加载岗位",   "正在加载候选岗位…",      "岗位加载完成"),
    "validate_job_full_name":   ("校验岗位",   "正在校验岗位归属…",      "岗位校验通过"),
    "run_evaluation_subgraph":  ("多维评估",   "正在进行多维度评估…",    "评估完成"),
    "build_visualization_report":("组装报告",  "正在组装可视化报告…",    "报告已生成"),
    "finalize_evaluation_report":("输出报告",  "正在整理评估报告…",      "报告已就绪"),
}

DEFAULT_LABEL = ("处理中", "正在处理…", "完成")


def get_step_label(node_name: str) -> tuple[str, str, str]:
    """获取节点中文提示三元组，未知节点返回默认。"""
    return STEP_LABELS.get(str(node_name), DEFAULT_LABEL)
```

**修改文件**：`backend/app/llm/graphs/workflows/runner.py` `_translate_updates`

```python
from app.llm.graphs.workflows.step_labels import get_step_label

def _translate_updates(self, payload, ctx):
    events = []
    for node_name, update in payload.items():
        if node_name == "__interrupt__":
            ...
            continue
        title, running_detail, _success = get_step_label(node_name)
        events.append(ctx.emitter.emit_step(
            step_id=str(node_name),
            title=title,
            status="running",  # 改为 running（节点开始执行时）
            detail=running_detail,
        ))
    return events
```

> 注意：`stream_mode="updates"` 在节点**完成后**才触发，所以这里语义是「该节点已开始/正在产出」。前端 running 态显示动画，收到下一个 step 或 run.finish 时自然推进。为更精确，可保留 status="success" 但 detail 用 running_detail 表达「这个步骤在工作」——前端以「最近一个 step」作为当前活跃步骤做动画。**采用后者**：status="success"（节点已完成产出），detail=running_detail；前端把 steps 数组最后一个 step 作为"当前进度"高亮显示动画。

**决策**：runner emit 时 `status="success"`（与现有行为一致，避免引入 running 但永不 success 的悬空态），前端 StepStrip 把**最后一个 step** 视为活跃步骤做波浪动画，历史步骤静态显示。

---

## 四、前端 bug 修复方案

### 4.1 thinking-block 自动展开/收起

**文件**：`frontend/src/components/employee/agent/blocks/thinking-block.tsx`

```typescript
const [expanded, setExpanded] = useState(false);
const [manualOverride, setManualOverride] = useState(false);
const isStreaming = block.status === 'streaming';

// 流式期间自动展开；结束后延迟收起；用户手动操作后不再自动干预
useEffect(() => {
  if (manualOverride) return;
  if (isStreaming) {
    setExpanded(true);
  } else {
    const t = setTimeout(() => setExpanded(false), 800);
    return () => clearTimeout(t);
  }
}, [isStreaming, manualOverride]);

const handleToggle = () => {
  setManualOverride(true);
  setExpanded(e => !e);
};
```

按钮 `onClick={handleToggle}`。

---

## 五、三项附加需求实现

### 5.1 终止按钮 morph

**文件**：`frontend/src/components/employee/agent/agent-composer.tsx`

移除当前独立小"停止"按钮（:222-229），主操作按钮 morph：

```tsx
<button
  type="button"
  onClick={sending ? onAbort : submit}
  disabled={!sending && (!content.trim())}
  className={`h-9 px-5 rounded-lg text-xs font-medium transition-all active:scale-[0.97]
              inline-flex items-center gap-1.5
              ${sending
                ? 'border border-[#DC2626] text-[#DC2626] hover:bg-[#FEE2E2] bg-white'
                : 'bg-[#0369A1] text-white hover:bg-[#0EA5E9] disabled:opacity-40 disabled:cursor-not-allowed'}`}
>
  {sending ? <Square size={13} className="fill-current" /> : <Send size={13} />}
  <span>{sending ? '停止' : '发送'}</span>
</button>
```

### 5.2 步骤波浪 + 光效动画

**新建文件**：`frontend/src/components/employee/agent/wave-text.tsx`

```typescript
/**
 * WaveText：字符波浪跳动 + 品牌蓝光泽逐字流动。
 *
 * 仅用于 running 态步骤提示。每个字符独立 span 做正弦上下波动，
 * 整体容器用渐变 background-clip:text + shimmer 动画营造光流过效果。
 */

interface WaveTextProps {
  text: string;
  className?: string;
}

export function WaveText({ text, className = '' }: WaveTextProps) {
  return (
    <span
      className={`inline-block bg-[linear-gradient(90deg,#0369A1,#0EA5E9,#38BDF8,#0EA5E9,#0369A1)]
                  bg-[length:200%_100%] bg-clip-text text-transparent
                  animate-[shimmer_2.5s_linear_infinite] ${className}`}
      aria-label={text}
    >
      {Array.from(text).map((ch, i) => (
        <span
          key={i}
          className="inline-block animate-[wave_1.4s_ease-in-out_infinite]"
          style={{ animationDelay: `${i * 60}ms`, whiteSpace: 'pre' }}
        >
          {ch}
        </span>
      ))}
    </span>
  );
}
```

**Tailwind / CSS keyframes**（加到 `index.css` 或 agent 局部样式）：

```css
@keyframes wave {
  0%, 100% { transform: translateY(0); }
  50%      { transform: translateY(-2px); }
}
@keyframes shimmer {
  0%   { background-position: 200% 0; }
  100% { background-position: -200% 0; }
}
```

**修改文件**：`frontend/src/components/employee/agent/step-strip.tsx`

- 折叠头部：当前活跃步骤（steps 最后一个，且整体 running）的 title 用 `<WaveText>`
- 展开时间线：status="success" 的最新步骤 title 用 `<WaveText>`，其余静态

### 5.3 标题乐观更新

**新建文件**：`frontend/src/utils/title.ts`

```typescript
/**
 * 与后端 AgentRuntimeService._make_title_from_content 完全一致的标题规则。
 * 用于首条消息发送时乐观更新会话标题，避免等待 reload。
 */
export function makeTitleFromContent(content: string): string {
  if (!content) return '';
  const flat = content
    .strip?.() ?? content.trim();
  let s = flat.replace(/\r/g, ' ').replace(/\n/g, ' ').replace(/\t/g, ' ');
  s = s.split(/\s+/).filter(Boolean).join(' ');
  return s.slice(0, 30);
}

const DEFAULT_TITLES = new Set(['', '新会话', '未命名会话']);
export function isDefaultTitle(t: string | null | undefined): boolean {
  return DEFAULT_TITLES.has((t ?? '').trim());
}
```

**修改文件**：`frontend/src/hooks/use-agent-run.ts` `sendMessage`

发送前判断：若当前 session 标题是默认空标题，本地算标题立即更新。

```typescript
// 在 setMessages(prev => [...prev, optimisticUserMessage]) 之后
const title = makeTitleFromContent(input.content);
if (isDefaultTitle(session?.title) && title) {
  const next = { ...session!, title };
  patchSession(next);          // 更新 Composer/topbar 渲染源
  // 通过返回值或回调通知上层 layout 同步侧边栏
}
```

> 实现细节：`useAgentRun` 当前不持有 `onSessionUpdate` 回调（它通过返回值暴露 `patchSession`）。需要让 `AgentWorkspace::handleSessionUpdate` 在 sendMessage 路径也能被调用。方案：`sendMessage` 返回乐观 title，或 hook 接收一个 `onTitleOptimistic` 回调。**采用**：hook 内部直接调 `patchSession`（更新本地渲染），并通过新增返回字段 `optimisticTitle` 让 Workspace 触发 `onSessionUpdate` 同步侧边栏。

---

## 六、UI/UX 全面升级（企业级深蓝专业风）

### 6.1 设计 token 强化

**文件**：`frontend/src/components/employee/agent/design/agent-tokens.ts`

补全色阶与动效：

```typescript
export const agentColors = {
  brand: { navy, navy2, ink, sky, sky2, skyTint, /*新增*/ sky300: '#7DD3FC', sky50: '#F0F9FF' },
  surface: { app, card, raised, hover, muted, /*新增*/ skeleton: '#E2E8F0', skeletonShine: '#F1F5F9' },
  text: { primary, secondary, tertiary, disabled, onBrand, onBrandMuted },
  semantic: { success, warning, danger, info, thinking },
  border: { subtle, default, strong, focus },
} as const;

export const agentMotion = {
  duration: { fast: 150, normal: 220, slow: 320 },
  easing: { standard: 'cubic-bezier(0.2, 0, 0, 1)', emphasized: 'cubic-bezier(0.3, 0, 0, 1.2)' },
};
```

### 6.2 消息流层次（AgentMessageCard / AgentMessageList）

- 卡片：`shadow-md` 柔和阴影 + 左侧 3px 品牌蓝 accent 条 + `rounded-xl`
- 入场动画：`animate-[fadeSlideUp_0.3s_ease]`（新 block 出现时 fade + translateY 8px→0）
- block 之间用更松的间距 + 轻分隔

### 6.3 block 组件升级

| 组件 | 升级点 |
|---|---|
| `TextBlock` | 行距 leading-relaxed、品牌蓝强调粗体、流式光标精致化 |
| `ThinkingBlock` | 容器化（淡紫底 `bg-[#F3E8FF]/40` + 紫边）、折叠头部加 Sparkles 图标、光标精致 |
| `ToolUseBlock` | 可展开看 output 详情（默认收起，success 后可点开） |
| `InterviewQuestionsCard` | 顶部统计条（总题数/维度数/难度分布环形）+ 按维度分组 + 题目卡精致化 |
| `EvaluationReportCard` | 分数环（SVG ring）+ 维度可视化条形 |

### 6.4 骨架屏

fanout 期间（有 tool_use running block 但无 interview_questions block 时），显示 shimmer 题目骨架卡。

### 6.5 错误态

`runState.error` 区域升级为带「重试」按钮的卡片（重试 = 重新发送上一条用户消息）。

---

## 七、验收标准

1. **BUG-1**：发送面试题生成请求 → 维度选择 + 计划审批后 → **最终看到 8-12 道题目**
2. **BUG-2**：fanout 期间能看到 **每个维度的 tool_use 进度 block**（display_name="生成【XX】题目"，success 后显示 count）
3. **BUG-3A**：开启思考 → **思考内容流式期间自动展开可见**
4. **BUG-3B**：开启思考但模型不返回 reasoning → thinking block 显示兜底提示
5. **附加 1**：运行中主按钮变成 **红色"停止"**，点击中止流式
6. **附加 2**：当前活跃步骤显示 **波浪跳动 + 光泽流动** 动画
7. **附加 3**：首条消息发送后 **标题立即出现在侧边栏**，无需刷新
8. **UI**：整体层次清晰、品牌蓝专业、动效流畅，无白屏闪烁

---

## 八、实施顺序（供 writing-plans 细化）

1. 后端 BUG-1 state schema 修复（最小改动，先让功能跑通）
2. 后端步骤友好提示（step_labels.py + runner 改造）
3. 后端 BUG-2 fanout 进度 block
4. 后端 BUG-3B thinking 兜底
5. 前端 thinking-block 自动展开收起
6. 前端标题乐观更新
7. 前端终止按钮 morph
8. 前端 WaveText + StepStrip 动画
9. 前端 UI 全面升级（token → 卡片 → block 组件 → 骨架屏 → 错误态）
10. 联调验收
