import { describe, it, expect, vi } from 'vitest';
import type { FormEvent } from 'react';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { AgentComposer } from '@/components/employee/agent/agent-composer';
import { AgentWorkspaceHeader } from '@/components/employee/agent/agent-workspace-header';
import { AgentSessionSidebar } from '@/components/employee/agent/agent-session-sidebar';
import { AgentMessageList } from '@/components/employee/agent/agent-message-list';
import { AgentToolTimeline } from '@/components/employee/agent/agent-tool-timeline';
import type { IAgentMessageItem, IAgentRuntimeFeedItem, IAgentToolStreamItem } from '@/types/agent';

const baseSession = {
  id: 1,
  session_key: 'session-1',
  employee_id: 1,
  title: '候选人筛选策略',
  status: 1,
  selected_model_name: 'qwen-plus',
  selected_model_source: 'employee',
  context_summary: null,
  last_message_time: '2026-05-12T04:00:00Z',
  version: 1,
  create_time: '2026-05-12T03:00:00Z',
  update_time: '2026-05-12T04:00:00Z',
};

const models = [
  { model_name: 'qwen-plus', source: 'employee' as const, config_id: 1, biz_type: 'employee', biz_id: 1, config_name: '招聘 Agent 模型', base_url: 'https://example.com' },
];

const toolEvents: IAgentToolStreamItem[] = [
  { id: 'call-1', type: 'call', tool_name: 'candidate_search', display_name: '搜索候选人数据', payload: { keyword: 'React' } },
  { id: 'result-1', type: 'result', tool_name: 'candidate_search', display_name: '搜索候选人数据', payload: { count: 8 }, success: true },
];

const userMessage: IAgentMessageItem = {
  id: 11,
  session_id: 1,
  parent_message_id: null,
  role: 'user',
  message_type: 'text',
  content: { context_refs: [], blocks: [{ type: 'text', text: '帮我筛选 React 候选人' }] },
  model_name: null,
  token_count: null,
  sort_order: 1,
  create_time: null,
};

const agentMessage: IAgentMessageItem = {
  id: 12,
  session_id: 1,
  parent_message_id: 11,
  role: 'agent',
  message_type: 'text',
  content: { context_refs: [], blocks: [{ type: 'text', text: '已完成候选人筛选。' }] },
  model_name: 'qwen-plus',
  token_count: null,
  sort_order: 2,
  create_time: null,
};

const runtimeFeedItems: IAgentRuntimeFeedItem[] = [
  { id: 'thinking-1', type: 'thinking', status: 'running', title: 'Agent 正在思考' },
  { id: 'tool-1', type: 'tool', status: 'success', title: '搜索候选人数据' },
];

function renderComposer(props?: Partial<Parameters<typeof AgentComposer>[0]>) {
  const onSubmit = vi.fn((event: FormEvent) => event.preventDefault());
  const result = render(
    <AgentComposer
      input="分析这个文件"
      sending={false}
      resumeFile={null}
      workflowType="interview_questions"
      onWorkflowChange={vi.fn()}
      onInputChange={vi.fn()}
      onResumeFileChange={vi.fn()}
      onSubmit={onSubmit}
      {...props}
    />
  );
  return { ...result, onSubmit };
}

