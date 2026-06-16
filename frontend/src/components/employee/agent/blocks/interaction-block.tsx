/**
 * InteractionBlock：用户交互卡片。
 *
 * - pending：根据 interaction_type 渲染不同表单
 *     - dimension_selection：候选维度多选 + 补充意见 → 提交 { selected_dimensions, user_feedback? }
 *     - plan_approval：可编辑计划 → 批准 { approved: true, edited_plan } / 驳回 { approved: false, feedback? }
 *     - job_selection：候选岗位单选 → 提交 { selected_job_name: string }
 * - submitted：已提交，显示已选值
 * - expired：超时未提交
 *
 * 提交字段名严格对齐后端 graph interrupt 的取值（interview_questions.py /
 * resume_evaluation.py 中 user_values.get(...) 的 key）。
 */

import { useState } from 'react';
import type { AgentBlock } from '@/types/agent';

interface InteractionBlockProps {
  block: AgentBlock & { type: 'interaction' };
  /** 是否正在提交（父级 sending）→ 禁用所有提交按钮，防止重复点击 */
  submitting?: boolean;
  onSubmit?: (requestId: string, values: Record<string, unknown>) => void;
}

export function InteractionBlock({ block, submitting, onSubmit }: InteractionBlockProps) {
  const { request_id, interaction_type, title, prompt, data, status } = block;

  // 终态（已提交/已驳回/已过期）：折叠回看原文 data，不渲染操作按钮
  if (status === 'submitted' || status === 'rejected' || status === 'expired') {
    return (
      <ResolvedInteraction
        title={title}
        status={status}
        interactionType={interaction_type}
        data={data}
      />
    );
  }

  // pending：按类型分发
  switch (interaction_type) {
    case 'dimension_selection':
      return (
        <DimensionSelection
          title={title}
          prompt={prompt}
          data={data}
          submitting={submitting}
          onSubmit={(vals) => onSubmit?.(request_id, vals)}
        />
      );
    case 'plan_approval':
      return (
        <PlanApproval
          title={title}
          prompt={prompt}
          data={data}
          submitting={submitting}
          onSubmit={(vals) => onSubmit?.(request_id, vals)}
        />
      );
    case 'job_selection':
      return (
        <JobSelection
          title={title}
          prompt={prompt}
          data={data}
          submitting={submitting}
          onSubmit={(vals) => onSubmit?.(request_id, vals)}
        />
      );
    default:
      // 未知 interaction_type：展示标题与提示，避免直接吞掉
      return (
        <div className="rounded-md border border-[#FEE2E2] bg-[#FEF2F2] px-4 py-3">
          <p className="text-sm font-medium text-[#DC2626]">{title}</p>
          <p className="text-xs text-[#94A3B8] mt-1">不支持的交互类型：{interaction_type}</p>
        </div>
      );
  }
}

