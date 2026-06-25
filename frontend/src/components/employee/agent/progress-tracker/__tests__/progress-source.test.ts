// progress-source.test.ts
import { describe, it, expect } from 'vitest';
import { selectProgressSource } from '../../progress-source';
import type { AgentStep } from '@/types/agent';

const rt: AgentStep[] = [{ step_id: 'load_resume', title: '读取简历', status: 'success' }];

describe('selectProgressSource（修复 Bug1 结束闪空）', () => {
  it('runState.steps 非空时优先用 runState（含结束后持久化未回写的空窗期）', () => {
    const r = selectProgressSource({
      runStateSteps: rt,
      runStateWorkflow: 'interview_questions',
      sessionProgress: null,           // 持久化尚未回写
      lastMessageWorkflow: 'interview_questions',
    });
    expect(r.steps).toBe(rt);
    expect(r.workflowType).toBe('interview_questions');
  });

  it('runState.steps 为空时回看 session.progress', () => {
    const persisted: AgentStep[] = [{ step_id: 'load_resume', title: '读取简历', status: 'success' }];
    const r = selectProgressSource({
      runStateSteps: [],
      runStateWorkflow: 'interview_questions',
      sessionProgress: { steps: persisted, workflow_type: 'resume_evaluation' },
      lastMessageWorkflow: 'interview_questions',
    });
    expect(r.steps).toBe(persisted);
    expect(r.workflowType).toBe('resume_evaluation');
  });

  it('两者皆空时退化为 lastMessageWorkflow，steps 为空数组', () => {
    const r = selectProgressSource({
      runStateSteps: [],
      runStateWorkflow: 'interview_questions',
      sessionProgress: null,
      lastMessageWorkflow: 'resume_evaluation',
    });
    expect(r.steps).toEqual([]);
    expect(r.workflowType).toBe('resume_evaluation');
  });

  it('全部缺省时兜底 interview_questions', () => {
    const r = selectProgressSource({
      runStateSteps: [],
      runStateWorkflow: 'interview_questions',
      sessionProgress: null,
    });
    expect(r.workflowType).toBe('interview_questions');
  });
});
