# Agent 工作台 8 项打磨 实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 修复 Agent 工作台的 8 项体验/质量问题（思考模式无输出、评估报告简陋/维度占位名、侧栏收起交互、已完成步骤折叠、动画字体不可见、简历文件图标、问答示例答案）。

**Architecture:** 后端改 `gateway` 思考参数 + 评估报告 DTO/prompt/兜底 + 问答 DTO/prompt；前端改侧栏 Popover、已完成步骤折叠、思考内容嵌入、文件图标、字体 fallback、报告/问答卡片渲染。各任务独立可测、按依赖顺序排列。

**Tech Stack:** Python 3.12 / FastAPI / LangGraph / langchain-openai（后端）；React 19 / TypeScript / Vite / Tailwind 3.4 / Zustand（前端）。

**对应 Spec:** `docs/superpowers/specs/2026-06-16-agent-workspace-polish-design.md`

**约定：**
- 后端测试用 `pytest`（项目已配 `backend/tests/`）；前端测试用 `vitest`（`frontend/` 下 `npm test`）。
- 每个任务结束 `git commit`，提交信息用 `feat`/`fix`/`refactor` 前缀 + 中文简述。
- 遵循 AGENTS.md：函数/类带 docstring/JSDoc；异常不吞 `Exception`；Redis key 带业务前缀。
- 所有相对路径以仓库根 `D:\code\py\project\resume` 为准。

---

## 文件结构总览

**后端（新建/修改）：**
- 修改 `backend/app/llm/gateway.py` — 思考参数修复（#8）
- 修改 `backend/app/services/resume_evaluation_service.py` — 维度名兜底（#4）+ 报告升级（#7）
- 修改 `backend/app/schemas/agent/dto.py` — `ResumeEvaluationReportDTO` 扩展（#7）+ `InterviewQuestionItemDTO` 加 `reference_answer`（#6）
- 修改 `backend/app/llm/prompts/templates/resume_evaluation/visual_report.yaml` — 报告结构（#7）+ 维度名约束（#4）
- 修改 `backend/app/llm/prompts/templates/interview_questions/question_generate.yaml` — 参考答案（#6）

**前端（新建/修改）：**
- 新建 `frontend/src/components/employee/agent/resume-file-icon.tsx` — react-file-icon 封装（#1）
- 修改 `frontend/src/components/employee/agent/agent-composer.tsx` — 图标 + 发送清除（#1）
- 修改 `frontend/src/components/employee/agent/layout/agent-sidebar-drawer.tsx` — Popover + 排序（#2）
- 修改 `frontend/src/store/agent.ts` — 会话列表时间降序（#2）
- 修改 `frontend/src/components/employee/agent/wave-text.tsx` — 字体 fallback（#3）
- 修改 `frontend/src/components/employee/agent/blocks/interaction-block.tsx` — 已完成步骤折叠（#5）
- 新建 `frontend/src/components/employee/agent/blocks/reasoning-section.tsx` — 思考折叠子组件（#8 展示）
- 修改 `frontend/src/components/employee/agent/blocks/block-renderer.tsx` — 移除独立 thinking 卡片（#8 展示）
- 修改 `frontend/src/components/employee/agent/agent-message-card.tsx` + `agent-message-list.tsx` — thinking 分组吸附（#8 展示）
- 修改 `frontend/src/components/employee/agent/blocks/{text-block,evaluation-report-card,interview-questions-card}.tsx` — 嵌入 ReasoningSection（#8 展示）
- 修改 `frontend/src/types/agent.ts` — 报告/问答类型扩展（#6/#7）

---

## Task 1: [#8] 修复思考模式 LLM 请求参数（gateway.py）

**Files:**
- Modify: `backend/app/llm/gateway.py:34-86`
- Test: `backend/tests/llm/test_gateway_thinking_params.py`（新建）

**背景：** 当前 `THINKING_PARAM_MAP` 对阿里云 DashScope/Qwen 只注入 `enable_thinking`，缺 `stream_options`，且 `thinking_budget_tokens` 字段名应为 `thinking_budget`；DeepSeek 分支注入了不被接受的 `{"thinking":{"type":"enabled"}}`。修复后开启思考模式能正常返回 `reasoning_content`。

- [ ] **Step 1: 写失败测试 — 校验各 provider 的 extra_body 构造**

新建 `backend/tests/llm/test_gateway_thinking_params.py`：

```python
"""gateway 思考参数注入单测。"""
from app.llm.gateway import OpenAICompatibleGateway
from app.schemas.agent.dto import LLMRuntimeConfigDTO
from pydantic import SecretStr


def _config(provider: str, enable_thinking: bool, budget: int | None = None) -> LLMRuntimeConfigDTO:
    return LLMRuntimeConfigDTO(
        model_name="qwen-plus", api_key=SecretStr("sk-test"),
        base_url="https://dashscope.aliyuncs.com/compatible-mode/v1",
        timeout_seconds=30, temperature=0.7, provider=provider,
        enable_thinking=enable_thinking, thinking_budget_tokens=budget,
    )


def test_qwen_thinking_injects_enable_thinking_and_stream_options():
    """Qwen 开启思考：extra_body 含 enable_thinking + stream_options。"""
    kw = OpenAICompatibleGateway()._chat_kwargs(_config("qwen", True))
    eb = kw["extra_body"]
    assert eb["enable_thinking"] is True
    assert eb["stream_options"] == {"include_usage": True}


def test_qwen_thinking_budget_renamed_to_thinking_budget():
    """thinking_budget_tokens 在注入时改名为 thinking_budget（仅 qwen/other）。"""
    kw = OpenAICompatibleGateway()._chat_kwargs(_config("qwen", True, budget=2048))
    assert kw["extra_body"]["thinking_budget"] == 2048
    assert "thinking_budget_tokens" not in kw["extra_body"]


def test_deepseek_thinking_injects_no_provider_key():
    """DeepSeek 默认出 reasoning，不注入任何 provider 思考 key（但仍带 stream_options）。"""
    kw = OpenAICompatibleGateway()._chat_kwargs(_config("deepseek", True))
    eb = kw["extra_body"]
    assert "enable_thinking" not in eb
    assert "thinking" not in eb
    assert eb["stream_options"] == {"include_usage": True}


def test_thinking_disabled_no_extra_body():
    """关闭思考：不注入任何思考参数。"""
    kw = OpenAICompatibleGateway()._chat_kwargs(_config("qwen", False))
    assert "extra_body" not in kw
```

> 若 `LLMRuntimeConfigDTO` 字段名与上面不完全一致，以实际 DTO 为准（先读 `backend/app/schemas/agent/dto.py` 的 `LLMRuntimeConfigDTO` 定义对齐字段）。

- [ ] **Step 2: 运行测试确认失败**

Run: `pytest backend/tests/llm/test_gateway_thinking_params.py -v`
Expected: 4 个测试 FAIL（当前 `thinking_budget_tokens` 命名未改、缺 stream_options、DeepSeek 注入了错误 key）。

- [ ] **Step 3: 修改 `THINKING_PARAM_MAP`（gateway.py:34-38）**

