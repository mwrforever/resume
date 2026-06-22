/**
 * 收尾 reload 重试单测：agent 消息未落库时 getSession 重试直到读到。
 *
 * 场景：流式中断（generator 自然结束、无 run.finish）后收尾 reload，第一次 getSession
 * 读不到本 run 的 agent 消息（后端 finally 在 shield 中跑、还未 commit）。
 * 修复：用 run_id 匹配重试，避免前端维度 block 消失直到用户手动刷新。
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const userMsg = {
  id: 10, session_id: 1, parent_message_id: null, role: 'user',
  workflow_type: 'interview_questions' as const, run_id: 'r1',
  content: { blocks: [{ type: 'text' as const, index: 0, text: 'hi', status: 'success' as const }] },
  model_name: null, token_count: null, sort_order: 0, create_time: null,
};
const agentMsg = {
  id: 20, session_id: 1, parent_message_id: 10, role: 'agent',
  workflow_type: 'interview_questions' as const, run_id: 'r1',
  content: {
    blocks: [{
      type: 'tool_use' as const, index: 0, tool_name: 'gen',
      display_name: '技术', input: {}, status: 'cancelled' as const,
    }],
  },
  model_name: null, token_count: null, sort_order: 1, create_time: null,
};

let sessionCalls = 0;
vi.mock('@/api/employee/agent', () => ({
  employeeAgentApi: {
    // 模拟流式中断：yield run.start + block.start 后自然结束（无 run.finish）
    streamMessage: vi.fn(() => (async function* () {
      yield {
        v: 1, seq: 0, ts: 0, run_id: 'r1', session_id: 1, type: 'run.start',
        data: {
          run_id: 'r1', workflow_type: 'interview_questions',
          enable_thinking: false, user_message_id: 10,
        },
      };
      yield {
        v: 1, seq: 1, ts: 0, run_id: 'r1', session_id: 1, type: 'block.start',
        data: {
          index: 0,
          block: { type: 'tool_use', index: 0, tool_name: 'gen', display_name: '技术', status: 'streaming', input: {} },
        },
      };
    })()),
    getSession: vi.fn(async () => {
      sessionCalls += 1;
      if (sessionCalls === 1) {
        // 第一次：agent 消息还没落库（后端 finally 在跑）
        return {
          data: { data: { session: { id: 1, enable_thinking: false, selected_model_name: null }, messages: [userMsg] } },
        };
      }
      // 第二次起：agent 消息已落库
      return {
        data: { data: { session: { id: 1, enable_thinking: false, selected_model_name: null }, messages: [userMsg, agentMsg] } },
      };
    }),
    abortSession: vi.fn(async () => ({ data: {} })),
  },
}));

import { useAgentStore } from '../agent';

describe('收尾 reload 重试', () => {
  beforeEach(() => {
    sessionCalls = 0;
    useAgentStore.setState({
      activeId: 1,
      sessions: [{ id: 1, title: 's1' } as never],
      runs: {
        1: {
          session: { id: 1, enable_thinking: false, selected_model_name: null } as never,
          messages: [],
          runState: {
            running: false, run_id: null, workflow_type: 'interview_questions',
            enable_thinking: false, steps: [], current_blocks: [], error: null, aborted: false,
          },
          sending: false, loaded: true,
        },
      },
    });
  });

  it('agent 消息未落库时 getSession 重试，最终读到 agent 消息', async () => {
    await useAgentStore.getState().sendMessage(1, {
      content: 'hi', workflow_type: 'interview_questions',
    });
    // 第一次 reload 读不到 agent 消息（run_id='r1' 未落库），应重试
    expect(sessionCalls).toBeGreaterThanOrEqual(2);
    // 最终 messages 含 agent 消息
    const msgs = useAgentStore.getState().runs[1].messages;
    expect(msgs.some((m: { role: string }) => m.role === 'agent')).toBe(true);
  }, 10000);
});
