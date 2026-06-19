/**
 * workflow-step-templates 单测：
 * - 空 runtime → 全 pending
 * - 部分命中 → 命中变 success，未命中保持 pending
 * - 重入相同 step_id → 取最后一次状态，长度不变
 * - 未知 workflow → fallback 返回 runtime steps 原样
 */

import { describe, it, expect } from 'vitest';
import type { AgentStep } from '@/types/agent';
import {
  WORKFLOW_STEP_TEMPLATES,
  mergeStepsWithTemplate,
} from '../workflow-step-templates';

describe('WORKFLOW_STEP_TEMPLATES', () => {
  it('interview_questions 共 8 步', () => {
    expect(WORKFLOW_STEP_TEMPLATES.interview_questions).toHaveLength(8);
  });
  it('resume_evaluation 共 8 步', () => {
    expect(WORKFLOW_STEP_TEMPLATES.resume_evaluation).toHaveLength(8);
  });
});

describe('mergeStepsWithTemplate', () => {
  it('空 runtime → 模板全部 pending，长度 = 模板长度', () => {
    const merged = mergeStepsWithTemplate('interview_questions', []);
    expect(merged).toHaveLength(8);
    expect(merged.every(s => s.status === 'pending')).toBe(true);
    expect(merged[0].step_id).toBe('load_resume');
    expect(merged[0].title).toBe('读取简历');
  });

  it('部分 runtime 命中 → 命中变实际状态，未命中保持 pending', () => {
    const runtime: AgentStep[] = [
      { step_id: 'load_resume',        title: '读取简历', status: 'success' },
      { step_id: 'suggest_dimensions', title: '分析维度', status: 'success' },
    ];
    const merged = mergeStepsWithTemplate('interview_questions', runtime);
    expect(merged).toHaveLength(8);
    expect(merged[0].status).toBe('success');
    expect(merged[1].status).toBe('success');
    expect(merged[2].status).toBe('pending');
    expect(merged[7].status).toBe('pending');
  });

  it('重入相同 step_id → 取最后一次出现的状态，长度仍 = 模板长度', () => {
    // 模拟驳回循环：suggest_dimensions 出现两次（第二次是重做后再次 success）
    const runtime: AgentStep[] = [
      { step_id: 'load_resume',                 title: '读取简历', status: 'success' },
      { step_id: 'suggest_dimensions',          title: '分析维度', status: 'success' },
      { step_id: 'request_dimension_selection', title: '选择维度', status: 'success' },
      // 用户驳回 → 跳回 suggest_dimensions 重做
      { step_id: 'suggest_dimensions',          title: '分析维度', status: 'success', detail: '重新分析' },
    ];
    const merged = mergeStepsWithTemplate('interview_questions', runtime);
    expect(merged).toHaveLength(8);
    // suggest_dimensions 在模板第 2 项，应取最后一次状态
    expect(merged[1].step_id).toBe('suggest_dimensions');
    expect(merged[1].detail).toBe('重新分析');
  });

  it('未知 workflow → fallback 返回 runtime steps 原样', () => {
    const runtime: AgentStep[] = [
      { step_id: 'foo', title: '未知节点', status: 'success' },
    ];
    // @ts-expect-error 故意传入非法 workflow
    const merged = mergeStepsWithTemplate('unknown_workflow', runtime);
    expect(merged).toEqual(runtime);
  });

  it('模板未覆盖的 runtime step → 追加到末尾（防御性兜底）', () => {
    const runtime: AgentStep[] = [
      { step_id: 'load_resume', title: '读取简历', status: 'success' },
      { step_id: 'unexpected', title: '意外节点', status: 'success' },
    ];
    const merged = mergeStepsWithTemplate('interview_questions', runtime);
    // 模板 8 项 + 追加 1 项 = 9
    expect(merged).toHaveLength(9);
    expect(merged[8].step_id).toBe('unexpected');
  });
});
