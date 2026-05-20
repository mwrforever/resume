import { ClipboardList, Loader2 } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import type { IPlanSubTask, TAgentDomain } from '@/types/agent';
import { PlanRepairHints } from './plan-repair-hints';

/** 领域标签中文映射 */
const domainLabelMap: Record<TAgentDomain, string> = {
  job: '岗位',
  application: '投递',
  evaluation: '评估',
  memory: '记忆',
  generic: '通用',
};

interface PlanReviewTreeProps {
  revision: number;
  maxRevisions: number;
  tasks: IPlanSubTask[];
  editable: boolean;
  repairSuggestions: string[];
  feedbackDraft: string;
  submitting: boolean;
  onFeedbackChange: (value: string) => void;
  onTaskInstructionChange: (taskId: string, instruction: string) => void;
  onApprove: () => void;
  onReject: () => void;
}

/**
 * 规划审批树（对应后端 UiComponentKey.PlanReviewTree）
 * 展示子任务列表，支持批准或带意见驳回并触发 resume 流
 */
export function PlanReviewTree({
  revision,
  maxRevisions,
  tasks,
  editable,
  repairSuggestions,
  feedbackDraft,
  submitting,
  onFeedbackChange,
  onTaskInstructionChange,
  onApprove,
  onReject,
}: PlanReviewTreeProps) {
  const rejectDisabled = submitting || feedbackDraft.trim().length === 0;

  return (
    <div
      className="ml-0 max-w-3xl rounded-3xl border border-violet-200 bg-violet-50/80 p-4 text-sm shadow-sm shadow-violet-100/70 md:ml-12"
      data-ui-component="PlanReviewTree"
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2 font-semibold text-slate-950">
            <ClipboardList size={15} className="text-violet-600" aria-hidden="true" />
            执行计划待审批
          </div>
          <p className="mt-1 text-xs text-slate-600">
            第 {revision} 轮规划 · 最多 {maxRevisions} 轮修订
          </p>
        </div>
        <Badge variant="warning">待确认</Badge>
      </div>

      <ol className="mt-4 space-y-3">
        {tasks.map((task, index) => (
          <li key={task.task_id} className="rounded-2xl border border-white/90 bg-white/90 p-3">
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-xs font-semibold text-violet-700">步骤 {index + 1}</span>
              <Badge variant="secondary">{domainLabelMap[task.domain] || task.domain}</Badge>
              <span className="font-medium text-slate-900">{task.title}</span>
            </div>
            {editable ? (
              <textarea
                className="mt-2 w-full resize-y rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-xs leading-5 text-slate-700 focus:border-violet-400 focus:outline-none focus:ring-2 focus:ring-violet-200"
                rows={3}
                value={task.instruction}
                disabled={submitting}
                onChange={(event) => onTaskInstructionChange(task.task_id, event.target.value)}
                aria-label={`${task.title} 执行说明`}
              />
            ) : (
              <p className="mt-2 whitespace-pre-wrap text-xs leading-5 text-slate-600">{task.instruction}</p>
            )}
            {task.depends_on && task.depends_on.length > 0 && (
              <p className="mt-1 text-[11px] text-slate-500">依赖：{task.depends_on.join(', ')}</p>
            )}
          </li>
        ))}
      </ol>

      <PlanRepairHints suggestions={repairSuggestions} />

      <label className="mt-4 block text-xs font-semibold text-slate-700" htmlFor="plan-review-feedback">
        驳回意见（驳回时必填）
      </label>
      <textarea
        id="plan-review-feedback"
        className="mt-1 w-full resize-y rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs leading-5 text-slate-700 focus:border-violet-400 focus:outline-none focus:ring-2 focus:ring-violet-200"
        rows={2}
        placeholder="请说明需要调整的方向，例如缺少岗位维度分析…"
        value={feedbackDraft}
        disabled={submitting}
        onChange={(event) => onFeedbackChange(event.target.value)}
      />

      <div className="mt-4 flex flex-wrap justify-end gap-2">
        <Button type="button" size="sm" variant="outline" disabled={rejectDisabled} onClick={onReject}>
          {submitting ? <Loader2 size={14} className="animate-spin" aria-hidden="true" /> : null}
          驳回并重规划
        </Button>
        <Button type="button" size="sm" disabled={submitting} onClick={onApprove}>
          {submitting ? <Loader2 size={14} className="animate-spin" aria-hidden="true" /> : null}
          批准执行
        </Button>
      </div>
    </div>
  );
}
