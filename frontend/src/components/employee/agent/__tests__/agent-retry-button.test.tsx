/**
 * 重试按钮单测：错误态下点击"重试"应触发 sendMessage 重新发送。
 *
 * 复现场景：错误来自非 handleSend 路径（如 resume/submit 失败、或刷新后直接看到错误），
 * lastInputRef.current 为空。旧实现 `if (lastInputRef.current) ...` 会静默 no-op，
 * 用户感到"重试按钮不起作用"。修复后应回退到历史最后一条用户消息重新发送。
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { AgentWorkspace } from '../agent-workspace';
import { useAgentStore } from '@/store/agent';
import type { AgentMessage } from '@/types/agent';

if (!Element.prototype.scrollTo) {
  Element.prototype.scrollTo = () => {};
}

vi.mock('@/api/employee/agent', () => ({
  employeeAgentApi: {
    getSession: vi.fn(async () => ({ data: { data: { session: { id: 1 }, messages: [] } } })),
  },
}));

const userMessage: AgentMessage = {
  id: 100, session_id: 1, parent_message_id: null, role: 'user',
  workflow_type: 'interview_questions', run_id: null,
  content: {
    blocks: [{ type: 'text', index: 0, text: '帮我出题', status: 'success' }],
    context_refs: [{ type: 'resume', file_path: '/a.pdf', file_name: 'a.pdf' }],
  },
  model_name: null, token_count: null, sort_order: 0, create_time: null,
};

function seedSessionWithError() {
  useAgentStore.setState({
    activeId: 1,
    runs: {
      1: {
        session: { id: 1, enable_thinking: false, selected_model_name: null } as never,
        messages: [userMessage],
        runState: {
          running: false, workflow_type: 'interview_questions', steps: [],
          current_blocks: [], run_id: null, enable_thinking: false, aborted: false,
          // 模拟后端报错：错误态展示重试按钮
          error: { code: 'graph_execution_failed', message: 'boom' },
        },
        sending: false, loaded: true,
      },
    },
  });
}

describe('错误态重试按钮', () => {
  beforeEach(() => useAgentStore.setState({ sessions: [], activeId: null, runs: {} }));

  it('点击"重试"应触发 sendMessage（即便 lastInputRef 为空也回退到最近用户消息）', async () => {
    seedSessionWithError();
    // 监听 store.sendMessage：捕获是否被调用及其入参
    const sendSpy = vi.fn();
    const actions = useAgentStore.getState();
    const origSend = actions.sendMessage;
    useAgentStore.setState({ sendMessage: async (...args: unknown[]) => { sendSpy(...args); } } as never);

    render(<AgentWorkspace sessionId={1} onSessionUpdate={() => {}} />);
    const retryBtn = screen.getByRole('button', { name: '重试' });
    fireEvent.click(retryBtn);

    // 期望 sendMessage 被调用（入参 sessionId=1 + 重建的 input）
    expect(sendSpy).toHaveBeenCalledTimes(1);
    const [, input] = sendSpy.mock.calls[0];
    expect(input.content).toBe('帮我出题');
    expect(input.workflow_type).toBe('interview_questions');

    // 还原避免污染其它用例
    useAgentStore.setState({ sendMessage: origSend } as never);
    void actions;
  });
});
