/**
 * ThinkingBlock：AI 思考过程折叠块。
 *
 * - 默认折叠，点击展开
 * - 紫色主题区分正文（thinkingBg / thinkingBorder / thinkingText）
 * - streaming 末尾光标；success 后 fade-out
 */

import { useState } from 'react';
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
    <div className="rounded-md border border-thinkingBorder bg-thinkingBg">
      {/* 折叠头部 */}
      <button
        type="button"
        className="flex items-center gap-2 w-full px-3 py-2 text-thinkingText text-sm font-medium
                   hover:bg-surfaceMuted/50 transition-colors duration-fast"
        onClick={() => setExpanded(e => !e)}
        aria-expanded={expanded}
      >
        <svg
          className={`w-3.5 h-3.5 transition-transform duration-fast ${expanded ? 'rotate-90' : ''}`}
          fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}
        >
          <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
        </svg>
        <span>{isStreaming ? '正在思考…' : '思考过程'}</span>
      </button>

      {/* 展开内容 */}
      {expanded && (
        <div className="px-3 pb-3 text-thinkingText/80 text-sm leading-loose whitespace-pre-wrap font-mono">
          {text}
          {isStreaming && (
            <span className="inline-block w-[2px] h-[12px] bg-thinkingText ml-0.5 align-middle animate-pulse" />
          )}
        </div>
      )}
    </div>
  );
}
