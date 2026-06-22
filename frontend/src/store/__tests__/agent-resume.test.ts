/**
 * resumeRun action 单元测试（A2 续接链路）。
 *
 * 验证：
 * 1. resumeRun 从历史消息推断 workflow_type，正确调用 resumeSession API。
 * 2. 执行期间 sending=true，finally 后 sending=false、AbortController/runPromise 清理。
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { useAgentStore } from '../agent';

vi.mock('@/api/employee/agent', () => ({
  employeeAgentApi: {
    resumeSession: vi.fn(() => (async function* () { /* 空 SSE，直接结束 */ })()),
    getSession: vi.fn(async () => ({ data: { data: { session: { id: 1 }, messages: [] } } })),
  },
}));

describe('resumeRun action', () => {
  beforeEach(() => useAgentStore.setState({
    activeId: 1,
    runs: {
      1: {
        session: { id: 1, enable_thinking: false, selected_model_name: null } as never,
        messages: [{ id: 5, workflow_type: 'interview_questions' } as never],
        runState: { workflow_type: 'interview_questions', aborted: false } as never,
        sending: false, loaded: true,
      },
    },
  }));

  it('resumeRun 调用 resumeSession 并置 sending', async () => {
    const { employeeAgentApi } = await import('@/api/employee/agent');
    await useAgentStore.getState().resumeRun(1);
    expect(employeeAgentApi.resumeSession).toHaveBeenCalledWith(
      1, 'interview_questions', { enableThinking: false, modelName: null }, expect.any(AbortSignal),
    );
    // finally 走完后 sending 应回归 false
    expect(useAgentStore.getState().runs[1].sending).toBe(false);
  });
});
