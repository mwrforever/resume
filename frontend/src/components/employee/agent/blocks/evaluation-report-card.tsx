/**
 * EvaluationReportCard：简历评估报告业务卡。
 *
 * - 顶部：SVG 分数环（颜色随分数变化）+ 决策标签
 * - 技能维度：横向条形可视化
 * - 经验时间线 / 岗位差距折叠面板
 */

import { useState } from 'react';
import type { AgentBlock, EvaluationReport } from '@/types/agent';
import { ReasoningSection } from './reasoning-section';

interface EvaluationReportCardProps {
  block: AgentBlock & { type: 'evaluation_report' };
  /** 吸附到本卡的思考内容（若有），嵌入默认收起的折叠区 */
  reasoning?: string;
}

/** 决策颜色映射 */
const DECISION_STYLES: Record<string, string> = {
  '推荐': 'bg-[#DCFCE7] text-[#16A34A] border-[#16A34A]/30',
  '不推荐': 'bg-[#FEE2E2] text-[#DC2626] border-[#DC2626]/30',
  '待定': 'bg-[#FEF3C7] text-[#D97706] border-[#D97706]/30',
};

/** 分数 → 环色 */
function ringColor(score: number): string {
  if (score >= 80) return '#16A34A';
  if (score >= 60) return '#D97706';
  return '#DC2626';
}

/** SVG 分数环 */
function ScoreRing({ score, color }: { score: number; color: string }) {
  const radius = 28;
  const circ = 2 * Math.PI * radius;
  const pct = Math.max(0, Math.min(100, score)) / 100;
  const offset = circ * (1 - pct);
  return (
    <div className="relative w-[72px] h-[72px] shrink-0">
      <svg className="w-full h-full -rotate-90" viewBox="0 0 72 72">
        <circle cx="36" cy="36" r={radius} fill="none" stroke="#EEF2F6" strokeWidth="6" />
        <circle
          cx="36" cy="36" r={radius} fill="none" stroke={color} strokeWidth="6"
          strokeLinecap="round"
          strokeDasharray={circ} strokeDashoffset={offset}
          style={{ transition: 'stroke-dashoffset 0.6s ease' }}
        />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <span className="text-xl font-bold text-[#020617] leading-none">{score.toFixed(0)}</span>
        <span className="text-[10px] text-[#94A3B8]">/100</span>
      </div>
    </div>
  );
}

/** 维度分数条 */
function DimensionBar({ name, score }: { name: string; score: number }) {
  const num = Number(score);
  const valid = Number.isFinite(num) ? Math.max(0, Math.min(100, num)) : 0;
  const color = valid >= 80 ? '#16A34A' : valid >= 60 ? '#D97706' : '#DC2626';
  return (
    <div className="flex items-center gap-2">
      <span className="w-28 shrink-0 text-xs text-[#64748B] truncate">{name}</span>
      <div className="flex-1 h-2 rounded-full bg-[#EEF2F6] overflow-hidden">
        <div
          className="h-full rounded-full transition-all duration-500"
          style={{ width: `${valid}%`, backgroundColor: color }}
        />
      </div>
      <span className="w-8 text-right text-xs font-mono text-[#334155]">
        {Number.isFinite(num) ? num.toFixed(0) : '-'}
      </span>
    </div>
  );
}

