import { FormEvent, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AdminLayout } from '@/components/layout/admin-layout';
import { employeeAgentApi, employeeLlmApi } from '@/api/employee/agent';
import { useAuthStore } from '@/store/auth';
import type { IAgentActionStreamItem, IAgentMemoryItem, IAgentMessageItem, IAgentReply, IAgentRuntimeFeedItem, IAgentToolStreamItem, ILlmModelOption } from '@/types/agent';
import { AgentComposer } from '@/components/employee/agent/agent-composer';
import { AgentMessageList } from '@/components/employee/agent/agent-message-list';
import { AgentPreferencesDialog } from '@/components/employee/agent/agent-preferences-dialog';
import { AgentSessionSidebar, type WorkspaceSession } from '@/components/employee/agent/agent-session-sidebar';
import { DeleteSessionDialog, SessionDialog, SessionSearchDialog } from '@/components/employee/agent/agent-session-dialogs';
import { AgentWorkspaceHeader } from '@/components/employee/agent/agent-workspace-header';
import { DEFAULT_MODEL_VALUE, blockText, buildLocalTitle, createStreamingMessage } from '@/components/employee/agent/agent-ui-utils';

const AGENT_IMMERSIVE_STORAGE_KEY = 'employee-agent-immersive';
const AGENT_SESSION_COLLAPSED_STORAGE_KEY = 'employee-agent-session-collapsed';

/** 从 localStorage 读取布尔值，若不存在则返回默认值 */
function readBooleanStorage(key: string, defaultValue: boolean) {
  const value = localStorage.getItem(key);
  if (value === null) return defaultValue;
  return value === 'true';
}

/**
 * 员工 Agent 工作区主页面。
 *
 * 采用沉浸式布局：左侧会话列表、中央对话区、右侧可折叠功能面板。
 * 负责会话管理（加载/新建/重命名/删除）、消息收发、模型选择、
 * 临时动作确认/拒绝、Trace 事件展示及自动滚动等核心交互。
 */
