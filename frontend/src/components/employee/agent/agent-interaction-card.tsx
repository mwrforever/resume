import { useMemo, useState } from 'react';
import { CheckCircle2, ClipboardCheck, MessageSquareText, Send, Sparkles, FileText, Target } from 'lucide-react';
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

  /* 建议选项和自定义输入至少填一个即可提交 */
  const submit = () => {
    if (selected.length === 0 && !customInput.trim()) {
      setError('请至少选择一个建议维度，或输入自定义内容');
      return;
    }
    const values: Record<string, unknown> = {};
    if (selected.length > 0) {
      values.selected_dimensions = selected;
    }
    if (customInput.trim()) {
      values.custom_input = customInput.trim();
    }
    onSubmit(item.id, values);
  };

  return (
    <>
      {/* AI 建议维度选项列表 */}
      {dimensions.length > 0 && (
      <div className="mt-3">
        <div className="mb-2 text-xs font-semibold text-slate-500">AI 建议维度（可多选）</div>
        <div className="flex flex-wrap gap-2">
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
      </div>
      )}
      {error && <div role="alert" className="mt-3 text-xs text-red-600">{error}</div>}
      <label className="mt-3 block text-xs font-medium text-slate-600">
        <span className="inline-flex items-center gap-1">
          <MessageSquareText size={12} aria-hidden="true" />
          自定义补充（与建议选项至少填一项）
        </span>
        <input
          className="mt-1 w-full rounded-2xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 outline-none focus:border-sky-400 focus:ring-2 focus:ring-sky-100"
          placeholder="输入自定义维度或对选择的补充说明"
          value={customInput}
          onChange={(event) => { setCustomInput(event.target.value); setError(''); }}
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
  const plan = useMemo(() => {
    const raw = item.data.plan || item.data;
    if (!raw || typeof raw !== 'object') return null;
    return raw as Record<string, unknown>;
  }, [item.data]);
  const planItems = useMemo(() => asRecordArray(plan?.items), [plan]);
  const [feedback, setFeedback] = useState('');
  const [error, setError] = useState('');

  const approve = () => {
    const values: Record<string, unknown> = { approved: true };
    if (feedback.trim()) {
      values.feedback = feedback.trim();
    }
    onSubmit(item.id, values);
  };

  /* 驳回时必须输入修改建议 */
  const reject = () => {
    if (!feedback.trim()) {
      setError('请输入修改建议');
      return;
    }
    const values: Record<string, unknown> = { approved: false, feedback: feedback.trim() };
    onSubmit(item.id, values);
  };

  return (
    <div className="mt-3 space-y-3">
      {/* 展示面试题计划具体内容 */}
      {plan && (
        <div className="rounded-2xl border border-slate-200 bg-white p-3">
          {plan.summary && <p className="text-sm text-slate-700">{String(plan.summary)}</p>}
          {planItems.length > 0 && (
            <ol className="mt-2 space-y-2">
              {planItems.map((planItem, index) => (
                <li key={index} className="flex items-start gap-2 rounded-xl bg-slate-50 px-3 py-2 text-sm">
                  <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-sky-100 text-xs font-semibold text-sky-700">{index + 1}</span>
                  <div className="min-w-0 flex-1">
                    <div className="font-medium text-slate-900">{labelOf(planItem)}</div>
                    {(planItem.dimension || planItem.focus) && <div className="text-xs text-slate-500">{String(planItem.dimension || planItem.focus || '')}</div>}
                    {planItem.question_count != null && <div className="text-xs text-slate-400">题目数：{String(planItem.question_count)}</div>}
                    {planItem.description && <div className="mt-1 text-xs text-slate-600">{String(planItem.description)}</div>}
                  </div>
                </li>
              ))}
            </ol>
          )}
          {plan.total_questions != null && <div className="mt-2 text-xs font-semibold text-slate-500">共计 {String(plan.total_questions)} 道题目</div>}
        </div>
      )}
      <label className="block text-xs font-medium text-slate-600">
        <span className="inline-flex items-center gap-1">
          <MessageSquareText size={12} aria-hidden="true" />
          修改建议（驳回时必填）
        </span>
        <input
          className="mt-1 w-full rounded-2xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 outline-none focus:border-sky-400 focus:ring-2 focus:ring-sky-100"
          placeholder="可输入对计划的修改建议或关注点"
          value={feedback}
          onChange={(event) => { setFeedback(event.target.value); setError(''); }}
        />
      </label>
      {error && <div role="alert" className="text-xs text-red-600">{error}</div>}
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
    /* 只要输入了岗位名称即可提交 */
    if (!jobName.trim()) {
      setError('请输入岗位名称');
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
              className={`flex items-center gap-1.5 rounded-2xl border px-3 py-2 text-sm font-medium transition-colors ${selectedJobId === id ? 'border-sky-300 bg-sky-50 text-sky-800' : 'border-slate-200 bg-white text-slate-700 hover:bg-slate-50'}`}
              onClick={() => {
                setError('');
                setSelectedJobId(id);
                setJobName(name);
              }}
            >
              {name}
              {candidate.source && <SourceBadge source={String(candidate.source)} />}
            </button>
          );
        })}
      </div>
      <label className="mt-3 block text-xs font-medium text-slate-600">
        岗位名称（可手动输入）
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


/** 岗位来源标记组件，显示匹配来源类型 */
function SourceBadge({ source }: { source: string }) {
  if (source === 'hr_requirement') {
    return <span className="inline-flex items-center gap-0.5 rounded-full bg-violet-100 px-1.5 py-0.5 text-[10px] font-semibold text-violet-700"><Target size={9} aria-hidden="true" />HR要求</span>;
  }
  if (source === 'resume_match') {
    return <span className="inline-flex items-center gap-0.5 rounded-full bg-emerald-100 px-1.5 py-0.5 text-[10px] font-semibold text-emerald-700"><FileText size={9} aria-hidden="true" />简历匹配</span>;
  }
  return <span className="inline-flex items-center gap-0.5 rounded-full bg-slate-100 px-1.5 py-0.5 text-[10px] font-semibold text-slate-600"><Sparkles size={9} aria-hidden="true" />系统推测</span>;
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
