import { useState } from 'react';
import { CheckCircle2, Clipboard, HelpCircle, Layers3, Pencil, Plus, RefreshCw, Trash2, X, Check } from 'lucide-react';
import { Button } from '@/components/ui/button';

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
  /** 是否启用编辑模式，允许增删改题目 */
  editable?: boolean;
  /** 编辑某道题目后的回调 */
  onEditQuestion?: (dimension: string, index: number, newQuestion: string) => void;
  /** 删除某道题目后的回调 */
  onDeleteQuestion?: (dimension: string, index: number) => void;
  /** 添加题目后的回调 */
  onAddQuestion?: (dimension: string) => void;
  /** 请求大模型重新生成的回调 */
  onRegenerate?: () => void;
  /** 确认面试题完成的回调 */
  onConfirm?: () => void;
  /** 是否正在重新生成中 */
  regenerating?: boolean;
}

/**
 * 可编辑面试题业务卡片。
 *
 * 支持查看、编辑、删除、添加题目，以及触发大模型重新生成。
 * 默认为只读模式，editable=true 时显示编辑控件。
 *
 * @param props 组件属性，包含面试题集合与编辑回调
 * @return React.ReactElement 面试题分组展示卡片
 */
export function InterviewQuestionSetCard({
  questionSet,
  editable = false,
  onEditQuestion,
  onDeleteQuestion,
  onAddQuestion,
  onRegenerate,
  onConfirm,
  regenerating = false,
}: InterviewQuestionSetCardProps) {
  /* 管理每道题的编辑状态，key 为 "dimension-index" */
  const [editingKey, setEditingKey] = useState<string | null>(null);
  const [editDraft, setEditDraft] = useState('');

  const questions = Array.isArray(questionSet.questions) ? questionSet.questions : [];
  /* 按维度分组 */
  const groupedQuestions = questions.reduce<Record<string, InterviewQuestionItem[]>>((groups, question) => {
    const dimension = question.dimension || '未分组维度';
    return { ...groups, [dimension]: [...(groups[dimension] || []), question] };
  }, {});
  const title = questionSet.title || '面试题清单';
  const totalQuestions = questionSet.total_questions ?? questions.length;

  /** 进入编辑模式 */
  const startEdit = (key: string, currentText: string) => {
    setEditingKey(key);
    setEditDraft(currentText);
  };

  /** 保存编辑 */
  const saveEdit = (dimension: string, index: number) => {
    if (editDraft.trim() && onEditQuestion) {
      onEditQuestion(dimension, index, editDraft.trim());
    }
    setEditingKey(null);
    setEditDraft('');
  };

  /** 取消编辑 */
  const cancelEdit = () => {
    setEditingKey(null);
    setEditDraft('');
  };

  return (
    <section className="rounded-3xl border border-sky-100 bg-white p-5 shadow-sm shadow-sky-100/70" aria-label="面试题清单">
      {/* 头部：标题与题数统计 */}
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

      {/* 题目分组列表 */}
      <div className="mt-4 space-y-4">
        {Object.entries(groupedQuestions).map(([dimension, dimensionQuestions]) => (
          <div key={dimension} className="rounded-2xl border border-slate-100 bg-slate-50/70 p-4">
            {/* 维度标题行 */}
            <div className="mb-3 flex items-center justify-between gap-3">
              <h4 className="text-sm font-semibold text-slate-900">{dimension}</h4>
              <div className="flex items-center gap-2">
                <span className="rounded-full bg-white px-2.5 py-1 text-xs font-semibold text-slate-500">{dimensionQuestions.length} 题</span>
                {editable && onAddQuestion && (
                  <button
                    type="button"
                    className="inline-flex items-center gap-1 rounded-full border border-sky-200 bg-sky-50 px-2 py-1 text-xs font-semibold text-sky-700 hover:bg-sky-100"
                    onClick={() => onAddQuestion(dimension)}
                  >
                    <Plus size={12} aria-hidden="true" />
                    添加
                  </button>
                )}
              </div>
            </div>

            {/* 该维度下的题目列表 */}
            <div className="space-y-3">
              {dimensionQuestions.map((item, index) => {
                const itemKey = `${dimension}-${index}`;
                const isEditing = editingKey === itemKey;

                return (
                  <article key={itemKey} className="rounded-2xl border border-slate-200 bg-white p-4">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0 flex-1">
                        <div className="text-xs font-semibold text-slate-500">难度：{item.difficulty || '未标注'}</div>
                        {isEditing ? (
                          /* 编辑模式：textarea 替代文本展示 */
                          <textarea
                            className="mt-1 w-full resize-y rounded-xl border border-sky-200 bg-sky-50/50 px-3 py-2 text-sm font-semibold leading-6 text-slate-950 focus:border-sky-400 focus:outline-none focus:ring-2 focus:ring-sky-100"
                            rows={2}
                            value={editDraft}
                            onChange={(e) => setEditDraft(e.target.value)}
                            aria-label="编辑题目内容"
                          />
                        ) : (
                          <p className="mt-1 text-sm font-semibold leading-6 text-slate-950">{item.question || '未生成题目内容'}</p>
                        )}
                      </div>
                      <div className="flex shrink-0 items-center gap-1">
                        {!isEditing && (
                          <button
                            type="button"
                            className="inline-flex shrink-0 items-center gap-1 rounded-xl border border-slate-200 px-2.5 py-1.5 text-xs font-semibold text-slate-600 hover:bg-slate-50"
                            onClick={() => navigator.clipboard?.writeText(item.question || '')}
                          >
                            <Clipboard size={13} aria-hidden="true" />
                            复制
                          </button>
                        )}
                        {editable && !isEditing && (
                          <>
                            <button
                              type="button"
                              className="inline-flex items-center gap-1 rounded-xl border border-slate-200 px-2 py-1.5 text-xs font-semibold text-slate-600 hover:bg-slate-50"
                              onClick={() => startEdit(itemKey, item.question || '')}
                              aria-label="编辑题目"
                            >
                              <Pencil size={12} aria-hidden="true" />
                            </button>
                            <button
                              type="button"
                              className="inline-flex items-center gap-1 rounded-xl border border-red-200 px-2 py-1.5 text-xs font-semibold text-red-600 hover:bg-red-50"
                              onClick={() => onDeleteQuestion?.(dimension, index)}
                              aria-label="删除题目"
                            >
                              <Trash2 size={12} aria-hidden="true" />
                            </button>
                          </>
                        )}
                        {isEditing && (
                          <>
                            <button
                              type="button"
                              className="inline-flex items-center gap-1 rounded-xl border border-emerald-200 px-2 py-1.5 text-xs font-semibold text-emerald-600 hover:bg-emerald-50"
                              onClick={() => saveEdit(dimension, index)}
                              aria-label="保存编辑"
                            >
                              <Check size={12} aria-hidden="true" />
                            </button>
                            <button
                              type="button"
                              className="inline-flex items-center gap-1 rounded-xl border border-slate-200 px-2 py-1.5 text-xs font-semibold text-slate-600 hover:bg-slate-50"
                              onClick={cancelEdit}
                              aria-label="取消编辑"
                            >
                              <X size={12} aria-hidden="true" />
                            </button>
                          </>
                        )}
                      </div>
                    </div>
                    {/* 评估要点标签 */}
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
                    {/* 追问建议与信号（折叠展示） */}
                    <details className="mt-3 rounded-2xl bg-slate-50 px-3 py-2 text-xs text-slate-600">
                      <summary className="cursor-pointer font-semibold text-slate-700">追问建议与信号</summary>
                      <SignalList title="追问建议" values={item.follow_up_suggestions || []} />
                      <SignalList title="优秀信号" values={item.excellent_signals || []} />
                      <SignalList title="一般信号" values={item.average_signals || []} />
                      <SignalList title="风险信号" values={item.risk_signals || []} />
                    </details>
                  </article>
                );
              })}
            </div>
          </div>
        ))}
      </div>

      {/* 底部操作栏：重新生成 + 确认完成 */}
      {editable && (
        <div className="mt-5 flex flex-wrap items-center justify-end gap-2 border-t border-slate-100 pt-4">
          {onRegenerate && (
            <Button type="button" variant="outline" size="sm" onClick={onRegenerate} disabled={regenerating}>
              <RefreshCw size={14} className={`mr-1 ${regenerating ? 'animate-spin' : ''}`} aria-hidden="true" />
              {regenerating ? '重新生成中...' : '重新生成'}
            </Button>
          )}
          {onConfirm && (
            <Button type="button" size="sm" onClick={onConfirm} disabled={regenerating}>
              <CheckCircle2 size={14} className="mr-1" aria-hidden="true" />
              确认完成
            </Button>
          )}
        </div>
      )}
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