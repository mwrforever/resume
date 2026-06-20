/**
 * StepStrip 进度分子单测。
 *
 * 回归 bug：tasks 流模式下节点开始即发 running、完成发 success。旧实现分子只数
 * success，导致"正在分析维度"（suggest_dimensions=running）时进度停在 1/8，
 * 与用户直觉（已处于第 2 步=2/8）不符。
 *
 * 修复语义：
 * - 运行中：分子 = 非 pending 步骤数（running 也计入）→ 正在第 N 步显示 N。
 * - 非运行态：分子 = success 步骤数（失败步不算"已完成"）。
 */

import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { StepStrip } from '../step-strip';
import type { AgentStep } from '@/types/agent';

/** 构造 step（默认 success） */
const step = (id: string, title: string, status: AgentStep['status'] = 'success'): AgentStep =>
  ({ step_id: id, title, status });

describe('StepStrip 进度分子', () => {
  it('运行中：第 1 步已完成、第 2 步运行中 → 显示 2 / 8', () => {
    const steps: AgentStep[] = [
      step('load_resume', '读取简历', 'success'),
      step('suggest_dimensions', '分析维度', 'running'),
    ];
    render(<StepStrip steps={steps} running workflowType="interview_questions" />);
    expect(screen.getByText(/运行中 · 2 \/ 8 步/)).toBeInTheDocument();
  });

  it('运行中：仅第 1 步运行中 → 显示 1 / 8（而非 0）', () => {
    const steps: AgentStep[] = [step('load_resume', '读取简历', 'running')];
    render(<StepStrip steps={steps} running workflowType="interview_questions" />);
    expect(screen.getByText(/运行中 · 1 \/ 8 步/)).toBeInTheDocument();
  });

  it('运行中：失败步也计入进度（已执行过）→ 2 / 8', () => {
    const steps: AgentStep[] = [
      step('load_resume', '读取简历', 'success'),
      step('build_question_plan', '规划出题', 'failed'),
    ];
    render(<StepStrip steps={steps} running workflowType="interview_questions" />);
    expect(screen.getByText(/运行中 · 2 \/ 8 步/)).toBeInTheDocument();
  });

  it('非运行态：已完成分子只数 success（失败步不计入）→ 1 / 8', () => {
    const steps: AgentStep[] = [
      step('load_resume', '读取简历', 'success'),
      step('build_question_plan', '规划出题', 'failed'),
    ];
    render(<StepStrip steps={steps} running={false} workflowType="interview_questions" />);
    expect(screen.getByText(/已完成 1 \/ 8 步/)).toBeInTheDocument();
  });

  it('非运行态：全部成功 → 已完成 8 / 8 步', () => {
    const ids: Array<[string, string]> = [
      ['load_resume', '读取简历'],
      ['suggest_dimensions', '分析维度'],
      ['request_dimension_selection', '选择维度'],
      ['build_question_plan', '规划出题'],
      ['request_plan_approval', '确认计划'],
      ['fanout_generate_questions', '生成题目'],
      ['reduce_questions', '汇总整理'],
      ['finalize_question_set', '输出题库'],
    ];
    const steps = ids.map(([id, title]) => step(id, title, 'success'));
    render(<StepStrip steps={steps} running={false} workflowType="interview_questions" />);
    expect(screen.getByText(/已完成 8 \/ 8 步/)).toBeInTheDocument();
  });
});
