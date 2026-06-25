/**
 * workflow-step-templates 单测：
 * - 空 runtime → 全 pending
 * - 部分命中 → 命中变 success，未命中保持 pending
 * - 重入相同 step_id → 按模板顺序排列，状态/detail 取最新
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

  it('重入相同 step_id → 按模板顺序、状态用最新', () => {
    // reducer 保证 runtime 去重，merge 接收的是去重后的 runtime；
    // 新语义下渲染顺序恒等于模板拓扑顺序，runtime 到达顺序不再影响排列。
    const runtime: AgentStep[] = [
      { step_id: 'load_resume',                 title: '读取简历', status: 'success' },
      { step_id: 'request_dimension_selection', title: '选择维度', status: 'success' },
      // 驳回循环：suggest_dimensions 重做（reducer 内部已去重，detail 取最新）
      { step_id: 'suggest_dimensions',          title: '分析维度', status: 'success', detail: '重新分析' },
    ];
    const merged = mergeStepsWithTemplate('interview_questions', runtime);
    // 长度 = 模板 8 项
    expect(merged).toHaveLength(8);
    // 渲染恒按模板拓扑顺序：load_resume / suggest_dimensions / request_dimension_selection / build_question_plan ...
    expect(merged[1].step_id).toBe('suggest_dimensions');
    expect(merged[1].detail).toBe('重新分析');  // 状态/detail 取自 runtime 最新值
    expect(merged[1].status).toBe('success');
    expect(merged[2].step_id).toBe('request_dimension_selection');
    // 后续模板未到达项保持 pending，按模板顺序第一个是 build_question_plan
    expect(merged[3].step_id).toBe('build_question_plan');
    expect(merged[3].status).toBe('pending');
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
    // 新语义：模板项按模板顺序在前（命中的取 runtime 状态，未命中 pending），未知 step_id 追加末尾
    expect(merged[0].step_id).toBe('load_resume');
    expect(merged[0].status).toBe('success');
    // 模板第 2 项（suggest_dimensions）未命中 → pending
    expect(merged[1].step_id).toBe('suggest_dimensions');
    expect(merged[1].status).toBe('pending');
    // 模板 index 1..7 共 7 项全为 pending（未命中 runtime）
    expect(merged.slice(1, 8).every(s => s.status === 'pending')).toBe(true);
    // 未知 step_id 追加在末尾 index 8
    expect(merged[8].step_id).toBe('unexpected');
    expect(merged[8].status).toBe('success');
  });

  it('模板顺序优先：已完成节点按模板序排列，未完成 pending 在后', () => {
    // 模拟驳回循环后 reducer 输出的 runtime
    const fromReducer: AgentStep[] = [
      { step_id: 'load_resume',                 title: '读取简历', status: 'success' },
      { step_id: 'request_dimension_selection', title: '选择维度', status: 'success' },
      { step_id: 'suggest_dimensions',          title: '分析维度', status: 'success', detail: '重做' },
    ];
    const merged = mergeStepsWithTemplate('interview_questions', fromReducer);
    // 新语义：渲染顺序恒等于模板拓扑顺序，状态/detail 取自 runtime。
    // 模板第 2 项 suggest_dimensions 命中 success，detail 取 runtime 最新值
    expect(merged[1].step_id).toBe('suggest_dimensions');
    expect(merged[1].status).toBe('success');
    expect(merged[1].detail).toBe('重做');
    // 模板第 3 项 request_dimension_selection 命中 success
    expect(merged[2].step_id).toBe('request_dimension_selection');
    expect(merged[2].status).toBe('success');
    // 模板第 4 项起未命中 → pending（首个为 build_question_plan）
    expect(merged[3].step_id).toBe('build_question_plan');
    expect(merged[3].status).toBe('pending');
    expect(merged.slice(3).every(s => s.status === 'pending')).toBe(true);
  });
});
