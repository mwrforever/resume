/**
 * ToolUseBlock：工具调用状态块
 *
 * running → 旋转 spinner | success → 绿勾 + 可点开看 output 详情 | failed → 红 error。
 * 单维度失败不阻塞其他，error 内联展示。
 */

import { useState } from 'react';
import type { AgentBlock } from '@/types/agent';

interface ToolUseBlockProps {
  block: AgentBlock & { type: 'tool_use' };
}

export function ToolUseBlock({ block }: ToolUseBlockProps) {
  const { tool_name, display_name, status, error, output } = block;
  const isRunning = status === 'streaming';
  const isFailed = status === 'failed';
  const [expanded, setExpanded] = useState(false);

  return (
    <div className="inline-flex flex-col gap-1">
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
        {/* 成功后展示产出计数，可点击展开 */}
        {!isRunning && !isFailed && output?.count != null && (
          <button
            type="button"
            onClick={() => setExpanded(e => !e)}
            className="text-[#16A34A] hover:underline text-xs font-medium"
          >
            {expanded ? '收起' : `生成 ${output.count} 题`}
          </button>
        )}
        {isFailed && error && <span className="text-[#DC2626] text-xs">{error}</span>}
      </div>

      {/* 展开后的 output 详情 */}
      {expanded && output && (
        <pre className="ml-1 mt-1 p-2 rounded-md bg-[#F8FAFC] border border-[#E2E8F0]
                        text-[11px] text-[#64748B] font-mono max-w-[520px] overflow-x-auto">
{JSON.stringify(output, null, 2)}
        </pre>
      )}
    </div>
  );
}
