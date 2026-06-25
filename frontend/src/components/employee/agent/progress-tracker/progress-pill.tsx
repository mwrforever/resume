/**
 * ProgressPill：悬浮岛收起态胶囊。
 *
 * 默认仅展示当前节点：迷你进度环（reached/total）+ 当前节点图标 + 标题
 * （running 时用 WaveText 波浪文字）+ 展开箭头。点击整体触发展开/收起。
 */
import { ChevronDown } from 'lucide-react';
import type { AgentStep } from '@/types/agent';
import { WaveText } from '../wave-text';

/** 迷你环半径与周长 */
const R = 13;
const C = 2 * Math.PI * R;

export interface ProgressPillProps {
  /** 当前活跃节点（merged 中最后一个非 pending，无则首项） */
  active: AgentStep;
  /** 已到达步骤数 */
  reached: number;
  /** 模板总步数 */
  total: number;
  /** 面板是否展开（控制箭头旋转） */
  open: boolean;
  /** 点击切换展开/收起 */
  onToggle: () => void;
}

/** 收起态胶囊 */
export function ProgressPill({ active, reached, total, open, onToggle }: ProgressPillProps) {
  const isRunning = active.status === 'running';
  return (
    <button
      type="button"
      onClick={onToggle}
      aria-expanded={open}
      aria-label={`流程进度 ${reached}/${total} 步，当前${active.title}，点击${open ? '收起' : '展开'}详情`}
      className="flex items-center gap-2.5 h-11 pl-2 pr-3.5 rounded-full cursor-pointer
                 bg-white/80 backdrop-blur-xl backdrop-saturate-150
                 border border-white/60 active:scale-[0.98] transition-transform
                 shadow-[0_20px_48px_-16px_rgba(2,6,23,0.18),inset_0_1px_0_rgba(255,255,255,0.7)]"
    >
      {/* 迷你进度环 + 居中计数 */}
      <span className="relative shrink-0">
        <svg width="32" height="32" viewBox="0 0 32 32">
          <defs>
            <linearGradient id="pillRing" x1="0" y1="0" x2="1" y2="1">
              <stop offset="0%" stopColor="#0EA5E9" />
              <stop offset="100%" stopColor="#0369A1" />
            </linearGradient>
          </defs>
          <circle cx="16" cy="16" r={R} fill="none" stroke="#E2E8F0" strokeWidth="3" />
          <circle
            cx="16" cy="16" r={R} fill="none" stroke="url(#pillRing)" strokeWidth="3"
            strokeLinecap="round" strokeDasharray={C}
            strokeDashoffset={C * (1 - (total ? reached / total : 0))}
            transform="rotate(-90 16 16)"
            style={{ transition: 'stroke-dashoffset 0.6s cubic-bezier(0.16,1,0.3,1)' }}
          />
        </svg>
        <span className="absolute inset-0 flex items-center justify-center text-[9px] font-bold text-[#0369A1] font-mono">
          {reached}/{total}
        </span>
      </span>

      {/* 当前节点标题：running 用波浪文字，其余纯文本 */}
      <span className="min-w-0 text-left">
        <span className="block text-[12.5px] font-semibold text-[#020617] truncate max-w-[140px]">
          {isRunning ? <WaveText text={active.title} /> : active.title}
        </span>
        <span className="block text-[10px] text-[#64748B]">
          {statusLabel(active.status)}
        </span>
      </span>

      {/* 展开箭头 */}
      <ChevronDown
        size={14}
        className="text-[#94A3B8] transition-transform"
        style={{ transform: open ? 'rotate(180deg)' : 'none' }}
      />
    </button>
  );
}

/** 状态副标题文案 */
function statusLabel(status: AgentStep['status']): string {
  switch (status) {
    case 'running': return '进行中';
    case 'success': return '已完成';
    case 'failed': return '已失败';
    default: return '待处理';
  }
}