/** 终态交互卡：状态徽标 + 标题 + 一句摘要 + 可展开只读回看原文 data。无操作按钮。 */
function ResolvedInteraction({
  title, status, interactionType, data,
}: {
  title: string;
  status: 'submitted' | 'rejected' | 'expired';
  interactionType: string;
  data: Record<string, unknown>;
}) {
  const [expanded, setExpanded] = useState(false);
  const badge =
    status === 'submitted' ? { txt: '✓ 已提交', cls: 'bg-[#DCFCE7] text-[#16A34A]' } :
    status === 'rejected'  ? { txt: '↻ 已驳回', cls: 'bg-[#FEF3C7] text-[#D97706]' } :
                             { txt: '已过期', cls: 'bg-[#F1F5F9] text-[#94A3B8]' };
  // 摘要：按交互类型取一行概括
  const summary =
    interactionType === 'dimension_selection'
      ? `已选 ${(data?.selected_dimensions as unknown[] | undefined)?.length ?? 0} 项`
      : interactionType === 'plan_approval'
        ? `总题量 ${(data?.plan as { total_questions?: number } | undefined)?.total_questions ?? 0}`
        : interactionType === 'job_selection'
          ? `岗位：${String((data?.selected_job_name as string | undefined) ?? '—')}`
          : '';

  return (
    <div className="rounded-md border border-[#E2E8F0] bg-[#F8FAFC] px-4 py-3">
      <button type="button" onClick={() => setExpanded(v => !v)} className="w-full flex items-center justify-between">
        <span className="flex items-center gap-2">
          <span className={`text-[11px] px-2 py-0.5 rounded-full font-semibold ${badge.cls}`}>{badge.txt}</span>
          <span className="text-sm font-semibold text-[#334155]">{title}</span>
        </span>
        <span className="text-xs text-[#64748B]">{summary} · {expanded ? '收起 ▴' : '展开回看 ▾'}</span>
      </button>
      {expanded && (
        <div className="mt-2 text-xs text-[#475569]">
          {/* 只读回看原文 data：先用 JSON 兜底，保证能回看不报错 */}
          <pre className="whitespace-pre-wrap break-words font-sans">{JSON.stringify(data, null, 2)}</pre>
        </div>
      )}
    </div>
  );
}

// ---------- 子组件 ----------

interface SectionProps {
  title: string;
  prompt: string;
  data: Record<string, unknown>;
  /** 提交进行中：禁用提交按钮防止重复点击 */
  submitting?: boolean;
  onSubmit: (values: Record<string, unknown>) => void;
}

/** 维度多选卡：提交 { selected_dimensions: [...], user_feedback?: string }
 *
 * 用户除了勾选 AI 提议的维度，还可以在下方文本框补充意见或追加自定义维度。
 * - 自定义维度按"，"或换行切分，source 标记为 user
 * - user_feedback 透传至后端，作为 question_plan prompt 的 user_intent 注入
 */
