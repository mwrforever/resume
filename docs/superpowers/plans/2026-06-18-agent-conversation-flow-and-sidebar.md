# Agent 工作台 · 对话流连续性 + 侧栏视觉升级 实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把 Agent 工作台对话流改造为「左 accent rail + 头像锚点」的连续对话流（去 agent 外卡 / 去 divider / 业务结果保留浮起卡），并升级侧栏与全局滚动条视觉。

**Architecture:** 前端纯样式与组件结构改造。改 7 个前端文件 + 1 个全局样式文件。流式与历史消息共用 rail 骨架，仅 class 差异。新增 `groupSessionsByTime` 纯函数（TDD），其余 UI 改造无新逻辑。

**Tech Stack:** React 19 + TypeScript + Tailwind CSS 3 + vitest（已有）。

**Spec：** `docs/superpowers/specs/2026-06-18-agent-conversation-flow-and-sidebar-design.md`

---

## 全局约定

- 所有任务在 worktree `agent-ui-flow-sidebar` 内执行（已就绪）。
- 测试运行：`cd frontend && npm test -- <pattern>`（vitest run）。
- TS 类型检查：`cd frontend && npx tsc --noEmit`。
- Commit 风格匹配项目历史：`feat(agent-fe): xxx` / `style(agent-fe): xxx` / `test(agent-fe): xxx`。
- **禁止**改动后端、`agent-tokens.ts`、Topbar、Composer、EmptyState。
- 中文注释 + 关键行级注释（CLAUDE.md §一）。

---

## 文件影响清单

| 文件 | 操作 | 任务 |
|---|---|---|
| `frontend/src/index.css` | 新增滚动条规则 | T1 |
| `frontend/src/components/employee/agent/layout/__tests__/agent-sidebar-grouping.test.ts` | 新建（测试） | T2 |
| `frontend/src/components/employee/agent/layout/agent-sidebar-drawer.tsx` | 新增 `groupSessionsByTime` + UI 重写 | T2、T3 |
| `frontend/src/components/employee/agent/agent-message-card.tsx` | 重写 rail 骨架 | T4 |
| `frontend/src/components/employee/agent/agent-message-list.tsx` | 流式分支同骨架 + rail-streaming 微动效 | T5 |
| `frontend/src/components/employee/agent/blocks/interview-questions-card.tsx` | 内部去 border + result-card 浮起 | T6 |
| `frontend/src/components/employee/agent/blocks/evaluation-report-card.tsx` | 内部去 border + result-card 浮起 | T6 |
| `frontend/src/index.css` | 新增 `@keyframes railGlow` | T5 |

---

## Task 1：全局滚动条样式

**Files:**
- Modify: `frontend/src/index.css`（在文件末尾追加）

风险最低；无需 TDD。改完目测：把任何长列表打开滚动一下应该看到 sky 着色的瘦身滚动条。

- [ ] **Step 1：在 `frontend/src/index.css` 末尾追加全局滚动条规则与 `.thin-scroll` 工具类**

在文件末尾（现有 `.agent-shadow-raised` 之后）新增：

```css

/* ===== 全局滚动条美化 =====
   规则：
   - 默认 thumb 半透明 slate（不抢眼）
   - thumb 自身 hover 进一步加深为 sky（与品牌色统一）
   - track 永远透明
   - .thin-scroll 工具类：极致瘦身（6px、容器 hover 才显形），用于阅读型容器 */

/* WebKit / Blink */
*::-webkit-scrollbar       { width: 8px; height: 8px; }
*::-webkit-scrollbar-track { background: transparent; }
*::-webkit-scrollbar-thumb {
  background: rgba(100, 116, 139, 0.18);
  border-radius: 999px;
  border: 2px solid transparent;
  background-clip: padding-box;
  transition: background 0.2s cubic-bezier(0.16, 1, 0.3, 1);
}
*::-webkit-scrollbar-thumb:hover {
  background: rgba(3, 105, 161, 0.4);
  background-clip: padding-box;
}

/* Firefox */
* { scrollbar-width: thin; scrollbar-color: rgba(100, 116, 139, 0.25) transparent; }

/* 工具类：极致瘦身（仅在阅读型容器需要时叠加） */
.thin-scroll { scrollbar-width: thin; scrollbar-color: transparent transparent; }
.thin-scroll:hover { scrollbar-color: rgba(100, 116, 139, 0.32) transparent; }
.thin-scroll::-webkit-scrollbar { width: 6px; height: 6px; }
.thin-scroll::-webkit-scrollbar-thumb {
  background: transparent;
  transition: background 0.25s cubic-bezier(0.16, 1, 0.3, 1);
}
.thin-scroll:hover::-webkit-scrollbar-thumb { background: rgba(100, 116, 139, 0.32); }
.thin-scroll:hover::-webkit-scrollbar-thumb:hover { background: rgba(3, 105, 161, 0.5); }
```

- [ ] **Step 2：构建检查（无单测，纯 CSS）**

Run: `cd frontend && npx tsc --noEmit`
Expected: 无错误（应不影响 TS）。

- [ ] **Step 3：提交**

```bash
cd "D:/code/py/project/resume/.claude/worktrees/agent-ui-flow-sidebar"
git add frontend/src/index.css
git commit -m "style(agent-fe): 全局滚动条美化 + .thin-scroll 工具类"
```

---

## Task 2：侧栏分组纯函数（TDD）

**Files:**
- Create: `frontend/src/components/employee/agent/layout/__tests__/agent-sidebar-grouping.test.ts`
- Modify: `frontend/src/components/employee/agent/layout/agent-sidebar-drawer.tsx`（仅在文件顶部导出新函数 `groupSessionsByTime`，不动 UI）

- [ ] **Step 1：写失败的单测**

Create `frontend/src/components/employee/agent/layout/__tests__/agent-sidebar-grouping.test.ts`：

