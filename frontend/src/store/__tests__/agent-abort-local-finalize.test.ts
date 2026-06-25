/**
 * 中断本地固化单测：
 * 中断瞬间 current_blocks 的 streaming block 本地标记为 cancelled，并保留 current_blocks
 * （pseudoStreamingMessage 靠 aborted 继续渲染），reload 无 agent 消息时不覆盖本地。
 *
 * 这取代了之前的 reload 重试方案——前端立即响应中断，不依赖后端 finally 落库时序。
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { AgentMessage } from '@/types/agent';

const userMsg: AgentMessage = {
  id: 10, session_id: 1, parent_message_id: null, role: 'user',
  workflow_type: 'interview_questions', run_id: 'r1',
  content: { blocks: [{ type: 'text', index: 0, text: 'hi', status: 'success' }] },
  model_name: null, token_count: null, sort_order: 0, create_time: null,
};

vi.mock('@/api/employee/agent', () => ({
  employeeAgentApi: {
    // 模拟流式：yield run.start + block.start(streaming)，挂起等 abort 信号后抛 AbortError
    streamMessage: vi.fn((_sid: number, _payload: unknown, signal: AbortSignal) => {
      return (async function* () {
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
            block: {
              type: 'tool_use', index: 0, tool_name: 'gen',
              display_name: '技术', status: 'streaming', input: {},
            },
          },
        };
        // 挂起等 abort
        while (!signal?.aborted) {
          await new Promise((r) => setTimeout(r, 5));
        }
        const err = new Error('aborted');
        err.name = 'AbortError';
        throw err;
      })();
    }),
    // reload 始终读不到 agent 消息（模拟后端 finally 未完成）
    getSession: vi.fn(async () => ({
      data: {
        data: {
          session: { id: 1, enable_thinking: false, selected_model_name: null },
          messages: [userMsg],
        },
      },
    })),
    abortSession: vi.fn(async () => ({ data: {} })),
  },
}));

import { useAgentStore } from '../agent';

describe('中断本地固化', () => {
  beforeEach(() => {
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

  it('中断瞬间 current_blocks streaming→cancelled，reload 无 agent 时保留本地', async () => {
    const sendPromise = useAgentStore.getState().sendMessage(1, {
      content: 'hi', workflow_type: 'interview_questions',
    });
    // 等流式挂起（run.start + block.start 已 dispatch 到 store）
    await new Promise((r) => setTimeout(r, 30));
    // 中断
    useAgentStore.getState().abort(1);
    await sendPromise;

    const run = useAgentStore.getState().runs[1];
    // aborted 置位（InterruptBar 数据源）
    expect(run.runState.aborted).toBe(true);
    // current_blocks 保留（未被 reload 清空），streaming block 被本地标记为 cancelled
    expect(run.runState.current_blocks.length).toBeGreaterThan(0);
    expect(run.runState.current_blocks[0].status).toBe('cancelled');
  }, 10000);
});