```python
# Provider 适配表：enable_thinking=True 时注入到 ChatOpenAI extra_body 的键值。
# - qwen/other（阿里云 DashScope OpenAI 兼容）：enable_thinking + stream_options
# - deepseek：DeepSeek-R1 默认输出 reasoning_content，不注入 provider 思考 key，
#   仅靠 stream_options 保证 usage 增量回吐。
THINKING_PARAM_MAP: dict[str, dict[str, Any]] = {
    "deepseek": {"stream_options": {"include_usage": True}},
    "qwen":     {"enable_thinking": True, "stream_options": {"include_usage": True}},
    "other":    {"enable_thinking": True, "stream_options": {"include_usage": True}},
}
```

- [ ] **Step 4: 修改 `_chat_kwargs` 的 budget 注入（gateway.py:67-86）**

把 budget 注入从 `thinking_budget_tokens` 改为 `thinking_budget`，且仅对 qwen/other 注入（DeepSeek 不支持）：

```python
    def _chat_kwargs(self, runtime_config: LLMRuntimeConfigDTO) -> dict[str, Any]:
        """构造 ChatOpenAI kwargs。

        仅在 enable_thinking 时注入 extra_body：provider 思考开关 + stream_options
        + thinking_budget（仅 qwen/other，DeepSeek 不支持该字段）。
        """
        extra_body: dict[str, Any] = {}
        if runtime_config.enable_thinking:
            extra_body.update(THINKING_PARAM_MAP.get(runtime_config.provider, THINKING_PARAM_MAP["other"]))
            if runtime_config.thinking_budget_tokens and runtime_config.provider in ("qwen", "other"):
                # Qwen 官方字段名为 thinking_budget（非 thinking_budget_tokens）
                extra_body["thinking_budget"] = runtime_config.thinking_budget_tokens

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
```

- [ ] **Step 5: 运行测试确认通过**

Run: `pytest backend/tests/llm/test_gateway_thinking_params.py -v`
Expected: 4 PASS。

- [ ] **Step 6: 提交**

```bash
git add backend/app/llm/gateway.py backend/tests/llm/test_gateway_thinking_params.py
git commit -m "fix(llm): 修复思考模式参数—补 stream_options、thinking_budget 改名、清理 DeepSeek 错误 key"
```

---

## Task 2: [#3] WaveText 动画字体可见性 fallback

**Files:**
- Modify: `frontend/src/components/employee/agent/wave-text.tsx:18-38`
- Test: `frontend/src/components/employee/agent/__tests__/wave-text.test.tsx`（新建）

**背景：** `bg-clip-text text-transparent` 在动画失效或渐变未穿透嵌套 inline-block 时文字完全不可见。加纯色 fallback 保证可读性优先。

- [ ] **Step 1: 写失败测试 — fallback 颜色存在且文本可读**

新建 `frontend/src/components/employee/agent/__tests__/wave-text.test.tsx`：