```ts
/**
 * 会话分组（今天 / 本周更早 / 更早）单测。
 *
 * 边界规则：
 * - 今天：last_message_time >= 本地今天 00:00
 * - 本周更早：本周一 00:00 <= last_message_time < 今天 00:00
 * - 更早：last_message_time < 本周一 00:00 或解析失败 / 为空
 * - 周一计算用 ISO（周一为周首）
 * - 同组内按时间降序
 */

import { describe, it, expect } from 'vitest';
import type { WorkspaceSession } from '@/types/agent';
import { groupSessionsByTime } from '../agent-sidebar-drawer';

/** 构造最小合法 WorkspaceSession（仅 last_message_time / id 有意义） */
function mk(id: number, lastMessageTime: string): WorkspaceSession {
  return {
    id,
    session_key: `k${id}`,
    current_task_id: `t${id}`,
    employee_id: 1,
    title: `s${id}`,
    selected_model_name: null,
    enable_thinking: false,
    status: 0,
    last_message_time: lastMessageTime,
    create_time: lastMessageTime,
    update_time: lastMessageTime,
  };
}

/** 固定 now：2026-06-17（周三）13:00 本地时间 */
const NOW = new Date(2026, 5, 17, 13, 0, 0);

/** 构造给定本地时间点的 ISO 字符串 */
function isoAt(y: number, m: number, d: number, h = 12): string {
  return new Date(y, m, d, h, 0, 0).toISOString();
}

describe('groupSessionsByTime', () => {
  it('返回三组：today / thisWeek / earlier，顺序固定', () => {
    const groups = groupSessionsByTime([], NOW);
    expect(groups.map(g => g.key)).toEqual(['today', 'thisWeek', 'earlier']);
    expect(groups.map(g => g.label)).toEqual(['今天', '本周更早', '更早']);
  });

  it('「今天」=本地今天 00:00 之后', () => {
    const sessions = [
      mk(1, isoAt(2026, 5, 17, 0)),   // 今天 00:00（含）
      mk(2, isoAt(2026, 5, 17, 12)),  // 今天中午
      mk(3, isoAt(2026, 5, 16, 23)),  // 昨晚
    ];
    const groups = groupSessionsByTime(sessions, NOW);
    const today = groups.find(g => g.key === 'today')!;
    expect(today.items.map(s => s.id)).toEqual([2, 1]); // 同组内降序
    const thisWeek = groups.find(g => g.key === 'thisWeek')!;
    expect(thisWeek.items.map(s => s.id)).toEqual([3]);
  });

  it('「本周更早」=本周一 00:00 ~ 今天 00:00', () => {
    // 本周一是 2026-06-15
    const sessions = [
      mk(1, isoAt(2026, 5, 15, 0)),  // 周一 00:00（含）
      mk(2, isoAt(2026, 5, 16, 23)), // 周二晚
      mk(3, isoAt(2026, 5, 14, 23)), // 上周日
    ];
    const groups = groupSessionsByTime(sessions, NOW);
    const thisWeek = groups.find(g => g.key === 'thisWeek')!;
    expect(thisWeek.items.map(s => s.id)).toEqual([2, 1]);
    const earlier = groups.find(g => g.key === 'earlier')!;
    expect(earlier.items.map(s => s.id)).toEqual([3]);
  });

  it('「更早」=本周一之前 + 空时间 + 解析失败', () => {
    const sessions = [
      mk(1, isoAt(2026, 5, 14, 12)), // 上周日
      mk(2, isoAt(2026, 0, 1, 12)),  // 半年前
      mk(3, ''),                      // 空时间
      mk(4, 'not-a-date'),            // 无效
    ];
    const groups = groupSessionsByTime(sessions, NOW);
    const earlier = groups.find(g => g.key === 'earlier')!;
    // 有效时间降序在前，空/无效放最后（按 id 升序兜底，stable）
    expect(earlier.items.map(s => s.id)).toEqual([1, 2, 3, 4]);
  });

  it('周一 00:00 边界：恰为周一 0 点 → 本周更早', () => {
    // NOW = 周三 13:00；本周一 = 2026-06-15 00:00:00
    const sessions = [
      mk(1, new Date(2026, 5, 15, 0, 0, 0).toISOString()),
      mk(2, new Date(2026, 5, 14, 23, 59, 59).toISOString()),
    ];
    const groups = groupSessionsByTime(sessions, NOW);
    expect(groups.find(g => g.key === 'thisWeek')!.items.map(s => s.id)).toEqual([1]);
    expect(groups.find(g => g.key === 'earlier')!.items.map(s => s.id)).toEqual([2]);
  });

  it('NOW 是周一时：本周一 = 当天 00:00，「本周更早」可能为空', () => {
    const monday = new Date(2026, 5, 15, 10, 0, 0); // 周一 10:00
    const sessions = [
      mk(1, new Date(2026, 5, 15, 9).toISOString()),  // 今天 09:00
      mk(2, new Date(2026, 5, 14, 23).toISOString()), // 上周日
    ];
    const groups = groupSessionsByTime(sessions, monday);
    expect(groups.find(g => g.key === 'today')!.items.map(s => s.id)).toEqual([1]);
    expect(groups.find(g => g.key === 'thisWeek')!.items).toEqual([]);
    expect(groups.find(g => g.key === 'earlier')!.items.map(s => s.id)).toEqual([2]);
  });

  it('不修改原数组', () => {
    const sessions = [mk(1, isoAt(2026, 5, 17, 12)), mk(2, isoAt(2026, 5, 14, 12))];
    const original = [...sessions];
    groupSessionsByTime(sessions, NOW);
    expect(sessions).toEqual(original);
  });
});
```

- [ ] **Step 2：运行确认测试失败**

Run: `cd frontend && npm test -- agent-sidebar-grouping`
Expected: FAIL — `groupSessionsByTime` 未导出。

- [ ] **Step 3：在 `agent-sidebar-drawer.tsx` 顶部新增 `groupSessionsByTime` 实现**

在 `frontend/src/components/employee/agent/layout/agent-sidebar-drawer.tsx` 中，紧接 `sortSessionsByTime` 函数之后追加：

