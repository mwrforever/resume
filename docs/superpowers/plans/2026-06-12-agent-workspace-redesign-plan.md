# Agent 工作台 UI 重新设计 — 实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将 Agent 工作台从简陋三栏升级为沉浸式新 Tab + 抽屉式侧栏 + 专业蓝色视觉体系

**Architecture:** 新增 `layout/` 子目录存放布局级组件（TopBar、DrawerSidebar、StandaloneLayout），将状态上提到 `AgentStandaloneLayout`；`agent-workspace.tsx` 瘦身后只管理消息；block 渲染合入`AgentMessageCard` 一张大卡；Composer 改为浮卡式。

**Tech Stack:** React 19 + TypeScript + Tailwind CSS + Lucide React + Zustand (仅 auth)

**前置设计文档:** `docs/superpowers/specs/2026-06-12-agent-workspace-redesign-design.md`

---

## 数据流变化

```
当前: page → AgentWorkspace(持有 sessions/activeId + messages)
                                      ↓
改造后: page → AgentStandaloneLayout(持有 sessions/activeId)
                  ├─ AgentTopbar           ← activeSession.title
                  ├─ AgentSidebarDrawer    ← sessions/activeId/onSelect/onCreate/onSearch
                  └─ AgentWorkspace(sessionId)   ← 只接收 activeId，瘦身
                       ├─ EmptyState / AgentMessageList
                       ├─ AgentMessageCard + blocks
                       └─ AgentComposer
```

---

### Task 1: 创建 Design Tokens + 字体加载

**Files:**
- Create: `frontend/src/components/employee/agent/design/agent-tokens.ts`
- Create: `frontend/src/components/employee/agent/design/index.ts` (re-export)
- Modify: `frontend/index.html` (加 Plus Jakarta Sans 字体)

- [ ] **Step 1: 创建 agent-tokens.ts**

```ts
/**
 * Agent 工作台设计 Token
 *
 * 仅 Agent 工作台使用，不污染全局 CSS。
 * 颜色值与现有主侧栏（深空蓝渐变）品牌一致。
 */

export const agentColors = {
  brand: {
    navy:    '#0F172A',
    navy2:   '#082F49',
    ink:     '#020617',
    sky:     '#0369A1',
    sky2:    '#0EA5E9',
    skyTint: '#E0F2FE',
  },
  surface: {
    app:     '#F8FAFC',
    card:    '#FFFFFF',
    raised:  '#FFFFFF',
    hover:   '#F1F5F9',
    muted:   '#E8ECF1',
  },
  text: {
    primary:      '#020617',
    secondary:    '#334155',
    tertiary:     '#64748B',
    disabled:     '#94A3B8',
    onBrand:      '#FFFFFF',
    onBrandMuted: 'rgba(255,255,255,0.7)',
  },
  semantic: {
    success:  '#16A34A', successBg:  '#DCFCE7',
    warning:  '#D97706', warningBg:  '#FEF3C7',
    danger:   '#DC2626', dangerBg:   '#FEE2E2',
    info:     '#0369A1', infoBg:     '#E0F2FE',
    thinking: '#7C3AED', thinkingBg: '#F3E8FF',
  },
  border: {
    subtle:  '#E2E8F0',
    default: '#CBD5E1',
    strong:  '#94A3B8',
    focus:   '#0EA5E9',
  },
} as const;

export const agentTypography = {
  fontFamily: "'Plus Jakarta Sans', -apple-system, 'PingFang SC', sans-serif",
  fontSize:   { xs: 12, sm: 13, base: 14, md: 15, lg: 16, xl: 18, '2xl': 22, '3xl': 28 },
  lineHeight: { tight: 1.3, normal: 1.5, relaxed: 1.7 },
  fontWeight: { regular: 400, medium: 500, semibold: 600, bold: 700 },
} as const;

export const agentRadius = { sm: 6, md: 10, lg: 14, xl: 18, '2xl': 22, full: 9999 } as const;

export const agentShadow = {
  sm:   '0 1px 2px rgba(15,23,42,0.06)',
  md:   '0 4px 12px rgba(15,23,42,0.08)',
  lg:   '0 8px 24px rgba(15,23,42,0.10)',
  xl:   '0 16px 40px rgba(15,23,42,0.14)',
  ring: '0 0 0 3px rgba(14,165,233,0.25)',
} as const;

export const agentMotion = {
  duration: { fast: 150, normal: 220, slow: 320 } as const,
  easing:   {
    standard:   'cubic-bezier(0.2, 0, 0, 1)',
    emphasized: 'cubic-bezier(0.3, 0, 0, 1.2)',
  } as const,
};
```

- [ ] **Step 2: 创建 design/index.ts re-export**

```ts
export * from './agent-tokens';
```

- [ ] **Step 3: 修改 index.html，添加 Plus Jakarta Sans 字体**

在 `frontend/index.html` 的 `<head>` 内添加：

```html
<link rel="preconnect" href="https://fonts.googleapis.com" />
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
<link href="https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@400;500;600;700&display=swap" rel="stylesheet" />
```

- [ ] **Step 4: 验证**

```bash
cd frontend && npx tsc --noEmit
```

Expected: no type errors

- [ ] **Step 5: Commit**

```bash
git add frontend/src/components/employee/agent/design/ frontend/index.html
git commit -m "feat(agent): add design tokens for Agent workspace redesign

新增 agent-tokens.ts（颜色/字体/间距/阴影/动效 token）
新增 index.ts re-export
加载 Plus Jakarta Sans 字体"
```

---

### Task 2: 创建 TopBar 顶部品牌栏

**Files:**
- Create: `frontend/src/components/employee/agent/layout/agent-topbar.tsx`

- [ ] **Step 1: 创建 `agent-topbar.tsx`**

```tsx
/**
 * AgentTopbar：顶部品牌栏
 *
 * 深空蓝渐变背景，左 Logo+品牌名，中会话标题，右返回后台+用户头像。
 * 返回后台用 _top 确保新 Tab 场景能跳回主 SPA。
 */

import { ArrowLeft, Bot } from 'lucide-react';
import type { WorkspaceSession } from '@/types/agent';

export interface AgentTopbarProps {
  session?: WorkspaceSession | null;
  userName?: string;
}

export function AgentTopbar({ session, userName = 'HR' }: AgentTopbarProps) {
  const nameAbbr = userName.slice(0, 2).toUpperCase();

  return (
    <header
      className="h-14 flex-shrink-0 flex items-center justify-between px-4
                 bg-gradient-to-r from-[#082f49] to-[#0f172a]
                 border-b border-white/10 shadow-sm"
    >
      {/* 左：Logo + 品牌名 */}
      <div className="flex items-center gap-3 min-w-0">
        <div className="flex h-8 w-8 flex-shrink-0 items-center justify-center
                        rounded-xl bg-sky-400 text-xs font-bold text-slate-950
                        shadow-lg shadow-sky-500/20">
          A
        </div>
        <span className="text-sm font-semibold text-white whitespace-nowrap">
          HR·Agent
        </span>
      </div>

      {/* 中：当前会话标题（< 768px 隐藏） */}
      {session?.title && (
        <div className="hidden md:flex items-center gap-2 text-xs text-white/70 truncate max-w-[40%]">
          <span className="w-1 h-1 rounded-full bg-white/30" />
          <span className="truncate">{session.title}</span>
        </div>
      )}

      {/* 右：返回后台 + 用户头像 */}
      <div className="flex items-center gap-3">
        <a
          href="/employee/dashboard"
          target="_top"
          className="hidden sm:inline-flex items-center gap-1.5 h-8 px-3 rounded-lg
                     text-xs text-white/70 hover:text-white hover:bg-white/10 transition-colors"
        >
          <ArrowLeft size={14} />
          <span>返回后台</span>
        </a>
        <div className="flex h-8 w-8 flex-shrink-0 items-center justify-center
                        rounded-full bg-slate-500/30 text-xs font-semibold text-white/90
                        border border-white/10"
             title={userName}>
          {nameAbbr}
        </div>
      </div>
    </header>
  );
}
```

