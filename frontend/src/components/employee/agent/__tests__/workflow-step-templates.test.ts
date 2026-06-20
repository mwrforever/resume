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

  it('重入相同 step_id → 该项移到 merged 末尾，长度不变，状态用最新', () => {
    // reducer 已保证 runtime 去重 + 重入移末尾，merge 接收的是去重后的 runtime
    const runtime: AgentStep[] = [
      { step_id: 'load_resume',                 title: '读取简历', status: 'success' },
      { step_id: 'request_dimension_selection', title: '选择维度', status: 'success' },
      // 驳回循环：suggest_dimensions 重做后被 reducer 移到末尾
      { step_id: 'suggest_dimensions',          title: '分析维度', status: 'success', detail: '重新分析' },
    ];
    const merged = mergeStepsWithTemplate('interview_questions', runtime);
    // 长度 = 模板 8 项
    expect(merged).toHaveLength(8);
    // 前 3 项按 runtime 顺序
    expect(merged[0].step_id).toBe('load_resume');
    expect(merged[1].step_id).toBe('request_dimension_selection');
    expect(merged[2].step_id).toBe('suggest_dimensions');
    expect(merged[2].detail).toBe('重新分析');  // 最新状态生效
    // 后续 5 项是模板未到达项（pending），按模板拓扑顺序，第一个应是 build_question_plan
    expect(merged[3].status).toBe('pending');
    expect(merged[3].step_id).toBe('build_question_plan');
  });

  it('未知 workflow → fallback 返回 runtime steps 原样', () => {
    const runtime: AgentStep[] = [
      { step_id: 'foo', title: '未知节点', status: 'success' },
    ];
    // @ts-expect-error 故意传入非法 workflow
    const merged = mergeStepsWithTemplate('unknown_workflow', runtime);
    expect(merged).toEqual(runtime);
  });

  it('模板未覆盖的 runtime step → 按 runtime 顺序排在前段（防御性兜底）', () => {
    const runtime: AgentStep[] = [
      { step_id: 'load_resume', title: '读取简历', status: 'success' },
      { step_id: 'unexpected', title: '意外节点', status: 'success' },
    ];
    const merged = mergeStepsWithTemplate('interview_questions', runtime);
    // 模板 8 项 + 追加 1 项 = 9
    expect(merged).toHaveLength(9);
    // 新语义：runtime 段在前，未到达模板项 pending 在后
    expect(merged[0].step_id).toBe('load_resume');
    expect(merged[1].step_id).toBe('unexpected');
    expect(merged[1].status).toBe('success');
    // 之后全是 pending 模板项
    expect(merged.slice(2).every(s => s.status === 'pending')).toBe(true);
  });

  it('runtime 顺序优先：activeStep 跟 runtime 末位走', () => {
    // 模拟驳回循环后 reducer 输出的 runtime
    const fromReducer: AgentStep[] = [
      { step_id: 'load_resume',                 title: '读取简历', status: 'success' },
      { step_id: 'request_dimension_selection', title: '选择维度', status: 'success' },
      { step_id: 'suggest_dimensions',          title: '分析维度', status: 'success', detail: '重做' },
    ];
    const merged = mergeStepsWithTemplate('interview_questions', fromReducer);
    // runtime 末位 suggest_dimensions 应在 merged 的 runtime 段末尾（index 2）
    expect(merged[2].step_id).toBe('suggest_dimensions');
    expect(merged[2].detail).toBe('重做');
    // 它之后全是 pending 模板项
    expect(merged.slice(3).every(s => s.status === 'pending')).toBe(true);
  });
});
