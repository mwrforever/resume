import { Activity, Brain, X } from 'lucide-react';
import { useState } from 'react';
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog';
import type { IAgentMemoryItem } from '@/types/agent';
import { cn } from '@/lib/utils';
import { hiddenScrollClass } from './agent-ui-utils';

type PreferenceTab = 'metrics' | 'memories';

interface AgentPreferencesDialogProps {
  open: boolean;
  memories: IAgentMemoryItem[];
  /** 保留 prop 以兼容父组件调用，Trace 模块已移除 */
  toolEvents?: unknown[];
  totalTokens: number;
  messageCount: number;
  actionCount: number;
  onClose: () => void;
}

const preferenceTabs = [
  { type: 'metrics' as const, icon: Activity, label: '运行指标', description: '会话消耗概览' },
  { type: 'memories' as const, icon: Brain, label: '长期记忆', description: '当前用户记忆' },
];

function MetricCard({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
      <div className="text-xs text-slate-500">{label}</div>
      <div className="mt-1 text-2xl font-bold text-slate-950">{value}</div>
    </div>
  );
}

export function AgentPreferencesDialog({ open, memories, toolEvents, totalTokens, messageCount, actionCount, onClose }: AgentPreferencesDialogProps) {
  const [activeTab, setActiveTab] = useState<PreferenceTab>('metrics');

  return (
    <Dialog open={open} onOpenChange={(value) => !value && onClose()} containerClassName="max-w-5xl overflow-hidden rounded-[2rem]">
      <DialogContent className="p-0">
        <div className="flex items-center justify-between border-b border-slate-100 px-5 py-4">
          <div>
            <DialogTitle className="mb-0">Agent 可观测信息</DialogTitle>
            <p className="mt-1 text-sm text-slate-500">运行指标与长期记忆信息，用于排查当前会话执行过程。</p>
          </div>
          <button type="button" onClick={onClose} aria-label="关闭" className="cursor-pointer rounded-xl p-2 text-slate-400 transition-colors duration-200 hover:bg-slate-100 hover:text-slate-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"><X size={18} /></button>
        </div>
        <div className="grid max-h-[72vh] min-h-[520px] grid-cols-[240px_minmax(0,1fr)] overflow-hidden">
          <nav className="border-r border-slate-100 bg-slate-50/80 p-3">
            <div className="space-y-2">
              {preferenceTabs.map((tab) => (
                <button key={tab.type} type="button" onClick={() => setActiveTab(tab.type)} className={cn('flex w-full cursor-pointer items-start gap-3 rounded-2xl border px-3 py-3 text-left transition-colors duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring', activeTab === tab.type ? 'border-sky-200 bg-white text-primary shadow-sm shadow-sky-100/80' : 'border-transparent text-slate-600 hover:border-slate-200 hover:bg-white')}>
                  <span className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-xl bg-sky-100 text-primary"><tab.icon size={16} aria-hidden="true" /></span>
                  <span className="min-w-0">
                    <span className="block text-sm font-semibold">{tab.label}</span>
                    <span className="mt-0.5 block text-xs text-slate-500">{tab.description}</span>
                  </span>
                </button>
              ))}
            </div>
          </nav>
          <section className={`overflow-y-auto p-5 ${hiddenScrollClass}`}>
            {activeTab === 'metrics' && (
              <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
                <MetricCard label="Tokens" value={totalTokens} />
                <MetricCard label="消息数" value={messageCount} />
                <MetricCard label="临时动作" value={actionCount} />
              </div>
            )}
            {activeTab === 'memories' && (
              <div className="space-y-3">
                {memories.map((memory) => (
                  <div key={memory.id} className="rounded-2xl border border-slate-200 bg-white p-4 text-sm leading-6 text-slate-700">
                    <div className="mb-1 font-semibold text-slate-950">{memory.memory_type}</div>
                    {memory.content}
                  </div>
                ))}
                {memories.length === 0 && <div className="rounded-2xl border border-dashed border-sky-200 bg-sky-50/50 p-6 text-sm text-slate-600">暂无记忆。</div>}
              </div>
            )}
          </section>
        </div>
      </DialogContent>
    </Dialog>
  );
}