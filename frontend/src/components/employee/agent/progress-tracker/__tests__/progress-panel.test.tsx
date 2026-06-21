import { describe, it, expect } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { ProgressPanel } from '../progress-panel';
import type { AgentStep } from '@/types/agent';

const steps: AgentStep[] = [
  { step_id: 'load_resume', title: '读取简历', status: 'success' },
  { step_id: 'suggest_dimensions', title: '分析维度', status: 'success' },
  { step_id: 'request_dimension_selection', title: '选择维度', status: 'success' },
  { step_id: 'build_question_plan', title: '规划出题', status: 'success' },
  { step_id: 'request_plan_approval', title: '确认计划', status: 'success' },
  { step_id: 'fanout_generate_questions', title: '生成题目', status: 'pending' },
  { step_id: 'reduce_questions', title: '汇总整理', status: 'pending' },
  { step_id: 'finalize_question_set', title: '输出题库', status: 'pending' },
];

describe('ProgressPanel', () => {
  it('默认只渲染前 5 个节点 + 加载更多', () => {
    render(<ProgressPanel steps={steps} reached={5} total={8} />);
    expect(screen.getByText('读取简历')).toBeInTheDocument();
    expect(screen.getByText('确认计划')).toBeInTheDocument();   // 第 5 个
    expect(screen.queryByText('生成题目')).not.toBeInTheDocument(); // 第 6 个隐藏
    expect(screen.getByText(/加载更多/)).toBeInTheDocument();
    // 计数展示 5 / 8
    expect(screen.getByText(/\/ 8 步/)).toBeInTheDocument();
  });

  it('点击加载更多后展示全部且按钮消失', () => {
    render(<ProgressPanel steps={steps} reached={5} total={8} />);
    fireEvent.click(screen.getByText(/加载更多/));
    expect(screen.getByText('生成题目')).toBeInTheDocument();
    expect(screen.getByText('输出题库')).toBeInTheDocument();
    expect(screen.queryByText(/加载更多/)).not.toBeInTheDocument();
  });

  it('节点数 ≤ 5 时不显示加载更多', () => {
    render(<ProgressPanel steps={steps.slice(0, 4)} reached={4} total={8} />);
    expect(screen.queryByText(/加载更多/)).not.toBeInTheDocument();
  });
});
