/**
 * CollapsedSessionPopover：侧栏收起态的单图标按钮 + 悬浮会话列表卡片。
 *
 * 鼠标移入/聚焦图标 → 弹出白色卡片，列出会话（复用 sortSessionsByTime，
 * 全部按 last_message_time 降序，不再分组）。移出即收起。点击会话项切换并关闭。
 */

import * as Popover from '@radix-ui/react-popover';
import { MessageSquare, Loader2 } from 'lucide-react';
import type { WorkspaceSession } from '@/types/agent';
import { sortSessionsByTime } from './agent-sidebar-drawer';

interface CollapsedSessionPopoverProps {
  sessions: WorkspaceSession[];
  activeId: number | null;
  runningIds: Set<number>;
  onSelect: (id: number) => void;
}

export function CollapsedSessionPopover({
  sessions, activeId, runningIds, onSelect,
}: CollapsedSessionPopoverProps) {
  const sorted = sortSessionsByTime(sessions);
  return (
    <Popover.Root>
      <Popover.Trigger asChild>
        <button
          type="button"
          title="会话列表"
          aria-label="会话列表"
          className="w-9 h-9 flex items-center justify-center rounded-lg
                     bg-[#0369A1] text-white hover:bg-[#0EA5E9] transition-colors"
        >
          <MessageSquare size={16} />
        </button>
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content
          side="right"
          align="start"
          sideOffset={8}
          className="z-50 w-64 max-h-96 overflow-y-auto rounded-xl border border-[#E2E8F0]
                     bg-white shadow-xl p-2"
        >
          <p className="px-2 py-1 text-[11px] text-[#94A3B8] tracking-wide">会话（按时间降序）</p>
          {sorted.map(s => {
            const isRunning = runningIds.has(s.id);
            return (
              <button
                key={s.id}
                type="button"
                onClick={() => onSelect(s.id)}
                className={`w-full text-left px-2 py-1.5 rounded-md text-sm transition-colors
                  ${s.id === activeId
                    ? 'bg-[#E0F2FE] text-[#0369A1] font-semibold'
                    : 'text-[#334155] hover:bg-[#F1F5F9]'}`}
              >
                <span className="flex items-center gap-2">
                  {isRunning && <Loader2 size={12} className="animate-spin text-[#0EA5E9]" />}
                  <span className="truncate">{s.title || '未命名会话'}</span>
                </span>
              </button>
            );
          })}
          {sorted.length === 0 && (
            <p className="px-2 py-3 text-center text-xs text-[#94A3B8]">暂无会话</p>
          )}
          <Popover.Arrow className="fill-white" />
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}
