/**
 * ToolUseBlock：工具调用状态块。
 *
 * - running 旋转 loading 图标
 * - success 显示 output 摘要
 * - failed 显示 error 信息
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
    <div className="flex items-center gap-2 px-3 py-2 rounded-md border border-border bg-surface text-sm">
      {/* 状态图标 */}
      {isRunning ? (
        <svg className="w-4 h-4 text-primary animate-spin" fill="none" viewBox="0 0 24 24">
          <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
          <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
        </svg>
      ) : isFailed ? (
        <svg className="w-4 h-4 text-destructive" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
        </svg>
      ) : (
        <svg className="w-4 h-4 text-success" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
        </svg>
      )}

      {/* 工具名称 */}
      <span className="text-mutedText font-medium">{display_name || tool_name}</span>

      {/* 状态标签 */}
      {isRunning && <span className="text-subtleText text-xs">运行中…</span>}
      {isFailed && error && <span className="text-destructive text-xs">{error}</span>}
    </div>
  );
}
