/**
 * aborted 标志生命周期单测：
 * - resolveRunStateAfterFinish 在客户端 abort 路径保留 aborted，其它路径清除
 * - store.abort(id) 立即置 aborted=true
 * - sendMessage/submitInteraction/resumeRun 入口立即清 aborted
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { useAgentStore, resolveRunStateAfterFinish } from '../agent';
import { INITIAL_RUN_STATE } from '@/utils/agent-run-reducer';
import type { AgentRunState } from '@/types/agent';

vi.mock('@/api/employee/agent', () => ({
  employeeAgentApi: {
    streamMessage: vi.fn(() => (async function* () {})()),
    submitInteraction: vi.fn(() => (async function* () {})()),
    resumeSession: vi.fn(() => (async function* () {})()),
    getSession: vi.fn(async () => ({ data: { data: { session: { id: 1 }, messages: [] } } })),
    abortSession: vi.fn(async () => ({ data: {} })),
  },
}));

describe('resolveRunStateAfterFinish · aborted 保留逻辑', () => {
  it('正常 END（hasFinish + nextTaskId）：aborted=false', () => {
    const prev: AgentRunState = { ...INITIAL_RUN_STATE, aborted: true };
    const next = resolveRunStateAfterFinish(prev, { hasFinish: true, nextTaskId: 't2', hasError: false });
    expect(next.aborted).toBe(false);
  });

  it('interrupt 暂停（hasFinish + 无 nextTaskId）：aborted=false', () => {
    const prev: AgentRunState = { ...INITIAL_RUN_STATE, aborted: true };
    const next = resolveRunStateAfterFinish(prev, { hasFinish: true, nextTaskId: null, hasError: false });
    expect(next.aborted).toBe(false);
  });

  it('客户端 abort（无 finish + 无 error + prev.aborted）：保留 aborted=true', () => {
    const prev: AgentRunState = { ...INITIAL_RUN_STATE, aborted: true };
    const next = resolveRunStateAfterFinish(prev, { hasFinish: false, nextTaskId: null, hasError: false });
    expect(next.aborted).toBe(true);
  });

  it('错误终态（hasError）：aborted=false', () => {
    const prev: AgentRunState = {
      ...INITIAL_RUN_STATE, aborted: true,
      error: { code: 'graph_execution_failed', message: 'boom' },
    };
    const next = resolveRunStateAfterFinish(prev, { hasFinish: false, nextTaskId: null, hasError: true });
    expect(next.aborted).toBe(false);
  });
});

describe('store.abort · 置 aborted 标志', () => {
  beforeEach(() => {
    useAgentStore.setState({
      activeId: 1,
      runs: {
        1: {
          session: { id: 1, enable_thinking: false, selected_model_name: null } as never,
          messages: [],
          runState: { ...INITIAL_RUN_STATE },
          sending: true,
          loaded: true,
        },
      },
    });
  });

  it('abort(id) 立即置 runState.aborted=true', () => {
    useAgentStore.getState().abort(1);
    expect(useAgentStore.getState().runs[1].runState.aborted).toBe(true);
  });
});