function DimensionSelection({ title, prompt, data, submitting, onSubmit }: SectionProps) {
  const candidates = (data?.candidates ?? []) as Array<{
    name?: unknown; reason?: unknown; source?: unknown;
  }>;
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [feedback, setFeedback] = useState('');

  const toggle = (name: string) => {
    setSelected(prev => {
      const next = new Set(prev);
      if (next.has(name)) next.delete(name);
      else next.add(name);
      return next;
    });
  };

  const submit = () => {
    // 1) 用户勾选的 AI 提议维度（保留 name/reason/source）
    const picked = candidates
      .filter(c => selected.has(String(c.name ?? '')))
      .map(c => ({
        name: String(c.name ?? ''),
        reason: c.reason ? String(c.reason) : '',
        source: c.source ? String(c.source) : 'ai',
      }));
    const trimmed = feedback.trim();
    const payload: Record<string, unknown> = { selected_dimensions: picked };
    // 2) 补充意见非空时透传到后端，参与 question_plan prompt 注入
    if (trimmed) payload.user_feedback = trimmed;
    onSubmit(payload);
  };

  // 至少选中一个维度，或填写了补充意见，才允许提交
  const canSubmit = selected.size > 0 || feedback.trim().length > 0;

  return (
    <div className="rounded-md border border-[#0EA5E9]/40 bg-white shadow-sm px-4 py-3">
      <p className="text-sm font-semibold text-[#020617]">{title}</p>
      {prompt && <p className="text-xs text-[#64748B] mt-1 mb-3">{prompt}</p>}

      {candidates.length > 0 ? (
        <div className="space-y-1.5 mb-3">
          {candidates.map((c, i) => {
            const name = String(c.name ?? `选项 ${i + 1}`);
            const reason = c.reason ? String(c.reason) : null;
            const isSelected = selected.has(name);
            return (
              <button
                key={name}
                type="button"
                className={`w-full flex items-center gap-2 px-3 py-2 rounded-md border text-left text-sm transition-all
                  ${isSelected
                    ? 'border-[#0EA5E9] bg-[#0EA5E9]/5 text-[#0369A1]'
                    : 'border-[#E2E8F0] bg-white hover:bg-[#F8FAFC] text-[#020617]'}`}
                onClick={() => toggle(name)}
              >
                <span className={`w-4 h-4 rounded border flex-shrink-0 flex items-center justify-center text-xs
                  ${isSelected ? 'border-[#0EA5E9] bg-[#0EA5E9] text-white' : 'border-[#94A3B8]'}`}>
                  {isSelected && '✓'}
                </span>
                <span className="font-medium">{name}</span>
                {reason && <span className="text-[#94A3B8] text-xs ml-auto">{reason}</span>}
              </button>
            );
          })}
        </div>
      ) : (
        <p className="text-xs text-[#94A3B8] mb-3">候选维度为空</p>
      )}

      {/* 补充意见输入框：可追加维度或对 AI 提议的维度做约束说明 */}
      <textarea
        value={feedback}
        onChange={e => setFeedback(e.target.value)}
        placeholder="补充意见或追加维度（可选）：例如「重点关注分布式事务设计」"
        rows={2}
        className="w-full text-xs border border-[#E2E8F0] rounded px-2 py-1.5 mb-2
                   outline-none focus:border-[#0EA5E9] resize-none"
      />

      <div className="flex items-center gap-2">
        <button
          type="button"
          className="px-4 py-1.5 rounded-md bg-[#0369A1] text-white text-sm font-medium
                     hover:bg-[#0EA5E9] transition-colors
                     disabled:opacity-50 disabled:cursor-not-allowed"
          disabled={!canSubmit || submitting}
          onClick={submit}
        >
          {submitting ? '提交中…' : `确认选择 (${selected.size}${feedback.trim() ? ' + 备注' : ''})`}
        </button>
        <button
          type="button"
          className="px-3 py-1.5 rounded-md border border-[#E2E8F0] text-[#64748B] text-sm
                     hover:bg-[#F8FAFC] transition-colors
                     disabled:opacity-50 disabled:cursor-not-allowed"
          disabled={submitting}
          onClick={() => onSubmit({ regenerate: true, feedback: feedback.trim() })}
        >
          驳回重新建议
        </button>
      </div>
    </div>
  );
}

/** 出题计划审批卡：提交 { approved, edited_plan?, feedback? }
 *
 * 计划项可直接编辑：每行 question_count（数字）、difficulty（下拉）、focus（文本）。
 * - 批准时把编辑后的 items 与重算的 total_questions 一起回传 edited_plan
 * - 驳回时只透传 feedback，由后端循环回 build_question_plan 重新规划
 */
type PlanItem = {
  dimension: string;
  question_count: number;
  difficulty: string;
  focus: string;
};

const DIFFICULTY_OPTIONS = ['较低', '中等', '较高'];

function PlanApproval({ title, prompt, data, submitting, onSubmit }: SectionProps) {
  const [feedback, setFeedback] = useState('');
  const initialPlan = (data?.plan ?? {}) as {
    total_questions?: number;
    items?: Array<{ dimension?: string; question_count?: number; difficulty?: string; focus?: string }>;
    summary?: string;
  };

  // items 进入受控状态以支持行内编辑；缺失字段填默认值，避免 input 切换 controlled/uncontrolled
  const [items, setItems] = useState<PlanItem[]>(
    (initialPlan.items ?? []).map(it => ({
      dimension: String(it.dimension ?? ''),
      question_count: Math.max(1, Number(it.question_count ?? 1)),
      difficulty: DIFFICULTY_OPTIONS.includes(String(it.difficulty)) ? String(it.difficulty) : '中等',
      focus: String(it.focus ?? ''),
    })),
  );
  const summary = String(initialPlan.summary ?? '');

  // 实时重算总题量；批准时一并回传，避免和 items 求和不一致
  const totalQuestions = items.reduce((s, it) => s + (Number.isFinite(it.question_count) ? it.question_count : 0), 0);

  const updateItem = (idx: number, patch: Partial<PlanItem>) => {
    setItems(prev => prev.map((it, i) => (i === idx ? { ...it, ...patch } : it)));
  };

  const approve = () => {
    // 编辑后的 plan 与原 plan 字段对齐；后端 _request_plan_approval 检测到 edited_plan 会覆盖 state.question_plan
    const edited_plan = {
      total_questions: totalQuestions,
      items,
      summary,
    };
    onSubmit({ approved: true, edited_plan });
  };
  const reject = () => onSubmit({ approved: false, feedback: feedback.trim() });

  // 至少有一行且每行 question_count >=1 才允许批准
  const canApprove = items.length > 0 && items.every(it => it.question_count >= 1 && it.dimension);

  return (
    <div className="rounded-md border border-[#0EA5E9]/40 bg-white shadow-sm px-4 py-3">
      <p className="text-sm font-semibold text-[#020617]">{title}</p>
      {prompt && <p className="text-xs text-[#64748B] mt-1 mb-3">{prompt}</p>}

      {/* 计划编辑表 */}
      <div className="mb-3 text-xs">
        <div className="flex items-center justify-between mb-1.5">
          <span className="text-[#64748B]">总题量：<span className="text-[#0369A1] font-semibold">{totalQuestions}</span></span>
          <span className="text-[#94A3B8]">可直接编辑题量、难度与考察重点</span>
        </div>
        {items.length > 0 ? (
          <div className="border border-[#E2E8F0] rounded overflow-hidden">
            {/* 表头 */}
            <div className="flex items-center gap-2 px-2 py-1.5 bg-[#F8FAFC] text-[#94A3B8] text-[11px]">
              <span className="w-24 shrink-0">维度</span>
              <span className="w-14 shrink-0 text-center">题量</span>
              <span className="w-20 shrink-0">难度</span>
              <span className="flex-1">考察重点</span>
            </div>
            <div className="divide-y divide-[#E2E8F0]">
              {items.map((it, i) => (
                <div key={i} className="flex items-center gap-2 px-2 py-1.5">
                  {/* 维度名只读：与已选维度严格对齐，由后端校验 */}
                  <span className="w-24 shrink-0 font-medium text-[#020617] truncate" title={it.dimension}>
                    {it.dimension}
                  </span>
                  <input
                    type="number"
                    min={1}
                    max={6}
                    value={it.question_count}
                    onChange={e => updateItem(i, { question_count: Math.max(1, Math.min(6, Number(e.target.value) || 1)) })}
                    className="w-14 shrink-0 text-center border border-[#E2E8F0] rounded px-1 py-0.5
                               outline-none focus:border-[#0EA5E9]"
                  />
                  <select
                    value={it.difficulty}
                    onChange={e => updateItem(i, { difficulty: e.target.value })}
                    className="w-20 shrink-0 border border-[#E2E8F0] rounded px-1 py-0.5
                               outline-none focus:border-[#0EA5E9] bg-white"
                  >
                    {DIFFICULTY_OPTIONS.map(d => <option key={d} value={d}>{d}</option>)}
                  </select>
                  <input
                    type="text"
                    value={it.focus}
                    onChange={e => updateItem(i, { focus: e.target.value })}
                    placeholder="考察重点"
                    className="flex-1 min-w-0 border border-[#E2E8F0] rounded px-1.5 py-0.5
                               outline-none focus:border-[#0EA5E9]"
                  />
                </div>
              ))}
            </div>
          </div>
        ) : (
          <p className="text-[#94A3B8]">出题计划为空</p>
        )}
        {summary && <p className="text-[#64748B] mt-2">{summary}</p>}
      </div>

      {/* 驳回反馈输入框 */}
      <textarea
        value={feedback}
        onChange={e => setFeedback(e.target.value)}
        placeholder="如需驳回，请填写反馈意见（可选）"
        rows={2}
        className="w-full text-xs border border-[#E2E8F0] rounded px-2 py-1.5 mb-2
                   outline-none focus:border-[#0EA5E9] resize-none"
      />

      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={approve}
          disabled={!canApprove || submitting}
          className="px-4 py-1.5 rounded-md bg-[#0369A1] text-white text-sm font-medium
                     hover:bg-[#0EA5E9] transition-colors
                     disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {submitting ? '提交中…' : '批准'}
        </button>
        <button
          type="button"
          onClick={reject}
          disabled={submitting}
          className="px-4 py-1.5 rounded-md border border-[#E2E8F0] text-[#64748B] text-sm
                     hover:bg-[#F8FAFC] transition-colors
                     disabled:opacity-50 disabled:cursor-not-allowed"
        >
          驳回并重生成
        </button>
      </div>
    </div>
  );
}

/** 岗位选择卡：提交 { selected_job_name: string } */
function JobSelection({ title, prompt, data, submitting, onSubmit }: SectionProps) {
  const candidates = (data?.candidates ?? []) as Array<{ name?: unknown; description?: unknown }>;
  const [selected, setSelected] = useState<string | null>(null);
  const [feedback, setFeedback] = useState('');

  return (
    <div className="rounded-md border border-[#0EA5E9]/40 bg-white shadow-sm px-4 py-3">
      <p className="text-sm font-semibold text-[#020617]">{title}</p>
      {prompt && <p className="text-xs text-[#64748B] mt-1 mb-3">{prompt}</p>}

      <div className="space-y-1.5 mb-3">
        {candidates.map((c, i) => {
          const name = String(c.name ?? `岗位 ${i + 1}`);
          const desc = c.description ? String(c.description) : null;
          const isSelected = selected === name;
          return (
            <button
              key={name}
              type="button"
              className={`w-full flex flex-col items-start px-3 py-2 rounded-md border text-left text-sm transition-all
                ${isSelected
                  ? 'border-[#0EA5E9] bg-[#0EA5E9]/5 text-[#0369A1]'
                  : 'border-[#E2E8F0] bg-white hover:bg-[#F8FAFC] text-[#020617]'}`}
              onClick={() => setSelected(name)}
            >
              <span className="font-medium">{name}</span>
              {desc && <span className="text-[#94A3B8] text-xs mt-0.5">{desc}</span>}
            </button>
          );
        })}
      </div>

      {/* 驳回反馈输入框（与维度/计划卡统一） */}
      <textarea
        value={feedback}
        onChange={e => setFeedback(e.target.value)}
        placeholder="如需驳回重新选岗，可填写反馈意见（可选）"
        rows={2}
        className="w-full text-xs border border-[#E2E8F0] rounded px-2 py-1.5 mb-2
                   outline-none focus:border-[#0EA5E9] resize-none"
      />

      <div className="flex items-center gap-2">
        <button
          type="button"
          className="px-4 py-1.5 rounded-md bg-[#0369A1] text-white text-sm font-medium
                     hover:bg-[#0EA5E9] transition-colors
                     disabled:opacity-50 disabled:cursor-not-allowed"
          disabled={!selected || submitting}
          onClick={() => selected && onSubmit({ selected_job_name: selected })}
        >
          {submitting ? '提交中…' : '确认选择'}
        </button>
        <button
          type="button"
          className="px-3 py-1.5 rounded-md border border-[#E2E8F0] text-[#64748B] text-sm
                     hover:bg-[#F8FAFC] transition-colors
                     disabled:opacity-50 disabled:cursor-not-allowed"
          disabled={submitting}
          onClick={() => onSubmit({ regenerate: true, feedback: feedback.trim() })}
        >
          驳回重新选岗
        </button>
      </div>
    </div>
  );
}
