/**
 * FloatingProgress：右上角悬浮岛容器（替换旧侧边第三栏 ProgressTracker）。
 *
 * 默认收起，仅展示 ProgressPill（当前节点）；点击展开 ProgressPanel 看节点详情。
 * 数据：合并模板与 runtime（模板顺序），派生 total/reached/active 下发子组件。
 * 绝对定位于工作台主区右上角，固定不随会话滚动。
 */
import { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import type { AgentStep, WorkflowType } from '@/types/agent';
import { mergeStepsWithTemplate, WORKFLOW_STEP_TEMPLATES } from '../workflow-step-templates';
import { ProgressPill } from './progress-pill';
import { ProgressPanel } from './progress-panel';

export interface FloatingProgressProps {
  /** 进度步骤（来自 selectProgressSource） */
  steps: AgentStep[];
  /** 是否运行态（保留契约） */
  running: boolean;
  /** workflow 类型（决定模板与分母） */
  workflowType: WorkflowType;
}

/** 悬浮岛主体 */
export function FloatingProgress({ steps, running: _running, workflowType }: FloatingProgressProps) {
  // 面板是否展开（默认收起）
  const [open, setOpen] = useState(false);

  // 合并模板与 runtime（模板顺序），派生计数与当前活跃节点
  const merged = mergeStepsWithTemplate(workflowType, steps);
  const total = WORKFLOW_STEP_TEMPLATES[workflowType]?.length ?? merged.length;
  const reached = merged.filter(s => s.status !== 'pending').length;
  const active = [...merged].reverse().find(s => s.status !== 'pending') ?? merged[0];

  // 无任何节点（异常）时不渲染
  if (!active) return null;

  return (
    <div className="absolute top-4 right-4 z-40 flex flex-col items-end">
      <ProgressPill
        active={active}
        reached={reached}
        total={total}
        open={open}
        onToggle={() => setOpen(v => !v)}
      />
      <AnimatePresence>
        {open && (
          <motion.div
            className="mt-2.5 origin-top-right"
            initial={{ opacity: 0, scale: 0.94, y: -8 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.94, y: -8 }}
            transition={{ type: 'spring', stiffness: 200, damping: 22 }}
          >
            <ProgressPanel steps={merged} reached={reached} total={total} />
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
