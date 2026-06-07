import { useState } from 'react';
import { Brain, ChevronDown, ChevronRight } from 'lucide-react';
import type { IAgentThinkingStreamItem } from '@/types/agent';

interface AgentThinkingPanelProps {
  item: IAgentThinkingStreamItem;
}

function thinkingStatusText(status: IAgentThinkingStreamItem['status']) {
  if (status === 'completed') return '已完成';
  if (status === 'unavailable') return '不可用';
  if (status === 'started') return '已开始';
  return '生成中';
}

export function AgentThinkingPanel({ item }: AgentThinkingPanelProps) {
  const [expanded, setExpanded] = useState(false);
  const statusText = thinkingStatusText(item.status);

  return (
    <section className="max-w-3xl rounded-3xl border border-sky-100 bg-sky-50/70 px-4 py-3 text-sm text-slate-700 md:ml-12">
      <button
        type="button"
        className="flex w-full items-center justify-between gap-3 rounded-2xl text-left font-semibold text-slate-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-500 focus-visible:ring-offset-2"
        aria-expanded={expanded}
        aria-label={expanded ? '收起思考过程' : '展开思考过程'}
        onClick={() => setExpanded((prev) => !prev)}
      >
        <span className="inline-flex items-center gap-2">
          <Brain size={15} className={item.status === 'streaming' ? 'animate-pulse text-sky-600' : 'text-sky-600'} aria-hidden="true" />
          <span aria-live="polite">思考过程 · {statusText}</span>
        </span>
        {expanded ? <ChevronDown size={16} aria-hidden="true" /> : <ChevronRight size={16} aria-hidden="true" />}
      </button>
      {expanded && (
        <pre className="mt-3 max-h-48 overflow-y-auto whitespace-pre-wrap rounded-2xl bg-white/80 p-3 text-xs leading-5 text-slate-700 shadow-inner shadow-sky-100">
          {item.content || '暂无思考内容'}
        </pre>
      )}
    </section>
  );
}
