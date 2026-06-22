/**
 * StepRow：进度栏单步行。
 *
 * 状态：
 * - pending：灰白圈占位；
 * - running：脉冲渐变球 + 旋转 loader + 光波文字（WaveText）；
 * - success：绿底白勾；
 * - failed：红底白 X。
 *
 * running 行整行带浅蓝渐变背景；连接线已完成段为渐变蓝并挂 `progress-flow-dot`
 * class（T15 在 index.css 中定义流光点 keyframes）。
 */
import { motion } from 'framer-motion';
import { Check, X } from 'lucide-react';
import type { AgentStep } from '@/types/agent';
import { WaveText } from '../wave-text';

interface StepRowProps {
  /** 该行的步骤数据 */
  step: AgentStep;
  /** 是否最后一行（最后一行不渲染下方连接线） */
  isLast: boolean;
  /** 节点序号（1-based）。提供时在 pending 空圈内显示数字，未提供则空圈（向后兼容） */
  index?: number;
}

/** 单行步骤渲染 */
export function StepRow({ step, isLast, index }: StepRowProps) {
  const isRunning = step.status === 'running';
  return (
    <motion.div
      layout
      className={`relative grid grid-cols-[28px_1fr] gap-x-2.5 gap-y-1 px-2 py-1.5 rounded-[10px]
        ${isRunning ? 'bg-[linear-gradient(90deg,rgba(14,165,233,0.06),rgba(14,165,233,0.02))]' : ''}`}
    >
      {/* 连接线：非最后一行渲染；success 时为渐变蓝（+ 流光点 class） */}
      {!isLast && (
        <span
          className={`absolute left-[21px] top-[30px] bottom-[-6px] w-0.5 rounded
            ${step.status === 'success'
              ? 'bg-[linear-gradient(180deg,#0EA5E9,#0369A1)] progress-flow-dot'
              : 'bg-[#E2E8F0]'}`}
        />
      )}
      <StepIcon status={step.status} index={index} />
      <div className="pt-[3px] min-w-0">
        <div className="text-[13px] font-medium leading-tight">
          {isRunning ? (
            <WaveText text={step.title} />
          ) : (
            <span
              className={
                step.status === 'pending'
                  ? 'text-[#94A3B8]'
                  : step.status === 'failed'
                    ? 'text-[#DC2626]'
                    : 'text-[#334155]'
              }
            >
              {step.title}
            </span>
          )}
        </div>
        {/* running 态下方显示 detail（如"正在分析…"），等宽字体增强"终端"质感 */}
        {step.detail && isRunning && (
          <div className="text-[11px] text-[#0369A1] mt-0.5 font-mono">{step.detail}</div>
        )}
      </div>
    </motion.div>
  );
}

/** 步骤图标：按状态返回四种样式；pending 态提供 index 时圈内显示序号 */
function StepIcon({ status, index }: { status: AgentStep['status']; index?: number }) {
  if (status === 'success') {
    return (
      <span className="w-7 h-7 rounded-[9px] bg-[#DCFCE7] text-[#16A34A] flex items-center justify-center relative z-[2]">
        <Check size={14} strokeWidth={2.5} />
      </span>
    );
  }
  if (status === 'running') {
    return (
      <span className="w-7 h-7 rounded-[9px] bg-[linear-gradient(135deg,#0EA5E9,#0369A1)] text-white flex items-center justify-center relative z-[2] progress-icon-pulse">
        <motion.span
          animate={{ rotate: 360 }}
          transition={{ repeat: Infinity, duration: 1, ease: 'linear' }}
          className="block w-3 h-3 border-2 border-white/40 border-t-white rounded-full"
        />
      </span>
    );
  }
  if (status === 'failed') {
    return (
      <span className="w-7 h-7 rounded-[9px] bg-[#FEE2E2] text-[#DC2626] flex items-center justify-center relative z-[2]">
        <X size={14} strokeWidth={2.5} />
      </span>
    );
  }
  // pending：白底灰边圈；提供 index 时圈内显示序号（议题 4）
  return (
    <span className="w-7 h-7 rounded-[9px] bg-white border-2 border-[#CBD5E1] flex items-center justify-center relative z-[2] text-[12px] font-semibold text-[#64748B]">
      {index}
    </span>
  );
}