```ts
/** 会话时间分组：今天 / 本周更早 / 更早。
 *
 * 边界规则：
 * - 今天：last_message_time >= 本地今天 00:00
 * - 本周更早：本周一 00:00 <= last_message_time < 今天 00:00
 * - 更早：本周一之前 / 空时间 / 解析失败
 * - 同组内按时间降序；空 / 无效时间项追加到「更早」末尾，按 id 升序稳定
 *
 * 周首遵循 ISO（周一为第一天），与 sortSessionsByTime 共用排序语义。
 *
 * 导出供单测与展开态侧栏渲染复用；折叠态侧栏不分组。
 */
export type SessionGroupKey = 'today' | 'thisWeek' | 'earlier';
export interface SessionGroup {
  key: SessionGroupKey;
  label: '今天' | '本周更早' | '更早';
  items: WorkspaceSession[];
}

export function groupSessionsByTime(
  sessions: WorkspaceSession[],
  now: Date = new Date(),
): SessionGroup[] {
  // 计算本地今天 00:00 与本周一 00:00（ISO 周首：周一）
  const today0 = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  // JS getDay：周日=0、周一=1…周六=6；本周一偏移：周日=-6，其它=1-day
  const dayOfWeek = today0.getDay();
  const mondayOffset = dayOfWeek === 0 ? -6 : 1 - dayOfWeek;
  const monday0 = new Date(today0);
  monday0.setDate(today0.getDate() + mondayOffset);

  const todayMs = today0.getTime();
  const mondayMs = monday0.getTime();

  const today: WorkspaceSession[] = [];
  const thisWeek: WorkspaceSession[] = [];
  const earlierValid: { s: WorkspaceSession; ms: number }[] = [];
  const earlierInvalid: WorkspaceSession[] = [];

  for (const s of sessions) {
    const t = s.last_message_time;
    if (!t) {
      earlierInvalid.push(s);
      continue;
    }
    const ms = new Date(t).getTime();
    if (!Number.isFinite(ms)) {
      earlierInvalid.push(s);
      continue;
    }
    if (ms >= todayMs) today.push(s);
    else if (ms >= mondayMs) thisWeek.push(s);
    else earlierValid.push({ s, ms });
  }

  // 同组内按时间降序
  const byTimeDesc = (a: WorkspaceSession, b: WorkspaceSession) =>
    (b.last_message_time ?? '').localeCompare(a.last_message_time ?? '');
  today.sort(byTimeDesc);
  thisWeek.sort(byTimeDesc);
  earlierValid.sort((a, b) => b.ms - a.ms);
  earlierInvalid.sort((a, b) => a.id - b.id);

  return [
    { key: 'today',    label: '今天',     items: today },
    { key: 'thisWeek', label: '本周更早', items: thisWeek },
    { key: 'earlier',  label: '更早',     items: [...earlierValid.map(x => x.s), ...earlierInvalid] },
  ];
}
```

- [ ] **Step 4：运行测试通过**

Run: `cd frontend && npm test -- agent-sidebar-grouping`
Expected: PASS — 全部 7 个测试通过。

- [ ] **Step 5：跑全量测试确保无回归**

Run: `cd frontend && npm test -- agent-sidebar`
Expected: PASS — `agent-sidebar-sort.test.ts` + `agent-sidebar-grouping.test.ts` 都通过。

- [ ] **Step 6：提交**

```bash
git add frontend/src/components/employee/agent/layout/agent-sidebar-drawer.tsx \
        frontend/src/components/employee/agent/layout/__tests__/agent-sidebar-grouping.test.ts
git commit -m "feat(agent-fe): 侧栏新增 groupSessionsByTime 分组纯函数（含单测）"
```

---

## Task 3：侧栏 UI 重写（毛玻璃头 + 时间分组 + 渐变 pill active）

**Files:**
- Modify: `frontend/src/components/employee/agent/layout/agent-sidebar-drawer.tsx`

仅改 UI，不改任何 props 与事件契约。

- [ ] **Step 1：替换 `AgentSidebarDrawer` 中"展开态内容"的 JSX**

在文件中定位 `{/* 展开态内容 */}` 块（约 line 105-211），整段替换为如下结构。**保留** `searchOpen / renaming / deleting / actionLoading / runningIds / commitRename / confirmDelete / visible / sorted` 等已有变量，新增 `groups`：

```tsx
        // 展开态时使用分组（折叠态不需要）
        const groups = groupSessionsByTime(visible);
```

把这行加在 `const sorted = sortSessionsByTime(visible);` 之后即可（`sorted` 仍保留供折叠态使用）。

然后将"展开态"整个 JSX 块替换为：

```tsx
      {/* 展开态内容（毛玻璃头 + 时间分组 + 渐变 pill active + 6px 隐形滚动条） */}
      <div className={`h-full flex flex-col transition-opacity duration-200
                       ${expanded ? 'opacity-100' : 'opacity-0 pointer-events-none'}`}>
        {/* 顶栏：毛玻璃 + sky 微光晕；标题 + 搜索图标 + 收起按钮 */}
        <div
          className="relative px-3 pt-3 pb-2.5
                     bg-[radial-gradient(120%_60%_at_0%_0%,rgba(14,165,233,0.08),transparent_60%)]
                     backdrop-blur-sm
                     border-b border-[#E2E8F0]/60"
        >
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold uppercase tracking-wider text-[#64748B]">会话</span>
            <div className="flex items-center gap-0.5">
              <button
                type="button"
                onClick={() => setSearchOpen(true)}
                title="搜索会话"
                aria-label="搜索会话"
                className="w-7 h-7 flex items-center justify-center rounded-md
                           text-[#64748B] hover:text-[#0369A1] hover:bg-[rgba(14,165,233,0.08)]
                           transition-colors"
              >
                <Search size={15} />
              </button>
              <button
                type="button"
                onClick={() => setExpanded(false)}
                title="收起侧栏"
                className="w-7 h-7 flex items-center justify-center rounded-md
                           text-[#64748B] hover:text-[#020617] hover:bg-[#F1F5F9] transition-colors"
              >
                <PanelLeftClose size={16} />
              </button>
            </div>
          </div>
        </div>

        {/* 会话列表（按时间分组：今天 / 本周更早 / 更早；隐形 6px 滚动条） */}
        <div className="flex-1 overflow-y-auto thin-scroll px-2 pb-2 pt-1">
          {groups.map(group => group.items.length === 0 ? null : (
            <div key={group.key} className="mb-1">
              {/* 组头：小字大写 label */}
              <div className="px-3 pt-2 pb-1 text-[10px] font-bold uppercase tracking-[0.1em] text-[#94A3B8]">
                {group.label}
              </div>
              <ul className="space-y-0.5">
                {group.items.map(s => {
                  const isActive = s.id === activeId;
                  const isRunning = runningIds.has(s.id);
                  return (
                    <li key={s.id} className="group relative">
                      <button
                        type="button"
                        onClick={() => onSelect(s.id)}
                        title={isRunning ? '正在运行…' : undefined}
                        className={`relative w-full flex items-center gap-3 px-3 py-2 rounded-lg text-left
                                    transition-all duration-200 ease-[cubic-bezier(0.16,1,0.3,1)]
                                    active:scale-[0.99]
                                    ${isActive
                                      ? 'bg-[linear-gradient(90deg,rgba(14,165,233,0.12)_0%,rgba(14,165,233,0.04)_60%,transparent)] text-[#020617] font-semibold'
                                      : 'text-[#334155] hover:bg-[#F1F5F9] hover:translate-x-[1px]'
                                    }`}
                      >
                        {/* active 左侧 2.5px sky 渐变 accent 条 */}
                        {isActive && (
                          <span className="absolute left-0 top-1.5 bottom-1.5 w-[2.5px] rounded-r-full bg-gradient-to-b from-[#0EA5E9] to-[#0369A1]" />
                        )}
                        {isRunning ? (
                          <Loader2 size={16} className={`flex-shrink-0 animate-spin ${isActive ? 'text-[#0369A1]' : 'text-[#0EA5E9]'}`} />
                        ) : (
                          <Bot size={16} className={`flex-shrink-0 ${isActive ? 'text-[#0369A1]' : 'text-[#64748B]'}`} />
                        )}
                        <span className="truncate text-sm flex-1">{s.title || '未命名会话'}</span>
                      </button>
                      {/* hover 操作区：重命名 + 删除（弹窗化） */}
                      <div className="absolute right-1.5 top-1/2 -translate-y-1/2 hidden group-hover:flex items-center gap-0.5">
                        <button
                          type="button" title="重命名"
                          onClick={(e) => { e.stopPropagation(); setRenaming(s); }}
                          className="w-6 h-6 flex items-center justify-center rounded text-[#64748B] hover:text-[#0369A1] bg-white/80 backdrop-blur-sm transition-colors"
                        >
                          <Pencil size={12} />
                        </button>
                        <button
                          type="button" title="删除"
                          onClick={(e) => { e.stopPropagation(); setDeleting(s); }}
                          className="w-6 h-6 flex items-center justify-center rounded text-[#64748B] hover:text-[#DC2626] bg-white/80 backdrop-blur-sm transition-colors"
                        >
                          <Trash2 size={12} />
                        </button>
                      </div>
                    </li>
                  );
                })}
              </ul>
            </div>
          ))}
          {visible.length === 0 && (
            <div className="text-center text-xs text-[#94A3B8] py-10 leading-relaxed">
              发送第一条消息后<br />会话会出现在这里
            </div>
          )}
        </div>

        {/* 底部按钮区（保持，新增 hover 微浮起） */}
        <div className="flex-shrink-0 px-3 py-3 border-t border-[#E2E8F0]
                        bg-[linear-gradient(180deg,transparent,rgba(248,250,252,0.6))]">
          <button
            type="button"
            onClick={() => onCreate()}
            className="w-full flex items-center justify-center gap-2 h-10 rounded-lg
                       bg-gradient-to-b from-[#0EA5E9] to-[#0369A1] text-white text-sm font-semibold
                       ring-1 ring-inset ring-white/15
                       shadow-[0_4px_12px_-4px_rgba(3,105,161,0.5)]
                       hover:from-[#0EA5E9] hover:to-[#082f49]
                       hover:shadow-[0_6px_16px_-4px_rgba(3,105,161,0.55)]
                       hover:-translate-y-[1px]
                       active:scale-[0.98] active:translate-y-0 active:shadow-sm
                       transition-all duration-200 ease-[cubic-bezier(0.16,1,0.3,1)]"
          >
            <Plus size={16} strokeWidth={2.5} />
            <span>新建会话</span>
          </button>
        </div>
      </div>
```

