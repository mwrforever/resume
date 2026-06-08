import { CheckCircle2, Clipboard, HelpCircle, Layers3 } from 'lucide-react';

interface InterviewQuestionItem {
  question?: string;
  dimension?: string;
  difficulty?: string;
  evaluation_points?: string[];
  follow_up_suggestions?: string[];
  excellent_signals?: string[];
  average_signals?: string[];
  risk_signals?: string[];
}

interface InterviewQuestionSet {
  title?: string;
  total_questions?: number;
  dimensions?: string[];
  questions?: InterviewQuestionItem[];
}

interface InterviewQuestionSetCardProps {
  questionSet: InterviewQuestionSet;
}

/**
 * 渲染面试题业务卡片。
 *
 * @param props 组件属性，包含结构化面试题集合。
 * @return React.ReactElement 面试题分组展示卡片。
 */
export function InterviewQuestionSetCard({ questionSet }: InterviewQuestionSetCardProps) {
  const questions = Array.isArray(questionSet.questions) ? questionSet.questions : [];
  const groupedQuestions = questions.reduce<Record<string, InterviewQuestionItem[]>>((groups, question) => {
    const dimension = question.dimension || '未分组维度';
    return { ...groups, [dimension]: [...(groups[dimension] || []), question] };
  }, {});
  const title = questionSet.title || '面试题清单';
  const totalQuestions = questionSet.total_questions ?? questions.length;

  return (
    <section className="rounded-3xl border border-sky-100 bg-white p-5 shadow-sm shadow-sky-100/70" aria-label="面试题清单">
      <div className="flex flex-col gap-3 border-b border-slate-100 pb-4 md:flex-row md:items-center md:justify-between">
        <div>
          <div className="flex items-center gap-2 text-xs font-semibold text-sky-700">
            <HelpCircle size={15} aria-hidden="true" />
            简历问答结果
          </div>
          <h3 className="mt-1 text-lg font-semibold text-slate-950">{title}</h3>
        </div>
        <div className="inline-flex items-center gap-2 rounded-2xl bg-sky-50 px-3 py-2 text-sm font-semibold text-sky-700">
          <Layers3 size={15} aria-hidden="true" />
          共 {totalQuestions} 题
        </div>
      </div>

      <div className="mt-4 space-y-4">
        {Object.entries(groupedQuestions).map(([dimension, dimensionQuestions]) => (
          <div key={dimension} className="rounded-2xl border border-slate-100 bg-slate-50/70 p-4">
            <div className="mb-3 flex items-center justify-between gap-3">
              <h4 className="text-sm font-semibold text-slate-900">{dimension}</h4>
              <span className="rounded-full bg-white px-2.5 py-1 text-xs font-semibold text-slate-500">{dimensionQuestions.length} 题</span>
            </div>
            <div className="space-y-3">
              {dimensionQuestions.map((item, index) => (
                <article key={`${dimension}-${index}`} className="rounded-2xl border border-slate-200 bg-white p-4">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <div className="text-xs font-semibold text-slate-500">难度：{item.difficulty || '未标注'}</div>
                      <p className="mt-1 text-sm font-semibold leading-6 text-slate-950">{item.question || '未生成题目内容'}</p>
                    </div>
                    <button
                      type="button"
                      className="inline-flex shrink-0 items-center gap-1 rounded-xl border border-slate-200 px-2.5 py-1.5 text-xs font-semibold text-slate-600 hover:bg-slate-50"
                      onClick={() => navigator.clipboard?.writeText(item.question || '')}
                    >
                      <Clipboard size={13} aria-hidden="true" />
                      复制
                    </button>
                  </div>
                  {(item.evaluation_points || []).length > 0 && (
                    <div className="mt-3 flex flex-wrap gap-2">
                      {(item.evaluation_points || []).map((point) => (
                        <span key={point} className="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2.5 py-1 text-xs font-semibold text-emerald-700">
                          <CheckCircle2 size={12} aria-hidden="true" />
                          {point}
                        </span>
                      ))}
                    </div>
                  )}
                  <details className="mt-3 rounded-2xl bg-slate-50 px-3 py-2 text-xs text-slate-600">
                    <summary className="cursor-pointer font-semibold text-slate-700">追问建议与信号</summary>
                    <SignalList title="追问建议" values={item.follow_up_suggestions || []} />
                    <SignalList title="优秀信号" values={item.excellent_signals || []} />
                    <SignalList title="一般信号" values={item.average_signals || []} />
                    <SignalList title="风险信号" values={item.risk_signals || []} />
                  </details>
                </article>
              ))}
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}

/**
 * 渲染题目信号列表。
 *
 * @param props 列表标题和内容。
 * @return React.ReactElement | null 有内容时返回列表，否则返回空。
 */
function SignalList({ title, values }: { title: string; values: string[] }) {
  if (values.length === 0) return null;

  return (
    <div className="mt-2">
      <div className="font-semibold text-slate-700">{title}</div>
      <ul className="mt-1 list-disc space-y-1 pl-5">
        {values.map((value) => (
          <li key={value}>{value}</li>
        ))}
      </ul>
    </div>
  );
}
