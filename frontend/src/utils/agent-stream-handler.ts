import type { Dispatch, SetStateAction } from 'react';
import type { WorkspaceSession } from '@/components/employee/agent/agent-session-sidebar';
import { blockText, createStreamingMessage } from '@/components/employee/agent/agent-ui-utils';
import type {
  IAgentActionStreamItem,
  IAgentMemoryItem,
  IAgentMessageItem,
  IAgentReply,
  IAgentRuntimeFeedItem,
  IAgentStreamEvent,
  IAgentToolStreamItem,
  IPlanReviewUiState,
} from '@/types/agent';
import { getUiComponentKey, parseAgentStreamEnvelopeV1, parsePlanReviewTreeData, parseRepairSuggestions } from '@/utils/agent-stream-v1';

/** 流式事件处理所需的 React 状态更新器集合 */
export interface AgentStreamHandlerDeps {
  streamingMessageId: number;
  persistedSession: WorkspaceSession;
  oldSessionId: number;
  enableThinking: boolean;
  setMessages: Dispatch<SetStateAction<IAgentMessageItem[]>>;
  setToolEvents: Dispatch<SetStateAction<IAgentToolStreamItem[]>>;
  setRuntimeFeedItems: Dispatch<SetStateAction<IAgentRuntimeFeedItem[]>>;
  setActions: Dispatch<SetStateAction<IAgentActionStreamItem[]>>;
  setPlanReview: Dispatch<SetStateAction<IPlanReviewUiState | null>>;
  replaceSession: (session: WorkspaceSession, oldId: number) => void;
  setMemories: Dispatch<SetStateAction<IAgentMemoryItem[]>>;
}

/**
 * 处理单条 SSE 事件（legacy + agent.v1）
 * v1 的 stream.text_delta 优先于 legacy token，避免重复追加
 */
export function handleAgentStreamEvent(streamEvent: IAgentStreamEvent, deps: AgentStreamHandlerDeps): void {
  if (streamEvent.event === 'agent.v1') {
    handleAgentV1Event(streamEvent.data, deps);
    return;
  }
  handleLegacyStreamEvent(streamEvent, deps);
}

function getNodeDisplayName(nodeId: string): string {
  const nameMap: Record<string, string> = {
    'analyst': '理解分析',
    'planner': '规划生成',
    'supervisor': '任务调度',
    'legacy_executor': '执行任务',
    'reporter': '结果汇报',
    'resume_prepare': '简历预处理',
    'resume_extract': '简历提取',
    'resume_markdown': '简历转换',
  };
  return nameMap[nodeId] || nodeId;
}

