/**
 * InterviewQuestionsCard：面试题集合业务卡。
 *
 * - 顶部统计条：总题数 / 维度数 / 难度分布
 * - 按维度分组展示题目
 * - 每题展示：题目、难度、评估要点
 * - 默认折叠详情，点击展开
 */

import { useMemo, useState } from 'react';
import type { AgentBlock, QuestionItem } from '@/types/agent';

interface InterviewQuestionsCardProps {
  block: AgentBlock & { type: 'interview_questions' };
}

/** 难度颜色映射 */
const DIFFICULTY_COLORS: Record<string, string> = {
  '简单': 'bg-[#DCFCE7] text-[#16A34A]',
  '中等': 'bg-[#FEF3C7] text-[#D97706]',
  '困难': 'bg-[#FEE2E2] text-[#DC2626]',
};

export function InterviewQuestionsCard({ block }: InterviewQuestionsCardProps) {
  const { question_set, status } = block;
  const questions = question_set?.questions ?? [];
  const dimensions = question_set?.dimensions ?? [];
  const [expandedQ, setExpandedQ] = useState<Set<number>>(new Set());

  // 难度分布统计
  const difficultyCount = useMemo(() => {
    const m: Record<string, number> = {};
    for (const q of questions) {
      const d = q.difficulty || '未分类';
      m[d] = (m[d] || 0) + 1;
    }
    return m;
  }, [questions]);

  const toggleQ = (idx: number) => {
    setExpandedQ(prev => {
      const next = new Set(prev);
      if (next.has(idx)) next.delete(idx);
      else next.add(idx);
      return next;
    });
  };

  return (
    <div>
      {/* 头部统计条 */}
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 mb-3">
        <div className="flex items-baseline gap-1">
          <span className="text-2xl font-bold text-[#020617]">{questions.length}</span>
          <span className="text-xs text-[#64748B]">道题</span>
        </div>
        <div className="flex items-baseline gap-1">
          <span className="text-lg font-semibold text-[#0369A1]">{dimensions.length}</span>
          <span className="text-xs text-[#64748B]">个维度</span>
        </div>
        {/* 难度分布 chip */}
        <div className="flex items-center gap-1.5">
          {Object.entries(difficultyCount).map(([d, n]) => (
            <span
              key={d}
              className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[11px] font-medium ${DIFFICULTY_COLORS[d] ?? 'bg-[#F1F5F9] text-[#64748B]'}`}
            >
              {d} {n}
            </span>
          ))}
        </div>
        {status === 'streaming' && (
          <span className="text-xs text-[#0EA5E9] animate-pulse">生成中…</span>
        )}
      </div>

      {/* 题目列表（无边框，由 AgentMessageCard 的 divide 提供分隔） */}
      <div className="space-y-1.5">
        {questions.map((q: QuestionItem, i: number) => {
          const isExpanded = expandedQ.has(i);
          return (
            <div key={i} className="rounded-lg border border-[#E2E8F0] hover:border-[#CBD5E1] transition-colors">
              {/* 题目标题行 */}
              <button
                type="button"
                className="flex items-start gap-2 w-full text-left px-3 py-2"
                onClick={() => toggleQ(i)}
              >
                <span className="text-[#94A3B8] text-xs font-mono mt-0.5 shrink-0">{i + 1}.</span>
                <span className="flex-1 text-sm text-[#020617] leading-relaxed">{q.question}</span>
                <span className={`shrink-0 text-[11px] px-1.5 py-0.5 rounded font-medium ${DIFFICULTY_COLORS[q.difficulty] ?? 'bg-[#F1F5F9] text-[#64748B]'}`}>
                  {q.difficulty}
                </span>
                <svg
                  className={`w-4 h-4 text-[#94A3B8] transition-transform duration-150 mt-0.5 shrink-0 ${isExpanded ? 'rotate-180' : ''}`}
                  fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}
                >
                  <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
                </svg>
              </button>

              {/* 展开详情 */}
              {isExpanded && (
                <div className="px-3 pb-2.5 ml-5 space-y-2 text-xs">
                  <p className="text-[#64748B]">
                    <span className="font-medium text-[#334155]">维度：</span>{q.dimension}
                  </p>
                  {q.evaluation_points?.length > 0 && (
                    <div>
                      <span className="font-medium text-[#334155]">评估要点：</span>
                      <ul className="list-disc ml-4 mt-1 text-[#64748B] space-y-0.5">
                        {q.evaluation_points.map((p, j) => <li key={j}>{p}</li>)}
                      </ul>
                    </div>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