describe('Agent workspace UI', () => {
  it('renders file upload without the job selector in the composer', () => {
    renderComposer();

    expect(screen.getByRole('button', { name: '文件上传' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '上传简历' })).not.toBeInTheDocument();
    expect(screen.queryByLabelText('关联岗位')).not.toBeInTheDocument();
    expect(screen.queryByRole('combobox')).not.toBeInTheDocument();
  });

  it('submits composer with Enter and keeps Shift Enter for line breaks', async () => {
    const user = userEvent.setup();
    const { onSubmit } = renderComposer();
    const textbox = screen.getByLabelText('Agent 消息输入');

    await user.click(textbox);
    await user.keyboard('{Shift>}{Enter}{/Shift}');
    expect(onSubmit).not.toHaveBeenCalled();

    await user.keyboard('{Enter}');
    expect(onSubmit).toHaveBeenCalledTimes(1);
  });

  it('renders thinking mode and preferences controls in workspace header', async () => {
    const onThinkingChange = vi.fn();
    const onToggleImmersiveMode = vi.fn();
    const onOpenPreferences = vi.fn();

    render(
      <AgentWorkspaceHeader
        currentSession={baseSession}
        selectedModelName="qwen-plus"
        selectableModels={models}
        enableThinking={false}
        immersiveMode
        onSelectModel={vi.fn()}
        onThinkingChange={onThinkingChange}
        onToggleImmersiveMode={onToggleImmersiveMode}
        onOpenPreferences={onOpenPreferences}
      />
    );

    await userEvent.click(screen.getByRole('button', { name: '切回原工作台模式' }));
    await userEvent.click(screen.getByRole('button', { name: '开启思考模式' }));
    await userEvent.click(screen.getByRole('button', { name: '打开偏好设置' }));

    expect(onToggleImmersiveMode).toHaveBeenCalledTimes(1);
    expect(onThinkingChange).toHaveBeenCalledWith(true);
    expect(onOpenPreferences).toHaveBeenCalledTimes(1);
  });

  it('collapses and expands the agent session sidebar with accessible controls', async () => {
    const onCollapsedChange = vi.fn();

    render(
      <AgentSessionSidebar
        sessions={[baseSession]}
        currentSessionId={1}
        loadingSessionId={null}
        collapsed={false}
        onCollapsedChange={onCollapsedChange}
        onOpenSession={vi.fn()}
        onCreateSession={vi.fn()}
        onRefreshSessions={vi.fn()}
        onSearchSessions={vi.fn()}
        onRenameSession={vi.fn()}
        onDeleteSession={vi.fn()}
      />
    );

    await userEvent.click(screen.getByRole('button', { name: '收起会话列表' }));

    expect(onCollapsedChange).toHaveBeenCalledWith(true);
    expect(screen.getByText('候选人筛选策略')).toBeInTheDocument();
  });

  it('renders collapsed session sidebar as a single icon rail', () => {
    render(
      <AgentSessionSidebar
        sessions={[baseSession]}
        currentSessionId={1}
        loadingSessionId={null}
        collapsed
        onCollapsedChange={vi.fn()}
        onOpenSession={vi.fn()}
        onCreateSession={vi.fn()}
        onRefreshSessions={vi.fn()}
        onSearchSessions={vi.fn()}
        onRenameSession={vi.fn()}
        onDeleteSession={vi.fn()}
      />
    );

    const collapsedRail = screen.getByLabelText('Agent 会话收起栏');
    expect(collapsedRail).toBeInTheDocument();
    expect(screen.queryByLabelText('Agent 会话列表')).not.toBeInTheDocument();
    expect(collapsedRail.children[0].querySelectorAll('button')).toHaveLength(1);
    expect(collapsedRail.children[1].querySelectorAll('button')).toHaveLength(3);
  });

  it('renders tool execution as status animation without exposing payload details', () => {
    render(<AgentToolTimeline toolEvents={toolEvents} active />);

    expect(screen.getByText('Agent 执行事件')).toBeInTheDocument();
    expect(screen.getAllByText('搜索候选人数据').length).toBeGreaterThan(0);
    expect(screen.getByText('执行完成')).toBeInTheDocument();
    expect(screen.queryByText(/"keyword": "React"/)).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /展开事件详情/ })).not.toBeInTheDocument();
  });

  it('interleaves compact runtime timeline before the agent reply instead of appending all events below the result', () => {
    const { container } = render(
      <AgentMessageList
        messages={[userMessage, agentMessage]}
        actionsByMessageId={new Map()}
        runtimeFeedItems={runtimeFeedItems}
        planReview={null}
        sending={false}
        errorMessage=""
        messagesEndRef={{ current: null }}
        onConfirmAction={vi.fn()}
        onRejectAction={vi.fn()}
        onPlanReviewFeedbackChange={vi.fn()}
        onPlanReviewTaskInstructionChange={vi.fn()}
        onPlanReviewApprove={vi.fn()}
        onPlanReviewReject={vi.fn()}
      />
    );

    const text = container.textContent || '';
    expect(text.indexOf('帮我筛选 React 候选人')).toBeLessThan(text.indexOf('运行过程 · 已完成 1 步'));
    expect(text.indexOf('运行过程 · 已完成 1 步')).toBeLessThan(text.indexOf('已完成候选人筛选。'));
  });
});