function handleAgentV1Event(data: Record<string, unknown>, deps: AgentStreamHandlerDeps): void {
  const envelope = parseAgentStreamEnvelopeV1(data);
  if (!envelope) return;

  const { payload, event_type: eventType } = envelope;

  if (eventType === 'stream.text_delta') {
    const delta = typeof payload.delta === 'string' ? payload.delta : '';
    if (delta) appendTokenDelta(delta, deps);
    return;
  }

  if (eventType === 'ui.render') {
    const componentKey = getUiComponentKey(payload);
    const renderData = (payload.data as Record<string, unknown>) || {};
    if (componentKey === 'PlanReviewTree') {
      const parsed = parsePlanReviewTreeData(renderData);
      if (!parsed) return;
      deps.setPlanReview({
        instanceId: String(payload.instance_id || `plan-${parsed.revision}`),
        revision: parsed.revision,
        maxRevisions: parsed.max_revisions ?? 3,
        tasks: parsed.tasks,
        editable: parsed.editable !== false,
        repairSuggestions: [],
        feedbackDraft: '',
        phase: 'pending',
      });
      return;
    }
    if (componentKey === 'PlanRepairHints') {
      const suggestions = parseRepairSuggestions(renderData);
      if (suggestions.length === 0) return;
      deps.setPlanReview((prev) => (prev ? { ...prev, repairSuggestions: [...prev.repairSuggestions, ...suggestions] } : prev));
    }
    return;
  }

  if (eventType === 'plan.repair_suggestions') {
    const suggestions = parseRepairSuggestions(payload);
    if (suggestions.length === 0) return;
    deps.setPlanReview((prev) => (prev ? { ...prev, repairSuggestions: [...prev.repairSuggestions, ...suggestions] } : prev));
    return;
  }

  if (eventType === 'plan.revision_started') {
    const revision = typeof payload.revision === 'number' ? payload.revision : 1;
    deps.setPlanReview((prev) => (prev ? { ...prev, revision, phase: 'submitting' } : prev));
    return;
  }

  if (eventType === 'lifecycle.interrupt') {
    deps.setPlanReview((prev) => (prev ? { ...prev, phase: 'pending' } : prev));
  }

  if (eventType === 'lifecycle.node_enter') {
    const nodeId = String(payload.node_id || '');
    deps.setRuntimeFeedItems((prev) => {
      const existing = prev.find((item) => item.id === `node-${nodeId}`);
      if (existing) return prev;
      return [...prev, {
        id: `node-${nodeId}`,
        type: 'node' as const,
        status: 'running' as const,
        title: getNodeDisplayName(nodeId),
        message: null,
      }];
    });
    return;
  }

  if (eventType === 'lifecycle.node_exit') {
    const nodeId = String(payload.node_id || '');
    const success = payload.error ? false : true;
    deps.setRuntimeFeedItems((prev) =>
      prev.map((item) =>
        item.id === `node-${nodeId}`
          ? { ...item, status: success ? 'success' : 'failed' as const }
          : item
      )
    );
    return;
  }

  if (eventType === 'tool.call_start') {
    const toolName = String(payload.tool_name || '未知工具');
    const callId = String(payload.call_id || `tool-${Date.now()}`);
    deps.setToolEvents((prev) => [
      ...prev,
      {
        id: callId,
        type: 'call' as const,
        tool_name: toolName,
        display_name: (payload.display_name as string) || toolName,
        payload: (payload.input_payload as Record<string, unknown>) || {},
      },
    ]);
    deps.setRuntimeFeedItems((prev) => [
      ...prev,
      { id: callId, type: 'tool' as const, status: 'running' as const, title: toolName },
    ]);
    return;
  }

  if (eventType === 'tool.call_end') {
    const callId = String(payload.call_id || '');
    const success = Boolean(payload.success);
    deps.setToolEvents((prev) =>
      prev.map((item) =>
        item.id === callId
          ? {
              ...item,
              success,
              error_message: (payload.error_message as string) || null,
              payload: (payload.output_payload as Record<string, unknown>) || {},
            }
          : item
      )
    );
    deps.setRuntimeFeedItems((prev) =>
      prev.map((item) =>
        item.id === callId
          ? { ...item, status: success ? 'success' : 'failed' as const }
          : item
      )
    );
    return;
  }

  if (eventType === 'lifecycle.resume_ack' || eventType === 'stream.text_done') {
    deps.setPlanReview((prev) => prev ? { ...prev, phase: 'pending' } : prev);
    return;
  }

  if (eventType === 'lifecycle.run_finished' || eventType === 'lifecycle.run_failed') {
    deps.setPlanReview((prev) => prev ? { ...prev, phase: 'pending' } : prev);
    return;
  }
}

