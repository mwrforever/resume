/**
 * StepStrip：运行步骤条（增强版）
 *
 * 默认折叠为单行，显示"已完成 N / M 步"。
 * 展开后显示水平时间线。
 * 步骤状态：待执行(灰圈) → 进行中(蓝色旋转) → 已完成(绿勾) → 失败(红X)。
 */

import { useState } from 'react';
import { ChevronDown, Check, X, Loader2 } from 'lucide-react';
import type { AgentStep } from '@/types/agent';

export interface StepStripProps {
  steps: AgentStep[];
  running: boolean;
}

export function StepStrip({ steps, running }: StepStripProps) {
  const [expanded, setExpanded] = useState(false);
  const successCount = steps.filter(s => s.status === 'success').length;
  const runningStep = steps.find(s => s.status === 'running');
  if (steps.length === 0) return null;

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
          {running
            ? `运行中 · ${successCount} / ${steps.length} 步${runningStep ? ` · ${runningStep.title}` : ''}`
            : `已完成 ${successCount} / ${steps.length} 步`}
        </span>
        <ChevronDown size={14} className={`ml-auto transition-transform duration-150 ${expanded ? 'rotate-180' : ''}`} />
      </button>

      {/* 展开步骤时间线 */}
      <div className={`overflow-hidden transition-all duration-220 ${
        expanded ? 'max-h-60 opacity-100 mt-2' : 'max-h-0 opacity-0'
      }`}>
        <ul className="flex flex-wrap gap-x-4 gap-y-1.5">
          {steps.map(s => (
            <li key={s.step_id} className="flex items-center gap-1.5">
              <StepIcon status={s.status} />
              <span className={s.status === 'pending' ? 'text-[#94A3B8]' : 'text-[#334155]'}>
                {s.title}
              </span>
              {s.detail && <span className="text-[#94A3B8] ml-0.5">{s.detail}</span>}
            </li>
          ))}
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
