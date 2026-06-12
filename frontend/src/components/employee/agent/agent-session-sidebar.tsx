/**
 * AgentSessionSidebar：左侧会话列表。
 */

import { useState } from 'react';
import { Plus, Search } from 'lucide-react';
import type { WorkspaceSession } from '@/types/agent';

export interface AgentSessionSidebarProps {
  sessions: WorkspaceSession[];
  activeId: number | null;
  onSelect: (id: number) => void;
  onCreate: () => void;
  onSearch: (keyword: string) => void;
}

export function AgentSessionSidebar({
  sessions, activeId, onSelect, onCreate, onSearch,
}: AgentSessionSidebarProps) {
  const [kw, setKw] = useState('');

  return (
    <aside className="w-[280px] border-r border-gray-200 bg-white flex flex-col">
      {/* 新建 + 搜索 */}
      <div className="p-3 space-y-2 border-b border-gray-200">
        <button type="button" onClick={onCreate}
                className="flex w-full items-center justify-center gap-1 h-9 rounded bg-blue-600 text-white text-xs font-medium hover:bg-blue-700 transition-colors">
          <Plus size={14} /> 新建会话
        </button>
        <div className="relative">
          <Search size={12} className="absolute left-2 top-1/2 -translate-y-1/2 text-gray-400" />
          <input
            value={kw} onChange={e => { setKw(e.target.value); onSearch(e.target.value); }}
            placeholder="搜索会话"
            className="w-full h-8 pl-7 pr-2 rounded border border-gray-200 text-xs focus:outline-none focus:ring-2 focus:ring-blue-200"
          />
        </div>
      </div>

      {/* 会话列表 */}
      <ul className="flex-1 overflow-y-auto p-2 space-y-1">
        {sessions.map(s => (
          <li key={s.id}>
            <button type="button" onClick={() => onSelect(s.id)}
                    className={`w-full text-left px-3 py-2 rounded text-xs transition-colors ${
                      activeId === s.id
                        ? 'bg-blue-50 text-blue-600 font-medium'
                        : 'text-gray-800 hover:bg-gray-50'
                    }`}>
              <div className="truncate">{s.title || '未命名会话'}</div>
              {s.last_message_time && (
                <div className="text-[11px] text-gray-400">{s.last_message_time}</div>
              )}
            </button>
          </li>
        ))}
        {sessions.length === 0 && (
          <li className="text-center text-xs text-gray-400 py-6">暂无会话</li>
        )}
      </ul>
    </aside>
  );
}
