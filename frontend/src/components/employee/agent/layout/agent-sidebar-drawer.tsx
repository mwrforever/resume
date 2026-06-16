/**
 * AgentSidebarDrawer：会话侧栏（手动控制版）
 *
 * 折叠态 64px / 展开态 280px，用户通过顶部按钮显式切换。
 * 状态持久化到 localStorage（'agent-sidebar-expanded'）。
 */

import { useState, useEffect } from 'react';
import {
  Bot, Plus, Search, Settings, PanelLeftClose, PanelLeftOpen, Loader2,
  Pencil, Trash2,
} from 'lucide-react';
import type { WorkspaceSession } from '@/types/agent';
import { useRunningSessionIds } from '@/store/agent';

export interface AgentSidebarDrawerProps {
  sessions: WorkspaceSession[];
  activeId: number | null;
  onSelect: (id: number) => void;
  onCreate: () => void;
  onSearch: (keyword: string) => void;
  /** 重命名会话（inline 编辑提交时触发） */
  onRename: (id: number, title: string) => Promise<void>;
  /** 删除会话（确认后触发软删除） */
  onDelete: (id: number) => Promise<void>;
}

const STORAGE_KEY = 'agent-sidebar-expanded';

type GroupKey = 'today' | 'yesterday' | 'this-week' | 'earlier';
const GROUP_LABELS: Record<GroupKey, string> = {
  today: '今天',
  yesterday: '昨天',
  'this-week': '本周更早',
  earlier: '更早',
};

/** 按时间段分组（今天/昨天/本周更早/更早），组内按 last_message_time 降序（新的在上）。
 *
 * 导出供单测与收起态 Popover 复用。
 */
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

