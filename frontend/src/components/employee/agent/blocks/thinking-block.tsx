/**
 * ThinkingBlock：AI 思考过程折叠块
 *
 * - 默认折叠，点击展开
 * - 紫色左边框 3px border-l-[3px] border-l-[#7C3AED]
 * - 不再带整体 border / bg / rounded（由 AgentMessageCard 的 px-4 py-3 提供间距）
 */

import { useState } from 'react';
import { ChevronRight } from 'lucide-react';
import type { AgentBlock } from '@/types/agent';
import { useFrameBatchedText } from '@/hooks/use-frame-batched-text';

interface ThinkingBlockProps {
  block: AgentBlock & { type: 'thinking' };
}

export function ThinkingBlock({ block }: ThinkingBlockProps) {
  const [expanded, setExpanded] = useState(false);
  const isStreaming = block.status === 'streaming';
  const { displayed, flush } = useFrameBatchedText(block.text);
  const text = isStreaming ? displayed : block.text;

  if (!isStreaming && displayed !== block.text) {
    flush();
  }

  return (
    <div className="border-l-[3px] border-l-[#7C3AED] pl-3">
      {/* 折叠头部 */}
      <button
        type="button"
        className="flex items-center gap-2 w-full text-left text-sm text-[#7C3AED] font-medium
                   hover:text-[#6D28D9] transition-colors duration-fast"
        onClick={() => setExpanded(e => !e)}
        aria-expanded={expanded}
      >
        <ChevronRight
          size={14}
          className={`transition-transform duration-fast ${expanded ? 'rotate-90' : ''}`}
        />
        <span>{isStreaming ? '正在思考…' : '思考过程'}</span>
      </button>

      {/* 展开内容 */}
      {expanded && (
        <div className="mt-2 text-sm leading-relaxed whitespace-pre-wrap text-[#334155] font-mono">
          {text}
          {isStreaming && (
            <span className="inline-block w-[2px] h-[14px] bg-[#7C3AED] ml-0.5 align-middle animate-pulse" />
          )}
        </div>
      )}
    </div>
  );
}
