/**
 * Bug4 Composer 三态按钮单测。
 *
 * - 空闲（sending=false）：仅发送，无暂停；有输入则发送可用。
 * - 流式中（sending=true）：仅暂停，无发送。
 * - interrupt 等待（sending=false）：仅发送（可用，点击触发 onSend），无暂停，
 *   且发送文案不再是“请先完成上方选择”（prop hasPendingInteraction 已移除，按钮只看 sending）。
 */
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { AgentComposer } from '../agent-composer';
import type { WorkspaceSession } from '@/types/agent';

// uploadResume 不会在按钮测试里触发，但 import 链需要 mock api
vi.mock('@/api/employee/agent', () => ({ employeeAgentApi: { uploadResume: vi.fn() } }));

const baseSession = {
  id: 1, session_key: '', current_task_id: '', employee_id: 0, title: null,
  selected_model_name: null, enable_thinking: false, status: 0,
  last_message_time: null, create_time: null, update_time: null,
} as WorkspaceSession;

function renderComposer(over: Partial<React.ComponentProps<typeof AgentComposer>>) {
  const props: React.ComponentProps<typeof AgentComposer> = {
    session: baseSession, sending: false,
    lastWorkflow: 'interview_questions', prefill: null,
    onPrefillConsumed: () => {}, onSend: vi.fn(), onAbort: vi.fn(),
    onToggleThinking: () => {}, onPickModel: () => {}, isEmptySession: true,
    ...over,
  };
  return { props, ...render(<AgentComposer {...props} />) };
}

describe('Bug4 Composer 三态按钮', () => {
  it('流式中：仅暂停，无发送', () => {
    renderComposer({ sending: true });
    expect(screen.getByLabelText('暂停')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /发送/ })).toBeNull();
  });

  it('空闲：仅发送，无暂停', () => {
    renderComposer({ sending: false });
    expect(screen.queryByLabelText('暂停')).toBeNull();
    expect(screen.getByRole('button', { name: /发送/ })).toBeInTheDocument();
  });

  it('interrupt 等待：仅发送且文案为“发送”，输入后可点击触发 onSend', () => {
    const { props } = renderComposer({ sending: false });
    // 无暂停按钮
    expect(screen.queryByLabelText('暂停')).toBeNull();
    // 文案是“发送”，不是“请先完成上方选择”
    const sendBtn = screen.getByRole('button', { name: /发送/ });
    expect(sendBtn).toHaveTextContent('发送');
    expect(screen.queryByText('请先完成上方选择')).toBeNull();
    // 输入内容后点击发送，onSend 被调用
    const ta = screen.getByPlaceholderText('输入消息…');
    fireEvent.change(ta, { target: { value: '换个问题' } });
    fireEvent.click(sendBtn);
    expect(props.onSend).toHaveBeenCalledTimes(1);
  });
});
