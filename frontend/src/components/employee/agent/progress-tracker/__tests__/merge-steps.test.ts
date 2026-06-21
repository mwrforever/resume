import { describe, it, expect } from 'vitest';
import { mergeStepsWithTemplate } from '../../workflow-step-templates';
import type { AgentStep } from '@/types/agent';

describe('mergeStepsWithTemplate（模板顺序）', () => {
  it('乱序 runtime 输入仍按模板拓扑顺序输出', () => {
    // runtime 到达顺序故意打乱（模拟 upsertStep 重入移末尾）
    const runtime: AgentStep[] = [
      { step_id: 'build_question_plan', title: 'X', status: 'running', detail: '出题中' },
      { step_id: 'load_resume', title: 'X', status: 'success' },
      { step_id: 'suggest_dimensions', title: 'X', status: 'success' },
      { step_id: 'request_dimension_selection', title: 'X', status: 'success' },
    ];
    const merged = mergeStepsWithTemplate('interview_questions', runtime);
    // 顺序必须等于模板顺序
    expect(merged.map(s => s.step_id)).toEqual([
      'load_resume', 'suggest_dimensions', 'request_dimension_selection',
      'build_question_plan', 'request_plan_approval', 'fanout_generate_questions',
      'reduce_questions', 'finalize_question_set',
    ]);
    // 标题用模板权威值
    expect(merged[0].title).toBe('读取简历');
    expect(merged[3].title).toBe('规划出题');
    // 状态取自 runtime；detail 透传
    expect(merged[3].status).toBe('running');
    expect(merged[3].detail).toBe('出题中');
    // 已完成节点不因乱序变 pending
    expect(merged.slice(0, 3).every(s => s.status === 'success')).toBe(true);
    // 未到达节点 pending
    expect(merged[4].status).toBe('pending');
  });

  it('未知 workflow 走 fallback 返回原数组', () => {
    const runtime: AgentStep[] = [{ step_id: 'x', title: 'x', status: 'running' }];
    // @ts-expect-error 故意传未知 workflow
    expect(mergeStepsWithTemplate('unknown', runtime)).toEqual(runtime);
  });

  it('runtime 含模板外 step_id 时追加到末尾', () => {
    const runtime: AgentStep[] = [
      { step_id: 'load_resume', title: 'x', status: 'success' },
      { step_id: 'mystery_node', title: '异常节点', status: 'failed' },
    ];
    const merged = mergeStepsWithTemplate('interview_questions', runtime);
    expect(merged.length).toBe(9); // 模板 8 + 未知 1
    expect(merged[merged.length - 1].step_id).toBe('mystery_node');
  });
});