- [ ] **Step 2: 验证**

```bash
cd frontend && npx tsc --noEmit
```

Expected: no type errors

- [ ] **Step 3: Commit**

```bash
git add frontend/src/components/employee/agent/layout/agent-topbar.tsx
git commit -m "feat(agent): add AgentTopbar component

深空蓝渐变品牌栏，左 Logo+HR·Agent 品牌名、
中会话标题、右返回后台链接与用户头像"
```

---

### Task 3: 创建 Drawer Sidebar（抽屉式侧栏）

**Files:**
- Create: `frontend/src/components/employee/agent/layout/agent-sidebar-drawer.tsx`
- Delete: `frontend/src/components/employee/agent/agent-session-sidebar.tsx`

- [ ] **Step 1: 创建 `agent-sidebar-drawer.tsx`**

```tsx
/**
 * AgentSidebarDrawer：抽屉式会话侧栏
 *
 * 折叠态 64px（仅 Bot 图标 + 未读红点）
 * hover/click 展开 280px overlay（会话按今天/昨天/本周/更早分组）
 * 鼠标离开 2s 后自动收回，图钉可固定展开。
 */

import { useState, useRef, useEffect, useCallback } from 'react';
import {
  Bot, Plus, Search, Pin, PinOff, Settings,
} from 'lucide-react';
import type { WorkspaceSession } from '@/types/agent';

export interface AgentSidebarDrawerProps {
  sessions: WorkspaceSession[];
  activeId: number | null;
  onSelect: (id: number) => void;
  onCreate: () => void;
  onSearch: (keyword: string) => void;
}

/** 按时间分组 */
type GroupKey = 'today' | 'yesterday' | 'this-week' | 'earlier';
const GROUP_LABELS: Record<GroupKey, string> = {
  today: '今天',
  yesterday: '昨天',
  'this-week': '本周更早',
  earlier: '更早',
};

function groupSessions(sessions: WorkspaceSession[]): Array<{ key: GroupKey; items: WorkspaceSession[] }> {
  const now = new Date();
  const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const yesterdayStart = new Date(todayStart.getTime() - 86400000);
  // 本周一：如果今天是周日(0)则回退到上周一
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

  return (['today', 'yesterday', 'this-week', 'earlier'] as GroupKey[])
    .filter(k => groups[k].length > 0)
    .map(key => ({ key, items: groups[key] }));
}

export function AgentSidebarDrawer({
  sessions, activeId, onSelect, onCreate, onSearch,
}: AgentSidebarDrawerProps) {
  const [pinned, setPinned] = useState(false);
  const [hovered, setHovered] = useState(false);
  const [keyword, setKeyword] = useState('');
  const leaveTimer = useRef<ReturnType<typeof setTimeout>>();
  const sidebarRef = useRef<HTMLDivElement>(null);
  const expanded = pinned || hovered;

  const clearLeaveTimer = () => { if (leaveTimer.current) clearTimeout(leaveTimer.current); };

  const handleMouseLeave = useCallback(() => {
    if (pinned) return;
    clearLeaveTimer();
    leaveTimer.current = setTimeout(() => setHovered(false), 2000);
  }, [pinned]);

  // 清理 timer
  useEffect(() => () => clearLeaveTimer(), []);

  const grouped = groupSessions(sessions);

  return (
    <nav
      ref={sidebarRef}
      onMouseEnter={() => { clearLeaveTimer(); setHovered(true); }}
      onMouseLeave={handleMouseLeave}
      className={`relative flex-shrink-0 bg-white border-r border-[#E2E8F0]
                  transition-[width] duration-220 ease-[cubic-bezier(0.2,0,0,1)]
                  ${expanded ? 'w-[280px]' : 'w-[64px]'}
                  overflow-hidden z-30`}
      style={{ boxShadow: expanded ? '4px 0 24px rgba(15,23,42,0.08)' : undefined }}
    >
      {/* 展开态内容 */}
      <div className={`h-full flex flex-col ${expanded ? 'opacity-100' : 'opacity-0 pointer-events-none'} transition-opacity duration-150`}>
        {/* 搜索行 */}
        <div className="relative px-3 pt-3 pb-2">
          <div className="relative">
            <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-[#64748B]" />
            <input
              value={keyword}
              onChange={e => { setKeyword(e.target.value); onSearch(e.target.value); }}
              placeholder="搜索会话"
              className="w-full h-9 pl-9 pr-3 rounded-lg border border-[#E2E8F0]
                         text-sm text-[#020617] placeholder:text-[#94A3B8]
                         focus:outline-none focus:ring-2 focus:ring-[#0EA5E9] focus:border-transparent
                         bg-[#F8FAFC]"
            />
          </div>
        </div>

        {/* 会话分组列表 */}
        <div className="flex-1 overflow-y-auto px-2 pb-2 space-y-4">
          {grouped.map(group => (
            <div key={group.key}>
              <div className="px-3 pb-1 text-xs font-semibold uppercase tracking-wider text-[#64748B]">
                {GROUP_LABELS[group.key]}
              </div>
              <ul className="space-y-0.5">
                {group.items.map(s => {
                  const isActive = s.id === activeId;
                  return (
                    <li key={s.id}>
                      <button
                        type="button"
                        onClick={() => { onSelect(s.id); if (!pinned) setHovered(false); }}
                        className={`w-full flex items-center gap-3 px-3 py-2 rounded-lg text-left
                                    transition-colors duration-150
                                    ${isActive
                                      ? 'bg-[#E0F2FE] text-[#020617] font-medium'
                                      : 'text-[#334155] hover:bg-[#F1F5F9]'
                                    }`}
                      >
                        <Bot size={16} className={`flex-shrink-0 ${isActive ? 'text-[#0369A1]' : 'text-[#64748B]'}`} />
                        <span className="truncate text-sm flex-1">{s.title || '未命名会话'}</span>
                      </button>
                    </li>
                  );
                })}
              </ul>
            </div>
          ))}
          {sessions.length === 0 && (
            <div className="text-center text-sm text-[#94A3B8] py-8">暂无会话</div>
          )}
        </div>

        {/* 底部按钮区 */}
        <div className="flex-shrink-0 px-3 py-3 border-t border-[#E2E8F0] space-y-2">
          <button
            type="button"
            onClick={() => { onCreate(); }}
            className="w-full flex items-center justify-center gap-2 h-10 rounded-lg
                       bg-[#0369A1] text-white text-sm font-medium
                       hover:bg-[#0EA5E9] transition-colors duration-150"
          >
            <Plus size={16} />
            <span>新建会话</span>
          </button>
          <div className="flex items-center justify-between">
            <button
              type="button" onClick={() => setPinned(v => !v)}
              className="h-8 px-2 rounded-md text-xs text-[#64748B] hover:text-[#020617] hover:bg-[#F1F5F9] transition-colors"
              title={pinned ? '取消固定' : '固定侧栏'}
            >
              {pinned ? <PinOff size={14} /> : <Pin size={14} />}
            </button>
            <span className="text-xs text-[#94A3B8]">设置</span>
          </div>
        </div>
      </div>

      {/* 折叠态内容（极简图标列） */}
      <div className={`absolute inset-0 flex flex-col items-center py-3 gap-2
                       ${expanded ? 'opacity-0 pointer-events-none' : 'opacity-100'}
                       transition-opacity duration-150`}>
        {/* 搜索 */}
        <button type="button" title="搜索"
                className="w-9 h-9 flex items-center justify-center rounded-lg
                           text-[#64748B] hover:bg-[#F1F5F9] transition-colors">
          <Search size={16} />
        </button>

        {/* 会话图标列表 */}
        <div className="flex-1 overflow-y-auto flex flex-col items-center gap-1 px-2">
          {sessions.slice(0, 20).map(s => (
            <button
              key={s.id}
              type="button"
              onClick={() => onSelect(s.id)}
              title={s.title || '未命名会话'}
              className={`relative w-9 h-9 flex items-center justify-center rounded-lg transition-colors
                          ${s.id === activeId
                            ? 'bg-[#E0F2FE] text-[#0369A1]'
                            : 'text-[#64748B] hover:bg-[#F1F5F9]'}`}
            >
              <Bot size={16} />
            </button>
          ))}
        </div>

        {/* 新建会话 FAB */}
        <button type="button" onClick={() => { onCreate(); }} title="新建会话"
                className="w-9 h-9 flex items-center justify-center rounded-full
                           bg-[#16A34A] text-white hover:bg-[#15803D] shadow-sm transition-colors">
          <Plus size={16} />
        </button>

        {/* 设置入口 */}
        <button type="button" title="设置"
                className="w-9 h-9 flex items-center justify-center rounded-lg
                           text-[#64748B] hover:bg-[#F1F5F9] transition-colors">
          <Settings size={16} />
        </button>
      </div>
    </nav>
  );
}
```

- [ ] **Step 2: 验证**

```bash
cd frontend && npx tsc --noEmit
```

Expected: no type errors

- [ ] **Step 3: 删除旧 sidebar**

```bash
rm -f frontend/src/components/employee/agent/agent-session-sidebar.tsx
```

- [ ] **Step 4: Commit**

```bash
git add frontend/src/components/employee/agent/layout/agent-sidebar-drawer.tsx
git rm frontend/src/components/employee/agent/agent-session-sidebar.tsx
git commit -m "feat(agent): add AgentSidebarDrawer (drawer-style session sidebar)

64px 折叠态仅显示 Bot 图标列与未读点，
hover/click 展开 280px overlay 显示分组会话列表，
支持搜索、固定/展开、新建会话 FAB。
删除旧的 agent-session-sidebar.tsx"
```

---

### Task 4: 创建 Standalone Layout + 重构 agent-workspace.tsx

**Files:**
- Create: `frontend/src/components/employee/agent/layout/agent-standalone-layout.tsx`
- Modify: `frontend/src/components/employee/agent/agent-workspace.tsx`
- Modify: `frontend/src/pages/employee/agent.tsx`

- [ ] **Step 1: 创建 `agent-standalone-layout.tsx`**

此组件将 session 管理从 workspace 上提到 layout 层，组件树为：

```tsx
<AgentStandaloneLayout>
  <AgentTopbar session={activeSession} />
  <div class="flex flex-1 overflow-hidden">
    <AgentSidebarDrawer ... />
    <AgentWorkspace sessionId={activeId} ... />
  </div>
</AgentStandaloneLayout>
```

```tsx
/**
 * AgentStandaloneLayout：独立布局容器
 *
 * 状态管理：会话列表、激活 ID、关键词由本层保持。
 * 负责与 employeeAgentApi 通信拉取/创建会话。
 * 通过 props 向下分发给 TopBar / Sidebar / Workspace。
 */

import { useCallback, useEffect, useState } from 'react';
import { AgentTopbar } from './agent-topbar';
import { AgentSidebarDrawer } from './agent-sidebar-drawer';
import { AgentWorkspace } from '../agent-workspace';
import { employeeAgentApi } from '@/api/employee/agent';
import type { WorkspaceSession } from '@/types/agent';

export function AgentStandaloneLayout() {
  const [sessions, setSessions] = useState<WorkspaceSession[]>([]);
  const [activeId, setActiveId] = useState<number | null>(null);
  const [keyword, setKeyword] = useState('');

  const activeSession = sessions.find(s => s.id === activeId) ?? null;

  const refreshSessions = useCallback(async () => {
    const resp = await employeeAgentApi.listSessions({
      page: 1, page_size: 50, keyword: keyword || undefined,
    });
    const data = resp.data?.data ?? resp.data;
    const items = (data?.items ?? []) as WorkspaceSession[];
    setSessions(items);
    if (activeId === null && items.length) setActiveId(items[0].id);
  }, [keyword, activeId]);

  useEffect(() => { void refreshSessions(); }, [refreshSessions]);

  const onCreate = async () => {
    const resp = await employeeAgentApi.createSession({ title: undefined });
    const s = (resp.data?.data ?? resp.data) as WorkspaceSession;
    setSessions(prev => [s, ...prev]);
    setActiveId(s.id);
  };

  // Tab 标题
  useEffect(() => {
    document.title = activeSession?.title
      ? `${activeSession.title} · HR·Agent`
      : 'HR·Agent';
  }, [activeSession]);

  return (
    <div className="h-screen flex flex-col bg-[#F8FAFC] font-['Plus_Jakarta_Sans',system-ui,sans-serif]">
      <AgentTopbar session={activeSession} />
      <div className="flex flex-1 overflow-hidden">
        <AgentSidebarDrawer
          sessions={sessions}
          activeId={activeId}
          onSelect={setActiveId}
          onCreate={() => void onCreate()}
          onSearch={setKeyword}
        />
        <AgentWorkspace
          sessionId={activeId}
          onSessionUpdate={(next) => {
            setSessions(prev => prev.map(s => s.id === next.id ? next : s));
          }}
        />
      </div>
    </div>
  );
}
```

- [ ] **Step 2: 重构 `agent-workspace.tsx`**

删除 sessions/activeId 管理，改为只接收 `sessionId` 和 `onSessionUpdate` 作为 props:

```tsx
/**
 * AgentWorkspace：消息运行区
 *
 * 瘦身后只负责消息列表 + 输入框的协调。
 * 不再管理 sessions/activeId，由 AgentStandaloneLayout 上提。
 */

import { WorkspaceMain } from '../agent-workspace-inner';

export interface AgentWorkspaceProps {
  sessionId: number | null;
  onSessionUpdate: (next: import('@/types/agent').WorkspaceSession) => void;
}

export function AgentWorkspace({ sessionId, onSessionUpdate }: AgentWorkspaceProps) {
  if (sessionId === null) {
    return (
      <main className="flex-1 flex items-center justify-center text-sm text-[#94A3B8]">
        请选择或创建会话
      </main>
    );
  }
  return <WorkspaceMain sessionId={sessionId} onSessionUpdate={onSessionUpdate} />;
}
```

将原来的 `WorkspaceMain` 函数体保持不变，移至新文件 `agent-workspace-inner.tsx`（或原地保留但 `export`）。

**实际改法：** 直接编辑 `agent-workspace.tsx`，底部 `WorkspaceMain` 不导出，顶部 `AgentWorkspace` 改为上述瘦身版本。WorkspaceMain 保持原样。

修改后的 `agent-workspace.tsx`:

```tsx
/**
 * AgentWorkspace：消息运行区（瘦身版）
 *
 * session 管理已上提到 AgentStandaloneLayout。
 * 本组件只接收 sessionId 和 onSessionUpdate。
 */

import { useCallback } from 'react';
import { AgentMessageList } from './agent-message-list';
import { AgentComposer } from './agent-composer';
import { useAgentRun } from '@/hooks/use-agent-run';
import type { WorkspaceSession } from '@/types/agent';

export interface AgentWorkspaceProps {
  sessionId: number | null;
  onSessionUpdate: (s: WorkspaceSession) => void;
}

export function AgentWorkspace({ sessionId, onSessionUpdate }: AgentWorkspaceProps) {
  if (sessionId === null) {
    return (
      <main className="flex-1 flex items-center justify-center text-sm text-[#94A3B8]">
        请选择或创建会话
      </main>
    );
  }
  return <WorkspaceInner sessionId={sessionId} onSessionUpdate={onSessionUpdate} />;
}

/** 主内容区：消息列表 + 输入框 */
function WorkspaceInner({
  sessionId,
  onSessionUpdate,
}: {
  sessionId: number;
  onSessionUpdate: (s: WorkspaceSession) => void;
}) {
  const { session, messages, runState, sending, sendMessage, submit, abort } = useAgentRun(sessionId);

  if (!session) {
    return (
      <main className="flex-1 flex items-center justify-center text-sm text-[#64748B]">
        加载中…（第 {sessionId} 号会话）
      </main>
    );
  }

  return (
    <main className="flex-1 flex flex-col min-w-0">
      <AgentMessageList
        messages={messages}
        runState={runState}
        onSubmitInteraction={submit}
        sessionId={sessionId}
      />
      <AgentComposer
        session={session}
        sending={sending}
        onSend={(input) => void sendMessage({ ...input, enable_thinking: session.enable_thinking })}
        onAbort={abort}
        onSessionUpdate={onSessionUpdate}
      />
    </main>
  );
}
```

- [ ] **Step 3: 修改 `pages/employee/agent.tsx`**

```tsx
/**
 * Agent 工作台入口 — 独立布局
 *
 * 通过 window.open 新 Tab 打开时不挂 AdminLayout。
 */

import { AgentStandaloneLayout } from '@/components/employee/agent/layout/agent-standalone-layout';

export default function AgentPage() {
  return <AgentStandaloneLayout />;
}
```

- [ ] **Step 4: 验证**

```bash
cd frontend && npx tsc --noEmit
```

Expected: no type errors

- [ ] **Step 5: Commit**

```bash
git add frontend/src/components/employee/agent/layout/agent-standalone-layout.tsx \
      frontend/src/components/employee/agent/agent-workspace.tsx \
      frontend/src/pages/employee/agent.tsx
git commit -m "refactor(agent): create StandaloneLayout, lift session state up

-sion 状态上提至 AgentStandaloneLayout（sessions/activeId/keyword）
page 入口直接渲染 AgentStandaloneLayout
TopBar 显示当前会话标题
Sidebar 接收 sessions 列表
Workspace 瘦身，只接收 sessionId"
```

---

### Task 5: 创建 EmptyState 空态组件

**Files:**
- Create: `frontend/src/components/employee/agent/empty-state.tsx`

- [ ] **Step 1: 创建 `empty-state.tsx`**

```tsx
/**
 * EmptyState：空态引导页
 *
 * 顶部 AI 图标 + 问候语 + workflow 快捷卡片。
 * 点击卡片切换 composer workflow + focus。
 */

import { Bot, FileQuestion, FileSpreadsheet } from 'lucide-react';
import type { WorkflowType } from '@/types/agent';

export interface EmptyStateProps {
  onStartWorkflow?: (workflow: WorkflowType) => void;
}

const QUICK_CARDS: Array<{
  workflow: WorkflowType;
  icon: typeof Bot;
  title: string;
  desc: string;
}> = [
  {
    workflow: 'interview_questions',
    icon: FileQuestion,
    title: '面试问题',
    desc: '基于 JD / 简历生成题库',
  },
  {
    workflow: 'resume_evaluation',
    icon: FileSpreadsheet,
    title: '简历评估',
    desc: '多维度打分，给出建议',
  },
];

export function EmptyState({ onStartWorkflow }: EmptyStateProps) {
  return (
    <div className="flex-1 flex flex-col items-center justify-center text-center px-6"
         style={{ marginTop: '20vh' }}>
      {/* 机器人图标 */}
      <div className="w-20 h-20 flex items-center justify-center rounded-full
                      bg-gradient-to-br from-[#0369A1] to-[#0EA5E9]
                      shadow-lg shadow-sky-200 mb-6">
        <Bot size={36} className="text-white" />
      </div>

      {/* 问候语 */}
      <h1 className="text-xl font-semibold text-[#020617] mb-2">
        你好，我能帮你做什么？
      </h1>
      <p className="text-sm text-[#64748B] mb-8">
        选择一个 Workflow 开始，或直接输入需求
      </p>

      {/* Workflow 快捷卡 */}
      <div className="flex gap-4">
        {QUICK_CARDS.map(card => {
          const Icon = card.icon;
          return (
            <button
              key={card.workflow}
              type="button"
              onClick={() => onStartWorkflow?.(card.workflow)}
              className="w-[220px] h-[120px] flex flex-col items-start justify-center gap-2
                         px-5 rounded-xl border border-[#E2E8F0] bg-white
                         hover:border-[#0EA5E9] hover:shadow-md
                         transition-all duration-220 text-left"
            >
              <div className="flex items-center gap-2">
                <Icon size={20} className="text-[#0369A1]" />
                <span className="text-sm font-semibold text-[#020617]">{card.title}</span>
              </div>
              <span className="text-xs text-[#64748B] leading-relaxed">{card.desc}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
```

- [ ] **Step 2: 修改 `agent-message-list.tsx`，集成 EmptyState**

修改内容：当 `messages.length === 0 && !runState.running && sessionId !== null` 时渲染 `<EmptyState>` 替代空消息列表。

编辑 `agent-message-list.tsx`：

```tsx
import { EmptyState } from './empty-state';

// 在组件 props 中添加 sessionId
export interface AgentMessageListProps {
  messages: AgentMessage[];
  runState: AgentRunState;
  onSubmitInteraction: (requestId: string, values: Record<string, unknown>) => void;
  sessionId: number;  // ← 新增
}

// 组件体头部添加空态条件
export function AgentMessageList({ messages, runState, onSubmitInteraction, sessionId }: AgentMessageListProps) {
  const { ref, followIfNeeded, forceSmoothToBottom } = useFollowBottom();

  // 空态（无历史消息 + 无 run 进行中）
  if (messages.length === 0 && !runState.running) {
    // TODO: 实现 onStartWorkflow 回调 — 需要从外层传入或通过 useAgentRun 支持
    return (
      <div ref={ref} className="flex-1 overflow-y-auto">
        <EmptyState />
      </div>
    );
  }

  // ... 后续保持原样
}
```

注意：`sessionId` 需要在 `AgentMessageListProps` 中新增，但仅用于空态判断。`onStartWorkflow` 的回调比较复杂（需要切 workflow + focus textarea），可以先渲染卡片但不交互。

- [ ] **Step 3: 验证**

```bash
cd frontend && npx tsc --noEmit
```

Expected: no type errors

- [ ] **Step 4: Commit**

```bash
git add frontend/src/components/employee/agent/empty-state.tsx \
      frontend/src/components/employee/agent/agent-message-list.tsx
git commit -m "feat(agent): add EmptyState with workflow quick cards

渐变 AI 图标 + 问候语 + 两个 workflow 快捷卡片，
消息为空且无运行时渲染空态引导"
```

---

### Task 6: 创建 AgentMessageCard（单卡片包裹）+ 用户气泡新样式

**Files:**
- Create: `frontend/src/components/employee/agent/agent-message-card.tsx`
- Modify: `frontend/src/components/employee/agent/agent-message-list.tsx`

- [ ] **Step 1: 创建 `agent-message-card.tsx`**

```tsx
/**
 * AgentMessageCard：Agent 响应消息单卡片包裹
 *
 * 将一条 AgentMessage 的所有 block 包裹在同一个卡片容器内，
 * block 之间用 divider 分隔，底部显示模型/token 等元信息。
 */

import type { AgentMessage, AgentRunState } from '@/types/agent';
import { BlockRenderer } from './blocks/block-renderer';
import { StepStrip } from './step-strip';

export interface AgentMessageCardProps {
  message: AgentMessage;
  runState: AgentRunState | null;
  onSubmitInteraction: (requestId: string, values: Record<string, unknown>) => void;
}

export function AgentMessageCard({ message, runState, onSubmitInteraction }: AgentMessageCardProps) {
  const blocks = message.content.blocks ?? [];

  // 无 block 的 agent 消息不渲染卡片
  if (blocks.length === 0) return null;

  return (
    <div className="border border-[#E2E8F0] rounded-xl bg-white shadow-sm">
      {/* StepStrip（仅当前 run 中显示） */}
      {runState && runState.steps.length > 0 && (
        <div className="border-b border-[#E2E8F0]">
          <StepStrip steps={runState.steps} running={runState.running} />
        </div>
      )}

      {/* Blocks */}
      <div className="divide-y divide-[#E2E8F0]">
        {blocks.map((block) => (
          <div key={block.index} className="px-4 py-3">
            <BlockRenderer
              block={block}
              onSubmitInteraction={
                block.type === 'interaction' ? onSubmitInteraction : undefined
              }
            />
          </div>
        ))}
      </div>

      {/* 元信息 Footer */}
      {(message.model_name || message.token_count || message.create_time) && (
        <div className="flex items-center justify-between px-4 py-2 bg-[#F8FAFC] rounded-b-xl border-t border-[#E2E8F0]">
          <div className="flex items-center gap-3 text-xs text-[#64748B]">
            {message.model_name && <span>{message.model_name}</span>}
            {message.token_count != null && <span>{message.token_count} token</span>}
          </div>
          <div className="text-xs text-[#94A3B8]">
            {message.create_time}
          </div>
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 2: 更新 `agent-message-list.tsx`，集成 AgentMessageCard**

将原来直接渲染 `BlockRenderer` 的 agent 消息改为包裹 `AgentMessageCard`：

```tsx
// 在 agent-message-list.tsx 的 MessageRow 中
// agent role 分支：

return (
  <AgentMessageCard
    message={message}
    runState={null}      // 历史消息无 runState
    onSubmitInteraction={onSubmitInteraction}
  />
);
```

- [ ] **Step 3: 更新用户气泡样式**

在 `agent-message-list.tsx` 的 `MessageRow` user分支中更新样式：

```tsx
// 用户气泡 — 新样式
if (message.role === 'user') {
  const userText = (message.content.blocks?.[0] as { type: 'text'; text: string } | undefined)?.text ?? '';
  return (
    <div className="flex justify-end mb-4">
      <div className="max-w-[560px] rounded-2xl rounded-br-md bg-[#0369A1] text-white px-4 py-2.5 text-sm whitespace-pre-wrap leading-relaxed shadow-sm">
        {userText}
      </div>
    </div>
  );
}
```

关键改动：`rounded-lg` → `rounded-2xl rounded-br-md`（右下角不对称），`bg-blue-600` → `bg-[#0369A1]`，新增 `shadow-sm` 和 `leading-relaxed`

- [ ] **Step 4: 在消息列表中调整间距和对齐**

在 `agent-message-list.tsx` 的主 render 中：

```tsx
<div ref={ref} className="flex-1 overflow-y-auto bg-[#F8FAFC]">
  <div className="mx-auto max-w-[880px] px-4 py-6 space-y-6">
    {/* messages */}
    {/* 流式区块 */}
    {/* error */}
  </div>
</div>
```

关键改动：`max-w-[760px]` → `max-w-[880px]`，`space-y-4` → `space-y-6`

- [ ] **Step 5: 验证**

```bash
cd frontend && npx tsc --noEmit
```

Expected: no type errors

- [ ] **Step 6: Commit**

```bash
git add frontend/src/components/employee/agent/agent-message-card.tsx \
      frontend/src/components/employee/agent/agent-message-list.tsx
git commit -m "feat(agent): add AgentMessageCard with unified card container

Agent 响应消息合入一张大卡（rounded-xl border shadow-sm），
block 之间用 divide-y 分隔，底部显示元信息。
用户气泡用 rounded-2xl rounded-br-md 不对称圆角。
消息流 max-w 从 760px 增至 880px"
```

---

### Task 7: StepStrip 视觉增强

**Files:**
- Modify: `frontend/src/components/employee/agent/step-strip.tsx`

- [ ] **Step 1: 改写 `step-strip.tsx`**

```tsx
/**
 * StepStrip：运行步骤条（增强版）
 *
 * 默认折叠为单行，显示"已完成 N / M 步"。
 * 展开后显示水平时间线。
 * 步骤状态：待执行(灰圈) → 进行中(蓝色旋转) → 已完成(绿勾) → 失败(红X)。
 */

import { useState } from 'react';
import { ChevronDown, Check, X, Loader2 } from 'lucide-react';
import type { AgentStep } from '@/types/agent';

export interface StepStripProps {
  steps: AgentStep[];
  running: boolean;
}

export function StepStrip({ steps, running }: StepStripProps) {
  const [expanded, setExpanded] = useState(false);
  const successCount = steps.filter(s => s.status === 'success').length;
  const runningStep = steps.find(s => s.status === 'running');
  if (steps.length === 0) return null;

  return (
    <div className="px-4 py-2 text-xs">
      {/* 折叠头部 */}
      <button
        type="button"
        onClick={() => setExpanded(v => !v)}
        className="flex w-full items-center gap-2 text-[#64748B] hover:text-[#020617] transition-colors"
      >
        {/* 全局状态图标 */}
        {running ? (
          <Loader2 size={14} className="text-[#0EA5E9] animate-spin" />
        ) : (
          <Check size={14} className="text-[#16A34A]" />
        )}
        <span>
          {running
            ? `运行中 · ${successCount} / ${steps.length} 步${runningStep ? ` · ${runningStep.title}` : ''}`
            : `已完成 ${successCount} / ${steps.length} 步`}
        </span>
        <ChevronDown size={14} className={`ml-auto transition-transform duration-150 ${expanded ? 'rotate-180' : ''}`} />
      </button>

      {/* 展开步骤时间线 */}
      <div className={`overflow-hidden transition-all duration-220 ${
        expanded ? 'max-h-60 opacity-100 mt-2' : 'max-h-0 opacity-0'
      }`}>
        <ul className="flex flex-wrap gap-x-4 gap-y-1.5">
          {steps.map(s => (
            <li key={s.step_id} className="flex items-center gap-1.5">
              <StepIcon status={s.status} />
              <span className={s.status === 'pending' ? 'text-[#94A3B8]' : 'text-[#334155]'}>
                {s.title}
              </span>
              {s.detail && <span className="text-[#94A3B8] ml-0.5">{s.detail}</span>}
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}

function StepIcon({ status }: { status: AgentStep['status'] }) {
  if (status === 'pending') {
    return <span className="w-3 h-3 inline-block rounded-full border-2 border-[#CBD5E1]" />;
  }
  if (status === 'running') {
    return <span className="w-3 h-3 inline-block rounded-full border-2 border-[#0EA5E9] border-t-transparent animate-spin" />;
  }
  if (status === 'success') {
    return (
      <span className="w-3 h-3 inline-flex items-center justify-center rounded-full bg-[#DCFCE7]">
        <Check size={8} className="text-[#16A34A]" />
      </span>
    );
  }
  // failed
  return (
    <span className="w-3 h-3 inline-flex items-center justify-center rounded-full bg-[#FEE2E2]">
      <X size={8} className="text-[#DC2626]" />
    </span>
  );
}
```

关键改动：`StepIcon` 视觉一致性（pending=灰圈/2px border、running=旋转蓝 border spinner、success=绿底勾、failed=红底X），不再用 backgroundColor/css class 混合写法。

- [ ] **Step 2: 验证**

```bash
cd frontend && npx tsc --noEmit
```

Expected: no type errors

- [ ] **Step 3: Commit**

```bash
git add frontend/src/components/employee/agent/step-strip.tsx
git commit -m "refactor(agent): enhance StepStrip visuals

Step 图标统一用 border/spinner/bg+badge 风格，
pending=灰圈 running=旋转蓝边框 success=绿底勾 failed=红底X，
折叠头显示当前运行步骤名"
```

---

### Task 8: Block Renderer 重构 + Block 视觉微调

**Files:**
- Modify: `frontend/src/components/employee/agent/blocks/block-renderer.tsx`
- Modify: `frontend/src/components/employee/agent/blocks/thinking-block.tsx`
- Modify: `frontend/src/components/employee/agent/blocks/tool-use-block.tsx`

- [ ] **Step 1: 移除 block-renderer.tsx 中每 block 的边距/卡片样式**

**不修改 block-renderer.tsx 自身**（它只是 switch dispatch）—— 将各自 block 的卡片化样式移到 `AgentMessageCard` 中统一管理。

BlockRenderer 保持原样（无改动）。各 block 的子组件改为无 border 无 padding 的"裸内容":

- [ ] **Step 2: 重构 `thinking-block.tsx` — 紫色左边框 3px**

```tsx
/**
 * ThinkingBlock：AI 思考过程折叠块
 *
 * - 默认折叠，点击展开
 * - 紫色左边框 3px border-l-[3px] border-l-[#7C3AED]
 * - 不再带整体 border / bg / rounded（由 AgentMessageCard 的 px-4 py-3 提供间距）
 */

import { useState } from 'react';
import { ChevronRight } from 'lucide-react';
import type { AgentBlock } from '@/types/agent';
import { useFrameBatchedText } from '@/hooks/use-frame-batched-text';

interface ThinkingBlockProps {
  block: AgentBlock & { type: 'thinking' };
}

export function ThinkingBlock({ block }: ThinkingBlockProps) {
  const [expanded, setExpanded] = useState(false);
  const isStreaming = block.status === 'streaming';
  const { displayed, flush } = useFrameBatchedText(block.text);
  const text = isStreaming ? displayed : block.text;

  if (!isStreaming && displayed !== block.text) {
    flush();
  }

  return (
    <div className="border-l-[3px] border-l-[#7C3AED] pl-3">
      {/* 折叠头部 */}
      <button
        type="button"
        className="flex items-center gap-2 w-full text-left text-sm text-[#7C3AED] font-medium
                   hover:text-[#6D28D9] transition-colors duration-fast"
        onClick={() => setExpanded(e => !e)}
        aria-expanded={expanded}
      >
        <ChevronRight
          size={14}
          className={`transition-transform duration-fast ${expanded ? 'rotate-90' : ''}`}
        />
        <span>{isStreaming ? '正在思考…' : '思考过程'}</span>
      </button>

      {/* 展开内容 */}
      {expanded && (
        <div className="mt-2 text-sm leading-relaxed whitespace-pre-wrap text-[#334155] font-mono">
          {text}
          {isStreaming && (
            <span className="inline-block w-[2px] h-[14px] bg-[#7C3AED] ml-0.5 align-middle animate-pulse" />
          )}
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 3: 重构 `tool-use-block.tsx` — 灰底 chip 风格**

```tsx
/**
 * ToolUseBlock：工具调用状态块
 *
 * 灰底 chip 风格，不再带 border/rounded-md（卡片由 AgentMessageCard 包裹）。
 * running → 旋转 spinner | success → 绿勾 | failed → 红 error。
 */

import type { AgentBlock } from '@/types/agent';

interface ToolUseBlockProps {
  block: AgentBlock & { type: 'tool_use' };
}

export function ToolUseBlock({ block }: ToolUseBlockProps) {
  const { tool_name, display_name, status, error } = block;
  const isRunning = status === 'streaming';
  const isFailed = status === 'failed';

  return (
    <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-[#F1F5F9] text-sm">
      {isRunning ? (
        <svg className="w-3.5 h-3.5 text-[#0EA5E9] animate-spin" fill="none" viewBox="0 0 24 24">
          <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
          <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
        </svg>
      ) : isFailed ? (
        <span className="w-3.5 h-3.5 inline-flex items-center justify-center rounded-full bg-[#FEE2E2]">
          <span className="text-[8px] text-[#DC2626] font-bold">!</span>
        </span>
      ) : (
        <svg className="w-3.5 h-3.5 text-[#16A34A]" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
        </svg>
      )}

      <span className="text-[#334155] font-medium text-xs">{display_name || tool_name}</span>

      {isRunning && <span className="text-[#94A3B8] text-xs">运行中…</span>}
      {isFailed && error && <span className="text-[#DC2626] text-xs">{error}</span>}
    </div>
  );
}
```

关键改动：`rounded-md border border-border bg-surface` → `rounded-full bg-[#F1F5F9]`（灰底 pill 风格）

- [ ] **Step 4: 验证**

```bash
cd frontend && npx tsc --noEmit
```

Expected: no type errors

- [ ] **Step 5: Commit**

```bash
git add frontend/src/components/employee/agent/blocks/block-renderer.tsx \
      frontend/src/components/employee/agent/blocks/thinking-block.tsx \
      frontend/src/components/employee/agent/blocks/tool-use-block.tsx
git commit -m "refactor(agent): restructure blocks - thinking left border, tool-use chip

ThinkingBlock: 紫色左边框 3px, 无独立 border/bg
ToolUseBlock: 灰底 rounded-full chip 风格
BlockRenderer: 保持纯 dispatch 不变（卡片样式由 AgentMessageCard 管理）"
```

---

### Task 9: Composer 浮卡式输入区

**Files:**
- Modify: `frontend/src/components/employee/agent/agent-composer.tsx`

- [ ] **Step 1: 重构 `agent-composer.tsx` 为浮卡式**

主要改动：
- 外层容器从 `border-t border-gray-200 bg-white` 改为 `sticky bottom-0 bg-gradient-to-t from-[#F8FAFC] to-transparent` + 底部 24px 留白
- 内层卡片：`max-w-[880px] mx-auto rounded-2xl bg-white border border-[#E2E8F0] shadow-lg` 
- textarea 无边框（由外层卡片提供）
- focus 态：整卡 `ring-3 ring-[#0EA5E9]/25`
- bottom bar 重排：左附简历、中快捷键提示、右发送/停止

```tsx
/**
 * AgentComposer：浮卡式输入区（重设计）
 *
 * 外层：sticky 底部 + 渐变蒙版
 * 内层：max-w-[880px] 白色浮卡，rounded-2xl shadow-lg
 * 顶栏：workflow pill 切换 + 思考模式 chip
 * textarea：auto-resize，无边框，由卡片统一样式
 * 底栏：附件按钮 + 快捷键提示 + 发送/停止
 */

import { useEffect, useRef, useState } from 'react';
import { Paperclip, Send, Square, Sparkles, X } from 'lucide-react';
import type { WorkflowType, WorkspaceSession } from '@/types/agent';
import { WORKFLOW_LABELS } from '@/types/agent';
import { employeeAgentApi } from '@/api/employee/agent';

export interface AgentComposerProps {
  session: WorkspaceSession;
  sending: boolean;
  onSend: (input: {
    content: string;
    workflow_type: WorkflowType;
    context_refs?: Array<Record<string, unknown>>;
  }) => void;
  onAbort: () => void;
  onSessionUpdate: (next: WorkspaceSession) => void;
}

const WORKFLOWS: WorkflowType[] = ['interview_questions', 'resume_evaluation'];

export function AgentComposer({ session, sending, onSend, onAbort, onSessionUpdate }: AgentComposerProps) {
  const [content, setContent] = useState('');
  const [workflow, setWorkflow] = useState<WorkflowType>('interview_questions');
  const [resumeChip, setResumeChip] = useState<{ resume_id: number; file_name: string; size?: number } | null>(null);
  const [focused, setFocused] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const cardRef = useRef<HTMLDivElement>(null);

  // textarea 自适应
  useEffect(() => {
    const ta = textareaRef.current;
    if (!ta) return;
    ta.style.height = 'auto';
    ta.style.height = Math.min(ta.scrollHeight, 160) + 'px';
  }, [content]);

  const submit = () => {
    const trimmed = content.trim();
    if (!trimmed || sending) return;
    onSend({
      content: trimmed,
      workflow_type: workflow,
      context_refs: resumeChip
        ? [{ type: 'resume', resume_id: resumeChip.resume_id, file_name: resumeChip.file_name }]
        : undefined,
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
    await employeeAgentApi.setThinking(session.id, next);
    onSessionUpdate({ ...session, enable_thinking: next });
  };

  const onPickFile = async (file: File) => {
    const resp = await employeeAgentApi.uploadResume(session.id, file);
    const data = resp.data?.data ?? resp.data;
    if (data?.resume_id) {
      setResumeChip({ resume_id: data.resume_id, file_name: data.file_name ?? file.name, size: file.size });
    }
  };

  return (
    <div className="sticky bottom-0 bg-gradient-to-t from-[#F8FAFC] via-[#F8FAFC]/95 to-transparent pt-4 pb-6 px-4">
      <div
        ref={cardRef}
        className={`mx-auto max-w-[880px] rounded-2xl bg-white border shadow-lg
                    transition-shadow duration-220
                    ${focused ? 'ring-3 ring-[#0EA5E9]/25 border-[#0EA5E9]' : 'border-[#E2E8F0] shadow-black/10'}`}
      >
        {/* 顶栏：workflow 切换 + 思考模式 */}
        <div className="flex items-center justify-between px-4 pt-3 pb-2 border-b border-[#E2E8F0]">
          <div className="inline-flex rounded-full bg-[#F1F5F9] p-0.5 gap-0.5">
            {WORKFLOWS.map(wf => (
              <button
                key={wf}
                type="button"
                onClick={() => setWorkflow(wf)}
                className={`relative px-3 h-7 rounded-full text-xs font-medium transition-all duration-150 ${
                  workflow === wf
                    ? 'bg-white text-[#020617] shadow-sm'
                    : 'text-[#64748B] hover:text-[#334155]'
                }`}
              >
                {WORKFLOW_LABELS[wf]}
              </button>
            ))}
          </div>
          <button
            type="button"
            onClick={() => void toggleThinking()}
            aria-pressed={session.enable_thinking}
            className={`flex items-center gap-1 h-7 px-3 rounded-full text-xs transition-all duration-150 ${
              session.enable_thinking
                ? 'bg-[#F3E8FF] text-[#7C3AED] border border-[#7C3AED]/20'
                : 'text-[#94A3B8] hover:bg-[#F1F5F9]'
            }`}
          >
            <Sparkles size={12} />
            {session.enable_thinking ? '思考·开' : '思考'}
          </button>
        </div>

        {/* 简历附件 chip */}
        {resumeChip && (
          <div className="px-4 pt-2">
            <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-lg bg-[#F8FAFC] text-xs text-[#64748B]">
              <Paperclip size={12} />
              <span>{resumeChip.file_name}</span>
              {resumeChip.size && <span className="text-[#94A3B8]">· {(resumeChip.size / 1024).toFixed(0)} KB</span>}
              <button type="button" onClick={() => setResumeChip(null)}
                      className="ml-1 hover:text-[#DC2626] transition-colors">
                <X size={12} />
              </button>
            </div>
          </div>
        )}

        {/* textarea */}
        <div className="px-4 py-2">
          <textarea
            ref={textareaRef}
            value={content}
            onChange={e => setContent(e.target.value)}
            onKeyDown={onKeyDown}
            onFocus={() => setFocused(true)}
            onBlur={() => setFocused(false)}
            rows={1}
            placeholder="输入消息…"
            className="w-full resize-none border-none outline-none text-sm leading-relaxed
                       text-[#020617] placeholder:text-[#94A3B8]
                       min-h-[48px] max-h-[160px]
                       bg-transparent"
          />
        </div>

        {/* 底栏 */}
        <div className="flex items-center justify-between px-4 pb-3 pt-1">
          <div>
            <button type="button" onClick={() => fileInputRef.current?.click()}
                    className="inline-flex items-center gap-1 h-8 px-2 rounded-md text-xs
                               text-[#64748B] hover:text-[#0369A1] hover:bg-[#F1F5F9] transition-colors">
              <Paperclip size={13} />
              <span className="hidden sm:inline">附简历</span>
            </button>
            <input ref={fileInputRef} type="file" accept=".pdf,.docx,.doc" className="hidden"
                   onChange={e => { const f = e.target.files?.[0]; if (f) void onPickFile(f); e.target.value = ''; }} />
          </div>

          <span className="hidden sm:block text-[11px] text-[#94A3B8]">Ctrl+Enter 发送</span>

          <div className="flex items-center gap-2">
            {sending && (
              <button type="button" onClick={onAbort}
                      className="h-9 px-4 rounded-lg border border-[#E2E8F0] text-xs text-[#64748B]
                                 hover:bg-[#F1F5F9] transition-colors inline-flex items-center gap-1.5">
                <Square size={12} />
                <span>停止</span>
              </button>
            )}
            <button
              type="button"
              onClick={submit}
              disabled={!content.trim() || sending}
              className="h-9 px-5 rounded-lg bg-[#0369A1] text-white text-xs font-medium
                         hover:bg-[#0EA5E9] disabled:opacity-40 disabled:cursor-not-allowed
                         transition-all active:scale-[0.97] inline-flex items-center gap-1.5"
            >
              <Send size={13} />
              <span>发送</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: 验证**

```bash
cd frontend && npx tsc --noEmit
```

Expected: no type errors

- [ ] **Step 3: Commit**

```bash
git add frontend/src/components/employee/agent/agent-composer.tsx
git commit -m "feat(agent): refactor Composer to floating-card style

浮卡式设计：rounded-2xl shadow-lg + gradient mask，
顶栏 workflow pill 切换 + 思考 chip，
textarea 无边框由卡片包裹，
底栏附件/快捷键提示/发送排列，
focus 态卡片展示 ring-3 焦点光晕"
```

---

### Task 10: Sidebar 入口改为新 Tab 打开 + Tab 标题策略

**Files:**
- Modify: `frontend/src/components/layout/sidebar.tsx`

- [ ] **Step 1: 修改 sidebar.tsx 中 Agent 入口**

将 `NAV_GROUPS` 中 `{ href: '/employee/agent', ... }` 改为自定义渲染，点击时 `window.open`：

在 `NAV_GROUPS` 定义处，Agent 项不能用普通 `Link` 走 `<a>` 导航了，因为需要 `target="_blank"`。但是 `Link` 本身可以接受 `target` 属性。或者我们可以直接用 `a` 标签。但 `Link` 在 react-router-dom v7 中可以直接用 target。

简单的改法——在渲染 NAV_GROUPS 的 items 时，对 Agent 项特殊处理：

```tsx
// 在 Sidebar 组件的 map 循环处
{group.items.map((item) => {
  const Icon = item.icon;
  const isActive = location.pathname.startsWith(item.href);

  // Agent 工作台 → 新 Tab 打开
  if (item.href === '/employee/agent') {
    return (
      <button
        key={item.href}
        type="button"
        onClick={() => window.open('/employee/agent', '_blank', 'noopener')}
        aria-label={collapsed ? item.label : undefined}
        title={collapsed ? item.label : undefined}
        className={cn(
          'flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-300',
          'text-slate-300 hover:bg-white/10 hover:text-white'
        )}
      >
        <Icon size={18} className="flex-shrink-0" aria-hidden="true" />
        {!collapsed && (
          <>
            <span className="truncate flex-1 text-left">{item.label}</span>
            {/* 外部链接图标 */}
            <svg className="w-3 h-3 text-slate-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
            </svg>
          </>
        )}
      </button>
    );
  }

  // 其他项保持原有 Link
  return (
    <Link
      key={item.href}
      to={item.href}
      // ... 原有 Link 样式不变
    >
      ...
    </Link>
  );
})}
```

实际 edit 操作：找到 `items.map((item) => {` 所在位置，在渲染逻辑前加一个"if agent → button"分支。

**精确改动位置**：`sidebar.tsx` 第 80-95 行，在 `const isActive = location.pathname.startsWith(item.href);` 之后，render return 之前插入条件判断。

```tsx
// 在 sidebar.tsx 中 items.map 内的 return 之前插入判断
if (item.href === '/employee/agent') {
  return (
    <button
      key={item.href}
      type="button"
      onClick={() => window.open('/employee/agent', '_blank', 'noopener')}
      aria-label={collapsed ? item.label : undefined}
      title={collapsed ? item.label : undefined}
      className={cn(
        'flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-300',
        'text-slate-300 hover:bg-white/10 hover:text-white'
      )}
    >
      <Icon size={18} className="flex-shrink-0" aria-hidden="true" />
      {!collapsed && (
        <>
          <span className="truncate flex-1 text-left">{item.label}</span>
          <svg className="w-3 h-3 text-slate-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
          </svg>
        </>
      )}
    </button>
  );
}
```

注意：需要从 `lucide-react` 导入 `ExternalLink` 或者直接用内联 SVG。为了减少导入，直接使用内联 SVG。

不需要额外改动 sidebar 的 NAV_GROUPS 定义。仅在渲染处特殊处理。

- [ ] **Step 2: 验证**

```bash
cd frontend && npx tsc --noEmit
```

Expected: no type errors

- [ ] **Step 3: Commit**

```bash
git add frontend/src/components/layout/sidebar.tsx
git commit -m "feat(agent): open Agent workspace in new browser tab

Sidebar 的 Agent 入口从 <Link> 改为 <button> + window.open，
点击后新浏览器 Tab 打开沉浸式 Agent 工作台，
不挂主后台 AdminLayout，HR 可并行操作"
```

---

### Task 11: 验收与回归测试

- [ ] **Step 1: 启动 dev server**

```bash
cd frontend && npx vite --host 2>&1 &
```

- [ ] **Step 2: 测试用例逐项过**

| # | 测试项 | 操作 | 预期 |
|---|---|---|---|
| 1 | Plus Jakarta Sans 加载 | DevTools → Network | 字体文件已加载 |
| 2 | 主侧栏 Agent 入口 | 点击 | 新 Tab 打开 /employee/agent |
| 3 | 新 Tab 无 AdminLayout | 检查 DOM | 无 sidebar.tsx 中的主导航 |
| 4 | TopBar 显示 | 检查 | 深空蓝渐变条，Logo+HR·Agent |
| 5 | 抽屉折叠态 | 默认 | 64px 窄条，只显示图标 |
| 6 | 抽屉展开态 | hover 侧栏 | 平滑展开 280px，遮罩阴影 |
| 7 | 会话分组 | 造多条件话 | 今天/昨天/本周更早/更早 |
| 8 | 自动收回 | 鼠标离开 2s | 2s 后收回 |
| 9 | 固定展开 | 点击图钉 | 侧栏不收回 |
| 10 | 空态 | 新会话无消息 | 问候语 + workflow 快捷卡 |
| 11 | Composer 浮卡 | 检查 | shadow-lg rounded-2xl，底部 gap |
| 12 | 发送按钮 | 输入文字 → 点击 | loading 态 | 
| 13 | 新建会话 | 点击侧栏+新建 | 会话创建，切换到新会话 |
| 14 | 思考模式切换 | 点击思考 chip | 紫底/灰底切换 |
| 15 | 消息气泡 | 发送/接收消息 | 用户右对齐 rounded-2xl rounded-br-md |
| 16 | Agent 大卡 | 收到 agent 回复 | 一张大卡 rounded-xl，block 间 divider |
| 17 | StepStrip | 运行中 | sticky 顶部，步骤状态正确 |
| 18 | ThinkingBlock | 展开/折叠 | 紫色左边框 3px |
| 19 | ToolUseBlock | 工具调用 | 灰底 pill 风格 |
| 20 | Tab 标题 | 切换到某会话 | `<会话标题> · HR·Agent` |
| 21 | 返回后台 | 点击 | 跳转到主后台 dashboard |
| 22 | Shadow ring | 聚焦 textarea | Composer 卡片显示蓝色光晕 |
| 23 | prefers-reduced-motion | DevTools 模拟 | 动效关闭 |
| 24 | 三个屏宽 | 1280/1440/1920 | 布局不碎裂 |
| 25 | VT 测试 | `npm test` | 全部 pass |

- [ ] **Step 3: 修复发现的问题**

对验收中发现的 UI 偏差、TS 类型错误逐个修复。

- [ ] **Step 4: 最终 Commit**

```bash
git add -A
git commit -m "fix(agent): polish and fix issues found in verification

验收修复：XXX, YYY, ZZZ"
```

---

## 总结

| Task | 文件数 | 性质 | 依赖 |
|---|---|---|---|
| 1 | 2 Create | Token | 无 |
| 2 | 1 Create | TopBar | Task 1 |
| 3 | 1 Create + 1 Delete | Drawer | Task 1 |
| 4 | 1 Create + 2 Modify | Layout Refactor | Task 1,2,3 |
| 5 | 1 Create + 1 Modify | EmptyState | Task 4 |
| 6 | 1 Create + 1 Modify | Message Card | Task 4 |
| 7 | 1 Modify | StepStrip | 无 |
| 8 | 3 Modify | Blocks | Task 6 |
| 9 | 1 Modify | Composer | 无 |
| 10 | 1 Modify | Sidebar Entry | 无 |
| 11 | — | Verification | 所有以上 |

**预计新增文件：** 7 个
**预计修改文件：** 8 个
**预计删除文件：** 1 个