import { useState } from 'react';
import { CheckCircle2, ChevronDown, ChevronRight, Clock3, Loader2, XCircle } from 'lucide-react';
import type { IAgentRuntimeFeedItem } from '@/types/agent';

interface AgentRunCompactTimelineProps {
  items: IAgentRuntimeFeedItem[];
}

function statusText(status: IAgentRuntimeFeedItem['status']) {
  if (status === 'success') return '已完成';
  if (status === 'failed') return '失败';
  if (status === 'pending') return '等待确认';
  return '执行中';
}

function StatusIcon({ status }: { status: IAgentRuntimeFeedItem['status'] }) {
  if (status === 'success') return <CheckCircle2 size={15} className="text-emerald-600" aria-hidden="true" />;
  if (status === 'failed') return <XCircle size={15} className="text-red-600" aria-hidden="true" />;
  if (status === 'pending') return <Clock3 size={15} className="text-amber-600" aria-hidden="true" />;
  return <Loader2 size={15} className="animate-spin text-sky-600" aria-hidden="true" />;
}

export function AgentRunCompactTimeline({ items }: AgentRunCompactTimelineProps) {
  const [expanded, setExpanded] = useState(false);
  const visibleItems = items.filter((item) => item.type !== 'action');
  if (visibleItems.length === 0) return null;

  const completedCount = visibleItems.filter((item) => item.status === 'success').length;

  return (
    <section className="max-w-3xl rounded-3xl border border-slate-200 bg-white px-4 py-3 shadow-sm shadow-slate-200/70 md:ml-12">
      <button
        type="button"
        className="flex w-full items-center justify-between gap-3 rounded-2xl text-left text-sm font-semibold text-slate-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-500 focus-visible:ring-offset-2"
        aria-expanded={expanded}
        aria-label={expanded ? '收起运行过程' : '展开运行过程'}
        onClick={() => setExpanded((prev) => !prev)}
      >
        <span>运行过程 · 已完成 {completedCount} 步</span>
        {expanded ? <ChevronDown size={16} aria-hidden="true" /> : <ChevronRight size={16} aria-hidden="true" />}
      </button>
      {expanded && (
        <div className="mt-3 space-y-2">
          {visibleItems.map((item) => (
            <div key={item.id} className="flex items-start gap-3 rounded-2xl bg-slate-50 px-3 py-2 text-sm text-slate-700">
              <span className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-xl bg-white shadow-sm">
                <StatusIcon status={item.status} />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block font-medium text-slate-900">{item.title}</span>
                <span className="block text-xs text-slate-500">{statusText(item.status)}</span>
                {item.message && <span className="mt-1 block text-xs text-red-600">{item.message}</span>}
              </span>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
