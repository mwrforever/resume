/**
 * Bug1 修复单测：activeId 初始化收敛 + bootstrap 幂等。
 *
 * 1. refreshSessions 不把 items[0] 设为 activeId（防止短暂指向历史会话→串史）。
 * 2. refreshSessions 在 activeId 指向的会话已不在新列表时，置为 null 交由兜底。
 * 3. bootstrap 幂等：连续调用只产生一个空虚拟会话。
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { useAgentStore } from '../agent';

vi.mock('@/api/employee/agent', () => ({
  employeeAgentApi: {
    listSessions: vi.fn(async () => ({
      data: { data: { items: [
        { id: 10, last_message_time: '2026-06-20T10:00:00Z' },
        { id: 11, last_message_time: '2026-06-19T10:00:00Z' },
      ] } },
    })),
  },
}));

describe('Bug1 activeId 收敛 + bootstrap 幂等', () => {
  beforeEach(() => useAgentStore.setState({
    sessions: [], activeId: null, runs: {}, creating: false,
  }));

  it('refreshSessions 不把 items[0] 设为 activeId', async () => {
    await useAgentStore.getState().refreshSessions();
    // 修复前这里会是 10；修复后保持 null（交由 bootstrap 自动新建兜底）
    expect(useAgentStore.getState().activeId).toBeNull();
    // 列表照常加载
    expect(useAgentStore.getState().sessions.map(s => s.id)).toEqual([10, 11]);
  });

  it('当前 activeId 不在新列表中时置 null', async () => {
    useAgentStore.setState({ activeId: 999 }); // 999 已被删/失效
    await useAgentStore.getState().refreshSessions();
    expect(useAgentStore.getState().activeId).toBeNull();
  });

  it('当前 activeId 仍在新列表中时保持不变', async () => {
    useAgentStore.setState({ activeId: 11 });
    await useAgentStore.getState().refreshSessions();
    expect(useAgentStore.getState().activeId).toBe(11);
  });

  it('bootstrap 幂等：连续调用只建一个空虚拟会话', () => {
    const { bootstrap } = useAgentStore.getState();
    bootstrap();
    bootstrap();
    bootstrap();
    const virtuals = useAgentStore.getState().sessions.filter(s => s.id < 0);
    expect(virtuals).toHaveLength(1);
    // activeId 指向该虚拟会话（负 id），绝不指向历史会话
    expect(useAgentStore.getState().activeId).toBe(virtuals[0].id);
  });
});
