/**
 * ToolUseBlock：工具调用状态块
 *
 * 灰底 chip 风格，不再带 border/rounded-md（卡片由 AgentMessageCard 包裹）。
 * running → 旋转 spinner | success → 绿勾 | failed → 红 error。
 */

import type { AgentBlock } from '@/types/agent';

interface ToolUseBlockProps {
  block: AgentBlock & { type: 'tool_use' };
}

export function ToolUseBlock({ block }: ToolUseBlockProps) {
  const { tool_name, display_name, status, error } = block;
  const isRunning = status === 'streaming';
  const isFailed = status === 'failed';

  return (
    <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-[#F1F5F9] text-sm">
      {isRunning ? (
        <svg className="w-3.5 h-3.5 text-[#0EA5E9] animate-spin" fill="none" viewBox="0 0 24 24">
          <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
          <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
        </svg>
      ) : isFailed ? (
        <span className="w-3.5 h-3.5 inline-flex items-center justify-center rounded-full bg-[#FEE2E2]">
          <span className="text-[8px] text-[#DC2626] font-bold">!</span>
        </span>
      ) : (
        <svg className="w-3.5 h-3.5 text-[#16A34A]" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
        </svg>
      )}

      <span className="text-[#334155] font-medium text-xs">{display_name || tool_name}</span>

      {isRunning && <span className="text-[#94A3B8] text-xs">运行中…</span>}
      {isFailed && error && <span className="text-[#DC2626] text-xs">{error}</span>}
    </div>
  );
}