折叠态内容（`{/* 折叠态内容 */}` 整块）**完全不动**。

- [ ] **Step 2：删除原有的「会话列表（按时间降序平铺，空虚拟会话已过滤）」单层 ul（已被分组替换）**

确认替换后，原来的 `<ul className="space-y-0.5">{sorted.map(...)}` 单层渲染应已消失。`sorted` 变量在折叠态 `CollapsedSessionPopover` 中仍可能用到 — 检查文件 line ~242：`<CollapsedSessionPopover sessions={visible}` 用的是 `visible` 不是 `sorted`，故 `sorted` 在新代码里不再被使用。

将 `const sorted = sortSessionsByTime(visible);` 这行**移除**（CLAUDE.md §6.3：删除自身改动产生的冗余）。但 **保留** `sortSessionsByTime` 函数本身，因为它仍被单测 `agent-sidebar-sort.test.ts` 引用、且语义清晰可复用。

- [ ] **Step 3：TS 类型检查 + 已有单测**

Run: `cd frontend && npx tsc --noEmit`
Expected: 无错误。

Run: `cd frontend && npm test -- agent-sidebar`
Expected: PASS — 已有 sort 测试 + 新增 grouping 测试都通过。

- [ ] **Step 4：手动视觉验证**

Run: `cd frontend && npm run dev`，浏览器打开 Agent 工作台。验证：
- 侧栏头部出现 sky 微光晕（左上角）；
- 会话按"今天 / 本周更早 / 更早"分组显示组头；
- active 会话项有渐变 pill 底色 + 左侧 sky 条；
- 鼠标在普通项上 hover：背景变浅灰 + 整项右移 1px；
- 滚动列表时滚动条很细且 sky 着色，不滚动时几乎不可见；
- 新建按钮 hover 时微微上浮。

- [ ] **Step 5：提交**

```bash
git add frontend/src/components/employee/agent/layout/agent-sidebar-drawer.tsx
git commit -m "feat(agent-fe): 侧栏视觉升级（毛玻璃头 + 时间分组 + 渐变 pill active + 隐形滚动条）"
```

---

## Task 4：AgentMessageCard 改为 rail 骨架

**Files:**
- Modify: `frontend/src/components/employee/agent/agent-message-card.tsx`

历史 agent 消息从「外卡 + divide-y」改为「左 rail + 头像锚点 + 段头/段尾」。

- [ ] **Step 1：完全替换 `agent-message-card.tsx` 内容**

