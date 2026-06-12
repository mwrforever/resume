/**
 * AgentTopbar：顶部品牌栏
 *
 * 深空蓝渐变背景，左 Logo+品牌名，中会话标题，右返回后台+用户头像。
 * 返回后台用 _top 确保新 Tab 场景能跳回主 SPA。
 */

import { ArrowLeft } from 'lucide-react';
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
