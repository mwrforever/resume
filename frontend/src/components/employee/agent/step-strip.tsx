/**
 * StepStrip：折叠的运行步骤条。
 *
 * - 默认折叠为单行："运行过程 · 已完成 N 步 · X.Xs   展开 ▾"
 * - 展开后展示小型时间线：✓ 步骤名 / ● 当前 / ○ 待执行
 * - 状态点用文本+颜色双重表达
 */

import { useState } from 'react';
import { ChevronDown, Check, Loader2 } from 'lucide-react';
import type { AgentStep } from '@/types/agent';

export interface StepStripProps {
  steps: AgentStep[];
  running: boolean;
}

export function StepStrip({ steps, running }: StepStripProps) {
  const [expanded, setExpanded] = useState(false);
  const successCount = steps.filter(s => s.status === 'success').length;
  if (steps.length === 0) return null;

  return (
    <div className="sticky top-0 z-10 my-2 rounded border border-border bg-surface/95 backdrop-blur">
      <button type="button" onClick={() => setExpanded(v => !v)}
              className="flex w-full items-center gap-2 px-3 py-2 text-xs text-mutedText hover:bg-surfaceMuted transition-colors">
        {running ? <Loader2 size={12} className="animate-spin text-primary" />
                 : <Check size={12} className="text-success" />}
        <span>运行过程 · 已完成 {successCount} / {steps.length} 步</span>
        <ChevronDown size={12} className={`ml-auto transition-transform ${expanded ? 'rotate-180' : ''}`} />
      </button>
      <div className="overflow-hidden transition-all"
           style={{ maxHeight: expanded ? 240 : 0, opacity: expanded ? 1 : 0 }}>
        <ul className="px-3 pb-2 space-y-1 text-xs">
          {steps.map(s => (
            <li key={s.step_id} className="flex items-center gap-2">
              <StepIcon status={s.status} />
              <span className={s.status === 'pending' ? 'text-gray-400' : 'text-foreground'}>
                {s.title}
              </span>
              {s.detail && <span className="text-gray-400 ml-2">{s.detail}</span>}
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}

function StepIcon({ status }: { status: AgentStep['status'] }) {
  if (status === 'running') return <Loader2 size={12} className="animate-spin text-primary" />;
  if (status === 'success') return <Check size={12} className="text-success" />;
  if (status === 'failed') return <span className="w-3 h-3 inline-block rounded-full bg-destructive" />;
  return <span className="w-3 h-3 inline-block rounded-full border border-gray-300" />;
}
