/**
 * deleteSession 删除最后一个会话后自动创建新虚拟会话。
 * 修复：原先删除所有会话后 activeId=null，工作台空白（显示"请选择或创建会话"）；
 * 现在自动新建虚拟会话，展示 EmptyState（新建会话页）。
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { useAgentStore } from '../agent';

vi.mock('@/api/employee/agent', () => ({
  employeeAgentApi: {
    deleteSession: vi.fn(async () => ({ data: {} })),
    getSession: vi.fn(async () => ({ data: { data: { session: { id: 1 }, messages: [] } } })),
  },
}));

describe('deleteSession 删除最后一个会话', () => {
  beforeEach(() => {
    useAgentStore.setState({
      activeId: 1,
      sessions: [{ id: 1, title: 's1' } as never],
      runs: {
        1: {
          session: { id: 1 } as never,
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

  it('删除最后一个会话后自动创建新虚拟会话', async () => {
    await useAgentStore.getState().deleteSession(1);
    const state = useAgentStore.getState();
    // sessions 含新虚拟会话（负 id），非空
    expect(state.sessions).toHaveLength(1);
    expect(state.sessions[0].id).toBeLessThan(0);
    // activeId 指向新虚拟会话
    expect(state.activeId).toBe(state.sessions[0].id);
  });

  it('删除非最后一个会话时不创建新虚拟会话', async () => {
    useAgentStore.setState((s) => ({
      sessions: [{ id: 1, title: 's1' } as never, { id: 2, title: 's2' } as never],
    }));
    await useAgentStore.getState().deleteSession(1);
    const state = useAgentStore.getState();
    // 仍有会话，不创建虚拟会话
    expect(state.sessions).toHaveLength(1);
    expect(state.sessions[0].id).toBe(2);
  });
});
