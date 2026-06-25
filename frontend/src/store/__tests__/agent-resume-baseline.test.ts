/**
 * Bug2 修复单测：resumeRun 进度基线。
 *
 * 模拟刷新后 runState.steps=[] 但 session.progress.steps 有 N 步，
 * 调 resumeRun 后断言 runState.steps 被初始化为持久化 N 步基线，
 * workflow_type 同步取 progress.workflow_type。
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { useAgentStore } from '../agent';
import type { AgentStep } from '@/types/agent';

// resumeSession 返回一个永不产出的挂起迭代器，让我们能在 await 前断言基线已写入
let releaseStream: () => void;
vi.mock('@/api/employee/agent', () => ({
  employeeAgentApi: {
    resumeSession: vi.fn(() => (async function* () {
      // 挂起直到测试释放，确保断言发生在流消费前
      await new Promise<void>((resolve) => { releaseStream = resolve; });
    })()),
    getSession: vi.fn(async () => ({ data: { data: { session: { id: 1 }, messages: [] } } })),
  },
}));

const persistedSteps: AgentStep[] = [
  { step_id: 'load_resume', title: '读取简历', status: 'success' },
  { step_id: 'suggest_dimensions', title: '分析维度', status: 'success' },
  { step_id: 'generate', title: '生成', status: 'running' },
];

describe('Bug2 resumeRun 进度基线', () => {
  beforeEach(() => useAgentStore.setState({
    activeId: 1,
    runs: {
      1: {
        session: {
          id: 1, enable_thinking: false, selected_model_name: null,
          progress: { workflow_type: 'interview_questions', steps: persistedSteps },
        } as never,
        messages: [{ id: 5, role: 'agent', workflow_type: 'interview_questions' } as never],
        runState: { workflow_type: 'interview_questions', steps: [], aborted: false } as never,
        sending: false, loaded: true,
      },
    },
  }));

  it('resumeRun 发起前用 session.progress.steps 初始化 runState.steps 基线', async () => {
    const p = useAgentStore.getState().resumeRun(1);
    // 此刻流挂起在 resumeSession 内，基线应已在发起前写入
    const steps = useAgentStore.getState().runs[1].runState.steps;
    expect(steps.map(s => s.step_id)).toEqual(['load_resume', 'suggest_dimensions', 'generate']);
    expect(useAgentStore.getState().runs[1].runState.workflow_type).toBe('interview_questions');
    // 释放流让 run promise 收尾，避免悬挂
    releaseStream();
    await p;
  });
});
