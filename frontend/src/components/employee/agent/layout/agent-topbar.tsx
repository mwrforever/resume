/**
 * AgentTopbar：顶部品牌栏
 *
 * 深空蓝渐变背景，左 Logo+品牌名，中会话标题（点击 inline 编辑），右返回后台+用户头像。
 * 返回后台用 _top 确保新 Tab 场景能跳回主 SPA。
 */

import { useState } from 'react';
import { ArrowLeft, Pencil, Check, X } from 'lucide-react';
import type { WorkspaceSession } from '@/types/agent';

export interface AgentTopbarProps {
  session?: WorkspaceSession | null;
  userName?: string;
  /** 标题 inline 编辑提交时触发（传新标题） */
  onRename?: (title: string) => Promise<void>;
}

export function AgentTopbar({ session, userName = 'HR', onRename }: AgentTopbarProps) {
  const nameAbbr = userName.slice(0, 2).toUpperCase();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState('');

  const startEdit = () => {
    setDraft(session?.title ?? '');
    setEditing(true);
  };
  const commit = async () => {
    const t = draft.trim();
    setEditing(false);
    if (t && t !== session?.title && onRename) await onRename(t);
  };
  const cancel = () => setEditing(false);

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

      {/* 中：当前会话标题（< 768px 隐藏），点击/铅笔进入 inline 编辑 */}
      {session && (
        <div className="hidden md:flex items-center gap-2 text-xs text-white/70 max-w-[40%]">
          <span className="w-1 h-1 rounded-full bg-white/30" />
          {editing ? (
            <span className="flex items-center gap-1">
              <input
                autoFocus
                value={draft}
                onChange={e => setDraft(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') void commit();
                  else if (e.key === 'Escape') cancel();
                }}
                className="h-6 px-2 rounded bg-white/10 border border-white/20 text-white text-xs outline-none w-48"
              />
              <button type="button" onClick={() => void commit()} title="确认"
                      className="hover:text-white transition-colors">
                <Check size={12} />
              </button>
              <button type="button" onClick={cancel} title="取消"
                      className="hover:text-white transition-colors">
                <X size={12} />
              </button>
            </span>
          ) : (
            <button
              type="button"
              onClick={startEdit}
              className="flex items-center gap-1 truncate hover:text-white transition-colors"
              title="点击编辑标题"
            >
              <span className="truncate">{session.title || '未命名会话'}</span>
              <Pencil size={11} className="opacity-50 hover:opacity-100" />
            </button>
          )}
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
