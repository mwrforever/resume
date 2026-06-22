/**
 * agent-run-reducer 单测：
 * 重点验证 upsertStep 在驳回循环（同 step_id 重入）时把该项移到 steps 数组末尾，
 * 让 steps[steps.length - 1] 始终是"最后到达 = 当前活跃"的语义信号。
 */

import { describe, it, expect } from 'vitest';
import { agentRunReducer, INITIAL_RUN_STATE } from '../agent-run-reducer';
import type { AgentEnvelope, AgentRunState } from '@/types/agent';

function makeStepEnv(stepId: string, title: string, status = 'success' as const): AgentEnvelope {
  return {
    v: 1, seq: 0, ts: 0, run_id: 'r1', session_id: 1,
    type: 'step.update',
    data: { step_id: stepId, title, status },
  };
}

describe('agent-run-reducer · upsertStep 重入语义', () => {
  it('首次到达 step 追加到末尾', () => {
    let s: AgentRunState = INITIAL_RUN_STATE;
    s = agentRunReducer(s, makeStepEnv('load_resume', '读取简历'));
    s = agentRunReducer(s, makeStepEnv('suggest_dimensions', '分析维度'));
    expect(s.steps.map(x => x.step_id)).toEqual(['load_resume', 'suggest_dimensions']);
  });

  it('重入相同 step_id：移到末尾，长度不变，状态用最新', () => {
    let s: AgentRunState = INITIAL_RUN_STATE;
    s = agentRunReducer(s, makeStepEnv('load_resume', '读取简历'));
    s = agentRunReducer(s, makeStepEnv('suggest_dimensions', '分析维度'));
    s = agentRunReducer(s, makeStepEnv('request_dimension_selection', '选择维度'));
    // 用户驳回 → graph 回 suggest_dimensions 重做并产出 step.update
    s = agentRunReducer(s, makeStepEnv('suggest_dimensions', '分析维度'));
    // 顺序：load_resume, request_dimension_selection, suggest_dimensions（重入移到末尾）
    expect(s.steps.map(x => x.step_id)).toEqual([
      'load_resume', 'request_dimension_selection', 'suggest_dimensions',
    ]);
    expect(s.steps).toHaveLength(3);  // 不重复
  });

  it('重入更新 detail 字段', () => {
    let s: AgentRunState = INITIAL_RUN_STATE;
    s = agentRunReducer(s, {
      v: 1, seq: 0, ts: 0, run_id: 'r1', session_id: 1,
      type: 'step.update',
      data: { step_id: 'suggest_dimensions', title: '分析维度', status: 'success', detail: '第一次' },
    });
    s = agentRunReducer(s, {
      v: 1, seq: 0, ts: 0, run_id: 'r1', session_id: 1,
      type: 'step.update',
      data: { step_id: 'suggest_dimensions', title: '分析维度', status: 'success', detail: '重做' },
    });
    expect(s.steps).toHaveLength(1);
    expect(s.steps[0].detail).toBe('重做');
  });
});

describe('agent-run-reducer · aborted 标志', () => {
  it('INITIAL_RUN_STATE.aborted 默认 false', () => {
    expect(INITIAL_RUN_STATE.aborted).toBe(false);
  });

  function makeRunStart(resume = false): AgentEnvelope {
    return {
      v: 1, seq: 0, ts: 0, run_id: 'r1', session_id: 1,
      type: 'run.start',
      data: {
        run_id: 'r1', workflow_type: 'interview_questions',
        enable_thinking: false, user_message_id: null,
        ...(resume ? { resume: true } : {}),
      },
    };
  }

  it('run.start（非 resume）清除 aborted', () => {
    const abortedState: AgentRunState = { ...INITIAL_RUN_STATE, aborted: true };
    const next = agentRunReducer(abortedState, makeRunStart(false));
    expect(next.aborted).toBe(false);
  });

  it('run.start（resume）清除 aborted', () => {
    const abortedState: AgentRunState = { ...INITIAL_RUN_STATE, aborted: true };
    const next = agentRunReducer(abortedState, makeRunStart(true));
    expect(next.aborted).toBe(false);
  });
});