```tsx
/**
 * AgentMessageCard：Agent 响应消息（rail 骨架）
 *
 * 设计要点（对话流方案 A）：
 * - 取消"外卡 + divide-y"，整段以左 accent rail + 头像锚点连成一条；
 * - block 之间用 spacing 而非 divider；
 * - 仅业务结果块（interview_questions / evaluation_report）由各自渲染器内
 *   使用 result-card 浮起，作为唯一"突出层"；
 * - StepStrip 不在此渲染（仅流式时由 list 顶部展示）；
 * - 段头：HR · Agent · 模型名（仅有 model_name 时）；
 * - 段尾：token / 时间 元信息小字。
 */

import type { AgentMessage } from '@/types/agent';
import { Sparkles } from 'lucide-react';
import { BlockRenderer } from './blocks/block-renderer';
import { attachReasoning } from './blocks/group-blocks';

export interface AgentMessageCardProps {
  message: AgentMessage;
  /** interaction 提交进行中：禁用提交按钮防重复点击 */
  submitting?: boolean;
  onSubmitInteraction: (requestId: string, values: Record<string, unknown>) => void;
}

export function AgentMessageCard({ message, submitting, onSubmitInteraction }: AgentMessageCardProps) {
  const blocks = attachReasoning(message.content.blocks ?? []);

  // 无 block 的 agent 消息不渲染
  if (blocks.length === 0) return null;

  return (
    <div className="relative pl-11">
      {/* Agent 助手徽标（rail 起点锚点） */}
      <div className="absolute left-0 top-0 flex h-8 w-8 items-center justify-center rounded-xl
                      bg-gradient-to-br from-[#0EA5E9] to-[#0369A1] text-white
                      shadow-[0_4px_10px_-3px_rgba(3,105,161,0.5)]
                      ring-1 ring-inset ring-white/20">
        <Sparkles size={15} className="fill-white/25" strokeWidth={2.2} />
      </div>

      {/* 左 accent rail：sky 渐变垂直线，与流式态用同骨架不同色（流式更亮，由 list 渲染） */}
      <div
        className="relative pl-4 py-1
                   border-l-2 border-transparent
                   [border-image:linear-gradient(180deg,#0EA5E9_0%,#0369A1_60%,transparent_100%)_1]"
      >
        {/* 段头：HR · Agent · 模型名 */}
        <div className="flex items-center gap-2 mb-2 text-[11px] text-[#64748B]">
          <span className="font-semibold text-[#334155]">HR · Agent</span>
          {message.model_name && (
            <>
              <span className="w-[3px] h-[3px] rounded-full bg-[#CBD5E1]" />
              <span className="font-mono">{message.model_name}</span>
            </>
          )}
        </div>

        {/* Blocks：space-y 替代 divide */}
        <div className="space-y-3">
          {blocks.map((block) => (
            <BlockRenderer
              key={block.index}
              block={block}
              submitting={submitting}
              onSubmitInteraction={
                block.type === 'interaction' ? onSubmitInteraction : undefined
              }
            />
          ))}
        </div>

        {/* 段尾元信息：token + 时间 inline 小字 */}
        {(message.token_count != null || message.create_time) && (
          <div className="flex items-center gap-2 mt-3 text-[10.5px] text-[#94A3B8] font-mono">
            {message.token_count != null && <span>{message.token_count} token</span>}
            {message.token_count != null && message.create_time && (
              <span className="w-[3px] h-[3px] rounded-full bg-[#E2E8F0]" />
            )}
            {message.create_time && <span>{message.create_time}</span>}
          </div>
        )}
      </div>
    </div>
  );
}
```

- [ ] **Step 2：移除 `AgentMessageCardProps.runState`（已不在新结构使用）— 检查并修复 `agent-message-list.tsx` 的 `<AgentMessageCard ... runState={null}>` 调用点**

新版 `AgentMessageCardProps` 不再有 `runState` prop。打开 `agent-message-list.tsx` line ~196，修改 `MessageRow` 内的 `<AgentMessageCard>` 调用：

```tsx
  return (
    <AgentMessageCard
      message={message}
      submitting={submitting}
      onSubmitInteraction={onSubmitInteraction}
    />
  );
```

去掉 `runState={null}` 这行。

- [ ] **Step 3：TS 类型检查**

Run: `cd frontend && npx tsc --noEmit`
Expected: 无错误。

如有报错，常见原因是 `AgentRunState` 仍被 `agent-message-card.tsx` 引用 — 应已被新版本完全移除（不再 import）。

- [ ] **Step 4：手动验证**

Run: `cd frontend && npm run dev`。
- 打开任一历史会话，验证：agent 消息没有外框，左侧只有 sky 渐变细线 + 头像；
- 各 block 之间没有 divider，靠 spacing 自然分段；
- 段头显示 "HR · Agent · <模型名>"；
- 段尾显示 "<n> token · <时间>"；
- text/thinking/tool_use 三类块全部"无容器"内联（思考仍是紫色 chip 折叠区，工具调用仍是 chip）。

- [ ] **Step 5：提交**

```bash
git add frontend/src/components/employee/agent/agent-message-card.tsx \
        frontend/src/components/employee/agent/agent-message-list.tsx
git commit -m "feat(agent-fe): AgentMessageCard 改 rail + 头像锚点骨架（去外卡/去 divider）"
```

---

## Task 5：AgentMessageList 流式分支同骨架 + rail-streaming 微动效

**Files:**
- Modify: `frontend/src/components/employee/agent/agent-message-list.tsx`
- Modify: `frontend/src/index.css`（新增 `@keyframes railGlow`）

- [ ] **Step 1：在 `frontend/src/index.css` 末尾追加流式 rail 呼吸光关键帧**

```css

/* ===== 流式 rail 呼吸光（Agent 消息流 A 方案专用） ===== */
@keyframes railGlow {
  0%, 100% { box-shadow: -3px 0 12px -4px rgba(14, 165, 233, 0.35); }
  50%      { box-shadow: -3px 0 16px -3px rgba(14, 165, 233, 0.55); }
}
```

- [ ] **Step 2：替换 `agent-message-list.tsx` 中流式分支的 JSX**

定位 `{/* 流式正在构造的 blocks */}` 块（约 line 73-99），整段替换为：

```tsx
        {/* 流式正在构造的 blocks（与历史 AgentMessageCard 共用 rail 骨架，仅颜色更亮 + 呼吸光） */}
        {runState.running && (
          <div className="relative pl-11 animate-[cardEnter_0.32s_cubic-bezier(0.16,1,0.3,1)]">
            {/* 头像锚点：与历史一致，确保流式 → 历史切换无视觉跳变 */}
            <div className="absolute left-0 top-0 flex h-8 w-8 items-center justify-center rounded-xl
                            bg-gradient-to-br from-[#0EA5E9] to-[#0369A1] text-white
                            shadow-[0_4px_10px_-3px_rgba(3,105,161,0.5)]
                            ring-1 ring-inset ring-white/20">
              <Sparkles size={15} className="fill-white/25" strokeWidth={2.2} />
            </div>

            {/* 流式 rail：更亮的 sky300 → sky → navy 渐变 + 1.6s 呼吸光 */}
            <div
              className="relative pl-4 py-1
                         border-l-2 border-transparent
                         [border-image:linear-gradient(180deg,#7DD3FC_0%,#0EA5E9_50%,#0369A1_100%)_1]
                         animate-[railGlow_1.6s_cubic-bezier(0.4,0,0.6,1)_infinite]
                         motion-reduce:animate-none"
            >
              {/* StepStrip：仅流式时显示在 rail 顶部 */}
              {runState.steps.length > 0 && (
                <div className="mb-2">
                  <StepStrip steps={runState.steps} running={runState.running} />
                </div>
              )}

              {/* 段头：HR · Agent · 流式标识 */}
              <div className="flex items-center gap-2 mb-2 text-[11px] text-[#64748B]">
                <span className="font-semibold text-[#334155]">HR · Agent</span>
                <span className="w-[3px] h-[3px] rounded-full bg-[#CBD5E1]" />
                <span className="text-[#0EA5E9] font-medium animate-pulse">生成中…</span>
              </div>

              {/* Blocks：与历史相同 spacing 节奏 */}
              <div className="space-y-3">
                {attachReasoning(runState.current_blocks).map(b => (
                  <BlockRenderer
                    key={b.index}
                    block={b}
                    submitting={sending}
                    onSubmitInteraction={
                      b.type === 'interaction' ? onSubmitInteraction : undefined
                    }
                  />
                ))}
                {/* fanout 骨架屏：题目正在并行生成 */}
                {showSkeleton && <QuestionSkeleton />}
              </div>
            </div>
          </div>
        )}
```

