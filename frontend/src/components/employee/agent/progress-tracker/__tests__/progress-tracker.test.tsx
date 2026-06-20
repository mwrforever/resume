/**
 * ProgressTracker 组件骨架单测（B1）。
 *
 * 覆盖：
 * - 渲染步骤标题 + 进度计数（reached / total）。
 * - 点击「收起」按钮后步骤标题文字从 DOM 中消失（仅保留图标列）。
 */

import { describe, it, expect } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { ProgressTracker } from '../progress-tracker';
import type { AgentStep } from '@/types/agent';

/** 构造一份典型 runtime 步骤数据（interview_questions 前 3 步） */
const steps: AgentStep[] = [
  { step_id: 'load_resume', title: '读取简历', status: 'success' },
  { step_id: 'suggest_dimensions', title: '分析维度', status: 'running', detail: '正在分析…' },
  { step_id: 'build_question_plan', title: '规划出题', status: 'pending' },
];

describe('ProgressTracker', () => {
  it('渲染步骤标题 + 进度计数', () => {
    render(<ProgressTracker steps={steps} running workflowType="interview_questions" />);
    // 步骤标题可见
    expect(screen.getByText('读取简历')).toBeInTheDocument();
    expect(screen.getByText('分析维度')).toBeInTheDocument();
    // 进度计数：非 pending 步骤数（success + running = 2） / 模板总数 8
    // 注：计数渲染为 <b>2</b> / 8 步，文本被 <b> 拆分 → 用 container.textContent 匹配
    expect(screen.getByText(/\/ 8 步/)).toBeInTheDocument();
    expect(screen.getByText('2')).toBeInTheDocument();
  });

  it('点击收起按钮后标题文字不可见', () => {
    render(<ProgressTracker steps={steps} running workflowType="interview_questions" />);
    // 点击「收起」按钮
    fireEvent.click(screen.getByTitle('收起'));
    // 收起后仅图标列，步骤标题文字应从 DOM 中移除
    expect(screen.queryByText('读取简历')).not.toBeInTheDocument();
  });
});
