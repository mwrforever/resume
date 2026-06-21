/**
 * Bug4 store 单测：sendMessage 在存在 pending interaction 时，
 * 先调 abortSession（标 expired + 推进 task_id）再发新一轮（streamMessage）。
 * 断言调用顺序：abortSession 早于 streamMessage。
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { useAgentStore } from '../agent';
import type { AgentMessage } from '@/types/agent';

const callOrder: string[] = [];
vi.mock('@/api/employee/agent', () => ({
  employeeAgentApi: {
    abortSession: vi.fn(async () => { callOrder.push('abort'); return { data: {} }; }),
    streamMessage: vi.fn(() => {
      callOrder.push('stream');
      return (async function* () { /* 空流，立即结束 */ })();
    }),
    getSession: vi.fn(async () => ({ data: { data: { session: { id: 1 }, messages: [] } } })),
  },
}));

// 一条含 pending interaction 的 agent 消息
const pendingAgentMsg: AgentMessage = {
  id: 9, session_id: 1, parent_message_id: null, role: 'agent',
  workflow_type: 'interview_questions', run_id: null,
  content: { blocks: [{
    type: 'interaction', index: 0, request_id: 'r1',
    interaction_type: 'resume_upload', title: '上传简历', prompt: '', data: {}, status: 'pending',
  }] },
  model_name: null, token_count: null, sort_order: 0, create_time: null,
};

describe('Bug4 sendMessage 发送前自动中断', () => {
  beforeEach(() => {
    callOrder.length = 0;
    useAgentStore.setState({
      activeId: 1,
      runs: {
        1: {
          session: { id: 1, enable_thinking: false, selected_model_name: null } as never,
          messages: [pendingAgentMsg],
          runState: { running: false, workflow_type: 'interview_questions', steps: [], current_blocks: [], error: null, run_id: null, enable_thinking: false },
          sending: false, loaded: true,
        },
      },
    });
  });

  it('pending interaction 时先 abort 再 stream', async () => {
    await useAgentStore.getState().sendMessage(1, { content: '换个问题', workflow_type: 'interview_questions' });
    expect(callOrder).toEqual(['abort', 'stream']);
  });

  it('无 pending interaction 时不调 abort', async () => {
    useAgentStore.setState((s) => ({
      runs: { ...s.runs, 1: { ...s.runs[1], messages: [] } },
    }));
    await useAgentStore.getState().sendMessage(1, { content: '你好', workflow_type: 'interview_questions' });
    expect(callOrder).toEqual(['stream']);
  });
});
