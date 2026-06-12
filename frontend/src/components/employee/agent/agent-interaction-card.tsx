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
  return String(item.name || item.title || item.job_name || item.label || item.dimension || item.key || '未命名');
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
          {typeof plan.summary === "string" && plan.summary && <p className="text-sm text-slate-700">{String(plan.summary)}</p>}
          {planItems.length > 0 && (
            <ol className="mt-2 space-y-2">
              {planItems.map((planItem, index) => (
                <li key={index} className="flex items-start gap-2 rounded-xl bg-slate-50 px-3 py-2 text-sm">
                  <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-sky-100 text-xs font-semibold text-sky-700">{index + 1}</span>
                  <div className="min-w-0 flex-1">
                    <div className="font-medium text-slate-900">{labelOf(planItem)}</div>
                    {(typeof planItem.dimension === "string" && planItem.dimension || typeof planItem.focus === "string" && planItem.focus) && <div className="text-xs text-slate-500">{String(planItem.dimension || planItem.focus || "")}</div>}
                    {planItem.question_count != null && <div className="text-xs text-slate-400">题目数：{String(planItem.question_count)}</div>}
                    {typeof planItem.description === "string" && planItem.description && <div className="mt-1 text-xs text-slate-600">{String(planItem.description)}</div>}
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
              {typeof candidate.source === "string" && candidate.source && <SourceBadge source={String(candidate.source)} />}
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

/**
 * 题集人工批阅交互卡。
 *
 * 用户在面试题集生成后进行人工把关：
 *   - "通过"：题集作为最终结果交付
 *   - "重新生成"：提交反馈意见，引擎根据反馈回流到规划节点重新生成
 *
 * 交互协议：
 *   - data.questions: Array<面试题对象>
 *   - data.plan: { items: Array<{ dimension, question_count, difficulty, focus }>, summary, total_questions }
 *   - 提交载荷：{ decision: 'approve' | 'regenerate', feedback: string }
 */
function QuestionReview({ item, onSubmit }: AgentInteractionCardProps) {
  const questions = useMemo(() => asRecordArray(item.data.questions), [item.data.questions]);
  const planObj = (item.data.plan && typeof item.data.plan === 'object' && !Array.isArray(item.data.plan)) ? (item.data.plan as Record<string, unknown>) : {};
  const planItems = useMemo(() => asRecordArray(planObj.items), [planObj.items]);
  const totalQuestions = typeof planObj.total_questions === 'number' ? planObj.total_questions : questions.length;
  const planSummary = typeof planObj.summary === 'string' ? planObj.summary : '';
  const [decision, setDecision] = useState<'approve' | 'regenerate'>('approve');
  const [feedback, setFeedback] = useState('');
  const [error, setError] = useState('');

  /** 提交批阅意见：驳回时强制要求填写反馈，避免引擎无方向重生成 */
  const submit = () => {
    if (decision === 'regenerate' && !feedback.trim()) {
      setError('请填写需要调整的方向，引擎将基于反馈重新生成。');
      return;
    }
    onSubmit(item.id, { decision, feedback: feedback.trim() });
  };

  return (
    <>
      {/* 题集摘要：先展示规划分布，便于用户快速判断 */}
      <div className="mt-3 rounded-2xl border border-slate-200 bg-white p-3">
        <div className="text-xs font-semibold text-slate-500">题目分布（共 {totalQuestions} 题）</div>
        {planSummary && <div className="mt-1 text-xs text-slate-500">{planSummary}</div>}
        <div className="mt-2 flex flex-wrap gap-2">
          {planItems.map((p, i) => (
            <span key={'plan-' + i} className="inline-flex items-center gap-1 rounded-2xl bg-slate-100 px-2.5 py-1 text-xs text-slate-700">
              <span className="font-medium">{String(p.dimension || p.name || '维度')}</span>
              <span className="text-slate-500">×{Number(p.question_count || 0)}</span>
              {p.difficulty ? <span className="text-slate-400">· {String(p.difficulty)}</span> : null}
            </span>
          ))}
        </div>
      </div>

      {/* 题目预览：限制展示前 6 题，避免卡片过长 */}
      <div className="mt-3 space-y-2">
        {questions.slice(0, 6).map((q, i) => (
          <div key={'q-' + i} className="rounded-2xl border border-slate-100 bg-slate-50/60 p-3 text-xs leading-5 text-slate-700">
            <span className="mr-1 font-semibold text-slate-500">{i + 1}.</span>
            <span>{String(q.question || q.text || '')}</span>
            {q.dimension ? <span className="ml-2 inline-flex items-center rounded-full bg-sky-100 px-2 py-0.5 text-[10px] font-medium text-sky-700">{String(q.dimension)}</span> : null}
            {q.difficulty ? <span className="ml-1 inline-flex items-center rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-medium text-amber-700">{String(q.difficulty)}</span> : null}
          </div>
        ))}
        {questions.length > 6 && (
          <div className="text-xs text-slate-400">…还有 {questions.length - 6} 题未展示</div>
        )}
      </div>

      {/* 决策切换：通过 / 重新生成 */}
      <div className="mt-4 flex gap-2">
        <button
          type="button"
          className={'flex items-center gap-1.5 rounded-2xl border px-3 py-2 text-sm font-medium transition-colors ' + (decision === 'approve' ? 'border-emerald-300 bg-emerald-50 text-emerald-800' : 'border-slate-200 bg-white text-slate-700 hover:bg-slate-50')}
          onClick={() => { setDecision('approve'); setError(''); }}
        >
          <CheckCircle2 size={14} aria-hidden="true" />通过
        </button>
        <button
          type="button"
          className={'flex items-center gap-1.5 rounded-2xl border px-3 py-2 text-sm font-medium transition-colors ' + (decision === 'regenerate' ? 'border-rose-300 bg-rose-50 text-rose-800' : 'border-slate-200 bg-white text-slate-700 hover:bg-slate-50')}
          onClick={() => { setDecision('regenerate'); setError(''); }}
        >
          <MessageSquareText size={14} aria-hidden="true" />重新生成
        </button>
      </div>

      {/* 反馈输入：仅在驳回时显示，其它情况展示可选附加说明 */}
      <label className="mt-3 block text-xs font-medium text-slate-600">
        {decision === 'regenerate' ? '请填写调整意见（必填）' : '附加说明（可选）'}
        <textarea
          className="mt-1 w-full rounded-2xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 outline-none focus:border-sky-400 focus:ring-2 focus:ring-sky-100"
          rows={3}
          value={feedback}
          onChange={(event) => setFeedback(event.target.value)}
          placeholder={decision === 'regenerate' ? '例如：请增加对系统设计能力的考察，减少基础语法题' : '可补充对题集的整体评价'}
        />
      </label>
      {error && <div role="alert" className="mt-2 text-xs text-red-600">{error}</div>}
      <Button type="button" size="sm" className="mt-4" onClick={submit} disabled={item.status !== 'pending'}>
        <Send size={13} className="mr-1" aria-hidden="true" />{item.submit_label || '提交批阅意见'}
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
          {item.interaction_type === 'question_review' && <QuestionReview item={item} onSubmit={onSubmit} />}
        </div>
      </div>
    </section>
  );
}
