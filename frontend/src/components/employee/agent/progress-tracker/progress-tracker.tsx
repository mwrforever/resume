/**
 * ProgressTracker：右侧进度追踪栏（B1）。
 *
 * 自上而下垂直步骤列表，可收起（304px ↔ 60px，framer-motion spring 宽度过渡）。
 *
 * 数据源：
 * - 流式中：传入的 steps（来自 runState.steps）；
 * - 非流式：父组件（T16）从 session.progress 读取并传入（持久化展示）。
 *
 * 收起态：
 * - 每行仅显示图标，容器挂 data-step-title / data-step-status / data-step-id；
 * - ProgressTooltipPortal 在 document 级监听 mouseover，自动渲染悬浮 tooltip
 *   显示步骤名 + 状态（position:fixed 规避栏 overflow:hidden）。
 *
 * running 步骤标题用 WaveText 波浪文字，图标挂 `progress-icon-pulse` class；
 * 连接线 success 段挂 `progress-flow-dot` class（CSS 由 T15 在 index.css 定义）。
 */
import { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { ChevronLeft, ChevronRight, Check, X } from 'lucide-react';
import type { AgentStep, WorkflowType } from '@/types/agent';
import { mergeStepsWithTemplate, WORKFLOW_STEP_TEMPLATES } from '../workflow-step-templates';
import { StepRow } from './step-row';
import { ProgressTooltipPortal } from './progress-tooltip';

export interface ProgressTrackerProps {
  /** runtime 步骤（或持久化 session.progress.steps） */
  steps: AgentStep[];
  /** 当前是否处于运行态（保留契约，后续 T16 控制某些行为） */
  running: boolean;
  /** 工作流类型（决定模板节点数） */
  workflowType: WorkflowType;
}

/** 进度环半径（用于 dasharray 计算） */
const RING_RADIUS = 18;
const CIRCUMFERENCE = 2 * Math.PI * RING_RADIUS;

/** 右侧进度追踪栏主体 */
export function ProgressTracker({ steps, running: _running, workflowType }: ProgressTrackerProps) {
  const [collapsed, setCollapsed] = useState(false);

  // 合并模板与 runtime：前 N 项为 runtime 已到达节点，后 M 项为 pending 占位
  const merged = mergeStepsWithTemplate(workflowType, steps);
  // 分母：模板节点数（未知 workflow 时退化为 merged 长度）
  const total = WORKFLOW_STEP_TEMPLATES[workflowType]?.length ?? merged.length;
  // 分子：非 pending 步骤数（running 也计入，与 StepStrip 同语义）
  const reached = merged.filter(s => s.status !== 'pending').length;
  // 当前活跃步骤：merged 中最后一个非 pending 节点（无则取第一项）
  const active = [...merged].reverse().find(s => s.status !== 'pending') ?? merged[0];

  return (
    <>
      <motion.aside
        animate={{ width: collapsed ? 60 : 304 }}
        transition={{ type: 'spring', stiffness: 120, damping: 20 }}
        className="relative shrink-0 bg-white border-l border-[#E2E8F0] flex flex-col overflow-hidden"
        data-collapsed={collapsed}
      >
        {/* 头部：标题 + 进度环 + 收起按钮 */}
        <div className="p-3 border-b border-[#E2E8F0]">
          <div className={`flex items-center gap-2 mb-2 ${collapsed ? 'justify-center' : ''}`}>
            {!collapsed && (
              <span className="text-[11px] font-bold tracking-wider uppercase text-[#64748B]">
                流程进度
              </span>
            )}
            {!collapsed && (
              <button
                type="button"
                title="收起"
                onClick={() => setCollapsed(true)}
                className="ml-auto w-[26px] h-[26px] rounded-lg border border-[#E2E8F0] bg-white text-[#94A3B8] hover:text-[#0EA5E9] hover:border-[#0EA5E9] flex items-center justify-center"
              >
                <ChevronRight size={14} />
              </button>
            )}
          </div>
          {/* 展开态：圆形进度环 + 计数 + 活跃步骤标题 */}
          {!collapsed && (
            <div className="flex items-center gap-3 p-2.5 rounded-xl bg-[linear-gradient(135deg,#F0F9FF,#fff)] border border-[#E2E8F0]">
              <svg width="44" height="44" viewBox="0 0 44 44">
                <defs>
                  <linearGradient id="ptRing" x1="0" y1="0" x2="1" y2="1">
                    <stop offset="0%" stopColor="#0EA5E9" />
                    <stop offset="100%" stopColor="#0369A1" />
                  </linearGradient>
                </defs>
                <circle cx="22" cy="22" r="18" fill="none" stroke="#E2E8F0" strokeWidth="4" />
                <circle
                  cx="22"
                  cy="22"
                  r="18"
                  fill="none"
                  stroke="url(#ptRing)"
                  strokeWidth="4"
                  strokeLinecap="round"
                  strokeDasharray={CIRCUMFERENCE}
                  strokeDashoffset={CIRCUMFERENCE * (1 - reached / total)}
                  transform="rotate(-90 22 22)"
                  style={{ transition: 'stroke-dashoffset 0.6s cubic-bezier(0.16,1,0.3,1)' }}
                />
              </svg>
              <div>
                <div className="text-[11px] text-[#64748B] font-mono">
                  <b className="text-[#0369A1] text-base">{reached}</b> / {total} 步
                </div>
                {active && (
                  <div className="text-[12.5px] font-semibold text-[#020617] mt-0.5">
                    {active.title}
                  </div>
                )}
              </div>
            </div>
          )}
          {/* 收起态：圆形展开按钮 */}
          {collapsed && (
            <button
              type="button"
              title="展开"
              onClick={() => setCollapsed(false)}
              className="mx-auto w-9 h-9 rounded-[11px] bg-[linear-gradient(135deg,#0EA5E9,#0369A1)] text-white flex items-center justify-center shadow-lg"
            >
              <ChevronLeft size={16} />
            </button>
          )}
        </div>

        {/* 步骤列表：AnimatePresence + layout 实现重排/进出动画 */}
        <motion.div layout className={`flex-1 overflow-y-auto p-2 ${collapsed ? 'px-0' : ''}`}>
          <AnimatePresence initial={false}>
            {merged.map((s, i) => (
              <motion.div
                key={s.step_id}
                layout
                initial={{ opacity: 0, x: collapsed ? 0 : -8 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ delay: i * 0.045, type: 'spring', stiffness: 120, damping: 20 }}
              >
                {collapsed ? (
                  <CollapsedStepIcon step={s} />
                ) : (
                  <StepRow step={s} isLast={i === merged.length - 1} />
                )}
              </motion.div>
            ))}
          </AnimatePresence>
        </motion.div>
      </motion.aside>
      {/* 收起态悬浮 tooltip：document mouseover 监听 data-step-title */}
      <ProgressTooltipPortal />
    </>
  );
}

/**
 * 收起态单步：仅图标列。
 * 容器挂 data-step-title / data-step-status / data-step-id 供 ProgressTooltipPortal 读取。
 */
function CollapsedStepIcon({ step }: { step: AgentStep }) {
  return (
    <div
      className="flex justify-center py-2"
      data-step-title={step.title}
      data-step-status={step.status}
      data-step-id={step.step_id}
    >
      <span
        className={`w-[30px] h-[30px] rounded-[9px] flex items-center justify-center
          ${step.status === 'success'
            ? 'bg-[#DCFCE7] text-[#16A34A]'
            : step.status === 'running'
              ? 'bg-[linear-gradient(135deg,#0EA5E9,#0369A1)] text-white progress-icon-pulse'
              : step.status === 'failed'
                ? 'bg-[#FEE2E2] text-[#DC2626]'
                : 'bg-white border-2 border-[#CBD5E1] text-[#94A3B8]'}`}
      >
        {step.status === 'success' ? (
          <Check size={14} strokeWidth={2.5} />
        ) : step.status === 'failed' ? (
          <X size={14} strokeWidth={2.5} />
        ) : step.status === 'running' ? (
          <motion.span
            animate={{ rotate: 360 }}
            transition={{ repeat: Infinity, duration: 1, ease: 'linear' }}
            className="block w-3 h-3 border-2 border-white/40 border-t-white rounded-full"
          />
        ) : null}
      </span>
    </div>
  );
}
