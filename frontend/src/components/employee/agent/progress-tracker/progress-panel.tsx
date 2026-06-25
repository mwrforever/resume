/**
 * ProgressPanel：悬浮岛展开态玻璃面板。
 *
 * 头部：流程进度标签 + reached/total 计数；
 * 列表：默认仅渲染前 DEFAULT_VISIBLE 个节点，超出显示"加载更多"，点开渲染全部；
 * 最大高度限定在单视窗内（max-h），溢出走精小滚动条 thin-scroll。
 * 单行复用 StepRow（含 WaveText / 流光连接线动画）。
 */
import { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import type { AgentStep } from '@/types/agent';
import { StepRow } from './step-row';

/** 默认展示节点数（超出折叠到"加载更多"） */
const DEFAULT_VISIBLE = 5;

export interface ProgressPanelProps {
  /** 已 merge 的完整步骤数组（模板顺序） */
  steps: AgentStep[];
  /** 已到达步骤数（非 pending） */
  reached: number;
  /** 模板总步数 */
  total: number;
}

/** 展开态面板主体 */
export function ProgressPanel({ steps, reached, total }: ProgressPanelProps) {
  // 是否展开全部节点（默认折叠到前 5 个）
  const [expanded, setExpanded] = useState(false);
  const visible = expanded ? steps : steps.slice(0, DEFAULT_VISIBLE);
  const hiddenCount = steps.length - DEFAULT_VISIBLE;

  return (
    <div
      className="w-72 rounded-[20px] overflow-hidden
                 bg-white/80 backdrop-blur-xl backdrop-saturate-150
                 border border-white/60
                 shadow-[0_20px_48px_-16px_rgba(2,6,23,0.18),inset_0_1px_0_rgba(255,255,255,0.7)]"
    >
      {/* 头部：标签 + 计数 */}
      <div className="flex items-center gap-2 px-3.5 py-3 border-b border-[#E2E8F0]/70">
        <span className="text-[10.5px] font-bold tracking-wider uppercase text-[#64748B]">
          流程进度
        </span>
        <span className="ml-auto text-[11px] text-[#64748B] font-mono">
          <b className="text-[#0369A1] text-sm">{reached}</b> / {total} 步
        </span>
      </div>

      {/* 节点列表：最大高度限定单视窗内，溢出滚动 */}
      <div className="p-2 max-h-[min(70vh,360px)] overflow-y-auto thin-scroll">
        <AnimatePresence initial={false}>
          {visible.map((s, i) => (
            <motion.div
              key={s.step_id}
              layout
              initial={{ opacity: 0, x: -6 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ delay: i * 0.04, type: 'spring', stiffness: 120, damping: 20 }}
            >
              <StepRow step={s} isLast={i === visible.length - 1} index={i + 1} />
            </motion.div>
          ))}
        </AnimatePresence>

        {/* 加载更多：节点超过默认数且未展开时显示 */}
        {!expanded && steps.length > DEFAULT_VISIBLE && (
          <button
            type="button"
            onClick={() => setExpanded(true)}
            className="w-full mt-1 py-2 rounded-[9px] text-[11.5px] font-semibold
                       text-[#0369A1] hover:bg-[#0EA5E9]/8 transition-colors"
          >
            加载更多（还有 {hiddenCount} 步）
          </button>
        )}
      </div>
    </div>
  );
}
