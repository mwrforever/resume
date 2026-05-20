import { ChevronsLeft, ChevronsRight, Clock3, MessageSquare, Pencil, Plus, RefreshCw, Search, Trash2 } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import type { IAgentSessionItem } from '@/types/agent';
import { cn } from '@/lib/utils';
import { formatAgentTime, hiddenScrollClass } from './agent-ui-utils';

export type WorkspaceSession = IAgentSessionItem & { isLocal?: boolean };

interface AgentSessionSidebarProps {
  sessions: WorkspaceSession[];
  currentSessionId?: number | null;
  loadingSessionId?: number | null;
  collapsed: boolean;
  onCollapsedChange: (collapsed: boolean) => void;
  onOpenSession: (session: WorkspaceSession) => void;
  onCreateSession: () => void;
  onRefreshSessions: () => void;
  onSearchSessions: () => void;
  onRenameSession: (session: WorkspaceSession) => void;
  onDeleteSession: (session: WorkspaceSession) => void;
}

export function AgentSessionSidebar({ sessions, currentSessionId, loadingSessionId, collapsed, onCollapsedChange, onOpenSession, onCreateSession, onRefreshSessions, onSearchSessions, onRenameSession, onDeleteSession }: AgentSessionSidebarProps) {
  if (collapsed) {
    return (
      <aside aria-label="Agent 会话收起栏" className="flex min-h-0 w-[76px] flex-col items-center overflow-hidden rounded-[2rem] border border-slate-200/80 bg-slate-950 p-3 text-white shadow-xl shadow-slate-900/10 transition-[width,transform,opacity] duration-300 ease-out">
        <div className="flex w-full items-center justify-center gap-1 border-b border-white/10 pb-3">
          <span className="flex h-8 w-8 items-center justify-center rounded-xl bg-white/8 text-sky-300"><MessageSquare size={15} aria-hidden="true" /></span>
          <button type="button" onClick={() => onCollapsedChange(false)} aria-label="展开会话列表" className="cursor-pointer rounded-xl p-2 text-slate-300 transition-colors duration-200 hover:bg-white/10 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-300"><ChevronsRight size={16} aria-hidden="true" /></button>
        </div>
        <div className="mt-3 flex w-full flex-col items-center gap-2 border-b border-white/10 pb-3">
          <button type="button" onClick={onCreateSession} aria-label="新建会话" className="cursor-pointer rounded-xl bg-sky-500 p-2 text-white transition-colors duration-200 hover:bg-sky-400 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-300"><Plus size={16} aria-hidden="true" /></button>
          <button type="button" onClick={onSearchSessions} aria-label="搜索会话" className="cursor-pointer rounded-xl p-2 text-slate-300 transition-colors duration-200 hover:bg-white/10 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-300"><Search size={16} aria-hidden="true" /></button>
          <button type="button" onClick={onRefreshSessions} aria-label="刷新会话" className="cursor-pointer rounded-xl p-2 text-slate-300 transition-colors duration-200 hover:bg-white/10 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-300"><RefreshCw size={16} aria-hidden="true" /></button>
        </div>
        <div className={`mt-3 flex min-h-0 w-full flex-1 flex-col items-center gap-2 overflow-y-auto ${hiddenScrollClass}`}>
          {sessions.map((session) => {
            const selected = currentSessionId === session.id;
            return (
              <button key={session.id} type="button" onClick={() => onOpenSession(session)} title={session.title} aria-label={`打开会话：${session.title}`} className={cn('flex h-10 w-10 shrink-0 cursor-pointer items-center justify-center rounded-2xl border text-xs font-semibold transition-[background-color,border-color,transform] duration-200 hover:-translate-y-0.5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-300', selected ? 'border-sky-400/60 bg-sky-500/20 text-sky-100 shadow-sm shadow-sky-950/30' : 'border-transparent bg-white/8 text-slate-300 hover:border-white/10 hover:bg-white/12')}>
                {loadingSessionId === session.id ? '…' : session.title.slice(0, 1)}
              </button>
            );
          })}
        </div>
      </aside>
    );
  }

  return (
    <aside aria-label="Agent 会话列表" className="flex min-h-0 w-full flex-col overflow-hidden rounded-[2rem] border border-slate-200/80 bg-slate-950 text-white shadow-xl shadow-slate-900/10 transition-[width,transform,opacity] duration-300 ease-out">
      <div className="flex items-center justify-between border-b border-white/10 p-3">
        <div className="flex min-w-0 items-center gap-2 text-sm font-semibold">
          <MessageSquare size={17} className="shrink-0 text-sky-300" aria-hidden="true" />
          <span className="transition-opacity duration-200">会话</span>
        </div>
        <div className="flex items-center gap-1">
          <button type="button" onClick={onSearchSessions} aria-label="搜索会话" className="cursor-pointer rounded-xl p-2 text-slate-300 transition-colors duration-200 hover:bg-white/10 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-300"><Search size={15} aria-hidden="true" /></button>
          <button type="button" onClick={onRefreshSessions} aria-label="刷新会话" className="cursor-pointer rounded-xl p-2 text-slate-300 transition-colors duration-200 hover:bg-white/10 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-300"><RefreshCw size={15} aria-hidden="true" /></button>
          <button type="button" onClick={onCreateSession} aria-label="新建会话" className="cursor-pointer rounded-xl bg-sky-500 p-2 text-white transition-colors duration-200 hover:bg-sky-400 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-300"><Plus size={15} aria-hidden="true" /></button>
          <button type="button" onClick={() => onCollapsedChange(true)} aria-label="收起会话列表" className="cursor-pointer rounded-xl p-2 text-slate-300 transition-colors duration-200 hover:bg-white/10 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-300">
            <ChevronsLeft size={15} aria-hidden="true" />
          </button>
        </div>
      </div>
      <div className={`min-h-0 flex-1 space-y-2 overflow-y-auto p-3 ${hiddenScrollClass}`}>
        {sessions.map((session) => {
          const selected = currentSessionId === session.id;
          return (
            <div key={session.id} className={cn('group flex items-center gap-1 rounded-2xl border p-2 transition-[background-color,border-color,box-shadow,transform] duration-200', selected ? 'border-sky-400/50 bg-sky-500/15 shadow-sm shadow-sky-950/30' : 'border-transparent hover:border-white/10 hover:bg-white/8')}>
              <button type="button" onClick={() => onOpenSession(session)} className="min-w-0 flex-1 cursor-pointer rounded-xl px-2 py-1.5 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-300">
                <div className="flex min-w-0 items-center gap-2">
                  <span className="truncate text-sm font-semibold text-white">{session.title}</span>
                  {session.isLocal && <Badge variant="secondary">未保存</Badge>}
                </div>
                <div className="mt-1 flex min-w-0 items-center gap-1 text-xs text-slate-400"><Clock3 size={13} aria-hidden="true" /><span className="truncate">{formatAgentTime(session.last_message_time || session.update_time)}</span></div>
              </button>
              <div className="flex shrink-0 items-center gap-1 opacity-0 transition-opacity duration-200 group-hover:opacity-100 group-focus-within:opacity-100">
                {loadingSessionId === session.id ? <Badge variant="secondary">加载</Badge> : null}
                <button type="button" onClick={() => onRenameSession(session)} className="cursor-pointer rounded-lg p-1.5 text-slate-400 hover:bg-white/10 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-300" aria-label="重命名会话"><Pencil size={13} aria-hidden="true" /></button>
                <button type="button" onClick={() => onDeleteSession(session)} className="cursor-pointer rounded-lg p-1.5 text-slate-400 hover:bg-red-500/15 hover:text-red-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-300" aria-label="删除会话"><Trash2 size={13} aria-hidden="true" /></button>
              </div>
            </div>
          );
        })}
        {sessions.length === 0 && <div className="rounded-2xl border border-dashed border-sky-300/30 bg-white/5 p-4 text-sm leading-6 text-slate-300">暂无会话，可以直接发送消息创建一次新的 Agent 对话。</div>}
      </div>
    </aside>
  );
}