- [ ] **Step 3：在文件顶部 import 新增 `Sparkles`**

修改 line 9-10 附近的 import：

```tsx
import { AlertCircle, RefreshCw, Sparkles } from 'lucide-react';
```

- [ ] **Step 4：检查并移除原"外层 StepStrip 单独渲染"片段**

原代码 line 76：
```tsx
<StepStrip steps={runState.steps} running={runState.running} />
```
是流式分支整体结构的第一行（不在 rail 内），应已被 Step 2 的整段替换覆盖。确认它不再独立存在于流式分支外层。

`QuestionSkeleton` 函数定义保留（line ~136-151）。

- [ ] **Step 5：TS 类型检查 + 已有单测**

Run: `cd frontend && npx tsc --noEmit`
Expected: 无错误。

Run: `cd frontend && npm test -- agent-stream-handler`
Expected: PASS（流式处理逻辑未动）。

- [ ] **Step 6：手动验证流式 → 历史切换**

Run: `cd frontend && npm run dev`。
- 发起一条新消息；
- 验证流式期间 rail 呈现更亮的渐变（顶部 sky300）+ 缓慢呼吸光（box-shadow 强度 1.6s 起伏）；
- 段头显示 "HR · Agent · 生成中…" 脉冲；
- 流式结束后切换为历史卡，rail 颜色变沉、呼吸光消失，**头像位置不跳**（关键）；
- StepStrip 跟随结束消失。

- [ ] **Step 7：提交**

```bash
git add frontend/src/components/employee/agent/agent-message-list.tsx \
        frontend/src/index.css
git commit -m "feat(agent-fe): 流式分支同 rail 骨架 + 更亮渐变 + 1.6s 呼吸光（railGlow）"
```

---

## Task 6：业务卡内部去 border + result-card 浮起

**Files:**
- Modify: `frontend/src/components/employee/agent/blocks/interview-questions-card.tsx`
- Modify: `frontend/src/components/employee/agent/blocks/evaluation-report-card.tsx`

两个业务卡是新对话流的"唯一突出层"。

- [ ] **Step 1：在 `interview-questions-card.tsx` 中包裹 result-card 外壳，并移除每题的 border**

修改 `InterviewQuestionsCard` 函数返回值，把根元素从 `<div>` 改为带 result-card class 的容器；并修改题目项的 className。

定位 `return (` 块（约 line 52-133），整段替换为：

