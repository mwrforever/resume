import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { AgentInteractionCard } from '@/components/employee/agent/agent-interaction-card';
import { AgentRunCompactTimeline } from '@/components/employee/agent/agent-run-compact-timeline';
import { AgentThinkingPanel } from '@/components/employee/agent/agent-thinking-panel';


describe('agent compact workflow components', () => {
  it('renders compact timeline collapsed summary and expands details', async () => {
    render(
      <AgentRunCompactTimeline
        items={[
          { id: 'step-1', type: 'node', status: 'success', title: '读取简历' },
          { id: 'step-2', type: 'node', status: 'running', title: '生成问题' },
        ]}
      />,
    );

    expect(screen.getByText('运行过程 · 已完成 1 步')).toBeInTheDocument();
    expect(screen.queryByText('读取简历')).not.toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: '展开运行过程' }));

    expect(screen.getByText('读取简历')).toBeInTheDocument();
  });

  it('renders thinking panel collapsed and reveals content on demand', async () => {
    render(<AgentThinkingPanel item={{ id: 'think-1', run_id: 'run-1', status: 'streaming', content: '正在分析简历结构' }} />);

    expect(screen.getByText('思考过程 · 生成中')).toBeInTheDocument();
    expect(screen.queryByText('正在分析简历结构')).not.toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: '展开思考过程' }));

    expect(screen.getByText('正在分析简历结构')).toBeInTheDocument();
  });

  it('submits selected dimensions from interaction card', async () => {
    const onSubmit = vi.fn();
    render(
      <AgentInteractionCard
        item={{
          id: 'req-1',
          run_id: 'run-1',
          interaction_type: 'dimension_selection',
          title: '选择面试维度',
          prompt: '请选择本次面试重点',
          data: { dimensions: [{ name: '项目深度' }, { name: '沟通表达' }] },
          submit_label: '确认维度',
          status: 'pending',
        }}
        onSubmit={onSubmit}
      />,
    );

    await userEvent.click(screen.getByRole('checkbox', { name: '项目深度' }));
    await userEvent.click(screen.getByRole('button', { name: '确认维度' }));

    expect(onSubmit).toHaveBeenCalledWith('req-1', { selected_dimensions: ['项目深度'] });
  });
});
