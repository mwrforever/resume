import { useMemo, useState } from 'react';
import { CheckCircle2, ClipboardCheck, MessageSquareText, Send } from 'lucide-react';
import { Button } from '@/components/ui/button';
import type { IAgentInteractionRequestItem } from '@/types/agent';

interface AgentInteractionCardProps {
  item: IAgentInteractionRequestItem;
  onSubmit: (requestId: string, values: Record<string, unknown>) => void;
}

function asRecordArray(value: unknown): Record<string, unknown>[] {
  return Array.isArray(value) ? value.filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === 'object' && !Array.isArray(item)) : [];
}

function labelOf(item: Record<string, unknown>) {
  return String(item.name || item.title || item.job_name || item.label || '未命名');
}

function DimensionSelection({ item, onSubmit }: AgentInteractionCardProps) {
  const dimensions = useMemo(() => asRecordArray(item.data.dimensions), [item.data.dimensions]);
  const [selected, setSelected] = useState<string[]>([]);
  const [customInput, setCustomInput] = useState('');
  const [error, setError] = useState('');

  const toggle = (name: string) => {
    setError('');
    setSelected((prev) => (prev.includes(name) ? prev.filter((itemName) => itemName !== name) : [...prev, name]));
  };

  const submit = () => {
    if (selected.length === 0) {
      setError('请至少选择一个维度');
      return;
    }
    const values: Record<string, unknown> = { selected_dimensions: selected };
    if (customInput.trim()) {
      values.custom_input = customInput.trim();
    }
    onSubmit(item.id, values);
  };

  return (
    <>
      <div className="mt-3 flex flex-wrap gap-2">
        {dimensions.map((dimension) => {
          const name = labelOf(dimension);
          const checked = selected.includes(name);
          return (
            <label key={name} className={`inline-flex cursor-pointer items-center gap-2 rounded-2xl border px-3 py-2 text-sm ${checked ? 'border-sky-300 bg-sky-50 text-sky-800' : 'border-slate-200 bg-white text-slate-700'}`}>
              <input type="checkbox" className="sr-only" checked={checked} aria-label={name} onChange={() => toggle(name)} />
              <span>{name}</span>
              {checked && <CheckCircle2 size={14} aria-hidden="true" />}
            </label>
          );
        })}
      </div>
      {error && <div role="alert" className="mt-3 text-xs text-red-600">{error}</div>}
      <label className="mt-3 block text-xs font-medium text-slate-600">
        <span className="inline-flex items-center gap-1">
          <MessageSquareText size={12} aria-hidden="true" />
          补充说明（可选）
        </span>
        <input
          className="mt-1 w-full rounded-2xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 outline-none focus:border-sky-400 focus:ring-2 focus:ring-sky-100"
          placeholder="可输入对维度的补充要求或关注重点"
          value={customInput}
          onChange={(event) => setCustomInput(event.target.value)}
        />
      </label>
      <Button type="button" size="sm" className="mt-4" onClick={submit} disabled={item.status !== 'pending'}>
        <Send size={14} className="mr-1" aria-hidden="true" />
        {item.submit_label}
      </Button>
    </>
  );
}

function PlanApproval({ item, onSubmit }: AgentInteractionCardProps) {
  const [feedback, setFeedback] = useState('');

  const approve = () => {
    const values: Record<string, unknown> = { approved: true };
    if (feedback.trim()) {
      values.feedback = feedback.trim();
    }
    onSubmit(item.id, values);
  };

  const reject = () => {
    const values: Record<string, unknown> = { approved: false, feedback: feedback.trim() || '请调整计划' };
    onSubmit(item.id, values);
  };

  return (
    <div className="mt-3 space-y-3">
      <label className="block text-xs font-medium text-slate-600">
        <span className="inline-flex items-center gap-1">
          <MessageSquareText size={12} aria-hidden="true" />
          审批意见（可选）
        </span>
        <input
          className="mt-1 w-full rounded-2xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 outline-none focus:border-sky-400 focus:ring-2 focus:ring-sky-100"
          placeholder="可输入对计划的修改建议或关注点"
          value={feedback}
          onChange={(event) => setFeedback(event.target.value)}
        />
      </label>
      <div className="flex flex-wrap gap-2">
        <Button type="button" size="sm" onClick={approve} disabled={item.status !== 'pending'}>
          批准计划
        </Button>
        <Button type="button" size="sm" variant="outline" onClick={reject} disabled={item.status !== 'pending'}>
          退回调整
        </Button>
      </div>
    </div>
  );
}

function JobSelection({ item, onSubmit }: AgentInteractionCardProps) {
  const candidates = useMemo(() => asRecordArray(item.data.jobs || item.data.candidates), [item.data.jobs, item.data.candidates]);
  const [selectedJobId, setSelectedJobId] = useState<number | null>(null);
  const [jobName, setJobName] = useState('');
  const [error, setError] = useState('');

  const submit = () => {
    if (!selectedJobId || !jobName.trim()) {
      setError('请选择岗位并输入完整岗位名称');
      return;
    }
    onSubmit(item.id, { job_id: selectedJobId, job_name: jobName.trim() });
  };

  return (
    <>
      <div className="mt-3 flex flex-wrap gap-2">
        {candidates.map((candidate) => {
          const id = Number(candidate.id || candidate.job_id || 0);
          const name = labelOf(candidate);
          return (
            <button
              key={`${id}-${name}`}
              type="button"
              className={`rounded-2xl border px-3 py-2 text-sm font-medium ${selectedJobId === id ? 'border-sky-300 bg-sky-50 text-sky-800' : 'border-slate-200 bg-white text-slate-700 hover:bg-slate-50'}`}
              onClick={() => {
                setError('');
                setSelectedJobId(id);
                setJobName(name);
              }}
            >
              {name}
            </button>
          );
        })}
      </div>
      <label className="mt-3 block text-xs font-medium text-slate-600">
        完整岗位名称
        <input
          className="mt-1 w-full rounded-2xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 outline-none focus:border-sky-400 focus:ring-2 focus:ring-sky-100"
          value={jobName}
          onChange={(event) => setJobName(event.target.value)}
        />
      </label>
      {error && <div role="alert" className="mt-3 text-xs text-red-600">{error}</div>}
      <Button type="button" size="sm" className="mt-4" onClick={submit} disabled={item.status !== 'pending'}>
        {item.submit_label}
      </Button>
    </>
  );
}

export function AgentInteractionCard({ item, onSubmit }: AgentInteractionCardProps) {
  return (
    <section className="max-w-3xl rounded-3xl border border-amber-200 bg-amber-50/80 p-4 text-sm text-slate-700 shadow-sm shadow-amber-100/70 md:ml-12">
      <div className="flex items-start gap-3">
        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-2xl bg-white text-amber-600 shadow-sm">
          <ClipboardCheck size={16} aria-hidden="true" />
        </span>
        <div className="min-w-0 flex-1">
          <div className="font-semibold text-slate-950">{item.title}</div>
          {item.prompt && <p className="mt-1 text-sm leading-6 text-slate-600">{item.prompt}</p>}
          {item.interaction_type === 'dimension_selection' && <DimensionSelection item={item} onSubmit={onSubmit} />}
          {item.interaction_type === 'plan_approval' && <PlanApproval item={item} onSubmit={onSubmit} />}
          {item.interaction_type === 'job_selection' && <JobSelection item={item} onSubmit={onSubmit} />}
        </div>
      </div>
    </section>
  );
}
