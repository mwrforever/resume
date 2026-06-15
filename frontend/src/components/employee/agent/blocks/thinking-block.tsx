/**
 * ThinkingBlock：AI 思考过程折叠块
 *
 * - 流式期间自动展开，结束后延迟 800ms 收起（BUG-3A）
 * - 用户手动 toggle 后不再自动干预（manualOverride）
 * - 紫色容器化：淡紫底 + 紫左边框 + Sparkles 头部图标
 * - 流式光标精致化
 */

import { useEffect, useRef, useState } from 'react';
import { ChevronRight, Sparkles } from 'lucide-react';
import type { AgentBlock } from '@/types/agent';
import { useFrameBatchedText } from '@/hooks/use-frame-batched-text';

interface ThinkingBlockProps {
  block: AgentBlock & { type: 'thinking' };
}

export function ThinkingBlock({ block }: ThinkingBlockProps) {
  const [expanded, setExpanded] = useState(false);
  // 用户手动 toggle 后置 true，之后不再被自动展开/收起逻辑干预
  const [manualOverride, setManualOverride] = useState(false);
  const isStreaming = block.status === 'streaming';
  const { displayed, flush } = useFrameBatchedText(block.text);
  const text = isStreaming ? displayed : block.text;
  // 保留折叠态引用，结束时 flush 残留字符
  const wasStreamingRef = useRef(false);

  // 流式→自动展开；结束→延迟收起；手动操作后不再干预
  useEffect(() => {
    if (manualOverride) return;
    if (isStreaming) {
      setExpanded(true);
      wasStreamingRef.current = true;
      return;
    }
    // 首次渲染且非 streaming（历史消息）保持折叠
    if (!wasStreamingRef.current) return;
    const t = window.setTimeout(() => setExpanded(false), 800);
    return () => window.clearTimeout(t);
  }, [isStreaming, manualOverride]);

  // streaming 结束时 flush 剩余字符
  if (!isStreaming && displayed !== block.text) {
    flush();
  }

  const handleToggle = () => {
    setManualOverride(true);
    setExpanded(e => !e);
  };

  return (
    <div className="rounded-lg bg-[#F3E8FF]/40 border-l-[3px] border-l-[#7C3AED] pl-3 pr-3 py-2.5">
      {/* 折叠头部 */}
      <button
        type="button"
        className="flex items-center gap-2 w-full text-left text-sm text-[#7C3AED] font-medium
                   hover:text-[#6D28D9] transition-colors duration-150"
        onClick={handleToggle}
        aria-expanded={expanded}
      >
        <ChevronRight
          size={14}
          className={`transition-transform duration-150 ${expanded ? 'rotate-90' : ''}`}
        />
        <Sparkles size={13} className={isStreaming ? 'fill-[#7C3AED]/30' : ''} />
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
