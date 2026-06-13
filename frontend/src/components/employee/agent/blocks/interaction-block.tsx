/**
 * InteractionBlock：用户交互卡片。
 *
 * - pending：根据 interaction_type 渲染不同表单
 *     - dimension_selection：候选维度多选 → 提交 { selected_dimensions: [...] }
 *     - plan_approval：批准/驳回 → 提交 { approved: bool, feedback?: string }
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
  onSubmit?: (requestId: string, values: Record<string, unknown>) => void;
}

export function InteractionBlock({ block, onSubmit }: InteractionBlockProps) {
  const { request_id, interaction_type, title, prompt, data, status } = block;

  // 已提交 / 已过期：统一展示
  if (status === 'submitted') {
    return (
      <div className="rounded-md border border-[#E2E8F0] bg-[#F8FAFC] px-4 py-3">
        <p className="text-sm font-medium text-[#64748B]">{title}</p>
        <p className="text-xs text-[#16A34A] mt-1">✓ 已提交</p>
      </div>
    );
  }
  if (status === 'expired') {
    return (
      <div className="rounded-md border border-[#E2E8F0] bg-[#F8FAFC] px-4 py-3">
        <p className="text-sm font-medium text-[#64748B]">{title}</p>
        <p className="text-xs text-[#94A3B8] mt-1">已过期</p>
      </div>
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
          onSubmit={(vals) => onSubmit?.(request_id, vals)}
        />
      );
    case 'plan_approval':
      return (
        <PlanApproval
          title={title}
          prompt={prompt}
          data={data}
          onSubmit={(vals) => onSubmit?.(request_id, vals)}
        />
      );
    case 'job_selection':
      return (
        <JobSelection
          title={title}
          prompt={prompt}
          data={data}
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

// ---------- 子组件 ----------

interface SectionProps {
  title: string;
  prompt: string;
  data: Record<string, unknown>;
  onSubmit: (values: Record<string, unknown>) => void;
}

/** 维度多选卡：提交 { selected_dimensions: [{name, reason, source}, ...] } */
function DimensionSelection({ title, prompt, data, onSubmit }: SectionProps) {
  const candidates = (data?.candidates ?? []) as Array<{
    name?: unknown; reason?: unknown; source?: unknown;
  }>;
  const [selected, setSelected] = useState<Set<string>>(new Set());

  const toggle = (name: string) => {
    setSelected(prev => {
      const next = new Set(prev);
      if (next.has(name)) next.delete(name);
      else next.add(name);
      return next;
    });
  };

  const submit = () => {
    // 把选中的维度对象（保留 name/reason/source）原样回传，与后端 state 类型对齐
    const picked = candidates
      .filter(c => selected.has(String(c.name ?? '')))
      .map(c => ({
        name: String(c.name ?? ''),
        reason: c.reason ? String(c.reason) : '',
        source: c.source ? String(c.source) : 'ai',
      }));
    onSubmit({ selected_dimensions: picked });
  };

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

      <button
        type="button"
        className="px-4 py-1.5 rounded-md bg-[#0369A1] text-white text-sm font-medium
                   hover:bg-[#0EA5E9] transition-colors
                   disabled:opacity-50 disabled:cursor-not-allowed"
        disabled={selected.size === 0}
        onClick={submit}
      >
        确认选择 ({selected.size})
      </button>
    </div>
  );
}

/** 出题计划审批卡：提交 { approved: bool, feedback?: string } */
function PlanApproval({ title, prompt, data, onSubmit }: SectionProps) {
  const [feedback, setFeedback] = useState('');
  const plan = (data?.plan ?? {}) as {
    total_questions?: number;
    items?: Array<{ dimension?: string; question_count?: number; difficulty?: string; focus?: string }>;
    summary?: string;
  };

  const approve = () => onSubmit({ approved: true });
  const reject = () => onSubmit({ approved: false, feedback: feedback.trim() });

  return (
    <div className="rounded-md border border-[#0EA5E9]/40 bg-white shadow-sm px-4 py-3">
      <p className="text-sm font-semibold text-[#020617]">{title}</p>
      {prompt && <p className="text-xs text-[#64748B] mt-1 mb-3">{prompt}</p>}

      {/* 计划摘要表 */}
      <div className="mb-3 text-xs">
        {plan.total_questions != null && (
          <p className="text-[#64748B] mb-1">总题量：{plan.total_questions}</p>
        )}
        {(plan.items ?? []).length > 0 && (
          <ul className="border border-[#E2E8F0] rounded divide-y divide-[#E2E8F0]">
            {plan.items!.map((it, i) => (
              <li key={i} className="px-2 py-1.5 flex items-center gap-2">
                <span className="font-medium text-[#020617]">{it.dimension}</span>
                <span className="text-[#94A3B8]">{it.question_count} 题</span>
                <span className="text-[#94A3B8]">· {it.difficulty}</span>
                {it.focus && <span className="text-[#94A3B8] truncate ml-auto">{it.focus}</span>}
              </li>
            ))}
          </ul>
        )}
        {plan.summary && <p className="text-[#64748B] mt-1">{plan.summary}</p>}
      </div>

      {/* 驳回反馈输入框 */}
      <textarea
        value={feedback}
        onChange={e => setFeedback(e.target.value)}
        placeholder="如需驳回，请填写反馈意见（可选）"
        rows={2}
        className="w-full text-xs border border-[#E2E8F0] rounded px-2 py-1.5 mb-2
                   outline-none focus:border-[#0EA5E9]"
      />

      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={approve}
          className="px-4 py-1.5 rounded-md bg-[#0369A1] text-white text-sm font-medium
                     hover:bg-[#0EA5E9] transition-colors"
        >
          批准
        </button>
        <button
          type="button"
          onClick={reject}
          className="px-4 py-1.5 rounded-md border border-[#E2E8F0] text-[#64748B] text-sm
                     hover:bg-[#F8FAFC] transition-colors"
        >
          驳回并重生成
        </button>
      </div>
    </div>
  );
}

/** 岗位选择卡：提交 { selected_job_name: string } */
function JobSelection({ title, prompt, data, onSubmit }: SectionProps) {
  const candidates = (data?.candidates ?? []) as Array<{ name?: unknown; description?: unknown }>;
  const [selected, setSelected] = useState<string | null>(null);

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

      <button
        type="button"
        className="px-4 py-1.5 rounded-md bg-[#0369A1] text-white text-sm font-medium
                   hover:bg-[#0EA5E9] transition-colors
                   disabled:opacity-50 disabled:cursor-not-allowed"
        disabled={!selected}
        onClick={() => selected && onSubmit({ selected_job_name: selected })}
      >
        确认选择
      </button>
    </div>
  );
}
