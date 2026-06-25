/**
 * shouldShowInterruptBar 判定纯函数单测：双信号 OR 兜底。
 *   !error && (aborted || (!running && !sending && last.content.interrupted))
 */
import { describe, it, expect } from 'vitest';
import { shouldShowInterruptBar } from '../agent-message-list';
import { INITIAL_RUN_STATE } from '@/utils/agent-run-reducer';
import type { AgentMessage, AgentRunState } from '@/types/agent';

function makeAgentMsg(interrupted?: boolean): AgentMessage {
  return {
    id: 1, session_id: 1, parent_message_id: null, role: 'agent',
    workflow_type: 'interview_questions', run_id: null,
    content: { blocks: [], ...(interrupted !== undefined ? { interrupted } : {}) },
    model_name: null, token_count: null, sort_order: 0, create_time: null,
  };
}

describe('shouldShowInterruptBar · 双信号判定', () => {
  it('aborted=true：立即显示（不限 running，中断瞬间与 pseudoStreamingMessage 同屏）', () => {
    const rs: AgentRunState = { ...INITIAL_RUN_STATE, running: true, aborted: true };
    expect(shouldShowInterruptBar(rs, [], false)).toBe(true);
  });

  it('content.interrupted=true + !running + !sending：显示（刷新恢复）', () => {
    const rs: AgentRunState = { ...INITIAL_RUN_STATE, running: false };
    expect(shouldShowInterruptBar(rs, [makeAgentMsg(true)], false)).toBe(true);
  });

  it('content.interrupted=true + sending=true：不显示（重试发起窗口避免残留）', () => {
    const rs: AgentRunState = { ...INITIAL_RUN_STATE, running: false };
    expect(shouldShowInterruptBar(rs, [makeAgentMsg(true)], true)).toBe(false);
  });

  it('两者皆 false：不显示（正常结束）', () => {
    const rs: AgentRunState = { ...INITIAL_RUN_STATE, running: false };
    expect(shouldShowInterruptBar(rs, [makeAgentMsg(false)], false)).toBe(false);
  });

  it('error 非空：不显示（互斥，走红色 callout）', () => {
    const rs: AgentRunState = {
      ...INITIAL_RUN_STATE, aborted: true,
      error: { code: 'graph_execution_failed', message: 'boom' },
    };
    expect(shouldShowInterruptBar(rs, [], false)).toBe(false);
  });
});