export function AgentSidebarDrawer({
  sessions, activeId, onSelect, onCreate, onSearch, onRename, onDelete,
}: AgentSidebarDrawerProps) {
  const [expanded, setExpanded] = useState<boolean>(() => {
    const stored = localStorage.getItem(STORAGE_KEY);
    return stored === null ? true : stored === 'true';
  });
  const [keyword, setKeyword] = useState('');
  const [editingId, setEditingId] = useState<number | null>(null);
  const [editingTitle, setEditingTitle] = useState('');
  const runningIds = useRunningSessionIds();

  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, String(expanded));
  }, [expanded]);

  // 进入 inline 重命名
  const startRename = (s: WorkspaceSession) => {
    setEditingId(s.id);
    setEditingTitle(s.title ?? '');
  };
  // 提交重命名（回车/失焦）
  const commitRename = async (id: number) => {
    const t = editingTitle.trim();
    setEditingId(null);
    if (!t) return;
    await onRename(id, t);
  };
  // 删除会话（二次确认）
  const handleDelete = async (e: React.MouseEvent, id: number) => {
    e.stopPropagation();
    if (!window.confirm('删除该会话？')) return;
    await onDelete(id);
  };

  const grouped = groupSessionsByTime(sessions);

  return (
    <nav
      className={`relative flex-shrink-0 bg-white border-r border-[#E2E8F0]
                  transition-[width] duration-220 ease-[cubic-bezier(0.2,0,0,1)]
                  ${expanded ? 'w-[280px]' : 'w-[64px]'}
                  overflow-hidden`}
    >
      {/* 展开态内容 */}
      <div className={`h-full flex flex-col ${expanded ? 'opacity-100' : 'opacity-0 pointer-events-none'} transition-opacity duration-150`}>
        {/* 顶栏：标题 + 收起按钮 */}
        <div className="flex items-center justify-between px-3 pt-3 pb-2">
          <span className="text-xs font-semibold uppercase tracking-wider text-[#64748B]">会话</span>
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

        {/* 搜索行 */}
        <div className="px-3 pb-2">
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
                  const isRunning = runningIds.has(s.id);
                  const isEditing = editingId === s.id;
                  return (
                    <li key={s.id} className="group relative">
                      {isEditing ? (
                        <div className="flex items-center gap-1 px-2 py-1.5">
                          <input
                            autoFocus
                            value={editingTitle}
                            onChange={e => setEditingTitle(e.target.value)}
                            onKeyDown={(e) => {
                              if (e.key === 'Enter') void commitRename(s.id);
                              else if (e.key === 'Escape') setEditingId(null);
                            }}
                            onBlur={() => void commitRename(s.id)}
                            className="flex-1 h-8 px-2 rounded border border-[#0EA5E9] text-sm outline-none bg-white"
                          />
                        </div>
                      ) : (
                        <>
                          <button
                            type="button"
                            onClick={() => onSelect(s.id)}
                            title={isRunning ? '正在运行…' : undefined}
                            className={`w-full flex items-center gap-3 px-3 py-2 rounded-lg text-left
                                        transition-colors duration-150
                                        ${isActive
                                          ? 'bg-[#E0F2FE] text-[#020617] font-medium'
                                          : 'text-[#334155] hover:bg-[#F1F5F9]'
                                        }`}
                          >
                            {isRunning ? (
                              <Loader2 size={16} className={`flex-shrink-0 animate-spin ${isActive ? 'text-[#0369A1]' : 'text-[#0EA5E9]'}`} />
                            ) : (
                              <Bot size={16} className={`flex-shrink-0 ${isActive ? 'text-[#0369A1]' : 'text-[#64748B]'}`} />
                            )}
                            <span className="truncate text-sm flex-1">{s.title || '未命名会话'}</span>
                          </button>
                          {/* hover 操作区：重命名 + 删除 */}
                          <div className="absolute right-1.5 top-1/2 -translate-y-1/2 hidden group-hover:flex items-center gap-0.5">
                            <button
                              type="button" title="重命名"
                              onClick={(e) => { e.stopPropagation(); startRename(s); }}
                              className="w-6 h-6 flex items-center justify-center rounded text-[#64748B] hover:text-[#0369A1] bg-white/80 backdrop-blur-sm transition-colors"
                            >
                              <Pencil size={12} />
                            </button>
                            <button
                              type="button" title="删除"
                              onClick={(e) => void handleDelete(e, s.id)}
                              className="w-6 h-6 flex items-center justify-center rounded text-[#64748B] hover:text-[#DC2626] bg-white/80 backdrop-blur-sm transition-colors"
                            >
                              <Trash2 size={12} />
                            </button>
                          </div>
                        </>
                      )}
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
        <div className="flex-shrink-0 px-3 py-3 border-t border-[#E2E8F0]">
          <button
            type="button"
            onClick={() => onCreate()}
            className="w-full flex items-center justify-center gap-2 h-10 rounded-lg
                       bg-[#0369A1] text-white text-sm font-medium
                       hover:bg-[#0EA5E9] transition-colors duration-150"
          >
            <Plus size={16} />
            <span>新建会话</span>
          </button>
        </div>
      </div>

      {/* 折叠态内容 */}
      <div className={`absolute inset-0 flex flex-col items-center py-3 gap-2
                       ${expanded ? 'opacity-0 pointer-events-none' : 'opacity-100'}
                       transition-opacity duration-150`}>
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

        {/* 会话图标列表 */}
        <div className="flex-1 overflow-y-auto flex flex-col items-center gap-1 px-2 w-full">
          {sessions.slice(0, 20).map(s => {
            const isRunning = runningIds.has(s.id);
            return (
              <button
                key={s.id}
                type="button"
                onClick={() => onSelect(s.id)}
                title={isRunning ? `正在运行 · ${s.title || '未命名会话'}` : (s.title || '未命名会话')}
                className={`relative w-9 h-9 flex items-center justify-center rounded-lg transition-colors
                            ${s.id === activeId
                              ? 'bg-[#E0F2FE] text-[#0369A1]'
                              : 'text-[#64748B] hover:bg-[#F1F5F9]'}`}
              >
                {isRunning
                  ? <Loader2 size={16} className="animate-spin text-[#0EA5E9]" />
                  : <Bot size={16} />}
              </button>
            );
          })}
        </div>

        {/* 新建会话 FAB */}
        <button type="button" onClick={() => onCreate()} title="新建会话"
                className="w-9 h-9 flex items-center justify-center rounded-full
                           bg-[#16A34A] text-white hover:bg-[#15803D] shadow-sm transition-colors">
          <Plus size={16} />
        </button>

        {/* 设置 */}
        <button type="button" title="设置"
                className="w-9 h-9 flex items-center justify-center rounded-lg
                           text-[#64748B] hover:bg-[#F1F5F9] transition-colors">
          <Settings size={16} />
        </button>
      </div>
    </nav>
  );
}
