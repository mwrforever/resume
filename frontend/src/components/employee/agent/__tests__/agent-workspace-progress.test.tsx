/**
 * Bug3 修复单测：新空会话不渲染右侧进度岛，发首条消息后渲染。
 *
 * 用 store mock 提供 runs：messages=[] vs messages 非空，断言进度岛存在性。
 * 进度岛特征文案："流程进度"（展开面板）或胶囊节点标题；这里用 FloatingProgress
 * 内部稳定文案做存在性断言——胶囊默认渲染当前节点标题，模板兜底会渲染首个 pending 节点标题。
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { AgentWorkspace } from '../agent-workspace';
import { useAgentStore } from '@/store/agent';
import type { AgentMessage } from '@/types/agent';

// jsdom 未实现 Element.scrollTo（use-follow-bottom 的自动滚动会调用），此处补桩避免渲染时抛错。
if (!Element.prototype.scrollTo) {
  Element.prototype.scrollTo = () => {};
}

// 真实 store，但 mock 掉网络层，避免 useAgentRun 内 ensureLoaded 触发真实请求
vi.mock('@/api/employee/agent', () => ({
  employeeAgentApi: {
    getSession: vi.fn(async () => ({ data: { data: { session: { id: 1 }, messages: [] } } })),
  },
}));

// 一条 user 消息，使 messages 非空
const userMessage: AgentMessage = {
  id: 100, session_id: 1, parent_message_id: null, role: 'user',
  workflow_type: 'interview_questions', run_id: null,
  content: { blocks: [{ type: 'text', index: 0, text: '帮我出题', status: 'success' }] },
  model_name: null, token_count: null, sort_order: 0, create_time: null,
};

function seedSession(messages: AgentMessage[]) {
  useAgentStore.setState({
    activeId: 1,
    runs: {
      1: {
        session: { id: 1, enable_thinking: false, selected_model_name: null } as never,
        messages,
        runState: { running: false, workflow_type: 'interview_questions', steps: [], current_blocks: [], error: null, run_id: null, enable_thinking: false },
        sending: false, loaded: true,
      },
    },
  });
}

describe('Bug3 FloatingProgress 条件挂载', () => {
  beforeEach(() => useAgentStore.setState({ sessions: [], activeId: null, runs: {} }));

  it('空会话（messages=[]）不渲染进度岛', () => {
    seedSession([]);
    const { container } = render(<AgentWorkspace sessionId={1} onSessionUpdate={() => {}} />);
    // 进度岛根节点带 data-testid（实现步骤会给 FloatingProgress 外层包裹加上）
    expect(container.querySelector('[data-testid="floating-progress"]')).toBeNull();
  });

  it('messages 非空时渲染进度岛', () => {
    seedSession([userMessage]);
    render(<AgentWorkspace sessionId={1} onSessionUpdate={() => {}} />);
    expect(screen.getByTestId('floating-progress')).toBeInTheDocument();
  });
});
