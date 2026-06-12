/**
 * EvaluationReportCard：简历评估报告业务卡。
 *
 * - 总分 + 决策标签（推荐/不推荐/待定）
 * - 匹配概览、技能维度、经验时间线、岗位差距
 * - 折叠面板式布局
 */

import { useState } from 'react';
import type { AgentBlock, EvaluationReport } from '@/types/agent';

interface EvaluationReportCardProps {
  block: AgentBlock & { type: 'evaluation_report' };
}

/** 决策颜色映射 */
const DECISION_STYLES: Record<string, string> = {
  '推荐': 'bg-success/10 text-success border-success/30',
  '不推荐': 'bg-destructive/10 text-destructive border-destructive/30',
  '待定': 'bg-warning/10 text-warning border-warning/30',
};

/** 分数颜色 */
function scoreColor(score: number): string {
  if (score >= 80) return 'text-success';
  if (score >= 60) return 'text-warning';
  return 'text-destructive';
}

export function EvaluationReportCard({ block }: EvaluationReportCardProps) {
  const report: EvaluationReport = block.report ?? ({} as EvaluationReport);
  const { final_score = 0, final_label = '', decision = '', summary = '' } = report;
  const [showDetail, setShowDetail] = useState(false);
  const decisionStyle = DECISION_STYLES[decision] ?? 'bg-surfaceMuted text-mutedText border-border';

  return (
    <div className="rounded-lg border border-border bg-surface shadow-sm">
      {/* 头部：总分 + 决策 */}
      <div className="px-4 py-4 border-b border-border">
        <div className="flex items-center justify-between">
          <div>
            <h3 className="text-md font-semibold text-foreground">简历评估报告</h3>
            {final_label && <p className="text-sm text-mutedText mt-0.5">{final_label}</p>}
          </div>
          <div className="text-right">
            <span className={`text-3xl font-bold ${scoreColor(final_score)}`}>
              {final_score.toFixed(0)}
            </span>
            <span className="text-sm text-subtleText">/100</span>
          </div>
        </div>
        {decision && (
          <span className={`inline-block mt-2 px-2.5 py-0.5 rounded-md border text-xs font-medium ${decisionStyle}`}>
            {decision}
          </span>
        )}
        {summary && <p className="mt-3 text-sm text-mutedText leading-normal">{summary}</p>}
      </div>

      {/* 详细面板折叠 */}
      <button
        type="button"
        className="w-full px-4 py-2 text-xs text-primary font-medium text-left hover:bg-surfaceMuted transition-colors"
        onClick={() => setShowDetail(s => !s)}
      >
        {showDetail ? '收起详情 ↑' : '展开详情 ↓'}
      </button>

      {showDetail && (
        <div className="px-4 pb-4 space-y-4 text-sm">
          {/* 技能维度 */}
          {report.skill_dimensions?.length > 0 && (
            <section>
              <h4 className="font-medium text-foreground mb-2">技能维度</h4>
              <div className="space-y-1">
                {report.skill_dimensions.map((dim: Record<string, unknown>, i: number) => (
                  <div key={i} className="flex items-center gap-2 text-mutedText">
                    <span className="flex-1">{String(dim.name ?? `维度${i + 1}`)}</span>
                    <span className="font-mono">{String(dim.score ?? '-')}</span>
                  </div>
                ))}
              </div>
            </section>
          )}

          {/* 岗位差距 */}
          {report.job_gaps?.length > 0 && (
            <section>
              <h4 className="font-medium text-foreground mb-2">岗位差距</h4>
              <ul className="list-disc ml-4 text-mutedText space-y-0.5">
                {report.job_gaps.map((gap: Record<string, unknown>, i: number) => (
                  <li key={i}>{String(gap.description ?? gap.gap ?? JSON.stringify(gap))}</li>
                ))}
              </ul>
            </section>
          )}
        </div>
      )}
    </div>
  );
}