function handleLegacyStreamEvent(streamEvent: IAgentStreamEvent, deps: AgentStreamHandlerDeps): void {
  const { streamingMessageId, persistedSession, oldSessionId } = deps;

  if (streamEvent.event === 'user_message') {
    const userMessage = streamEvent.data.message as IAgentMessageItem;
    deps.setMessages((prev) => (prev.some((message) => message.id === userMessage.id) ? prev : [...prev, userMessage]));
    return;
  }

  if (streamEvent.event === 'tool_call') {
    const toolCall = streamEvent.data.tool_call as Record<string, unknown>;
    const toolName = String(toolCall.tool_name || '');
    const displayName = String(toolCall.display_name || '工具调用');
    const feedId = `tool-${toolName || displayName}`;
    deps.setToolEvents((prev) => [
      ...prev,
      { id: `call-${Date.now()}-${prev.length}`, type: 'call', tool_name: toolName, display_name: displayName, payload: (toolCall.input_payload as Record<string, unknown>) || {} },
    ]);
    deps.setRuntimeFeedItems((prev) =>
      prev.some((item) => item.id === feedId)
        ? prev.map((item) => (item.id === feedId ? { ...item, status: 'running', title: displayName, message: null } : item))
        : [...prev, { id: feedId, type: 'tool', status: 'running', title: displayName }],
    );
    return;
  }

  if (streamEvent.event === 'tool_result') {
    const toolResult = streamEvent.data.tool_result as Record<string, unknown>;
    const toolName = String(toolResult.tool_name || '');
    const displayName = String(toolResult.display_name || '工具结果');
    const feedId = `tool-${toolName || displayName}`;
    const success = Boolean(toolResult.success);
    const errorMessage = typeof toolResult.error_message === 'string' ? toolResult.error_message : null;
    deps.setToolEvents((prev) => [
      ...prev,
      {
        id: `result-${Date.now()}-${prev.length}`,
        type: 'result',
        tool_name: toolName,
        display_name: displayName,
        payload: (toolResult.output_payload as Record<string, unknown>) || {},
        success,
        error_message: errorMessage,
      },
    ]);
    deps.setRuntimeFeedItems((prev) =>
      prev.some((item) => item.id === feedId)
        ? prev.map((item) =>
            item.id === feedId ? { ...item, status: success ? 'success' : 'failed', title: displayName, message: errorMessage } : item,
          )
        : [...prev, { id: feedId, type: 'tool', status: success ? 'success' : 'failed', title: displayName, message: errorMessage }],
    );
    return;
  }

  if (streamEvent.event === 'action_required') {
    const action = streamEvent.data.action as IAgentActionStreamItem;
    deps.setActions((prev) => [action, ...prev.filter((item) => item.id !== action.id)]);
    deps.setRuntimeFeedItems((prev) =>
      prev.some((item) => item.id === `action-${action.id}`) ? prev : [...prev, { id: `action-${action.id}`, type: 'action', status: 'pending', title: action.action_name, action }],
    );
    return;
  }

  if (streamEvent.event === 'token') {
    const delta = typeof streamEvent.data.delta === 'string' ? streamEvent.data.delta : '';
    if (delta) appendTokenDelta(delta, deps);
    return;
  }

  if (streamEvent.event === 'final' || streamEvent.event === 'error') {
    const reply = streamEvent.data.reply as IAgentReply | undefined;
    if (!reply) {
      if (streamEvent.event === 'error' && typeof streamEvent.data.message === 'string') {
        throw new Error(streamEvent.data.message);
      }
      return;
    }
    const nextSession = reply.session || { ...persistedSession, title: persistedSession.title };
    deps.replaceSession(nextSession, oldSessionId);
    deps.setMessages((prev) => [
      ...prev.filter((message) => message.id !== streamingMessageId && message.id !== reply.user_message.id && message.id !== reply.agent_message.id),
      reply.user_message,
      reply.agent_message,
    ]);
    deps.setMemories(reply.memories || []);
    deps.setPlanReview(null);
  }
}

function appendTokenDelta(delta: string, deps: AgentStreamHandlerDeps): void {
  const { streamingMessageId, persistedSession, enableThinking } = deps;
  if (enableThinking) {
    deps.setRuntimeFeedItems((prev) => prev.map((item) => (item.id === `thinking-${streamingMessageId}` ? { ...item, status: 'success' } : item)));
  }
  deps.setMessages((prev) => {
    const existing = prev.find((message) => message.id === streamingMessageId);
    if (!existing) {
      return [...prev, createStreamingMessage(streamingMessageId, persistedSession.id, delta, prev.length + 1)];
    }
    return prev.map((message) =>
      message.id === streamingMessageId
        ? {
            ...message,
            content: {
              ...message.content,
              blocks: [{ type: 'text', text: `${blockText(message.content.blocks?.[0] || {})}${delta}` }],
            },
          }
        : message,
    );
  });
}
