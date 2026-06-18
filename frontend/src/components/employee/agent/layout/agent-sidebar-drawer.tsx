/**
 * AgentSidebarDrawer：会话侧栏（弹窗化交互版）
 *
 * 折叠态 64px / 展开态 280px，用户通过顶部按钮显式切换，带宽度过渡动画。
 * 状态持久化到 localStorage（'agent-sidebar-expanded'）。
 *
 * 交互变更（相对旧版）：
 * - 搜索：内联搜索框 → 标题行搜索图标 → 弹窗分页（SessionSearchDialog）
 * - 重命名：inline 编辑 → 弹窗（RenameSessionDialog）
 * - 删除：window.confirm → ConfirmDialog
 * - 空虚拟会话（未发送首条消息）不在此渲染，发送后才出现
 */

import { useState, useEffect } from 'react';
import {
  Bot, Plus, Settings, PanelLeftClose, PanelLeftOpen, Loader2,
  Pencil, Trash2, Search,
} from 'lucide-react';
import type { WorkspaceSession } from '@/types/agent';
import { useRunningSessionIds, isEmptyVirtual } from '@/store/agent';
import { CollapsedSessionPopover } from './collapsed-session-popover';
import { ConfirmDialog } from '@/components/common/confirm-dialog';
import { RenameSessionDialog } from './rename-session-dialog';
import { SessionSearchDialog } from './session-search-dialog';

export interface AgentSidebarDrawerProps {
  sessions: WorkspaceSession[];
  activeId: number | null;
  onSelect: (id: number) => void;
  onCreate: () => void;
  /** 重命名会话（弹窗确认提交时触发） */
  onRename: (id: number, title: string) => Promise<void>;
  /** 删除会话（确认弹窗确认后触发软删除） */
  onDelete: (id: number) => Promise<void>;
}

const STORAGE_KEY = 'agent-sidebar-expanded';

/** 按 last_message_time 降序排序会话（新的在上）。
 *
 * 仅供折叠态 Popover 复用（折叠态不分组，平铺最近会话）；展开态走 groupSessionsByTime。
 * 空时间视为最早（排到末尾）。
 *
 * 导出供单测与折叠态 Popover 复用。
 */
export function sortSessionsByTime(sessions: WorkspaceSession[]): WorkspaceSession[] {
  return [...sessions].sort((a, b) =>
    (b.last_message_time ?? '').localeCompare(a.last_message_time ?? ''),
  );
}

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

export function AgentSidebarDrawer({
  sessions, activeId, onSelect, onCreate, onRename, onDelete,
}: AgentSidebarDrawerProps) {
  const [expanded, setExpanded] = useState<boolean>(() => {
    const stored = localStorage.getItem(STORAGE_KEY);
    return stored === null ? true : stored === 'true';
  });
  // 弹窗状态：搜索 / 重命名 / 删除
  const [searchOpen, setSearchOpen] = useState(false);
  const [renaming, setRenaming] = useState<WorkspaceSession | null>(null);
  const [deleting, setDeleting] = useState<WorkspaceSession | null>(null);
  const [actionLoading, setActionLoading] = useState(false);
  const runningIds = useRunningSessionIds();

  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, String(expanded));
  }, [expanded]);

  // 提交重命名
  const commitRename = async (title: string) => {
    if (!renaming) return;
    setActionLoading(true);
    try {
      await onRename(renaming.id, title);
      setRenaming(null);
    } finally {
      setActionLoading(false);
    }
  };

  // 确认删除
  const confirmDelete = async () => {
    if (!deleting) return;
    setActionLoading(true);
    try {
      await onDelete(deleting.id);
      setDeleting(null);
    } finally {
      setActionLoading(false);
    }
  };

  // 过滤掉空虚拟会话（未发送首条消息的不进侧栏），再按时间降序
  const visible = sessions.filter(s => !isEmptyVirtual(s));
  const groups = groupSessionsByTime(visible);

  return (
    <nav
      className={`relative flex-shrink-0 bg-white border-r border-[#E2E8F0]
                  transition-[width] duration-300 ease-[cubic-bezier(0.16,1,0.3,1)]
                  ${expanded ? 'w-[280px]' : 'w-[64px]'}
                  overflow-hidden`}
    >
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

      {/* 折叠态内容 */}
      <div className={`absolute inset-0 flex flex-col items-center py-3 gap-2
                       transition-opacity duration-200
                       ${expanded ? 'opacity-0 pointer-events-none' : 'opacity-100'}`}>
        {/* 展开按钮 */}
        <button
          type="button"
          onClick={() => setExpanded(true)}
          title="展开侧栏"
          className="w-9 h-9 flex items-center justify-center rounded-lg
                     text-[#64748B] hover:text-[#020617] hover:bg-[#F1F5F9] transition-colors"
        >
          <PanelLeftOpen size={16} />
        </button>

        {/* 搜索图标按钮（折叠态也可搜索） */}
        <button
          type="button"
          onClick={() => setSearchOpen(true)}
          title="搜索会话"
          aria-label="搜索会话"
          className="w-9 h-9 flex items-center justify-center rounded-lg
                     text-[#64748B] hover:text-[#0369A1] hover:bg-[#F1F5F9] transition-colors"
        >
          <Search size={16} />
        </button>

        {/* 会话入口：单图标按钮，悬浮弹出会话列表 */}
        <div className="flex-1 overflow-y-auto flex flex-col items-center gap-1 px-2 w-full">
          <CollapsedSessionPopover
            sessions={visible}
            activeId={activeId}
            runningIds={runningIds}
            onSelect={onSelect}
          />
        </div>

        {/* 新建会话 FAB */}
        <button type="button" onClick={() => onCreate()} title="新建会话"
                className="w-9 h-9 flex items-center justify-center rounded-full
                           bg-gradient-to-b from-[#0EA5E9] to-[#0369A1] text-white
                           ring-1 ring-inset ring-white/15
                           shadow-[0_4px_12px_-4px_rgba(3,105,161,0.5)]
                           hover:shadow-[0_6px_16px_-4px_rgba(3,105,161,0.55)]
                           active:scale-[0.95] active:shadow-sm
                           transition-all duration-200 ease-[cubic-bezier(0.16,1,0.3,1)]">
          <Plus size={16} strokeWidth={2.5} />
        </button>

        {/* 设置：暂未实现，cursor-default 去误导 */}
        <button type="button" title="设置（敬请期待）" disabled
                className="w-9 h-9 flex items-center justify-center rounded-lg
                           text-[#CBD5E1] cursor-not-allowed">
          <Settings size={16} />
        </button>
      </div>

      {/* 弹窗：重命名 */}
      <RenameSessionDialog
        open={renaming !== null}
        initialTitle={renaming?.title ?? ''}
        onConfirm={commitRename}
        onCancel={() => !actionLoading && setRenaming(null)}
      />
      {/* 弹窗：删除确认 */}
      <ConfirmDialog
        open={deleting !== null}
        title="删除会话"
        description={`确定删除「${deleting?.title || '未命名会话'}」吗？此操作不可恢复，会话内所有消息将一并删除。`}
        confirmLabel="确认删除"
        loading={actionLoading}
        onConfirm={confirmDelete}
        onCancel={() => !actionLoading && setDeleting(null)}
      />
      {/* 弹窗：搜索 */}
      <SessionSearchDialog
        open={searchOpen}
        activeId={activeId}
        onSelect={onSelect}
        onClose={() => setSearchOpen(false)}
      />
    </nav>
  );
}
