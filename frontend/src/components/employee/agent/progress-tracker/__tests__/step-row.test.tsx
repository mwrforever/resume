/**
 * StepRow 序号渲染单测（议题 4）。
 *
 * - pending 态 + index：空圈内显示序号
 * - success/running/failed：仍渲染状态图标，不显示序号
 * - 未传 index：pending 空圈不显示数字（向后兼容）
 */
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { StepRow } from '../step-row';
import type { AgentStep } from '@/types/agent';

const pendingStep: AgentStep = { step_id: 's1', title: '读取简历', status: 'pending' };
const successStep: AgentStep = { step_id: 's2', title: '分析维度', status: 'success' };

describe('StepRow 序号（议题 4）', () => {
  it('pending 态传入 index=1 时显示序号 1', () => {
    render(<StepRow step={pendingStep} isLast={false} index={1} />);
    expect(screen.getByText('1')).toBeInTheDocument();
  });

  it('pending 态传入 index=3 时显示序号 3', () => {
    render(<StepRow step={pendingStep} isLast={false} index={3} />);
    expect(screen.getByText('3')).toBeInTheDocument();
  });

  it('success 态不显示序号（仍是成功图标）', () => {
    render(<StepRow step={successStep} isLast={false} index={1} />);
    expect(screen.queryByText('1')).toBeNull();
  });

  it('未传 index 时 pending 空圈不显示数字（向后兼容）', () => {
    render(<StepRow step={pendingStep} isLast={false} />);
    expect(screen.queryByText('1')).toBeNull();
  });
});