export function EvaluationReportCard({ block, reasoning }: EvaluationReportCardProps) {
  const report: EvaluationReport = block.report ?? ({} as EvaluationReport);
  const {
    final_score = 0, final_label = '', decision = '', summary = '',
    profile_summary, interview_suggestions, comprehensive_comment,
  } = report;
  const [showDetail, setShowDetail] = useState(false);
  const decisionStyle = DECISION_STYLES[decision] ?? 'bg-[#F1F5F9] text-[#64748B] border-[#CBD5E1]';
  const color = ringColor(final_score);

  return (
    <div className="
      relative bg-white rounded-2xl px-4 py-3.5
      shadow-[0_1px_3px_rgba(2,6,23,0.05),0_12px_32px_-12px_rgba(3,105,161,0.14)]
      before:content-[''] before:absolute before:inset-0 before:rounded-2xl
      before:p-px before:pointer-events-none
      before:[background:linear-gradient(135deg,rgba(14,165,233,0.45),rgba(3,105,161,0.18)_50%,rgba(226,232,240,0.6))]
      before:[mask:linear-gradient(#000_0_0)_content-box,linear-gradient(#000_0_0)]
      before:[mask-composite:xor] before:[-webkit-mask-composite:xor]
    ">
      {/* 浮起卡头小字 label */}
      <div className="text-[10px] font-bold uppercase tracking-[0.12em] text-[#0369A1] mb-2">
        Resume Evaluation
      </div>

      {/* 头部：分数环 + 决策 */}
      <div className="flex items-center gap-4 mb-3">
        <ScoreRing score={final_score} color={color} />
        <div className="flex-1 min-w-0">
          <h3 className="text-base font-semibold text-[#020617]">简历评估报告</h3>
          {final_label && <p className="text-sm text-[#64748B] mt-0.5">{final_label}</p>}
          {decision && (
            <span className={`inline-block mt-1.5 px-2.5 py-0.5 rounded-md border text-xs font-medium ${decisionStyle}`}>
              {decision}
            </span>
          )}
        </div>
      </div>

      {summary && <p className="text-sm text-[#64748B] leading-relaxed mb-3">{summary}</p>}

      {/* 候选人画像摘要（始终可见） */}
      {profile_summary && (
        <div className="flex flex-wrap items-center gap-2 mb-3 text-xs">
          {profile_summary.years != null && (
            <span className="px-2 py-0.5 rounded-md bg-[#F1F5F9] text-[#334155]">{profile_summary.years} 年经验</span>
          )}
          {profile_summary.education && (
            <span className="px-2 py-0.5 rounded-md bg-[#F1F5F9] text-[#334155]">{profile_summary.education}</span>
          )}
          {profile_summary.stack && profile_summary.stack.length > 0 && (
            <span className="px-2 py-0.5 rounded-md bg-[#E0F2FE] text-[#0369A1]">
              {profile_summary.stack.join(' / ')}
            </span>
          )}
          {profile_summary.stability && (
            <span className="px-2 py-0.5 rounded-md bg-[#F1F5F9] text-[#64748B]">{profile_summary.stability}</span>
          )}
        </div>
      )}

      {/* 详细面板折叠 */}
      <button
        type="button"
        className="w-full px-3 py-1.5 text-xs text-[#0369A1] font-medium text-left
                   hover:bg-[#F1F5F9] rounded-md transition-colors"
        onClick={() => setShowDetail(s => !s)}
      >
        {showDetail ? '收起详情 ↑' : '展开详情 ↓'}
      </button>

      {showDetail && (
        <div className="mt-2 space-y-4 text-sm">
          {/* 技能维度条形 */}
          {report.skill_dimensions?.length > 0 && (
            <section>
              <h4 className="font-medium text-[#020617] mb-2 text-sm">技能维度</h4>
              <div className="space-y-1.5">
                {report.skill_dimensions.map((dim: Record<string, unknown>, i: number) => (
                  <DimensionBar
                    key={i}
                    // 后端 skill_dimensions 的维度名字段为 dimension_name（非 name）
                    name={String(dim.dimension_name ?? dim.name ?? `维度${i + 1}`)}
                    score={Number(dim.score ?? 0)}
                  />
                ))}
              </div>
            </section>
          )}

          {/* 岗位差距 */}
          {report.job_gaps?.length > 0 && (
            <section>
              <h4 className="font-medium text-[#020617] mb-2 text-sm">岗位差距</h4>
              <ul className="list-disc ml-4 text-[#64748B] space-y-0.5 text-xs">
                {report.job_gaps.map((gap: Record<string, unknown>, i: number) => (
                  <li key={i}>{String(gap.description ?? gap.gap ?? JSON.stringify(gap))}</li>
                ))}
              </ul>
            </section>
          )}

          {/* 面试建议 */}
          {interview_suggestions && interview_suggestions.length > 0 && (
            <section>
              <h4 className="font-medium text-[#020617] mb-2 text-sm">面试重点考察</h4>
              <ul className="space-y-1 text-xs">
                {interview_suggestions.map((s, i) => (
                  <li key={i} className="text-[#475569]">
                    <span className="font-medium text-[#334155]">{s.focus}</span>
                    {s.reason && <span className="text-[#94A3B8]"> — {s.reason}</span>}
                  </li>
                ))}
              </ul>
            </section>
          )}

          {/* 综合评语：去 border，改为左 accent 条 callout 浅渐变底 */}
          {comprehensive_comment && (comprehensive_comment.advantages || comprehensive_comment.risks) && (
            <section
              className="relative pl-3 py-2
                         bg-gradient-to-r from-[#F8FAFC] via-[#F8FAFC]/70 to-transparent
                         rounded-r-md"
            >
              <span className="absolute left-0 top-1.5 bottom-1.5 w-[2.5px] rounded-r-full bg-gradient-to-b from-[#0EA5E9] to-[#0369A1]" />
              {comprehensive_comment.advantages && (
                <p className="text-xs text-[#16A34A]"><span className="font-medium">优势：</span>{comprehensive_comment.advantages}</p>
              )}
              {comprehensive_comment.risks && (
                <p className="text-xs text-[#D97706] mt-1"><span className="font-medium">风险：</span>{comprehensive_comment.risks}</p>
              )}
            </section>
          )}
        </div>
      )}
      {reasoning !== undefined && <ReasoningSection reasoning={reasoning} />}
    </div>
  );
}
