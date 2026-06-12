/**
 * InterviewQuestionsCard：面试题集合业务卡。
 *
 * - 按维度分组展示题目
 * - 每题展示：题目、难度、评估要点、优秀/一般/风险信号
 * - 默认折叠详情，点击展开
 */

import { useState } from 'react';
import type { AgentBlock, QuestionItem } from '@/types/agent';

interface InterviewQuestionsCardProps {
  block: AgentBlock & { type: 'interview_questions' };
}

/** 难度颜色映射 */
const DIFFICULTY_COLORS: Record<string, string> = {
  '简单': 'bg-success/10 text-success',
  '中等': 'bg-warning/10 text-warning',
  '困难': 'bg-destructive/10 text-destructive',
};

export function InterviewQuestionsCard({ block }: InterviewQuestionsCardProps) {
  const { question_set, status } = block;
  const questions = question_set?.questions ?? [];
  const dimensions = question_set?.dimensions ?? [];
  const [expandedQ, setExpandedQ] = useState<Set<number>>(new Set());

  const toggleQ = (idx: number) => {
    setExpandedQ(prev => {
      const next = new Set(prev);
      if (next.has(idx)) next.delete(idx);
      else next.add(idx);
      return next;
    });
  };

  return (
    <div className="rounded-lg border border-border bg-surface shadow-sm">
      {/* 头部 */}
      <div className="px-4 py-3 border-b border-border">
        <h3 className="text-md font-semibold text-foreground">面试题目</h3>
        <p className="text-xs text-mutedText mt-0.5">
          共 {questions.length} 题 · 覆盖 {dimensions.length} 个维度
        </p>
        {status === 'streaming' && (
          <span className="text-xs text-primary animate-pulse">生成中…</span>
        )}
      </div>

      {/* 题目列表 */}
      <div className="divide-y divide-border">
        {questions.map((q: QuestionItem, i: number) => {
          const isExpanded = expandedQ.has(i);
          return (
            <div key={i} className="px-4 py-3">
              {/* 题目标题行 */}
              <button
                type="button"
                className="flex items-start gap-2 w-full text-left"
                onClick={() => toggleQ(i)}
              >
                <span className="text-mutedText text-sm font-mono mt-0.5">{i + 1}.</span>
                <span className="flex-1 text-sm text-foreground">{q.question}</span>
                <span className={`text-xs px-1.5 py-0.5 rounded ${DIFFICULTY_COLORS[q.difficulty] ?? 'bg-surfaceMuted text-mutedText'}`}>
                  {q.difficulty}
                </span>
                <svg
                  className={`w-4 h-4 text-subtleText transition-transform duration-fast mt-0.5 ${isExpanded ? 'rotate-180' : ''}`}
                  fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}
                >
                  <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
                </svg>
              </button>

              {/* 展开详情 */}
              {isExpanded && (
                <div className="mt-2 ml-6 space-y-2 text-xs">
                  <p className="text-mutedText">
                    <span className="font-medium">维度：</span>{q.dimension}
                  </p>
                  {q.evaluation_points?.length > 0 && (
                    <div>
                      <span className="font-medium text-mutedText">评估要点：</span>
                      <ul className="list-disc ml-4 text-subtleText">
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
