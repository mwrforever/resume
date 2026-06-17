/**
 * AgentTopbar：顶部品牌栏
 *
 * 深空蓝渐变背景，左 Logo+品牌名，中会话标题（点击打开重命名弹窗），右返回后台+用户头像。
 * 重命名交互改为弹窗（RenameSessionDialog），与侧栏统一。
 * 返回后台用 _top 确保新 Tab 场景能跳回主 SPA。
 */

import { useState } from 'react';
import { ArrowLeft, Pencil, Sparkles } from 'lucide-react';
import type { WorkspaceSession } from '@/types/agent';
import { RenameSessionDialog } from './rename-session-dialog';

export interface AgentTopbarProps {
  session?: WorkspaceSession | null;
  userName?: string;
  /** 标题重命名提交时触发（传新标题） */
  onRename?: (title: string) => Promise<void>;
}

export function AgentTopbar({ session, userName = 'HR', onRename }: AgentTopbarProps) {
  const nameAbbr = userName.slice(0, 2).toUpperCase();
  const [renaming, setRenaming] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  // 提交重命名（弹窗确认）
  const handleRename = async (title: string) => {
    if (!onRename) {
      setRenaming(false);
      return;
    }
    setSubmitting(true);
    try {
      if (title.trim() && title !== session?.title) await onRename(title);
      setRenaming(false);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <header
      className="relative h-14 flex-shrink-0 flex items-center justify-between px-4
                 bg-gradient-to-r from-[#082f49] via-[#0c2540] to-[#0f172a]
                 ring-1 ring-inset ring-white/[0.06]
                 shadow-[0_1px_0_0_rgba(255,255,255,0.04),0_4px_18px_-10px_rgba(2,6,23,0.6)]"
    >
      {/* 左：Logo 徽标 + 品牌名 */}
      <div className="flex items-center gap-2.5 min-w-0">
        <div className="relative flex h-8 w-8 flex-shrink-0 items-center justify-center
                        rounded-xl bg-gradient-to-br from-[#0EA5E9] to-[#0369A1]
                        text-white shadow-[0_4px_12px_-2px_rgba(14,165,233,0.5)]
                        ring-1 ring-inset ring-white/20">
          <Sparkles size={16} className="fill-white/30" strokeWidth={2.2} />
        </div>
        <div className="flex items-baseline gap-1.5 whitespace-nowrap">
          <span className="text-sm font-bold text-white tracking-tight">HR·Agent</span>
          <span className="hidden sm:inline text-[10px] font-medium uppercase tracking-[0.14em] text-sky-300/60">Workbench</span>
        </div>
      </div>

      {/* 中：当前会话标题（< 768px 隐藏），点击铅笔打开重命名弹窗 */}
      {session && (
        <div className="hidden md:flex items-center gap-2 text-xs text-white/70 max-w-[40%]">
          <span className="w-1 h-1 rounded-full bg-white/30" />
          <button
            type="button"
            onClick={() => setRenaming(true)}
            className="flex items-center gap-1.5 truncate hover:text-white transition-colors"
            title="点击重命名"
          >
            <span className="truncate">{session.title || '未命名会话'}</span>
            <Pencil size={11} className="opacity-50 hover:opacity-100" />
          </button>
        </div>
      )}

      {/* 右：返回后台 + 用户头像 */}
      <div className="flex items-center gap-2.5">
        <a
          href="/employee/dashboard"
          target="_top"
          className="hidden sm:inline-flex items-center gap-1.5 h-8 px-3 rounded-lg
                     text-xs font-medium text-white/70
                     ring-1 ring-inset ring-white/10
                     hover:text-white hover:bg-white/10 hover:ring-white/20
                     active:scale-[0.98] transition-all duration-200
                     ease-[cubic-bezier(0.16,1,0.3,1)]"
        >
          <ArrowLeft size={14} />
          <span>返回后台</span>
        </a>
        <div className="flex h-8 w-8 flex-shrink-0 items-center justify-center
                        rounded-full bg-gradient-to-br from-slate-400/30 to-slate-600/30
                        text-xs font-semibold text-white/90
                        ring-1 ring-inset ring-white/15
                        active:scale-[0.97] transition-transform"
             title={userName}>
          {nameAbbr}
        </div>
      </div>

      {/* 重命名弹窗（与侧栏复用同一组件） */}
      <RenameSessionDialog
        open={renaming}
        initialTitle={session?.title ?? ''}
        onConfirm={handleRename}
        onCancel={() => !submitting && setRenaming(false)}
      />
    </header>
  );
}
