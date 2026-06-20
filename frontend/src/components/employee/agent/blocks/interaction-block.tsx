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

import { useRef, useState } from 'react';
import type { AgentBlock } from '@/types/agent';

interface InteractionBlockProps {
  block: AgentBlock & { type: 'interaction' };
  /** 是否正在提交（父级 sending）→ 禁用所有提交按钮，防止重复点击 */
  submitting?: boolean;
  onSubmit?: (requestId: string, values: Record<string, unknown>) => void;
}

export function InteractionBlock({ block, submitting, onSubmit }: InteractionBlockProps) {
  const { request_id, interaction_type, title, prompt, data, status, values } = block;

  // 终态（已提交/已驳回/已过期）：直接展示只读 UI（高亮用户当时的选择），不渲染操作按钮
  if (status === 'submitted' || status === 'rejected' || status === 'expired') {
    return (
      <ResolvedInteraction
        title={title}
        status={status}
        interactionType={interaction_type}
        data={data}
        values={values ?? {}}
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

/** 终态交互卡：状态徽标 + 标题 + 只读回看原文（按类型渲染真实 UI，高亮用户当时的选择）。无操作按钮。 */
function ResolvedInteraction({
  title, status, interactionType, data, values,
}: {
  title: string;
  status: 'submitted' | 'rejected' | 'expired';
  interactionType: string;
  data: Record<string, unknown>;
  values: Record<string, unknown>;
}) {
  const badge =
    status === 'submitted' ? { txt: '✓ 已提交', cls: 'bg-[#DCFCE7] text-[#16A34A]' } :
    status === 'rejected'  ? { txt: '↻ 已驳回', cls: 'bg-[#FEF3C7] text-[#D97706]' } :
                             { txt: '已过期', cls: 'bg-[#F1F5F9] text-[#94A3B8]' };

  return (
    <div className="rounded-md border border-[#E2E8F0] bg-[#F8FAFC] px-4 py-3">
      <div className="flex items-center gap-2 mb-2">
        <span className={`text-[11px] px-2 py-0.5 rounded-full font-semibold ${badge.cls}`}>{badge.txt}</span>
        <span className="text-sm font-semibold text-[#334155]">{title}</span>
      </div>
      {interactionType === 'dimension_selection' && (
        <ReadOnlyDimensionSelection data={data} values={values} />
      )}
      {interactionType === 'plan_approval' && (
        <ReadOnlyPlanApproval data={data} values={values} />
      )}
      {interactionType === 'job_selection' && (
        <ReadOnlyJobSelection data={data} values={values} />
      )}
    </div>
  );
}

/** 只读维度选择：列出候选维度，高亮用户当时选中的项。 */
function ReadOnlyDimensionSelection({
  data, values,
}: {
  data: Record<string, unknown>;
  values: Record<string, unknown>;
}) {
  const candidates = (data?.candidates ?? []) as Array<{ name?: unknown; reason?: unknown }>;
  // 用户当时选中的维度名集合
  const selectedNames = new Set(
    ((values?.selected_dimensions as Array<{ name?: unknown }> | undefined) ?? [])
      .map(d => String(d.name ?? '')),
  );
  if (candidates.length === 0) {
    return <p className="text-xs text-[#94A3B8]">候选维度为空</p>;
  }
  return (
    <div className="space-y-1.5">
      {candidates.map((c, i) => {
        const name = String(c.name ?? `选项 ${i + 1}`);
        const reason = c.reason ? String(c.reason) : null;
        const isSelected = selectedNames.has(name);
        return (
          <div
            key={i}
            className={`flex items-center gap-2 px-3 py-1.5 rounded-md border text-sm
              ${isSelected ? 'border-[#0EA5E9] bg-[#0EA5E9]/5 text-[#0369A1]' : 'border-[#E2E8F0] bg-white text-[#020617]'}`}
          >
            <span className={`w-4 h-4 rounded border flex-shrink-0 flex items-center justify-center text-xs
              ${isSelected ? 'border-[#0EA5E9] bg-[#0EA5E9] text-white' : 'border-[#CBD5E1]'}`}>
              {isSelected && '✓'}
            </span>
            <span className="font-medium">{name}</span>
            {reason && <span className="text-[#94A3B8] text-xs ml-auto">{reason}</span>}
          </div>
        );
      })}
    </div>
  );
}

/** 只读计划审批：渲染计划表（维度/题量/难度/考察重点），优先展示用户提交的 edited_plan。 */
function ReadOnlyPlanApproval({
  data, values,
}: {
  data: Record<string, unknown>;
  values: Record<string, unknown>;
}) {
  // 优先用用户提交的 edited_plan（反映用户最终确认的版本），否则回退 AI 原始 plan
  const plan = ((values?.edited_plan as Record<string, unknown> | undefined) ??
    (data?.plan as Record<string, unknown> | undefined) ??
    {}) as {
      total_questions?: number;
      items?: Array<{ dimension?: string; question_count?: number; difficulty?: string; focus?: string }>;
      summary?: string;
    };
  const items = plan.items ?? [];
  if (items.length === 0) {
    return <p className="text-xs text-[#94A3B8]">出题计划为空</p>;
  }
  return (
    <div className="text-xs">
      <p className="text-[#64748B] mb-1.5">总题量：<span className="text-[#0369A1] font-semibold">{plan.total_questions ?? items.length}</span></p>
      <div className="border border-[#E2E8F0] rounded overflow-hidden">
        <div className="flex items-center gap-2 px-2 py-1.5 bg-[#F8FAFC] text-[#94A3B8] text-[11px]">
          <span className="w-24 shrink-0">维度</span>
          <span className="w-14 shrink-0 text-center">题量</span>
          <span className="w-20 shrink-0">难度</span>
          <span className="flex-1">考察重点</span>
        </div>
        <div className="divide-y divide-[#E2E8F0]">
          {items.map((it, i) => (
            <div key={i} className="flex items-center gap-2 px-2 py-1.5 text-[#020617]">
              <span className="w-24 shrink-0 font-medium truncate" title={String(it.dimension ?? '')}>{String(it.dimension ?? '')}</span>
              <span className="w-14 shrink-0 text-center">{String(it.question_count ?? '')}</span>
              <span className="w-20 shrink-0">{String(it.difficulty ?? '')}</span>
              <span className="flex-1 truncate" title={String(it.focus ?? '')}>{String(it.focus ?? '')}</span>
            </div>
          ))}
        </div>
      </div>
      {plan.summary && <p className="text-[#64748B] mt-2">{plan.summary}</p>}
    </div>
  );
}

/** 只读岗位选择：列出候选岗位，高亮用户当时选中的项。 */
function ReadOnlyJobSelection({
  data, values,
}: {
  data: Record<string, unknown>;
  values: Record<string, unknown>;
}) {
  const candidates = (data?.candidates ?? []) as Array<{ name?: unknown; description?: unknown }>;
  const selectedName = String((values?.selected_job_name as string | undefined) ?? '');
  if (candidates.length === 0) {
    return <p className="text-xs text-[#94A3B8]">候选岗位为空</p>;
  }
  return (
    <div className="space-y-1.5">
      {candidates.map((c, i) => {
        const name = String(c.name ?? `岗位 ${i + 1}`);
        const desc = c.description ? String(c.description) : null;
        const isSelected = name === selectedName;
        return (
          <div
            key={i}
            className={`flex flex-col px-3 py-1.5 rounded-md border text-sm
              ${isSelected ? 'border-[#0EA5E9] bg-[#0EA5E9]/5 text-[#0369A1]' : 'border-[#E2E8F0] bg-white text-[#020617]'}`}
          >
            <span className="flex items-center gap-2 font-medium">
              {isSelected && <span className="text-[#0EA5E9]">✓</span>}
              {name}
            </span>
            {desc && <span className="text-[#94A3B8] text-xs mt-0.5">{desc}</span>}
          </div>
        );
      })}
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
          onClick={() => {
            // 已勾选维度 = 用户采纳的，驳回后必须保留
            const accepted = candidates
              .filter(c => selected.has(String(c.name ?? '')))
              .map(c => ({
                name: String(c.name ?? ''),
                reason: c.reason ? String(c.reason) : '',
              }));
            // 未勾选维度 = 用户否决的，驳回后必须替换为新建议
            const rejected = candidates
              .filter(c => !selected.has(String(c.name ?? '')))
              .map(c => ({
                name: String(c.name ?? ''),
                reason: c.reason ? String(c.reason) : '',
              }));
            onSubmit({
              regenerate: true,
              feedback: feedback.trim(),
              accepted_dimensions: accepted,
              rejected_dimensions: rejected,
            });
          }}
        >
          {selected.size === 0 ? '全部驳回，重新建议' : `保留已选 ${selected.size} 个，调整其余`}
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

/** 岗位选择卡：分页（5/页）+ 手动搜索（按钮/Enter 触发，leading-edge 节流）。
 *  提交 { selected_job_name }。不随输入自动过滤；节流防连点。
 *
 * 注意：本卡不含驳回 textarea + 按钮——岗位候选源是员工绑定岗位 DB 列表
 * （load_job_candidates 节点不调 LLM，候选岗固定），驳回重生成在后端无 LLM 支撑、
 * feedback 字段会被丢弃。移除驳回入口避免误导用户；如需切换岗位直接点选其它候选项即可。
 */
const JOB_PAGE_SIZE = 5;
const JOB_SEARCH_THROTTLE_MS = 300;

function JobSelection({ title, prompt, data, submitting, onSubmit }: SectionProps) {
  const candidates = (data?.candidates ?? []) as Array<{ name?: unknown; description?: unknown }>;
  const [selected, setSelected] = useState<string | null>(null);
  const [query, setQuery] = useState('');          // 输入框文本（未应用）
  const [appliedQuery, setAppliedQuery] = useState(''); // 已应用的搜索词（决定过滤）
  const [page, setPage] = useState(0);
  const lastSearchRef = useRef(0);                 // 节流时间戳（不进 state）

  // 过滤基于已应用的 appliedQuery（非输入中的 query，避免输入过程中列表抖动）
  const filtered = appliedQuery.trim()
    ? candidates.filter(c => {
        const q = appliedQuery.trim().toLowerCase();
        return String(c.name ?? '').toLowerCase().includes(q)
            || String(c.description ?? '').toLowerCase().includes(q);
      })
    : candidates;
  const totalPages = Math.max(1, Math.ceil(filtered.length / JOB_PAGE_SIZE));
  // 过滤结果收缩时夹紧当前页，避免落到空白页
  const safePage = Math.min(page, totalPages - 1);
  const pageJobs = filtered.slice(safePage * JOB_PAGE_SIZE, safePage * JOB_PAGE_SIZE + JOB_PAGE_SIZE);

  /** 执行搜索：读输入框当前值 → 应用过滤 → 重置第 1 页。
   *  leading-edge 节流：距上次执行不足 300ms 忽略（防连点 / Enter+点击叠加）。 */
  const applySearch = () => {
    const now = Date.now();
    if (now - lastSearchRef.current < JOB_SEARCH_THROTTLE_MS) return;
    lastSearchRef.current = now;
    setAppliedQuery(query);
    setPage(0);
    // 已选岗位被新过滤结果排除时清空，避免提交一个用户看不见的选项
    if (selected) {
      const q = query.trim().toLowerCase();
      const stillIn = candidates.some(c =>
        String(c.name ?? '') === selected
        && String(c.name ?? '').toLowerCase().includes(q));
      if (!stillIn) setSelected(null);
    }
  };
  /** 清除搜索词并重置节流，恢复全量分页。 */
  const clearSearch = () => {
    setQuery(''); setAppliedQuery(''); setPage(0); lastSearchRef.current = 0;
  };

  return (
    <div className="rounded-md border border-[#0EA5E9]/40 bg-white shadow-sm px-4 py-3">
      <p className="text-sm font-semibold text-[#020617]">{title}</p>
      {prompt && <p className="text-xs text-[#64748B] mt-1 mb-3">{prompt}</p>}

      {/* 搜索框 + 搜索按钮（手动触发，输入过程不自动过滤） */}
      <div className="flex items-center gap-2 px-3 py-2 mb-3 rounded-lg border bg-[#F1F5F9]
                      focus-within:border-[#0EA5E9] focus-within:bg-white
                      focus-within:shadow-[0_0_0_3px_rgba(14,165,233,0.18)] transition-all">
        <svg className="w-4 h-4 text-[#94A3B8] shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor"><circle cx="11" cy="11" r="7"/><path d="M21 21l-4.3-4.3" strokeLinecap="round"/></svg>
        <input
          type="text"
          value={query}
          onChange={e => setQuery(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); applySearch(); } }}
          placeholder="输入岗位名称或技能方向，点击搜索"
          className="flex-1 min-w-0 bg-transparent border-none outline-none text-sm text-[#020617] placeholder:text-[#94A3B8]"
        />
        {query && (
          <button type="button" onClick={clearSearch} aria-label="清除搜索"
                  className="text-[#94A3B8] hover:text-[#DC2626] text-sm px-1">×</button>
        )}
        <button type="button" onClick={applySearch}
                className="px-3 py-1 rounded-md bg-gradient-to-b from-[#0EA5E9] to-[#0369A1]
                           text-white text-xs font-semibold active:scale-95 transition-transform shrink-0">
          搜索
        </button>
      </div>

      {/* 岗位列表（当前页） */}
      {pageJobs.length === 0 ? (
        <p className="text-xs text-[#94A3B8] mb-3 py-4 text-center">未找到匹配「{appliedQuery}」的岗位</p>
      ) : (
        <div className="space-y-1.5 mb-3">
          {pageJobs.map((c, i) => {
            const name = String(c.name ?? `岗位 ${i + 1}`);
            const desc = c.description ? String(c.description) : null;
            const isSelected = selected === name;
            return (
              <button key={name} type="button" aria-label={name}
                className={`w-full flex flex-col items-start px-3 py-2 rounded-md border text-left text-sm transition-all
                  ${isSelected ? 'border-[#0EA5E9] bg-[#0EA5E9]/5 text-[#0369A1]' : 'border-[#E2E8F0] bg-white hover:bg-[#F8FAFC] text-[#020617]'}`}
                onClick={() => setSelected(name)}>
                <span className="font-medium">{name}</span>
                {desc && <span className="text-[#94A3B8] text-xs mt-0.5">{desc}</span>}
              </button>
            );
          })}
        </div>
      )}

      {/* 分页器 */}
      <div className="flex items-center justify-between pt-2 border-t border-[#E2E8F0] mb-3">
        <span className="text-[11px] text-[#94A3B8] font-mono">
          第 {safePage + 1} / {totalPages} 页 · 共 {filtered.length} 条
        </span>
        <div className="flex items-center gap-1.5">
          <button type="button" aria-label="上一页" disabled={safePage === 0}
                  onClick={() => setPage(p => Math.max(0, p - 1))}
                  className="w-7 h-7 rounded-md border border-[#E2E8F0] bg-white text-[#64748B]
                             disabled:opacity-35 hover:border-[#0EA5E9] hover:text-[#0369A1] flex items-center justify-center">‹</button>
          {Array.from({ length: totalPages }).map((_, i) => (
            <span key={i} className={`rounded-full transition-all ${i === safePage
              ? 'w-4 h-1.5 bg-gradient-to-r from-[#0EA5E9] to-[#0369A1]' : 'w-1.5 h-1.5 bg-[#E2E8F0]'}`} />
          ))}
          <button type="button" aria-label="下一页" disabled={safePage >= totalPages - 1}
                  onClick={() => setPage(p => Math.min(totalPages - 1, p + 1))}
                  className="w-7 h-7 rounded-md border border-[#E2E8F0] bg-white text-[#64748B]
                             disabled:opacity-35 hover:border-[#0EA5E9] hover:text-[#0369A1] flex items-center justify-center">›</button>
        </div>
      </div>

      <button type="button"
        className="px-4 py-1.5 rounded-md bg-[#0369A1] text-white text-sm font-medium hover:bg-[#0EA5E9] transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
        disabled={!selected || submitting}
        onClick={() => selected && onSubmit({ selected_job_name: selected })}>
        {submitting ? '提交中…' : '确认选择'}
      </button>
    </div>
  );
}