export default function EmployeeAgent() {
  const userId = useAuthStore((state) => state.userId);
  const [sessions, setSessions] = useState<WorkspaceSession[]>([]);
  const [currentSession, setCurrentSession] = useState<WorkspaceSession | null>(null);
  const [messages, setMessages] = useState<IAgentMessageItem[]>([]);
  const [memories, setMemories] = useState<IAgentMemoryItem[]>([]);
  const [toolEvents, setToolEvents] = useState<IAgentToolStreamItem[]>([]);
  const [runtimeFeedItems, setRuntimeFeedItems] = useState<IAgentRuntimeFeedItem[]>([]);
  const [actions, setActions] = useState<IAgentActionStreamItem[]>([]);
  const [models, setModels] = useState<ILlmModelOption[]>([]);
  const [selectedModelName, setSelectedModelName] = useState<string | null>(null);
  const [enableThinking, setEnableThinking] = useState(false);
  const [input, setInput] = useState('');
  const [sending, setSending] = useState(false);
  const [loadingSessionId, setLoadingSessionId] = useState<number | null>(null);
  const [errorMessage, setErrorMessage] = useState('');
  const [preferencesOpen, setPreferencesOpen] = useState(false);
  const [renameTarget, setRenameTarget] = useState<WorkspaceSession | null>(null);
  const [savingSession, setSavingSession] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<WorkspaceSession | null>(null);
  const [deletingSession, setDeletingSession] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [immersiveMode, setImmersiveMode] = useState(() => readBooleanStorage(AGENT_IMMERSIVE_STORAGE_KEY, true));
  const [sessionSidebarCollapsed, setSessionSidebarCollapsed] = useState(() => readBooleanStorage(AGENT_SESSION_COLLAPSED_STORAGE_KEY, false));
  const messagesEndRef = useRef<HTMLDivElement | null>(null);

  const totalTokens = useMemo(() => messages.reduce((sum, message) => sum + (message.token_count || 0), 0), [messages]);
  const selectableModels = useMemo(() => models.filter((model) => model.source !== 'env'), [models]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
  }, [messages.length, actions.length, runtimeFeedItems.length, sending]);

  useEffect(() => {
    localStorage.setItem(AGENT_IMMERSIVE_STORAGE_KEY, String(immersiveMode));
  }, [immersiveMode]);

  useEffect(() => {
    localStorage.setItem(AGENT_SESSION_COLLAPSED_STORAGE_KEY, String(sessionSidebarCollapsed));
  }, [sessionSidebarCollapsed]);

  useEffect(() => {
    const handleShortcut = (event: KeyboardEvent) => {
      if (!event.ctrlKey || event.key.toLowerCase() !== 'b') return;
      event.preventDefault();
      setImmersiveMode((prev) => !prev);
    };
    window.addEventListener('keydown', handleShortcut);
    return () => window.removeEventListener('keydown', handleShortcut);
  }, []);

  const loadSessions = useCallback(async () => {
    const res = await employeeAgentApi.listSessions({ page: 1, page_size: 100 });
    setSessions((prev) => [...prev.filter((session) => session.isLocal), ...(res.data?.items || [])]);
  }, []);

  const loadModels = useCallback(async () => {
    const res = await employeeLlmApi.listOptions();
    setModels(res.data || []);
  }, []);

  const clearConversation = () => {
    setMessages([]);
    setMemories([]);
    setToolEvents([]);
    setRuntimeFeedItems([]);
    setActions([]);
    setInput('');
  };

  const replaceSession = (nextSession: WorkspaceSession, oldId?: number) => {
    setSessions((prev) => {
      const filtered = oldId ? prev.filter((session) => session.id !== oldId) : prev;
      const exists = filtered.some((session) => session.id === nextSession.id);
      return exists ? filtered.map((session) => session.id === nextSession.id ? nextSession : session) : [nextSession, ...filtered];
    });
    setCurrentSession(nextSession);
    setSelectedModelName(nextSession.selected_model_name || null);
  };

  const createLocalSession = (modelName: string | null = selectedModelName) => {
    const selectedModel = models.find((model) => model.model_name === modelName);
    const localSession: WorkspaceSession = {
      id: -Date.now(),
      session_key: `local-${Date.now()}`,
      employee_id: Number(userId || 0),
      title: '新会话',
      status: 1,
      selected_model_name: modelName,
      selected_model_source: selectedModel?.source || null,
      context_summary: null,
      last_message_time: null,
      version: 0,
      create_time: null,
      update_time: null,
      isLocal: true,
    };
    setSessions((prev) => [localSession, ...prev]);
    setCurrentSession(localSession);
    setSelectedModelName(modelName);
    clearConversation();
    return localSession;
  };

  const openSession = useCallback(async (session: WorkspaceSession) => {
    setErrorMessage('');
    setCurrentSession(session);
    setSelectedModelName(session.selected_model_name || null);
    if (session.isLocal) {
      clearConversation();
      return;
    }
    setLoadingSessionId(session.id);
    try {
      const detail = await employeeAgentApi.getSession(session.id);
      setCurrentSession(detail.data.session);
      setSelectedModelName(detail.data.session.selected_model_name || null);
      setMessages(detail.data.messages);
      setMemories(detail.data.memories || []);
      setToolEvents([]);
      setRuntimeFeedItems([]);
      setActions([]);
    } finally {
      setLoadingSessionId(null);
    }
  }, []);

  useEffect(() => {
    loadSessions();
    loadModels();
  }, [loadModels, loadSessions]);

  const saveSession = async (title: string) => {
    if (!renameTarget) return;
    setSavingSession(true);
    try {
      if (renameTarget.isLocal) {
        replaceSession({ ...renameTarget, title }, renameTarget.id);
      } else {
        const res = await employeeAgentApi.updateSession(renameTarget.id, { title });
        replaceSession(res.data);
        await loadSessions();
      }
      setRenameTarget(null);
    } finally {
      setSavingSession(false);
    }
  };

  const deleteSession = async () => {
    if (!deleteTarget) return;
    setDeletingSession(true);
    try {
      if (!deleteTarget.isLocal) {
        await employeeAgentApi.deleteSession(deleteTarget.id);
        await loadSessions();
      }
      setSessions((prev) => prev.filter((session) => session.id !== deleteTarget.id));
      if (currentSession?.id === deleteTarget.id) {
        setCurrentSession(null);
        setSelectedModelName(null);
        clearConversation();
      }
      setDeleteTarget(null);
    } finally {
      setDeletingSession(false);
    }
  };

  const selectModel = async (value: string) => {
    const modelName = value === DEFAULT_MODEL_VALUE ? null : value;
    setSelectedModelName(modelName);
    if (!currentSession) return;
    const selectedModel = models.find((model) => model.model_name === modelName);
    if (currentSession.isLocal) {
      replaceSession({ ...currentSession, selected_model_name: modelName, selected_model_source: selectedModel?.source || null }, currentSession.id);
      return;
    }
    const res = await employeeAgentApi.selectModel(currentSession.id, modelName);
    replaceSession(res.data);
    await loadSessions();
  };

  const sendMessage = async (event: FormEvent) => {
    event.preventDefault();
    if (!input.trim()) return;
    const content = input.trim();
    const activeSession = currentSession || createLocalSession(selectedModelName);
    const oldSessionId = activeSession.id;
    const streamingMessageId = -Date.now();
    setErrorMessage('');
    setSending(true);
    setToolEvents([]);
    setRuntimeFeedItems(enableThinking ? [{ id: `thinking-${streamingMessageId}`, type: 'thinking', status: 'running', title: 'Agent 正在思考' }] : []);
    setInput('');
    try {
      let persistedSession: WorkspaceSession = activeSession;
      if (activeSession.isLocal) {
        const createRes = await employeeAgentApi.createSession({ title: '新会话', selected_model_name: activeSession.selected_model_name || null });
        persistedSession = createRes.data;
        replaceSession(persistedSession, oldSessionId);
      }
      await employeeAgentApi.streamMessage(persistedSession.id, { content, context_refs: [], runtime_options: { enable_thinking: enableThinking } }, (streamEvent) => {
        if (streamEvent.event === 'user_message') {
          const userMessage = streamEvent.data.message as IAgentMessageItem;
          setMessages((prev) => prev.some((message) => message.id === userMessage.id) ? prev : [...prev, userMessage]);
        }
        if (streamEvent.event === 'tool_call') {
          const toolCall = streamEvent.data.tool_call as Record<string, unknown>;
          const toolName = String(toolCall.tool_name || '');
          const displayName = String(toolCall.display_name || '工具调用');
          const feedId = `tool-${toolName || displayName}`;
          setToolEvents((prev) => [...prev, { id: `call-${Date.now()}-${prev.length}`, type: 'call', tool_name: toolName, display_name: displayName, payload: (toolCall.input_payload as Record<string, unknown>) || {} }]);
          setRuntimeFeedItems((prev) => prev.some((item) => item.id === feedId) ? prev.map((item) => item.id === feedId ? { ...item, status: 'running', title: displayName, message: null } : item) : [...prev, { id: feedId, type: 'tool', status: 'running', title: displayName }]);
        }
        if (streamEvent.event === 'tool_result') {
          const toolResult = streamEvent.data.tool_result as Record<string, unknown>;
          const toolName = String(toolResult.tool_name || '');
          const displayName = String(toolResult.display_name || '工具结果');
          const feedId = `tool-${toolName || displayName}`;
          const success = Boolean(toolResult.success);
          const errorMessage = typeof toolResult.error_message === 'string' ? toolResult.error_message : null;
          setToolEvents((prev) => [...prev, { id: `result-${Date.now()}-${prev.length}`, type: 'result', tool_name: toolName, display_name: displayName, payload: (toolResult.output_payload as Record<string, unknown>) || {}, success, error_message: errorMessage }]);
          setRuntimeFeedItems((prev) => prev.some((item) => item.id === feedId) ? prev.map((item) => item.id === feedId ? { ...item, status: success ? 'success' : 'failed', title: displayName, message: errorMessage } : item) : [...prev, { id: feedId, type: 'tool', status: success ? 'success' : 'failed', title: displayName, message: errorMessage }]);
        }
        if (streamEvent.event === 'action_required') {
          const action = streamEvent.data.action as IAgentActionStreamItem;
          setActions((prev) => [action, ...prev.filter((item) => item.id !== action.id)]);
          setRuntimeFeedItems((prev) => prev.some((item) => item.id === `action-${action.id}`) ? prev : [...prev, { id: `action-${action.id}`, type: 'action', status: 'pending', title: action.action_name, action }]);
        }
        if (streamEvent.event === 'token') {
          const delta = typeof streamEvent.data.delta === 'string' ? streamEvent.data.delta : '';
          if (!delta) return;
          if (enableThinking) {
            setRuntimeFeedItems((prev) => prev.map((item) => item.id === `thinking-${streamingMessageId}` ? { ...item, status: 'success' } : item));
          }
          setMessages((prev) => {
            const existing = prev.find((message) => message.id === streamingMessageId);
            if (!existing) {
              return [...prev, createStreamingMessage(streamingMessageId, persistedSession.id, delta, prev.length + 1)];
            }
            return prev.map((message) => message.id === streamingMessageId ? { ...message, content: { ...message.content, blocks: [{ type: 'text', text: `${blockText(message.content.blocks?.[0] || {})}${delta}` }] } } : message);
          });
        }
        if (streamEvent.event === 'final' || streamEvent.event === 'error') {
          const reply = streamEvent.data.reply as IAgentReply | undefined;
          if (!reply) {
            if (streamEvent.event === 'error' && typeof streamEvent.data.message === 'string') throw new Error(streamEvent.data.message);
            return;
          }
          const nextSession = reply.session || { ...persistedSession, title: buildLocalTitle(content), context_summary: buildLocalTitle(content) };
          replaceSession(nextSession, oldSessionId);
          setMessages((prev) => [...prev.filter((message) => message.id !== streamingMessageId && message.id !== reply.user_message.id && message.id !== reply.agent_message.id), reply.user_message, reply.agent_message]);
          setMemories(reply.memories || []);
        }
      });
      await loadSessions();
    } catch (error) {
      setInput(content);
      setErrorMessage(error instanceof Error ? error.message : '消息发送失败，请检查模型配置或稍后重试。');
    } finally {
      setSending(false);
    }
  };

  /**
   * 统一更新动作状态，同步 actions 列表与运行时 feed 中对应项的展示状态
   *
   * @param actionId  动作唯一标识
   * @param status    目标状态码（如 4 表示已执行/已拒绝）
   */
  const updateActionStatus = useCallback((actionId: string, status: number) => {
    setActions((prev) => prev.map((item) => item.id === actionId ? { ...item, status } : item));
    setRuntimeFeedItems((prev) => prev.map((item) => item.id === `action-${actionId}` && item.action ? { ...item, action: { ...item.action, status } } : item));
  }, []);

  const confirmAgentAction = async (action: IAgentActionStreamItem) => {
    try {
      const res = await employeeAgentApi.executeAction({
        capability_key: action.capability_key,
        action_name: action.action_name,
        target_type: action.target_type,
        target_id: action.target_id,
        input_payload: action.input_payload,
        preview_payload: action.preview_payload,
      });
      updateActionStatus(action.id, res.data.status);
    } catch (err) {
      const message = err instanceof Error ? err.message : '动作执行失败，请稍后重试';
      setErrorMessage(message);
    }
  };

  const rejectAgentAction = async (action: IAgentActionStreamItem) => {
    updateActionStatus(action.id, 4);
  };

  const actionsByMessageId = useMemo(() => {
    const runtimeActionIds = new Set(runtimeFeedItems.filter((item) => item.type === 'action' && item.action).map((item) => item.action?.id));
    const agentReplyByParentId = new Map<number, number>();
    messages.forEach((message) => {
      if (message.role === 'agent' && typeof message.parent_message_id === 'number') {
        agentReplyByParentId.set(message.parent_message_id, message.id);
      }
    });
    const grouped = new Map<number, IAgentActionStreamItem[]>();
    actions.forEach((action) => {
      if (runtimeActionIds.has(action.id)) return;
      if (typeof action.message_id !== 'number') return;
      const displayMessageId = agentReplyByParentId.get(action.message_id) || action.message_id;
      grouped.set(displayMessageId, [...(grouped.get(displayMessageId) || []), action]);
    });
    grouped.forEach((items) => items.sort((left, right) => left.id.localeCompare(right.id)));
    return grouped;
  }, [actions, messages, runtimeFeedItems]);

  return (
    <AdminLayout breadcrumbs={[{ label: 'Agent 平台' }, { label: 'Agent 工作台' }]} immersive={immersiveMode}>
      <div className={immersiveMode ? 'relative h-screen overflow-hidden p-3 lg:p-4' : 'relative h-[calc(100vh-7rem)] overflow-hidden'}>
        <div className="grid h-full min-h-0 gap-3 overflow-hidden transition-[grid-template-columns] duration-300 ease-out" style={{ gridTemplateColumns: `${sessionSidebarCollapsed ? 76 : 260}px minmax(0, 1fr)` }}>
        <AgentSessionSidebar
          sessions={sessions}
          currentSessionId={currentSession?.id}
          loadingSessionId={loadingSessionId}
          collapsed={sessionSidebarCollapsed}
          onCollapsedChange={setSessionSidebarCollapsed}
          onOpenSession={openSession}
          onCreateSession={() => createLocalSession()}
          onRefreshSessions={loadSessions}
          onSearchSessions={() => setSearchOpen(true)}
          onRenameSession={setRenameTarget}
          onDeleteSession={setDeleteTarget}
        />
        <main className="flex min-h-0 flex-col overflow-hidden rounded-[2rem] border border-white/80 bg-white/95 shadow-xl shadow-slate-200/70 backdrop-blur">
          <AgentWorkspaceHeader
            currentSession={currentSession}
            selectedModelName={selectedModelName}
            selectableModels={selectableModels}
            enableThinking={enableThinking}
            immersiveMode={immersiveMode}
            onSelectModel={selectModel}
            onThinkingChange={setEnableThinking}
            onToggleImmersiveMode={() => setImmersiveMode((prev) => !prev)}
            onOpenPreferences={() => setPreferencesOpen(true)}
          />
          <AgentMessageList
            messages={messages}
            actionsByMessageId={actionsByMessageId}
            runtimeFeedItems={runtimeFeedItems}
            sending={sending}
            errorMessage={errorMessage}
            messagesEndRef={messagesEndRef}
            onConfirmAction={confirmAgentAction}
            onRejectAction={rejectAgentAction}
          />
          <AgentComposer input={input} sending={sending} onInputChange={setInput} onSubmit={sendMessage} />
        </main>
        </div>
      </div>
      <SessionDialog open={!!renameTarget} initialTitle={renameTarget?.title ?? ''} saving={savingSession} onClose={() => setRenameTarget(null)} onSubmit={saveSession} />
      <AgentPreferencesDialog
        open={preferencesOpen}
        memories={memories}
        toolEvents={toolEvents}
        totalTokens={totalTokens}
        messageCount={messages.length}
        actionCount={actions.length}
        onClose={() => setPreferencesOpen(false)}
      />
      <SessionSearchDialog open={searchOpen} onClose={() => setSearchOpen(false)} onOpenSession={openSession} />
      <DeleteSessionDialog target={deleteTarget} loading={deletingSession} onConfirm={deleteSession} onCancel={() => setDeleteTarget(null)} />
    </AdminLayout>
  );
}