```tsx
  return (
    <div className="
      relative bg-white rounded-2xl px-4 py-3.5
      shadow-[0_1px_3px_rgba(2,6,23,0.05),0_12px_32px_-12px_rgba(3,105,161,0.14)]
      before:content-[''] before:absolute before:inset-0 before:rounded-2xl
      before:p-px before:pointer-events-none
      before:[background:linear-gradient(135deg,rgba(14,165,233,0.45),rgba(3,105,161,0.18)_50%,rgba(226,232,240,0.6))]
      before:[mask:linear-gradient(#000_0_0)_content-box,linear-gradient(#000_0_0)]
      before:[mask-composite:xor] before:[-webkit-mask-composite:xor]
    ">
      {/* 浮起卡头小字 label */}
      <div className="text-[10px] font-bold uppercase tracking-[0.12em] text-[#0369A1] mb-2">
        Interview Questions
      </div>

      {/* 头部统计条 */}
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 mb-3">
        <div className="flex items-baseline gap-1">
          <span className="text-2xl font-bold text-[#020617]">{questions.length}</span>
          <span className="text-xs text-[#64748B]">道题</span>
        </div>
        <div className="flex items-baseline gap-1">
          <span className="text-lg font-semibold text-[#0369A1]">{dimensions.length}</span>
          <span className="text-xs text-[#64748B]">个维度</span>
        </div>
        {/* 难度分布 chip */}
        <div className="flex items-center gap-1.5">
          {Object.entries(difficultyCount).map(([d, n]) => (
            <span
              key={d}
              className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[11px] font-medium ${DIFFICULTY_COLORS[d] ?? 'bg-[#F1F5F9] text-[#64748B]'}`}
            >
              {d} {n}
            </span>
          ))}
        </div>
        {status === 'streaming' && (
          <span className="text-xs text-[#0EA5E9] animate-pulse">生成中…</span>
        )}
      </div>

      {/* 题目列表（去 border，hover 显浅底，左侧 expanded 时高亮 accent） */}
      <div className="space-y-0.5">
        {questions.map((q: QuestionItem, i: number) => {
          const isExpanded = expandedQ.has(i);
          return (
            <div
              key={i}
              className={`relative rounded-lg transition-colors duration-200 ease-[cubic-bezier(0.16,1,0.3,1)]
                          ${isExpanded ? 'bg-[#F8FAFC]' : 'hover:bg-[#F8FAFC]'}`}
            >
              {/* 左侧 accent 条：默认透明，hover/expanded 时显示 sky 渐变 */}
              <span
                className={`absolute left-0 top-2 bottom-2 w-[2px] rounded-r-full transition-opacity duration-200
                            bg-gradient-to-b from-[#0EA5E9] to-[#0369A1]
                            ${isExpanded ? 'opacity-100' : 'opacity-0 group-hover:opacity-60'}`}
              />
              {/* 题目标题行 */}
              <button
                type="button"
                className="flex items-start gap-2 w-full text-left px-3 py-2"
                onClick={() => toggleQ(i)}
              >
                <span className="text-[#94A3B8] text-xs font-mono mt-0.5 shrink-0">{i + 1}.</span>
                <span className="flex-1 text-sm text-[#020617] leading-relaxed">{q.question}</span>
                <span className={`shrink-0 text-[11px] px-1.5 py-0.5 rounded font-medium ${DIFFICULTY_COLORS[q.difficulty] ?? 'bg-[#F1F5F9] text-[#64748B]'}`}>
                  {q.difficulty}
                </span>
                <svg
                  className={`w-4 h-4 text-[#94A3B8] transition-transform duration-150 mt-0.5 shrink-0 ${isExpanded ? 'rotate-180' : ''}`}
                  fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}
                >
                  <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
                </svg>
              </button>

              {/* 展开详情（保留原结构：维度 / 评估要点 / 参考答案） */}
              {isExpanded && (
                <div className="px-3 pb-2.5 ml-5 space-y-2 text-xs">
                  <p className="text-[#64748B]">
                    <span className="font-medium text-[#334155]">维度：</span>{q.dimension}
                  </p>
                  {q.evaluation_points?.length > 0 && (
                    <div>
                      <span className="font-medium text-[#334155]">评估要点：</span>
                      <ul className="list-disc ml-4 mt-1 text-[#64748B] space-y-0.5">
                        {q.evaluation_points.map((p, j) => <li key={j}>{p}</li>)}
                      </ul>
                    </div>
                  )}
                  {q.reference_answer && (
                    <div className="mt-2 rounded-md bg-[#F8FAFC] border border-[#E2E8F0] px-3 py-2">
                      <p className="text-[11px] text-[#D97706] font-semibold mb-1">参考答案（仅供参考）</p>
                      <p className="text-[#475569] whitespace-pre-wrap">{q.reference_answer}</p>
                    </div>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>
      {reasoning !== undefined && <ReasoningSection reasoning={reasoning} />}
    </div>
  );
}
```

- [ ] **Step 2：在 `evaluation-report-card.tsx` 中包裹 result-card 外壳并改"综合评语"区**

定位 `return (` 块（约 line 89-198），整段替换为：

```tsx
  return (
    <div className="
      relative bg-white rounded-2xl px-4 py-3.5
      shadow-[0_1px_3px_rgba(2,6,23,0.05),0_12px_32px_-12px_rgba(3,105,161,0.14)]
      before:content-[''] before:absolute before:inset-0 before:rounded-2xl
      before:p-px before:pointer-events-none
      before:[background:linear-gradient(135deg,rgba(14,165,233,0.45),rgba(3,105,161,0.18)_50%,rgba(226,232,240,0.6))]
      before:[mask:linear-gradient(#000_0_0)_content-box,linear-gradient(#000_0_0)]
      before:[mask-composite:xor] before:[-webkit-mask-composite:xor]
    ">
      {/* 浮起卡头小字 label */}
      <div className="text-[10px] font-bold uppercase tracking-[0.12em] text-[#0369A1] mb-2">
        Resume Evaluation
      </div>

      {/* 头部：分数环 + 决策 */}
      <div className="flex items-center gap-4 mb-3">
        <ScoreRing score={final_score} color={color} />
        <div className="flex-1 min-w-0">
          <h3 className="text-base font-semibold text-[#020617]">简历评估报告</h3>
          {final_label && <p className="text-sm text-[#64748B] mt-0.5">{final_label}</p>}
          {decision && (
            <span className={`inline-block mt-1.5 px-2.5 py-0.5 rounded-md border text-xs font-medium ${decisionStyle}`}>
              {decision}
            </span>
          )}
        </div>
      </div>

      {summary && <p className="text-sm text-[#64748B] leading-relaxed mb-3">{summary}</p>}

      {/* 候选人画像摘要（始终可见） */}
      {profile_summary && (
        <div className="flex flex-wrap items-center gap-2 mb-3 text-xs">
          {profile_summary.years != null && (
            <span className="px-2 py-0.5 rounded-md bg-[#F1F5F9] text-[#334155]">{profile_summary.years} 年经验</span>
          )}
          {profile_summary.education && (
            <span className="px-2 py-0.5 rounded-md bg-[#F1F5F9] text-[#334155]">{profile_summary.education}</span>
          )}
          {profile_summary.stack && profile_summary.stack.length > 0 && (
            <span className="px-2 py-0.5 rounded-md bg-[#E0F2FE] text-[#0369A1]">
              {profile_summary.stack.join(' / ')}
            </span>
          )}
          {profile_summary.stability && (
            <span className="px-2 py-0.5 rounded-md bg-[#F1F5F9] text-[#64748B]">{profile_summary.stability}</span>
          )}
        </div>
      )}

      {/* 详细面板折叠 */}
      <button
        type="button"
        className="w-full px-3 py-1.5 text-xs text-[#0369A1] font-medium text-left
                   hover:bg-[#F1F5F9] rounded-md transition-colors"
        onClick={() => setShowDetail(s => !s)}
      >
        {showDetail ? '收起详情 ↑' : '展开详情 ↓'}
      </button>

      {showDetail && (
        <div className="mt-2 space-y-4 text-sm">
          {/* 技能维度条形 */}
          {report.skill_dimensions?.length > 0 && (
            <section>
              <h4 className="font-medium text-[#020617] mb-2 text-sm">技能维度</h4>
              <div className="space-y-1.5">
                {report.skill_dimensions.map((dim: Record<string, unknown>, i: number) => (
                  <DimensionBar
                    key={i}
                    name={String(dim.dimension_name ?? dim.name ?? `维度${i + 1}`)}
                    score={Number(dim.score ?? 0)}
                  />
                ))}
              </div>
            </section>
          )}

          {/* 岗位差距 */}
          {report.job_gaps?.length > 0 && (
            <section>
              <h4 className="font-medium text-[#020617] mb-2 text-sm">岗位差距</h4>
              <ul className="list-disc ml-4 text-[#64748B] space-y-0.5 text-xs">
                {report.job_gaps.map((gap: Record<string, unknown>, i: number) => (
                  <li key={i}>{String(gap.description ?? gap.gap ?? JSON.stringify(gap))}</li>
                ))}
              </ul>
            </section>
          )}

          {/* 面试建议 */}
          {interview_suggestions && interview_suggestions.length > 0 && (
            <section>
              <h4 className="font-medium text-[#020617] mb-2 text-sm">面试重点考察</h4>
              <ul className="space-y-1 text-xs">
                {interview_suggestions.map((s, i) => (
                  <li key={i} className="text-[#475569]">
                    <span className="font-medium text-[#334155]">{s.focus}</span>
                    {s.reason && <span className="text-[#94A3B8]"> — {s.reason}</span>}
                  </li>
                ))}
              </ul>
            </section>
          )}

          {/* 综合评语：去 border，改为左 accent 条 callout 浅渐变底 */}
          {comprehensive_comment && (comprehensive_comment.advantages || comprehensive_comment.risks) && (
            <section
              className="relative pl-3 py-2
                         bg-gradient-to-r from-[#F8FAFC] via-[#F8FAFC]/70 to-transparent
                         rounded-r-md"
            >
              <span className="absolute left-0 top-1.5 bottom-1.5 w-[2.5px] rounded-r-full bg-gradient-to-b from-[#0EA5E9] to-[#0369A1]" />
              {comprehensive_comment.advantages && (
                <p className="text-xs text-[#16A34A]"><span className="font-medium">优势：</span>{comprehensive_comment.advantages}</p>
              )}
              {comprehensive_comment.risks && (
                <p className="text-xs text-[#D97706] mt-1"><span className="font-medium">风险：</span>{comprehensive_comment.risks}</p>
              )}
            </section>
          )}
        </div>
      )}
      {reasoning !== undefined && <ReasoningSection reasoning={reasoning} />}
    </div>
  );
}
```

- [ ] **Step 3：TS 类型检查**

Run: `cd frontend && npx tsc --noEmit`
Expected: 无错误。

- [ ] **Step 4：手动验证**

Run: `cd frontend && npm run dev`。
- 找一条历史评估消息，验证：评估报告卡浮起感更明显（带 sky→subtle 渐变描边 + tinted 阴影），与 rail 主体形成"突出层"对比；
- 综合评语区不再有 border + 灰底，而是左侧 sky accent 条 + 浅渐变底；
- 面试题集合卡同样浮起，每题之间没有 border，hover 时左侧出现淡 sky 条；
- 卡顶部出现 `INTERVIEW QUESTIONS` / `RESUME EVALUATION` 极小字 label。

- [ ] **Step 5：提交**

```bash
git add frontend/src/components/employee/agent/blocks/interview-questions-card.tsx \
        frontend/src/components/employee/agent/blocks/evaluation-report-card.tsx
git commit -m "feat(agent-fe): 业务卡浮起化（result-card 渐变描边 + 综合评语去 border）"
```

---

## Task 7：联调验证 + 已有测试全量回归

**Files:** 无修改，仅验证。

- [ ] **Step 1：跑前端全量单测**

Run: `cd frontend && npm test`
Expected: PASS — 所有现有测试 + 新增 grouping 测试通过。

如有失败：
- `agent-workspace.test.tsx`、`plan-review-tree.test.tsx` 不应受本次改动影响（不依赖 message-card / sidebar UI 结构）；
- 若失败，回到对应任务排查回归。

- [ ] **Step 2：TS 严格类型检查**

Run: `cd frontend && npx tsc --noEmit`
Expected: 无错误。

- [ ] **Step 3：完整对话端到端手测**

Run: `cd frontend && npm run dev`，浏览器登录后台 → Agent 工作台。验证清单：

**侧栏：**
- [ ] 滚动条 6px 隐形，hover 显形 sky 着色；
- [ ] 时间分组组头出现（拥有今天 + 本周 + 更早会话才能看到 3 个）；
- [ ] active 项渐变 pill + 左 accent 条；
- [ ] 普通项 hover 微右移；
- [ ] 搜索图标按钮、收起、新建会话功能保留；
- [ ] 重命名、删除弹窗保留可用；
- [ ] 折叠态（点 PanelLeftClose）保留原视觉与功能。

**消息流：**
- [ ] 用户气泡保留蓝渐变；
- [ ] agent 历史消息无外卡，左 sky 渐变 rail + 头像；
- [ ] 段头显示 "HR · Agent · <模型名>"；
- [ ] 段尾显示 "<n> token · <时间>"；
- [ ] block 之间 spacing 自然，无 divider；
- [ ] 思考过程 chip 折叠区可点开；
- [ ] 工具调用 chip 状态正常（运行/成功/失败 + 题数）；
- [ ] interaction 表单提交保留卡边界，按钮禁用态正常；
- [ ] 评估报告 / 面试题集合是浮起卡（描边 + 阴影），唯一"突出层"。

**流式 → 历史切换：**
- [ ] 发起一条新消息；
- [ ] 流式 rail 颜色更亮 + 1.6s 呼吸光；
- [ ] 段头显示 "生成中…" 脉冲；
- [ ] StepStrip 展示在 rail 顶部，跟随 step 变化；
- [ ] 流式结束后 rail 颜色变沉，呼吸光消失，头像位置不跳；
- [ ] 错误重试 callout（如能触发）保留独立红色边界。

**全局滚动条：**
- [ ] 切到任一管理后台界面（如简历列表），确认滚动条变 sky 风格但没有破坏现有布局；
- [ ] 弹窗内的滚动条同样 sky 风格。

- [ ] **Step 4：构建无错**

Run: `cd frontend && npm run build`
Expected: 构建成功。

- [ ] **Step 5：提交（如本任务无 diff，跳过）**

如果手测中发现细节微调，单独提一笔：`fix(agent-fe): 联调微调 ...`。

---

## 合并回 dev 分支（实施完成后由人工触发）

```bash
# 在主 checkout 内（不是 worktree）
cd D:/code/py/project/resume
git checkout dev
git merge --no-ff worktree-agent-ui-flow-sidebar -m "merge: agent 工作台对话流连续性 + 侧栏视觉升级"
```

---

## 自检（plan 内嵌）

### Spec 覆盖

| Spec 节 | 实现任务 | 状态 |
|---|---|---|
| §4.1 AgentMessageCard 改 rail | T4 | ✓ |
| §4.2 流式分支同骨架 + 微动效 | T5 | ✓ |
| §4.3 InterviewQuestionsCard 浮起 | T6 | ✓ |
| §4.4 EvaluationReportCard 浮起 | T6 | ✓ |
| §4.5 result-card inline class | T6（两处独立 inline） | ✓ |
| §4.6 侧栏 UI（毛玻璃 / 分组 / 渐变 pill） | T2、T3 | ✓ |
| §4.7 全局滚动条 | T1 | ✓ |
| §5 保留功能验收 | T7 手测清单 | ✓ |
| §7.1 单测（groupSessionsByTime） | T2 | ✓ |
| §7.2 视觉验证 | T7 | ✓ |

### Placeholder 扫描

无 TBD / TODO / "实现细节后补"。每一步包含完整代码或 diff 描述。

### 类型一致性

- `groupSessionsByTime` 在 T2 定义，T3 使用 → 签名一致。
- `SessionGroup.key` 与 `label` 在 T2 单测和 T3 渲染保持同名同字面量。
- `AgentMessageCardProps` 在 T4 定义（去掉 `runState`），T4 同步修改 `agent-message-list.tsx` 调用点 → 一致。
- `Sparkles` 在 T5 import 列表新增 → 与 T4 已 import 的 `Sparkles` 在 `agent-message-card.tsx` 是不同文件，互不冲突。

### 已识别细节

- T6 中 `evaluation-report-card.tsx` 的 `comprehensive_comment` 区原本是 `rounded-md bg-[#F8FAFC] border` 容器，新版改为左 accent 条 callout — 已用完整代码替换，无遗漏。
- T3 删除 `const sorted = ...` 这行属"自身改动产生的冗余清理"（CLAUDE.md §6.3），保留函数本身（仍被 sort 单测引用）。

---

**计划完成。**
