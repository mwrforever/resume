/**
 * submitInteraction 进度基线单测（Bug2 孪生漏网修复）。
 *
 * 现象：刷新后进度正常，但点"批准出题"（submitInteraction）期间进度回退到 2/8、
 * 之前节点置灰；END 后又正常。
 *
 * 根因：submitInteraction 未像 resumeRun 那样在调 API 前把 session.progress.steps
 * 载入 runState 作为基线。resolve_interaction 只对中断点之后的节点发 step.update，
 * selectProgressSource 优先取非空的 runState.steps（仅 2 步）→ 回退。
 *
 * 修复：submitInteraction 在 runPromise 前用 session.progress.steps 初始化基线。
 * 模拟刷新后 runState.steps=[] 但 session.progress.steps 有 N 步，调 submitInteraction
 * 后断言 runState.steps 被初始化为持久化 N 步基线。
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { useAgentStore } from '../agent';
import type { AgentStep } from '@/types/agent';

// submitInteraction 返回一个永不产出的挂起迭代器，让我们能在 await 前断言基线已写入
let releaseStream: () => void;
vi.mock('@/api/employee/agent', () => ({
  employeeAgentApi: {
    submitInteraction: vi.fn(() => (async function* () {
      // 挂起直到测试释放，确保断言发生在流消费前
      await new Promise<void>((resolve) => { releaseStream = resolve; });
    })()),
    getSession: vi.fn(async () => ({ data: { data: { session: { id: 1 }, messages: [] } } })),
  },
}));

const persistedSteps: AgentStep[] = [
  { step_id: 'load_resume', title: '读取简历', status: 'success' },
  { step_id: 'suggest_dimensions', title: '分析维度', status: 'success' },
  { step_id: 'dimension_select', title: '选择维度', status: 'success' },
];

describe('submitInteraction 进度基线', () => {
  beforeEach(() => useAgentStore.setState({
    activeId: 1,
    runs: {
      1: {
        session: {
          id: 1, enable_thinking: false, selected_model_name: null,
          progress: { workflow_type: 'interview_questions', steps: persistedSteps },
        } as never,
        messages: [{ id: 5, role: 'agent', workflow_type: 'interview_questions' } as never],
        // 刷新后内存 runState.steps 为空——基线只能从 session.progress 取
        runState: { workflow_type: 'interview_questions', steps: [] } as never,
        sending: false, loaded: true,
      },
    },
  }));

  it('submitInteraction 发起前用 session.progress.steps 初始化 runState.steps 基线', async () => {
    const p = useAgentStore.getState().submitInteraction(1, 'req_1', { approved: true });
    // 此刻流挂起在 submitInteraction API 内，基线应已在发起前写入
    const steps = useAgentStore.getState().runs[1].runState.steps;
    expect(steps.map(s => s.step_id)).toEqual(
      ['load_resume', 'suggest_dimensions', 'dimension_select'],
    );
    expect(useAgentStore.getState().runs[1].runState.workflow_type).toBe('interview_questions');
    // 释放流让 run promise 收尾，避免悬挂
    releaseStream();
    await p;
  });
});
