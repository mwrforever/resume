// floating-progress.test.tsx
import { describe, it, expect } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { FloatingProgress } from '../floating-progress';
import type { AgentStep } from '@/types/agent';

const steps: AgentStep[] = [
  { step_id: 'load_resume', title: '读取简历', status: 'success' },
  { step_id: 'suggest_dimensions', title: '分析维度', status: 'success' },
];

describe('FloatingProgress', () => {
  it('默认收起：展示当前节点，面板（流程进度标签）不在 DOM', () => {
    render(<FloatingProgress steps={steps} running workflowType="interview_questions" />);
    // 当前节点 = 最后一个非 pending = 分析维度
    expect(screen.getByText('分析维度')).toBeInTheDocument();
    // 面板未展开
    expect(screen.queryByText('流程进度')).not.toBeInTheDocument();
  });

  it('点击胶囊后展开面板', () => {
    render(<FloatingProgress steps={steps} running workflowType="interview_questions" />);
    fireEvent.click(screen.getByText('分析维度'));
    expect(screen.getByText('流程进度')).toBeInTheDocument();
    // 计数 2 / 8
    expect(screen.getByText(/\/ 8 步/)).toBeInTheDocument();
  });
});
