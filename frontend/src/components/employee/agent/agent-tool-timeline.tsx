import { CheckCircle2, Loader2, XCircle } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { IAgentToolStreamItem } from '@/types/agent';

interface ToolTimelineItem {
  key: string;
  name: string;
  status: 'running' | 'success' | 'failed';
  message?: string;
}

function buildTimelineItems(toolEvents: IAgentToolStreamItem[]) {
  const items = new Map<string, ToolTimelineItem>();
  toolEvents.forEach((event) => {
    const key = event.tool_name || event.display_name || event.id;
    if (event.type === 'call') {
      items.set(key, { key, name: event.display_name || event.tool_name || '工具调用', status: 'running' });
      return;
    }
    const previous = items.get(key);
    items.set(key, {
      key,
      name: previous?.name || event.display_name || event.tool_name || '工具结果',
      status: event.success === false ? 'failed' : 'success',
      message: event.error_message || undefined,
    });
  });
  return Array.from(items.values()).slice(-4);
}

export function AgentToolTimeline({ toolEvents, active }: { toolEvents: IAgentToolStreamItem[]; active: boolean }) {
  const items = buildTimelineItems(toolEvents);
  if (items.length === 0 && !active) return null;

  return (
    <div className="max-w-3xl rounded-3xl border border-sky-100 bg-sky-50/80 p-3 text-xs text-slate-600 shadow-sm shadow-sky-100/70 transition-[opacity,transform] duration-300">
      <div className="mb-2 flex items-center gap-2 font-semibold text-slate-900">
        <span className="flex h-6 w-6 items-center justify-center rounded-xl bg-white text-sky-600 shadow-sm"><Loader2 size={13} className={cn(active && 'animate-spin')} aria-hidden="true" /></span>
        Agent 执行事件
      </div>
      <div className="space-y-2">
        {items.map((item) => (
          <div key={item.key} className="rounded-2xl bg-white/90 px-3 py-2 shadow-sm shadow-sky-100/60 transition-[opacity,transform,background-color] duration-300">
            <div className="flex w-full items-start gap-2 text-left">
              {item.status === 'running' && <Loader2 size={14} className="mt-0.5 shrink-0 animate-spin text-sky-600" aria-hidden="true" />}
              {item.status === 'success' && <CheckCircle2 size={14} className="mt-0.5 shrink-0 text-emerald-600 transition-colors duration-300" aria-hidden="true" />}
              {item.status === 'failed' && <XCircle size={14} className="mt-0.5 shrink-0 text-red-600" aria-hidden="true" />}
              <span className="min-w-0 flex-1">
                <span className="block truncate font-semibold text-slate-800">{item.name}</span>
                <span className="mt-0.5 block text-slate-500">{item.status === 'running' ? '执行中' : item.status === 'success' ? '执行完成' : '执行失败'}</span>
                {item.message && <span className="mt-0.5 block text-red-600">{item.message}</span>}
              </span>
            </div>
          </div>
        ))}
        {items.length === 0 && active && <div className="rounded-2xl bg-white/80 px-3 py-2">正在准备上下文与模型请求...</div>}
      </div>
    </div>
  );
}
