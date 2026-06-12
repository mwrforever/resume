/**
 * AgentSidebarDrawer：抽屉式会话侧栏
 *
 * 折叠态 64px（仅 Bot 图标列）
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
  const leaveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const sidebarRef = useRef<HTMLDivElement>(null);
  const expanded = pinned || hovered;

  const clearLeaveTimer = () => { if (leaveTimer.current) clearTimeout(leaveTimer.current); };

  const handleMouseLeave = useCallback(() => {
    if (pinned) return;
    clearLeaveTimer();
    leaveTimer.current = setTimeout(() => setHovered(false), 2000);
  }, [pinned]);

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
