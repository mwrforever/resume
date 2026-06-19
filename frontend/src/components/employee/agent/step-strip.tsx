/**
 * StepStrip：运行步骤条
 *
 * 数据来源：runState.steps（运行时 step.update 累积）+ workflow 静态节点模板
 * （workflow-step-templates.ts）。展示「已完成 N / 总 M 步」，分母恒为模板长度，
 * 驳回循环（同 step_id 重入）不增加分母。
 *
 * 默认折叠为单行；展开后显示水平时间线，含未到达的 pending 项。
 * 步骤状态：待执行(灰圈) → 进行中(蓝旋转) → 已完成(绿勾) → 失败(红X)。
 *
 * 注意：思考过程不在步骤条展示——阶段/维度思考统一走 tool_use 块（可持久化），
 * 由 ToolUseBlock 内的 ReasoningSection 承载。
 */

import { useState } from 'react';
import { ChevronDown, Check, X, Loader2 } from 'lucide-react';
import type { AgentStep, WorkflowType } from '@/types/agent';
import { WaveText } from './wave-text';
import { mergeStepsWithTemplate, WORKFLOW_STEP_TEMPLATES } from './workflow-step-templates';

export interface StepStripProps {
  /** 运行时累积的 step.update（来自 runState.steps），按到达顺序 */
  steps: AgentStep[];
  /** 当前是否在跑流式 run（影响图标 / 文案 / 波浪动画） */
  running: boolean;
  /** workflow 类型（用于查模板拿到总步数与未到达步骤标题） */
  workflowType: WorkflowType;
}

export function StepStrip({ steps, running, workflowType }: StepStripProps) {
  const [expanded, setExpanded] = useState(false);

  // 模板合并：runtime steps 按 step_id 替换模板项，长度 = 模板长度（异常分支可能追加未知 step）
  const mergedSteps = mergeStepsWithTemplate(workflowType, steps);
  const successCount = mergedSteps.filter(s => s.status === 'success').length;
  // 分母恒为 workflow 模板静态长度，避免异常分支追加未知 step 时分母抖动；
  // 未知 workflow（fallback 路径）退回 mergedSteps.length
  const totalCount = WORKFLOW_STEP_TEMPLATES[workflowType]?.length ?? mergedSteps.length;

  // 当前活跃步骤：第一个非 success 项；全部 success 时取最后一项（运行结束态）
  const activeStep =
    mergedSteps.find(s => s.status !== 'success') ?? mergedSteps[mergedSteps.length - 1];

  // 模板长度永远 ≥ 1（WORKFLOW_STEP_TEMPLATES 不允许空），但 fallback / 未来扩展时仍兜底
  if (mergedSteps.length === 0) return null;

  return (
    <div className="px-4 py-2 text-xs">
      {/* 折叠头部 */}
      <button
        type="button"
        onClick={() => setExpanded(v => !v)}
        className="flex w-full items-center gap-2 text-[#64748B] hover:text-[#020617] transition-colors"
      >
        {/* 全局状态图标 */}
        {running ? (
          <Loader2 size={14} className="text-[#0EA5E9] animate-spin" />
        ) : (
          <Check size={14} className="text-[#16A34A]" />
        )}
        <span>
          {running ? (
            <>
              运行中 · {successCount} / {totalCount} 步
              {activeStep && (
                <>
                  <span className="text-[#64748B]"> · </span>
                  <WaveText text={activeStep.title} />
                </>
              )}
            </>
          ) : (
            `已完成 ${successCount} / ${totalCount} 步`
          )}
        </span>
        <ChevronDown size={14} className={`ml-auto transition-transform duration-150 ${expanded ? 'rotate-180' : ''}`} />
      </button>

      {/* 展开步骤时间线（含未到达的 pending 项） */}
      <div className={`overflow-hidden transition-all duration-220 ${
        expanded ? 'max-h-60 opacity-100 mt-2' : 'max-h-0 opacity-0'
      }`}>
        <ul className="flex flex-wrap gap-x-4 gap-y-1.5">
          {mergedSteps.map((s) => {
            // 当前活跃步骤（且整体 running）用 WaveText 高亮，其余静态
            const isActive = running && s.step_id === activeStep?.step_id && s.status !== 'success';
            return (
              <li key={s.step_id} className="flex items-center gap-1.5">
                <StepIcon status={s.status} />
                <span className={s.status === 'pending' ? 'text-[#94A3B8]' : 'text-[#334155]'}>
                  {isActive ? <WaveText text={s.title} /> : s.title}
                </span>
                {s.detail && <span className="text-[#94A3B8] ml-0.5">{s.detail}</span>}
              </li>
            );
          })}
        </ul>
      </div>
    </div>
  );
}

function StepIcon({ status }: { status: AgentStep['status'] }) {
  if (status === 'pending') {
    return <span className="w-3 h-3 inline-block rounded-full border-2 border-[#CBD5E1]" />;
  }
  if (status === 'running') {
    return <span className="w-3 h-3 inline-block rounded-full border-2 border-[#0EA5E9] border-t-transparent animate-spin" />;
  }
  if (status === 'success') {
    return (
      <span className="w-3 h-3 inline-flex items-center justify-center rounded-full bg-[#DCFCE7]">
        <Check size={8} className="text-[#16A34A]" />
      </span>
    );
  }
  // failed
  return (
    <span className="w-3 h-3 inline-flex items-center justify-center rounded-full bg-[#FEE2E2]">
      <X size={8} className="text-[#DC2626]" />
    </span>
  );
}