```tsx
import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import { WaveText } from '../wave-text';

describe('WaveText', () => {
  it('渲染给定文本（每个字符为独立 span）', () => {
    const { getByLabelText, container } = render(<WaveText text="评估中" />);
    // aria-label 保留完整文本，保证可读性
    expect(getByLabelText('评估中')).toBeDefined();
    // 容器含品牌蓝 fallback 色，避免动画失效时透明
    const outer = container.querySelector('span[aria-label="评估中"]');
    expect(outer?.className).toContain('text-[#0369A1]');
  });

  it('空文本不渲染', () => {
    const { container } = render(<WaveText text="" />);
    expect(container.firstChild).toBeNull();
  });
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `npx vitest run src/components/employee/agent/__tests__/wave-text.test.tsx`
Expected: FAIL（当前 className 含 `text-transparent`，不含 `text-[#0369A1]`）。

- [ ] **Step 3: 修改 WaveText — 加纯色 fallback**

把外层 span 的 `text-transparent` 替换为带 fallback 的写法：保留 `bg-clip-text` 但 color 设为品牌蓝，渐变背景失效时仍有可见色。

```tsx
export function WaveText({ text, className = '' }: WaveTextProps) {
  if (!text) return null;
  return (
    <span
      aria-label={text}
      // 纯色 fallback #0369A1 优先保证可读；渐变 bg-clip-text 在动画生效时覆盖外观。
      // 动画/shimmer 失效（Tailwind purge、嵌套 inline-block 未穿透）时文字仍可见。
      className={`inline-block text-[#0369A1]
                  bg-[linear-gradient(90deg,#0369A1,#0EA5E9,#38BDF8,#0EA5E9,#0369A1)]
                  bg-[length:200%_100%] bg-clip-text
                  animate-[shimmer_2.5s_linear_infinite] ${className}`}
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

> 注意：移除了 `text-transparent`。`bg-clip-text` 仍生效——当背景渐变渲染时，文字会显示渐变色；背景未覆盖时回退到 `text-[#0369A1]`。这是可读性优先的稳妥写法。

- [ ] **Step 4: 运行测试确认通过**

Run: `npx vitest run src/components/employee/agent/__tests__/wave-text.test.tsx`
Expected: PASS。

- [ ] **Step 5: 手动验证**

`npm run dev` 后在 Agent 工作台触发一个 running 步骤，确认步骤标题文字始终可见（不闪烁消失）。

- [ ] **Step 6: 提交**

```bash
git add frontend/src/components/employee/agent/wave-text.tsx frontend/src/components/employee/agent/__tests__/wave-text.test.tsx
git commit -m "fix(agent-fe): WaveText 加纯色 fallback，修复动画失效时文字不可见"
```

---

## Task 3: [#1] 简历文件图标（react-file-icon）+ 发送后清除

**Files:**
- Modify: `frontend/package.json`（加依赖）
- Create: `frontend/src/components/employee/agent/resume-file-icon.tsx`
- Modify: `frontend/src/components/employee/agent/agent-composer.tsx:73-81,254-266`

- [ ] **Step 1: 安装 react-file-icon**

Run（在 `frontend/` 下）: `npm install react-file-icon`
确认 `package.json` dependencies 出现 `"react-file-icon"`。

> react-file-icon 是纯客户端渲染组件，无 SSR/worker 依赖，直接装即可。

- [ ] **Step 2: 新建 ResumeFileIcon 封装组件**

新建 `frontend/src/components/employee/agent/resume-file-icon.tsx`：

```tsx
/**
 * ResumeFileIcon：按文件名扩展名渲染对应文件类型图标。
 *
 * 基于 react-file-icon 的 FileIcon + defaultStyles，区分 pdf/doc/docx 等。
 * 用于 Agent composer 的简历附件 chip 展示。
 */

import { FileIcon, defaultStyles } from 'react-file-icon';

interface ResumeFileIconProps {
  /** 完整文件名（含扩展名），用于匹配图标类型 */
  fileName: string;
  /** 图标尺寸（px），默认 26 */
  size?: number;
}

/** 扩展名 → react-file-icon 的 type label */
function fileTypeOf(fileName: string): string {
  const ext = fileName.split('.').pop()?.toLowerCase() ?? '';
  return ext;
}

export function ResumeFileIcon({ fileName, size = 26 }: ResumeFileIconProps) {
  const ext = fileTypeOf(fileName);
  // defaultStyles 已覆盖 pdf/docx/doc/xls/png 等；未知扩展回退到默认文件图标
  const style = (defaultStyles as Record<string, Record<string, unknown>>)[ext] ?? {};
  return (
    <div style={{ width: size, height: size * 1.2 }} className="flex-shrink-0">
      <FileIcon extension={ext || undefined} {...style} size={size * 1.2} />
    </div>
  );
}
```

- [ ] **Step 3: 修改 composer UploadChip success 分支用图标**

`agent-composer.tsx`：
- 顶部 import 加 `import { ResumeFileIcon } from './resume-file-icon';`，并从 lucide-react 的 import 中移除不再使用的 `Check`（若仅此处用）。
- `submit()`（73-81 行）发送后重置 upload：

```tsx
  const submit = () => {
    const trimmed = content.trim();
    if (!trimmed || sending) return;
    const ctxRefs = upload.kind === 'success'
      ? [{ type: 'resume', resume_id: upload.resumeId, file_name: upload.fileName }]
      : undefined;
    onSend({ content: trimmed, workflow_type: workflow, context_refs: ctxRefs });
    setContent('');
    // 发送后清除附件展示，避免脏携带到下一条消息
    setUpload({ kind: 'idle' });
  };
```

- `UploadChip` 的 success 分支（254-266 行）用图标替换 `Check`：

```tsx
  if (state.kind === 'success') {
    return (
      <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-lg
                      bg-[#E0F2FE] text-[#0369A1] text-xs font-medium border border-[#0EA5E9]/20">
        <ResumeFileIcon fileName={state.fileName} size={18} />
        <span className="truncate max-w-[260px]">已附上 · {state.fileName}</span>
        <span className="text-[#64748B] font-normal">{(state.size / 1024).toFixed(0)} KB</span>
        <button type="button" onClick={onClear}
                className="ml-1 hover:text-[#DC2626] transition-colors" title="移除附件">
          <X size={12} />
        </button>
      </div>
    );
  }
```

- [ ] **Step 4: 验证 lint/build**

Run（在 `frontend/` 下）: `npx tsc --noEmit`
Expected: 无类型错误。

- [ ] **Step 5: 手动验证**

`npm run dev` → Agent 工作台附一份 PDF 和一份 DOCX，确认 chip 显示对应格式图标；发送消息后 chip 消失。

- [ ] **Step 6: 提交**

```bash
git add frontend/package.json frontend/package-lock.json frontend/src/components/employee/agent/resume-file-icon.tsx frontend/src/components/employee/agent/agent-composer.tsx
git commit -m "feat(agent-fe): 简历附件用 react-file-icon 展示格式图标 + 发送后清除输入框附件"
```

---

## Task 4: [#2] 会话列表时间降序排序（store + groupSessions）

**Files:**
- Modify: `frontend/src/store/agent.ts:91-109`
- Modify: `frontend/src/components/employee/agent/layout/agent-sidebar-drawer.tsx:50-57`
- Test: `frontend/src/store/__tests__/agent-sort.test.ts`（新建）

**背景：** 当前 `refreshSessions` 直接用后端返回顺序，`groupSessions` 只分组不组内排序。需统一按 `last_message_time` 降序，展开态/收起态/搜索都受益。

- [ ] **Step 1: 写失败测试 — 组内降序**

新建 `frontend/src/store/__tests__/agent-sort.test.ts`：

```ts
import { describe, it, expect } from 'vitest';

// 直接测 groupSessions 的排序行为：把它抽成纯函数导出后引用
// （见 Step 3：把 groupSessions 导出）
import { groupSessionsByTime } from '../../components/employee/agent/layout/agent-sidebar-drawer';

describe('会话排序', () => {
  it('组内按 last_message_time 降序（新的在上）', () => {
    const sessions = [
      { id: 1, title: 'a', last_message_time: '2026-06-16T10:00:00' },
      { id: 2, title: 'b', last_message_time: '2026-06-16T18:00:00' },
      { id: 3, title: 'c', last_message_time: '2026-06-16T12:00:00' },
    ] as never;
    const groups = groupSessionsByTime(sessions);
    const today = groups.find(g => g.key === 'today');
    expect(today?.items.map(i => i.id)).toEqual([2, 3, 1]);
  });

  it('无时间的会话排到 earlier 组最后', () => {
    const sessions = [
      { id: 1, title: 'a', last_message_time: '' },
    ] as never;
    const groups = groupSessionsByTime(sessions);
    expect(groups.find(g => g.key === 'earlier')?.items.map(i => i.id)).toEqual([1]);
  });
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `npx vitest run src/store/__tests__/agent-sort.test.ts`
Expected: FAIL（`groupSessionsByTime` 未导出 / 组内未排序）。

- [ ] **Step 3: 改 groupSessions — 导出 + 组内降序**

`agent-sidebar-drawer.tsx`：把 `groupSessions` 重命名为导出的 `groupSessionsByTime`，并在分组循环内对每组排序。修改 38-62 行：

```tsx
export function groupSessionsByTime(sessions: WorkspaceSession[]): Array<{ key: GroupKey; items: WorkspaceSession[] }> {
  const now = new Date();
  const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const yesterdayStart = new Date(todayStart.getTime() - 86400000);
  const dayOfWeek = now.getDay();
  const mondayOffset = dayOfWeek === 0 ? 6 : dayOfWeek - 1;
  const weekStart = new Date(todayStart.getTime() - mondayOffset * 86400000);

  const groups: Record<GroupKey, WorkspaceSession[]> = {
    today: [], yesterday: [], 'this-week': [], earlier: [],
  };

  for (const s of sessions) {
    if (!s.last_message_time) { groups.earlier.push(s); continue; }
    const t = new Date(s.last_message_time).getTime();
    if (t >= todayStart.getTime()) { groups.today.push(s); }
    else if (t >= yesterdayStart.getTime()) { groups.yesterday.push(s); }
    else if (t >= weekStart.getTime()) { groups['this-week'].push(s); }
    else { groups.earlier.push(s); }
  }

  // 组内按 last_message_time 降序（新的在上）；空时间视为最早
  const desc = (a: WorkspaceSession, b: WorkspaceSession) =>
    (b.last_message_time ?? '').localeCompare(a.last_message_time ?? '');

  return (['today', 'yesterday', 'this-week', 'earlier'] as GroupKey[])
    .filter(k => groups[k].length > 0)
    .map(key => ({ key, items: groups[key].sort(desc) }));
}
```

并把组件内原 `const grouped = groupSessions(sessions);` 改为 `const grouped = groupSessionsByTime(sessions);`。

- [ ] **Step 4: store refreshSessions 兜底降序（防止后端顺序不稳定）**

`store/agent.ts` 的 `refreshSessions`（约 91-109 行）拿到 items 后整体降序一次：

```ts
        const items = (data?.data?.items ?? []) as WorkspaceSession[];
        // 兜底降序：即便后端未排序，前端也保证新的在上
        items.sort((a, b) => (b.last_message_time ?? '').localeCompare(a.last_message_time ?? ''));
        set({ sessions: items, /* 其余字段不变 */ });
```

> 以实际 `refreshSessions` 结构为准，只加 sort 那一行，不动其余赋值。

- [ ] **Step 5: 运行测试确认通过**

Run: `npx vitest run src/store/__tests__/agent-sort.test.ts`
Expected: PASS。

- [ ] **Step 6: 提交**

```bash
git add frontend/src/components/employee/agent/layout/agent-sidebar-drawer.tsx frontend/src/store/agent.ts frontend/src/store/__tests__/agent-sort.test.ts
git commit -m "feat(agent-fe): 会话列表按 last_message_time 降序（组内也排序）"
```

---

## Task 5: [#2] 侧栏收起态单图标 + Popover 会话列表

**Files:**
- Modify: `frontend/src/components/employee/agent/layout/agent-sidebar-drawer.tsx:233-284`
- Modify: `frontend/package.json`（若 radix popover 未装则加 `@radix-ui/react-popover`）

**背景：** 收起态现状是 20 个会话图标列表。改为：一个图标按钮，hover/focus 弹出白色 Popover 卡片显示会话列表（复用展开态列表 markup）。项目已装 `@radix-ui/react-dialog`，popover 需确认是否已装。

- [ ] **Step 1: 确认/安装 Popover 依赖**

Run（在 `frontend/` 下）: 检查 `package.json` 是否有 `@radix-ui/react-popover`；若无则 `npm install @radix-ui/react-popover`。

- [ ] **Step 2: 新建 CollapsedSessionPopover 子组件**

在 `agent-sidebar-drawer.tsx` 文件内（或同目录新建 `collapsed-session-popover.tsx`）新增组件，用 Radix Popover 的 hover 触发 + 复用 `groupSessionsByTime` 渲染列表：

```tsx
import * as Popover from '@radix-ui/react-popover';

/**
 * CollapsedSessionPopover：收起态的单图标按钮 + 悬浮会话列表卡片。
 *
 * 鼠标移入/聚焦图标 → 弹出白色卡片，列出会话（按时间降序，复用展开态列表结构）。
 * 移出即收起。点击会话项切换并关闭。
 */
export function CollapsedSessionPopover({
  sessions, activeId, runningIds, onSelect,
}: {
  sessions: WorkspaceSession[];
  activeId: number | null;
  runningIds: Set<number>;
  onSelect: (id: number) => void;
}) {
  const grouped = groupSessionsByTime(sessions);
  return (
    <Popover.Root>
      <Popover.Trigger asChild>
        <button type="button" title="会话列表"
          className="w-9 h-9 flex items-center justify-center rounded-lg
                     bg-[#0369A1] text-white hover:bg-[#0EA5E9] transition-colors">
          <MessageSquare size={16} />
        </button>
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content
          side="right" align="start" sideOffset={8}
          className="z-50 w-64 max-h-96 overflow-y-auto rounded-xl border border-[#E2E8F0]
                     bg-white shadow-xl p-2">
          <p className="px-2 py-1 text-[11px] text-[#94A3B8] tracking-wide">会话（按时间降序）</p>
          {grouped.map(g => (
            <div key={g.key}>
              <p className="px-2 pt-2 pb-1 text-[11px] text-[#94A3B8]">{GROUP_LABELS[g.key]}</p>
              {g.items.map(s => {
                const isRunning = runningIds.has(s.id);
                return (
                  <button key={s.id} type="button"
                    onClick={() => onSelect(s.id)}
                    className={`w-full text-left px-2 py-1.5 rounded-md text-sm transition-colors
                      ${s.id === activeId ? 'bg-[#E0F2FE] text-[#0369A1] font-semibold'
                        : 'text-[#334155] hover:bg-[#F1F5F9]'}`}>
                    <span className="flex items-center gap-2">
                      {isRunning && <Loader2 size={12} className="animate-spin text-[#0EA5E9]" />}
                      <span className="truncate">{s.title || '未命名会话'}</span>
                    </span>
                  </button>
                );
              })}
            </div>
          ))}
          <Popover.Arrow className="fill-white" />
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}
```

> import 顶部补 `MessageSquare`（lucide-react）、`Loader2`（若未在该文件 import）。

- [ ] **Step 3: 替换收起态的图标列表（233-269 行）**

把原「会话图标列表」div（248-269 行）替换为 `<CollapsedSessionPopover sessions={sessions} activeId={activeId} runningIds={runningIds} onSelect={onSelect} />`。保留展开按钮（238-246 行）、新建 FAB（272-276）、设置（279-283）不变。

- [ ] **Step 4: 验证类型**

Run（在 `frontend/` 下）: `npx tsc --noEmit`
Expected: 无错误。

- [ ] **Step 5: 手动验证**

`npm run dev` → 收起侧栏 → 悬浮单图标，确认白色卡片弹出、会话按时间降序、点击切换会话、移出收起。

- [ ] **Step 6: 提交**

```bash
git add frontend/src/components/employee/agent/layout/agent-sidebar-drawer.tsx frontend/package.json frontend/package-lock.json
git commit -m "feat(agent-fe): 侧栏收起态改为单图标 + 悬浮 Popover 会话列表"
```

---

## Task 6: [#8 展示] 抽取 ReasoningSection 折叠子组件

**Files:**
- Create: `frontend/src/components/employee/agent/blocks/reasoning-section.tsx`

**背景：** 思考内容不再独立卡片，要嵌入各业务块。先抽出可复用的默认收起折叠组件。

- [ ] **Step 1: 新建 ReasoningSection**

新建 `frontend/src/components/employee/agent/blocks/reasoning-section.tsx`：

```tsx
/**
 * ReasoningSection：嵌入业务块内的思考过程折叠区（默认收起）。
 *
 * 替代原独立 ThinkingBlock。reasoning 为空时折叠头提示"模型未返回推理过程"。
 */

import { useState } from 'react';
import { ChevronRight, Sparkles } from 'lucide-react';

interface ReasoningSectionProps {
  /** 模型返回的推理内容（reasoning_content） */
  reasoning: string;
}

export function ReasoningSection({ reasoning }: ReasoningSectionProps) {
  const [expanded, setExpanded] = useState(false);
  const empty = !reasoning.trim();
  return (
    <div className="mt-2 rounded-md border border-[#E2E8F0] bg-[#F8FAFC]">
      <button type="button"
        onClick={() => setExpanded(v => !v)}
        className="w-full flex items-center gap-1.5 px-3 py-1.5 text-xs text-[#7C3AED] hover:bg-[#F1F5F9] rounded-md transition-colors">
        <ChevronRight size={12} className={`transition-transform ${expanded ? 'rotate-90' : ''}`} />
        <Sparkles size={12} />
        <span>{empty ? '模型未返回推理过程' : '思考过程'}</span>
      </button>
      {expanded && !empty && (
        <pre className="px-3 pb-2 text-xs text-[#475569] whitespace-pre-wrap break-words font-sans">
          {reasoning}
        </pre>
      )}
    </div>
  );
}
```

- [ ] **Step 2: 验证类型**

Run（在 `frontend/` 下）: `npx tsc --noEmit`
Expected: 无错误。

- [ ] **Step 3: 提交**

```bash
git add frontend/src/components/employee/agent/blocks/reasoning-section.tsx
git commit -m "feat(agent-fe): 新增 ReasoningSection 折叠子组件（思考内容嵌入用）"
```

---

## Task 7: [#8 展示] thinking 块分组吸附 + 移除独立卡片

**Files:**
- Modify: `frontend/src/components/employee/agent/blocks/block-renderer.tsx:22-45`
- Modify: `frontend/src/components/employee/agent/agent-message-card.tsx:40-52`
- Modify: `frontend/src/components/employee/agent/agent-message-list.tsx:78-89`

**背景：** `thinking` 块吸附到相邻业务块作为 `reasoning` prop；`BlockRenderer` 不再渲染独立 `case 'thinking'`。

- [ ] **Step 1: 新增分组工具函数**

在 `agent-message-card.tsx`（或新建 `frontend/src/components/employee/agent/utils/group-blocks.ts`）加纯函数，把连续 thinking 块吸附到后一个业务块；孤立 thinking 吸附到前一个：

```tsx
import type { AgentBlock } from '@/types/agent';

/**
 * attachReasoning：把连续的 thinking 块吸附到相邻业务块。
 *
 * 规则：thinking 块吸附到其后紧跟的业务块（text/interaction/report/questions）；
 * 若 thinking 后无业务块（孤立），吸附到前一个业务块。结果业务块带 reasoning 字段。
 */
export function attachReasoning(blocks: AgentBlock[]): Array<AgentBlock & { reasoning?: string }> {
  const result: Array<AgentBlock & { reasoning?: string }> = [];
  let pendingReasoning = '';
  for (const b of blocks) {
    if (b.type === 'thinking') {
      // 累积思考文本
      pendingReasoning += (b as { text?: string }).text ?? '';
      continue;
    }
    // 业务块：附上累积的 reasoning（若有）
    result.push({ ...b, reasoning: pendingReasoning || undefined });
    pendingReasoning = '';
  }
  // 末尾孤立的 thinking：吸附到最后一个业务块
  if (pendingReasoning && result.length > 0) {
    const last = result[result.length - 1];
    last.reasoning = (last.reasoning ?? '') + pendingReasoning;
  }
  return result;
}
```

- [ ] **Step 2: 在两处渲染入口套用 attachReasoning**

`agent-message-card.tsx:40-52` 与 `agent-message-list.tsx:78-89`：把 `message.content.blocks.map(...)` 改为先 `attachReasoning(blocks).map(...)`。两个文件都 import 该函数。

- [ ] **Step 3: BlockRenderer 移除 case 'thinking'**

`block-renderer.tsx`：删除 `case 'thinking': return <ThinkingBlock .../>;` 分支（26-27 行）及其 import；保留其余 case。各业务块组件接收 `reasoning` prop（见 Task 8）。

```tsx
export function BlockRenderer({ block, submitting, onSubmitInteraction }: BlockRendererProps) {
  switch (block.type) {
    case 'text':                return <TextBlock block={block} />;
    case 'tool_use':            return <ToolUseBlock block={block} />;
    case 'interaction':         return <InteractionBlock block={block} submitting={submitting} onSubmit={onSubmitInteraction} />;
    case 'interview_questions': return <InterviewQuestionsCard block={block} />;
    case 'evaluation_report':   return <EvaluationReportCard block={block} />;
    default: return null;  // thinking 块不再独立渲染，已吸附进业务块
  }
}
```

- [ ] **Step 4: 删除/保留 thinking-block.tsx**

`thinking-block.tsx` 不再被引用。可保留文件（标注 deprecated）或删除——按 AGENTS.md「精准改动」原则，**删除该文件**（本次改动使其失效）。同时清理任何对它的 import。

- [ ] **Step 5: 验证类型 + build**

Run（在 `frontend/` 下）: `npx tsc --noEmit`
Expected: 无错误（若有残留 import 报错，按报错清理）。

- [ ] **Step 6: 手动验证**

`npm run dev` → 开启思考模式发一条评估消息，确认思考内容出现在对应业务块内的折叠区（默认收起，点开展示），不再有独立紫色思考卡片。

- [ ] **Step 7: 提交**

```bash
git add frontend/src/components/employee/agent/blocks/block-renderer.tsx frontend/src/components/employee/agent/agent-message-card.tsx frontend/src/components/employee/agent/agent-message-list.tsx frontend/src/components/employee/agent/utils/group-blocks.ts
git rm frontend/src/components/employee/agent/blocks/thinking-block.tsx
git commit -m "refactor(agent-fe): thinking 块吸附到业务块，移除独立思考卡片"
```

---

## Task 8: [#8 展示] 各业务块嵌入 ReasoningSection

**Files:**
- Modify: `frontend/src/components/employee/agent/blocks/text-block.tsx`
- Modify: `frontend/src/components/employee/agent/blocks/evaluation-report-card.tsx`
- Modify: `frontend/src/components/employee/agent/blocks/interview-questions-card.tsx`

**背景：** 业务块组件接收 `reasoning` prop，非空时在块内渲染 `<ReasoningSection>`。

- [ ] **Step 1: TextBlock 嵌入**

`text-block.tsx`：扩展 props 接收 `reasoning?: string`，渲染正文后加：

```tsx
import { ReasoningSection } from './reasoning-section';

export function TextBlock({ block, reasoning }: { block: AgentBlock & { type: 'text' }; reasoning?: string }) {
  return (
    <div className="...">
      {/* 原正文渲染保持不变 */}
      {reasoning !== undefined && <ReasoningSection reasoning={reasoning} />}
    </div>
  );
}
```

- [ ] **Step 2: EvaluationReportCard / InterviewQuestionsCard 同理嵌入**

两个卡片组件 props 加 `reasoning?: string`，在卡片底部加 `{reasoning !== undefined && <ReasoningSection reasoning={reasoning} />}`。`block-renderer.tsx` 透传 `reasoning` prop（从已吸附的 block 上读取 `block.reasoning`）。

`block-renderer.tsx` 各 case 改为传 reasoning：
```tsx
    case 'text':                return <TextBlock block={block} reasoning={block.reasoning} />;
    case 'evaluation_report':   return <EvaluationReportCard block={block} reasoning={block.reasoning} />;
    case 'interview_questions': return <InterviewQuestionsCard block={block} reasoning={block.reasoning} />;
```

- [ ] **Step 3: 验证类型 + 手动验证**

Run: `npx tsc --noEmit`；再 `npm run dev` 验证思考内容在正文/报告/问答卡片内折叠展示。

- [ ] **Step 4: 提交**

```bash
git add frontend/src/components/employee/agent/blocks/text-block.tsx frontend/src/components/employee/agent/blocks/evaluation-report-card.tsx frontend/src/components/employee/agent/blocks/interview-questions-card.tsx frontend/src/components/employee/agent/blocks/block-renderer.tsx
git commit -m "feat(agent-fe): 业务块嵌入 ReasoningSection 展示思考内容"
```

---

## Task 9: [#5] 已完成交互步骤可折叠回看 + 隐藏操作按钮

**Files:**
- Modify: `frontend/src/components/employee/agent/blocks/interaction-block.tsx:25-52,114-440`

**背景：** 终态（submitted/rejected/expired）当前早返回只剩一行字。改为：状态徽标 + 标题 + 摘要 + 可展开只读回看原文 `data`；操作按钮仅在 `status==='pending'` 渲染。

- [ ] **Step 1: 改 InteractionBlock 主体 — 终态渲染折叠头**

把 29-52 行三个终态早返回，合并为一个统一的「终态折叠回看」分支。新增 `resolved` 判断 + 一个内部子组件渲染只读内容。修改后结构：

```tsx
export function InteractionBlock({ block, submitting, onSubmit }: InteractionBlockProps) {
  const { request_id, interaction_type, title, prompt, data, status } = block;
  const resolved = status === 'submitted' || status === 'rejected' || status === 'expired';

  // 终态：折叠回看原文，不渲染操作按钮
  if (resolved) {
    return <ResolvedInteraction title={title} status={status!} interactionType={interaction_type!} data={data} />;
  }

  // pending：按类型分发（保持原 switch 不变）
  switch (interaction_type) {
    case 'dimension_selection': return <DimensionSelection title={title} prompt={prompt} data={data} submitting={submitting} onSubmit={(vals) => onSubmit?.(request_id, vals)} />;
    case 'plan_approval':       return <PlanApproval title={title} prompt={prompt} data={data} submitting={submitting} onSubmit={(vals) => onSubmit?.(request_id, vals)} />;
    case 'job_selection':       return <JobSelection title={title} prompt={prompt} data={data} submitting={submitting} onSubmit={(vals) => onSubmit?.(request_id, vals)} />;
    default: return (/* 原 unknown 分支保持 */);
  }
}
```

- [ ] **Step 2: 新增 ResolvedInteraction 子组件（只读回看）**

在 `interaction-block.tsx` 内新增：

```tsx
/** 终态交互卡：状态徽标 + 标题 + 一句摘要 + 可展开只读回看原文 data。无操作按钮。 */
function ResolvedInteraction({
  title, status, interactionType, data,
}: {
  title: string; status: string; interactionType: string; data: Record<string, unknown>;
}) {
  const [expanded, setExpanded] = useState(false);
  const badge =
    status === 'submitted' ? { txt: '✓ 已提交', cls: 'bg-[#DCFCE7] text-[#16A34A]' } :
    status === 'rejected'  ? { txt: '↻ 已驳回', cls: 'bg-[#FEF3C7] text-[#D97706]' } :
                             { txt: '已过期', cls: 'bg-[#F1F5F9] text-[#94A3B8]' };
  // 摘要：按类型取一行概括
  const summary =
    interactionType === 'dimension_selection'
      ? `已选 ${(data?.selected_dimensions as unknown[] | undefined)?.length ?? 0} 项`
      : interactionType === 'plan_approval'
        ? `总题量 ${(data?.plan as { total_questions?: number } | undefined)?.total_questions ?? 0}`
        : interactionType === 'job_selection'
          ? `岗位：${String((data?.selected_job_name as string | undefined) ?? '—')}`
          : '';

  return (
    <div className="rounded-md border border-[#E2E8F0] bg-[#F8FAFC] px-4 py-3">
      <button type="button" onClick={() => setExpanded(v => !v)}
        className="w-full flex items-center justify-between">
        <span className="flex items-center gap-2">
          <span className={`text-[11px] px-2 py-0.5 rounded-full font-semibold ${badge.cls}`}>{badge.txt}</span>
          <span className="text-sm font-semibold text-[#334155]">{title}</span>
        </span>
        <span className="text-xs text-[#64748B]">{summary} · {expanded ? '收起 ▴' : '展开回看 ▾'}</span>
      </button>
      {expanded && (
        <div className="mt-2 text-xs text-[#475569]">
          {/* 只读渲染原文候选/计划/岗位；这里用 JSON 只读展示兜底，
              若要更友好可在三种类型各写一个只读视图 */}
          <pre className="whitespace-pre-wrap break-words font-sans">{JSON.stringify(data, null, 2)}</pre>
        </div>
      )}
    </div>
  );
}
```

> 说明：展开内容先用 JSON 只读展示（兜底、不报错）。若需更友好，可后续把 DimensionSelection/PlanApproval/JobSelection 的渲染逻辑抽成只读模式复用；本任务先用 JSON 保证「能回看」，避免一次性改太大。

- [ ] **Step 3: 确认 pending 态操作按钮不受影响**

`DimensionSelection`/`PlanApproval`/`JobSelection` 的操作按钮（确认/驳回）只在 pending 态被渲染（因为 resolved 态已在主组件早返回，不会进 switch）。无需改动按钮代码。

- [ ] **Step 4: 验证类型 + 手动验证**

Run: `npx tsc --noEmit`；再 `npm run dev` → 提交一个交互卡（维度选择），确认提交后变成「✓ 已提交 + 可展开回看候选维度」，无操作按钮。

- [ ] **Step 5: 提交**

```bash
git add frontend/src/components/employee/agent/blocks/interaction-block.tsx
git commit -m "feat(agent-fe): 已完成交互步骤可折叠回看原文，终态不渲染操作按钮"
```

---

## Task 10: [#4] 评估报告维度名后端兜底覆盖

**Files:**
- Modify: `backend/app/services/resume_evaluation_service.py:183-215`
- Modify: `backend/app/llm/prompts/templates/resume_evaluation/visual_report.yaml:33,42`
- Test: `backend/tests/services/test_resume_evaluation_dim_name.py`（新建）

**背景：** 最终报告是独立 LLM 调用，可能输出"维度1/维度2"。用评估结果 `dimension_results` 的真实 `dimension_name` 按 `dimension_id` 兜底覆盖。

- [ ] **Step 1: 写失败测试 — 维度名兜底覆盖占位名**

新建 `backend/tests/services/test_resume_evaluation_dim_name.py`：

```python
"""评估报告维度名兜底单测。"""
from app.services.resume_evaluation_service import _override_dimension_names


def test_override_replaces_placeholder_by_dimension_id():
    """报告维度名占位（维度1）被评估结果的真实维度名覆盖。"""
    report = {
        "skill_dimensions": [
            {"dimension_id": 1, "dimension_name": "维度1", "score": 80},
            {"dimension_id": 2, "dimension_name": "技术深度", "score": 90},
        ]
    }
    eval_dims = [
        {"dimension_id": 1, "dimension_name": "沟通能力"},
        {"dimension_id": 2, "dimension_name": "技术深度"},
    ]
    _override_dimension_names(report, eval_dims)
    assert report["skill_dimensions"][0]["dimension_name"] == "沟通能力"
    assert report["skill_dimensions"][1]["dimension_name"] == "技术深度"


def test_override_skips_when_no_eval_dims():
    """评估结果为空时不覆盖，保留 LLM 原名。"""
    report = {"skill_dimensions": [{"dimension_name": "维度1"}]}
    _override_dimension_names(report, [])
    assert report["skill_dimensions"][0]["dimension_name"] == "维度1"
```

- [ ] **Step 2: 运行测试确认失败**

Run: `pytest backend/tests/services/test_resume_evaluation_dim_name.py -v`
Expected: FAIL（`_override_dimension_names` 未定义）。

- [ ] **Step 3: 实现兜底函数 + 在 build_visualization_report 调用**

`resume_evaluation_service.py` 模块级加纯函数：

```python
import re

# 占位维度名正则：如"维度1"、"维度 2"
_PLACEHOLDER_DIM_RE = re.compile(r"^\s*维度\s*\d+\s*$")


def _override_dimension_names(report: dict, eval_dimension_results: list[dict]) -> None:
    """用评估结果的真实维度名覆盖报告 skill_dimensions 的占位名。

    优先按 dimension_id 精确匹配；报告项缺 dimension_id 或 id 未命中时，
    按"占位名正则 + 列表顺序"二次对齐。eval_dimension_results 为空则不覆盖。
    """
    if not eval_dimension_results:
        return
    by_id = {int(d.get("dimension_id") or 0): d for d in eval_dimension_results if d.get("dimension_id")}
    # 顺序兜底用：尚未被 dimension_id 匹配的评估维度名，按序分配给占位报告项
    fallback_names = [str(d.get("dimension_name") or "") for d in eval_dimension_results]
    fallback_idx = 0
    for sd in report.get("skill_dimensions") or []:
        did = sd.get("dimension_id")
        if did is not None and int(did) in by_id:
            sd["dimension_name"] = by_id[int(did)].get("dimension_name") or sd.get("dimension_name")
            continue
        # 无 id 或未命中：仅当报告名是占位时才用顺序兜底覆盖
        if _PLACEHOLDER_DIM_RE.match(str(sd.get("dimension_name") or "")):
            if fallback_idx < len(fallback_names):
                sd["dimension_name"] = fallback_names[fallback_idx]
                fallback_idx += 1
```

在 `build_visualization_report`（183-215 行）`model_validate_json` 成功后调用：

```python
        report = ResumeEvaluationReportDTO.model_validate_json(text).model_dump(mode="json")
        # 兜底：用评估结果的真实维度名覆盖 LLM 可能生成的占位名（维度1/维度2）
        eval_result = state.get("evaluation_result") or {}
        _override_dimension_names(report, eval_result.get("dimension_results") or [])
```

- [ ] **Step 4: 强化 prompt 约束（visual_report.yaml 第 10 条）**

把指令第 10 条改为：
```
10. skill_dimensions 的 dimension_name 必须与"评估结果"中各维度的 dimension_name 完全一致，禁止使用"维度1""维度2"等占位名；不得输出业务表写入指令，不得编造评估结果中不存在的维度或技能
```

- [ ] **Step 5: 运行测试确认通过**

Run: `pytest backend/tests/services/test_resume_evaluation_dim_name.py -v`
Expected: PASS。

- [ ] **Step 6: 提交**

```bash
git add backend/app/services/resume_evaluation_service.py backend/app/llm/prompts/templates/resume_evaluation/visual_report.yaml backend/tests/services/test_resume_evaluation_dim_name.py
git commit -m "fix(eval): 评估报告维度名用评估结果兜底覆盖占位名（维度1/2）"
```

---

## Task 11: [#7] 扩展 ResumeEvaluationReportDTO（报告内容升级 B）

**Files:**
- Modify: `backend/app/schemas/agent/dto.py:120-131`
- Modify: `backend/app/llm/prompts/templates/resume_evaluation/visual_report.yaml`
- Test: `backend/tests/schemas/test_resume_eval_report_dto.py`（新建）

**背景：** 报告补：画像摘要、维度命中技能+权重+点评、面试建议、综合评语（复用已算 advantage_comment/disadvantage_comment）。

- [ ] **Step 1: 写失败测试 — 新字段可解析**

新建 `backend/tests/schemas/test_resume_eval_report_dto.py`：

```python
"""ResumeEvaluationReportDTO 扩展字段解析测试。"""
from app.schemas.agent.dto import ResumeEvaluationReportDTO


def test_report_dto_accepts_new_fields():
    data = {
        "final_score": 82, "final_label": "良好", "decision": "建议进入面试",
        "summary": "匹配度高",
        "match_overview": {"advantages": ["经验丰富"], "risks": ["跳槽频繁"]},
        "resume_structure": {}, "experience_timeline": [],
        "skill_dimensions": [{
            "dimension_name": "技术深度", "score": 85, "weight": 0.3,
            "matched_skills": ["Python", "FastAPI"], "comment": "核心项目扎实",
            "advantage": "强", "disadvantage": "",
        }],
        "job_gaps": [{"gap": "缺管理", "suggestion": "面试考察"}],
        "profile_summary": {"years": 5, "education": "本科", "stack": ["Python"], "stability": "稳定"},
        "interview_suggestions": [{"focus": "系统设计", "reason": "岗位核心"}],
        "comprehensive_comment": {"advantages": "技术强", "risks": "管理弱"},
    }
    r = ResumeEvaluationReportDTO.model_validate(data)
    assert r.profile_summary["years"] == 5
    assert r.skill_dimensions[0]["matched_skills"] == ["Python", "FastAPI"]
    assert r.comprehensive_comment["advantages"] == "技术强"
```

- [ ] **Step 2: 运行测试确认失败**

Run: `pytest backend/tests/schemas/test_resume_eval_report_dto.py -v`
Expected: FAIL（字段未定义）。

- [ ] **Step 3: 扩展 DTO（dto.py:120-131）**

```python
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
    # 新增（方案 B + 综合评语）
    profile_summary: dict[str, Any] = Field(default_factory=dict)           # 画像摘要
    interview_suggestions: list[dict[str, Any]] = Field(default_factory=list)  # 面试建议
    comprehensive_comment: dict[str, Any] = Field(default_factory=dict)     # 综合评语（复用 advantage/disadvantage_comment）
```

> `skill_dimensions` 仍为 `list[dict]`（向后兼容）；prompt 输出每项含 `weight/matched_skills/comment`，DTO 不强制约束 dict 内部结构，避免 LLM 字段缺失导致解析失败。

- [ ] **Step 4: 扩展 visual_report.yaml 输出 schema**

在 `visual_report.yaml` 的输出 JSON 示例与指令中加：
- `profile_summary`：{years(从业年限), education(最高学历), stack(核心技术栈数组), stability(稳定性一句话)}
- `skill_dimensions` 每项加 `weight`(0-1 权重)、`matched_skills`(命中技能数组)、`comment`(该维度优势/风险点评)
- `interview_suggestions`：[{focus(考察重点), reason(依据)}]，由岗位差距 + 低分维度反推
- `comprehensive_comment`：{advantages(优势总评), risks(风险总评)}

指令补一条："profile_summary/interview_suggestions/comprehensive_comment 必须基于评估结果与画像生成，不得编造；comprehensive_comment 优先复用评估结果中的 advantage_comment/disadvantage_comment。"

- [ ] **Step 5: 运行测试确认通过**

Run: `pytest backend/tests/schemas/test_resume_eval_report_dto.py -v`
Expected: PASS。

- [ ] **Step 6: 提交**

```bash
git add backend/app/schemas/agent/dto.py backend/app/llm/prompts/templates/resume_evaluation/visual_report.yaml backend/tests/schemas/test_resume_eval_report_dto.py
git commit -m "feat(eval): ResumeEvaluationReportDTO 扩展画像/维度详情/面试建议/综合评语"
```

---

## Task 12: [#7] 报告兜底路径补全新字段 + 前端渲染

**Files:**
- Modify: `backend/app/services/resume_evaluation_service.py:196-214`（兜底拼装）
- Modify: `frontend/src/types/agent.ts:160-170`（EvaluationReport 类型）
- Modify: `frontend/src/components/employee/agent/blocks/evaluation-report-card.tsx`

- [ ] **Step 1: 兜底拼装补全新字段**

`resume_evaluation_service.py` 兜底分支（196-214 行）用 evaluation_result 直接拼装，补 `profile_summary`（从 state.resume_profile 取）、`comprehensive_comment`（复用 advantage_comment/disadvantage_comment）、`interview_suggestions`（由 job_gaps + 低分维度简单反推或留空数组）。保证兜底报告不缺字段、不白屏。

```python
            report = ResumeEvaluationReportDTO(
                final_score=float(eval_result.get("final_score") or 0),
                final_label=str(eval_result.get("final_label") or ""),
                decision="建议人工复核",
                summary=str(eval_result.get("advantage_comment") or ""),
                match_overview={"advantages": [], "risks": []},
                resume_structure=state.get("resume_profile") or {},
                experience_timeline=[],
                skill_dimensions=[
                    {"dimension_name": d.get("dimension_name"), "score": d.get("score"),
                     "weight": d.get("weight"), "matched_skills": d.get("matched_skills") or [],
                     "comment": f"{d.get('advantage') or ''} {d.get('disadvantage') or ''}".strip(),
                     "advantage": d.get("advantage"), "disadvantage": d.get("disadvantage")}
                    for d in eval_result.get("dimension_results") or []
                ],
                job_gaps=[],
                profile_summary=state.get("resume_profile") or {},
                interview_suggestions=[],
                comprehensive_comment={
                    "advantages": str(eval_result.get("advantage_comment") or ""),
                    "risks": str(eval_result.get("disadvantage_comment") or ""),
                },
            ).model_dump(mode="json")
```

- [ ] **Step 2: 前端类型扩展**

`types/agent.ts` 的 `EvaluationReport`（约 160-170 行）加：

```ts
  profile_summary?: { years?: number; education?: string; stack?: string[]; stability?: string };
  interview_suggestions?: Array<{ focus: string; reason: string }>;
  comprehensive_comment?: { advantages?: string; risks?: string };
```
`skill_dimensions` 项加 `weight?: number; matched_skills?: string[]; comment?: string`。

- [ ] **Step 3: 前端报告卡片渲染新段落**

`evaluation-report-card.tsx` 在现有评分/维度/差距之上加渲染：
- 画像摘要块（years/education/stack 标签/stability）
- 每个维度补权重 + matched_skills 标签 + comment
- 面试建议块（interview_suggestions 列表）
- 综合评语块（comprehensive_comment.advantages / risks）

样式沿用现有蓝色卡片体系（`#E0F2FE`/`#0369A1`/`#0EA5E9`）。

- [ ] **Step 4: 验证类型 + 手动验证**

Run: `npx tsc --noEmit`；再 `npm run dev` 跑一次简历评估，确认报告含新段落，兜底路径（可临时让 prompt 输出非法 JSON 触发）也不白屏。

- [ ] **Step 5: 提交**

```bash
git add backend/app/services/resume_evaluation_service.py frontend/src/types/agent.ts frontend/src/components/employee/agent/blocks/evaluation-report-card.tsx
git commit -m "feat(eval): 报告兜底补全新字段 + 前端渲染画像/维度详情/面试建议/综合评语"
```

---

## Task 13: [#6] 问答每题加参考答案（仅供参考）

**Files:**
- Modify: `backend/app/schemas/agent/dto.py:100-109`
- Modify: `backend/app/llm/prompts/templates/interview_questions/question_generate.yaml`
- Modify: `frontend/src/types/agent.ts:140-157`
- Modify: `frontend/src/components/employee/agent/blocks/interview-questions-card.tsx:79-120`

- [ ] **Step 1: DTO 加字段**

`dto.py` `InterviewQuestionItemDTO`（100-109 行）加：

```python
    reference_answer: str = ""   # 示例参考答案（标注"仅供参考"）
```

- [ ] **Step 2: prompt 输出加 reference_answer**

`question_generate.yaml`：在输出 JSON 每题结构里加 `"reference_answer": "..."`，指令加一条："reference_answer 为该题的一个示例性参考答案，仅供面试官参考，不作为标准答案。"

- [ ] **Step 3: 前端类型 + 卡片渲染**

`types/agent.ts` `QuestionItem` 加 `reference_answer?: string`。
`interview-questions-card.tsx` 每题展开区（79-120 行的 `expandedQ` 块）下方加：

```tsx
{q.reference_answer && (
  <div className="mt-2 rounded-md bg-[#F8FAFC] border border-[#E2E8F0] px-3 py-2">
    <p className="text-[11px] text-[#D97706] font-semibold mb-1">参考答案（仅供参考）</p>
    <p className="text-xs text-[#475569] whitespace-pre-wrap">{q.reference_answer}</p>
  </div>
)}
```

- [ ] **Step 4: 验证类型 + 手动验证**

Run: `npx tsc --noEmit`；再端到端跑一次面试问答生成，确认每题展开后有"参考答案（仅供参考）"块。

- [ ] **Step 5: 提交**

```bash
git add backend/app/schemas/agent/dto.py backend/app/llm/prompts/templates/interview_questions/question_generate.yaml frontend/src/types/agent.ts frontend/src/components/employee/agent/blocks/interview-questions-card.tsx
git commit -m "feat(qa): 每道面试题加示例参考答案（仅供参考）"
```

---

## 自检（写完后核对）

**1. Spec 覆盖：**
- #8 参数修复 → Task 1 ✓；#8 展示嵌入 → Task 6/7/8 ✓
- #3 字体 → Task 2 ✓
- #1 图标+清除 → Task 3 ✓
- #2 排序 → Task 4；#2 Popover → Task 5 ✓
- #5 折叠回看 → Task 9 ✓
- #4 维度名 → Task 10 ✓
- #7 报告 → Task 11/12 ✓
- #6 参考答案 → Task 13 ✓
全部 8 项覆盖。

**2. 占位符扫描：** 无 TBD/TODO；每个代码步骤含完整代码。

**3. 类型一致性：** `ReasoningSection`/`attachReasoning`/`_override_dimension_names`/`groupSessionsByTime`/`CollapsedSessionPopover`/`ResolvedInteraction` 定义与调用处命名一致；`reasoning` prop 在 BlockRenderer/各业务块统一。
