/**
 * TextBlock：Agent 正文流式文本块。
 *
 * - 通过 useFrameBatchedText 让字符按 80cps 匀速吐出
 * - streaming 末尾光标闪烁；success 后 fade-out
 * - aria-live="polite" 让屏幕阅读器友好播报
 * - markdown 极简渲染：粗体 / 列表 / 行内 code
 */

import { useMemo } from 'react';
import type { AgentBlock } from '@/types/agent';
import { useFrameBatchedText } from '@/hooks/use-frame-batched-text';

interface TextBlockProps {
  block: AgentBlock & { type: 'text' };
}

/** 极简 markdown 渲染：粗体、列表、行内 code */
function renderSimpleMarkdown(text: string) {
  // 按行处理
  return text.split('\n').map((line, i) => {
    // 列表项
    const listMatch = line.match(/^[-*]\s+(.*)$/);
    if (listMatch) {
      return <li key={i} className="ml-4">{renderInline(listMatch[1])}</li>;
    }
    // 有序列表
    const olMatch = line.match(/^\d+\.\s+(.*)$/);
    if (olMatch) {
      return <li key={i} className="ml-4 list-decimal">{renderInline(olMatch[1])}</li>;
    }
    return <span key={i}>{i > 0 ? '\n' : ''}{renderInline(line)}</span>;
  });
}

function renderInline(text: string) {
  const parts: React.ReactNode[] = [];
  const regex = /(\*\*(.+?)\*\*|`(.+?)`)/g;
  let lastIdx = 0;
  let match: RegExpExecArray | null;
  let key = 0;
  while ((match = regex.exec(text)) !== null) {
    if (match.index > lastIdx) {
      parts.push(text.slice(lastIdx, match.index));
    }
    if (match[2]) {
      parts.push(<strong key={key++}>{match[2]}</strong>);
    } else if (match[3]) {
      parts.push(<code key={key++} className="bg-surfaceMuted text-foreground px-1 rounded font-mono text-xs">{match[3]}</code>);
    }
    lastIdx = match.index + match[0].length;
  }
  if (lastIdx < text.length) parts.push(text.slice(lastIdx));
  return parts;
}

export function TextBlock({ block }: TextBlockProps) {
  const { displayed, flush } = useFrameBatchedText(block.text);
  const isStreaming = block.status === 'streaming';

  // streaming 结束时 flush 剩余字符
  const renderedText = isStreaming ? displayed : block.text;
  if (!isStreaming && displayed !== block.text) {
    flush();
  }

  const content = useMemo(() => renderSimpleMarkdown(renderedText), [renderedText]);

  return (
    <div
      className="text-foreground text-base leading-normal whitespace-pre-wrap"
      aria-live="polite"
    >
      {content}
      {isStreaming && (
        <span className="inline-block w-[2px] h-[14px] bg-primary ml-0.5 align-middle animate-pulse" />
      )}
    </div>
  );
}
