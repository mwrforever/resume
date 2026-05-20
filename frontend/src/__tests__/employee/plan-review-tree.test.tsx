import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { PlanReviewTree } from '@/components/employee/agent/plan-review-tree';
import type { IPlanSubTask } from '@/types/agent';

const tasks: IPlanSubTask[] = [
  { task_id: 't1', domain: 'job', title: '分析岗位', instruction: '梳理岗位要求' },
  { task_id: 't2', domain: 'application', title: '筛选投递', instruction: '按条件筛选候选人' },
];

describe('PlanReviewTree', () => {
  it('renders tasks and disables reject until feedback is provided', async () => {
    const onReject = vi.fn();
    const onApprove = vi.fn();

    render(
      <PlanReviewTree
        revision={1}
        maxRevisions={3}
        tasks={tasks}
        editable
        repairSuggestions={['补充评估维度']}
        feedbackDraft=""
        submitting={false}
        onFeedbackChange={vi.fn()}
        onTaskInstructionChange={vi.fn()}
        onApprove={onApprove}
        onReject={onReject}
      />,
    );

    expect(screen.getByText('执行计划待审批')).toBeInTheDocument();
    expect(screen.getByText('分析岗位')).toBeInTheDocument();
    expect(screen.getByText('补充评估维度')).toBeInTheDocument();

    const rejectButton = screen.getByRole('button', { name: '驳回并重规划' });
    expect(rejectButton).toBeDisabled();

    await userEvent.click(screen.getByRole('button', { name: '批准执行' }));
    expect(onApprove).toHaveBeenCalledTimes(1);
  });
});
