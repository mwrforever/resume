import type { Dispatch, SetStateAction } from 'react';
import type { WorkspaceSession } from '@/components/employee/agent/agent-session-sidebar';
import { blockText, createStreamingMessage } from '@/components/employee/agent/agent-ui-utils';
import type {
  IAgentActionStreamItem,
  IAgentBusinessCardItem,
  IAgentInteractionRequestItem,
  IAgentMemoryItem,
  IAgentMessageItem,
  IAgentReply,
  IAgentRuntimeFeedItem,
  IAgentStreamEnvelopeV2,
  IAgentStreamEvent,
  IAgentThinkingStreamItem,
  IAgentToolStreamItem,
  IPlanReviewUiState,
} from '@/types/agent';
import { getUiComponentKey, parseAgentStreamEnvelopeV1, parsePlanReviewTreeData, parseRepairSuggestions } from '@/utils/agent-stream-v1';
import { parseAgentStreamEnvelopeV2 } from '@/utils/agent-stream-v2';

/** Global monotonic counter; first push of each timeline item gets a seq so message-list can interleave them in arrival order. */
let __timelineSeqCounter = 0;
function nextTimelineSeq(): number { __timelineSeqCounter += 1; return __timelineSeqCounter; }

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
  setThinkingItems?: Dispatch<SetStateAction<IAgentThinkingStreamItem[]>>;
  setInteractionRequests?: Dispatch<SetStateAction<IAgentInteractionRequestItem[]>>;
  setBusinessCards?: Dispatch<SetStateAction<IAgentBusinessCardItem[]>>;
  replaceSession: (session: WorkspaceSession, oldId: number) => void;
  setMemories: Dispatch<SetStateAction<IAgentMemoryItem[]>>;
}

/**
 * 处理单条 SSE 事件（legacy + agent.v1）
 * v1 的 stream.text_delta 优先于 legacy token，避免重复追加
 */
export function handleAgentStreamEvent(streamEvent: IAgentStreamEvent, deps: AgentStreamHandlerDeps): void {
  if (streamEvent.event === 'agent') {
    handleAgentV2Event(streamEvent.data, deps);
    return;
  }
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
    'coordinator': '任务调度',
    'job_agent': '岗位 Agent',
    'application_agent': '投递 Agent',
    'resume_agent': '简历 Agent',
    'evaluation_agent': '评估 Agent',
    'memory_agent': '记忆 Agent',
    'generic_agent': '通用 Agent',
  };
  return nameMap[nodeId] || nodeId;
}

function handleAgentV2Event(data: Record<string, unknown>, deps: AgentStreamHandlerDeps): void {
  const envelope = parseAgentStreamEnvelopeV2(data);
  if (!envelope) return;

  const { event, payload } = envelope;
  if (event === 'message.started') {
    const messageId = typeof payload.message_id === 'number' ? payload.message_id : deps.streamingMessageId;
    const content = typeof payload.content === 'string' ? payload.content : '';
    deps.setMessages((prev) => {
      const withoutOptimistic = prev.filter((m) => m.id !== deps.streamingMessageId);
      const exists = withoutOptimistic.some((m) => m.id === messageId);
      if (exists) return withoutOptimistic;
      const userMessage: IAgentMessageItem = {
        id: messageId,
        session_id: deps.persistedSession.id,
        parent_message_id: null,
        role: 'user',
        message_type: 'text',
        content: { context_refs: (payload.context_refs as Array<Record<string, unknown>>) || [], blocks: [{ type: 'text', text: content }] },
        model_name: null,
        token_count: null,
        sort_order: prev.length + 1,
        create_time: null,
      };
      return [...withoutOptimistic, userMessage];
    });
    return;
  }

  if (event === 'message.delta' || event === 'text_stream') {
    const delta = typeof payload.delta === 'string' ? payload.delta : '';
    if (delta) appendTokenDelta(delta, deps);
    return;
  }

  if (event === 'thinking_status') {
    upsertThinkingStatus(envelope, payload, deps);
    return;
  }

  if (event === 'thinking_stream') {
    appendThinkingStream(envelope, payload, deps);
    return;
  }

  if (event === 'execution_status') {
    upsertExecutionStatus(envelope, payload, deps);
    return;
  }

  if (event === 'interaction_request') {
    upsertInteractionRequest(envelope, payload, deps);
    return;
  }

  if (event === 'interaction_result') {
    markInteractionResult(payload, deps);
    return;
  }

  if (event === 'completed') {
    deps.setRuntimeFeedItems((prev) => prev.map((item) => (item.status === 'running' ? { ...item, status: 'success' } : item)));
    appendCompletedBusinessCards(envelope, payload, deps);
    return;
  }

  if (event === 'message.done') {
    const content = typeof payload.content === 'string' ? payload.content : '';
    if (content) replaceStreamingMessageContent(content, deps);
    return;
  }

  if (event === 'lifecycle.node.enter') {
    const nodeId = getV2NodeId(envelope);
    deps.setRuntimeFeedItems((prev) => upsertRuntimeFeed(prev, {
      id: `node-${nodeId}`,
      type: 'node',
      status: 'running',
      title: getNodeDisplayName(nodeId),
    }));
    return;
  }

  if (event === 'lifecycle.node.exit') {
    const nodeId = getV2NodeId(envelope);
    deps.setRuntimeFeedItems((prev) => updateRuntimeFeedStatus(prev, `node-${nodeId}`, 'success'));
    return;
  }

  if (event === 'lifecycle.run.finished' || event === 'form.resolved') {
    deps.setPlanReview((prev) => (prev ? { ...prev, phase: 'pending' } : prev));
    markThinkingFeed('success', deps);
    return;
  }

  if (event === 'lifecycle.run.failed' || event === 'error') {
    const message = typeof payload.error_message === 'string' ? payload.error_message : typeof payload.message === 'string' ? payload.message : null;
    deps.setPlanReview((prev) => (prev ? { ...prev, phase: 'pending' } : prev));
    deps.setRuntimeFeedItems((prev) => prev.map((item) => (item.status === 'running' ? { ...item, status: 'failed', message } : item)));
    return;
  }

  if (event === 'tool.started') {
    const callId = String(payload.call_id || `tool-${Date.now()}`);
    const toolName = String(payload.tool_name || '');
    const displayName = String(payload.display_name || toolName || '工具调用');
    deps.setToolEvents((prev) => [
      ...prev,
      { id: callId, type: 'call', tool_name: toolName, display_name: displayName, payload: (payload.input_payload as Record<string, unknown>) || {} },
    ]);
    deps.setRuntimeFeedItems((prev) => upsertRuntimeFeed(prev, {
      id: `tool-${callId}`,
      type: 'tool',
      status: 'running',
      title: displayName,
    }));
    return;
  }

  if (event === 'tool.finished') {
    const callId = String(payload.call_id || `tool-${Date.now()}`);
    const toolName = String(payload.tool_name || '');
    const displayName = String(payload.display_name || toolName || '工具结果');
    const success = payload.success !== false;
    const errorMessage = typeof payload.error_message === 'string' ? payload.error_message : null;
    deps.setToolEvents((prev) => [
      ...prev,
      {
        id: `${callId}-result`,
        type: 'result',
        tool_name: toolName,
        display_name: displayName,
        payload: (payload.output_payload as Record<string, unknown>) || {},
        success,
        error_message: errorMessage,
      },
    ]);
    deps.setRuntimeFeedItems((prev) => updateRuntimeFeedStatus(prev, `tool-${callId}`, success ? 'success' : 'failed', errorMessage));
    return;
  }

  if (event === 'action.requested') {
    const action = buildV2Action(payload, envelope);
    deps.setActions((prev) => [action, ...prev.filter((item) => item.id !== action.id)]);
    deps.setRuntimeFeedItems((prev) => upsertRuntimeFeed(prev, {
      id: `action-${action.id}`,
      type: 'action',
      status: 'pending',
      title: action.action_name,
      action,
    }));
    return;
  }

  if (event === 'data.evaluation_report') {
    const title = `评估报告：${String(payload.final_label || '已完成')} / ${Number(payload.final_score || 0)}`;
    deps.setToolEvents((prev) => [
      ...prev,
      {
        id: String(payload.card_id || `evaluation-${Date.now()}`),
        type: 'result',
        tool_name: 'evaluation_report',
        display_name: 'AI 简历评估报告',
        payload,
        success: true,
        error_message: null,
      },
    ]);
    deps.setRuntimeFeedItems((prev) => upsertRuntimeFeed(prev, {
      id: String(payload.card_id || `evaluation-${Date.now()}`),
      type: 'tool',
      status: 'success',
      title,
    }));
    return;
  }

  if (event === 'data.card') {
    appendBusinessCard(envelope, payload, deps);
    const title = typeof payload.title === 'string' ? payload.title : '数据卡片';
    deps.setToolEvents((prev) => [
      ...prev,
      {
        id: String(payload.card_id || `data-card-${Date.now()}`),
        type: 'result',
        tool_name: String(payload.card_type || 'data_card'),
        display_name: title,
        payload,
        success: true,
        error_message: null,
      },
    ]);
  }
}


function compactEventId(envelope: IAgentStreamEnvelopeV2, prefix: string): string {
  return `${prefix}-${envelope.run_id}-${envelope.node_id}`;
}

function coerceThinkingStatus(status: unknown): IAgentThinkingStreamItem['status'] {
  return status === 'started' || status === 'streaming' || status === 'completed' || status === 'unavailable' ? status : 'streaming';
}

function coerceFeedStatus(status: unknown): IAgentRuntimeFeedItem['status'] {
  if (status === 'success') return 'success';
  if (status === 'failed') return 'failed';
  if (status === 'waiting') return 'pending';
  return 'running';
}

function coerceInteractionType(value: unknown): IAgentInteractionRequestItem['interaction_type'] {
  if (value === 'dimension_selection' || value === 'plan_approval' || value === 'job_selection') return value;
  return 'dimension_selection';
}

function coerceBusinessCardType(value: unknown): IAgentBusinessCardItem['type'] | null {
  if (value === 'interview_question_set' || value === 'resume_evaluation_report') return value;
  return null;
}

function upsertThinkingStatus(
  envelope: IAgentStreamEnvelopeV2,
  payload: Record<string, unknown>,
  deps: AgentStreamHandlerDeps,
): void {
  if (!deps.setThinkingItems) return;
  const id = String(payload.message_id || compactEventId(envelope, 'thinking'));
  const content = typeof payload.content === 'string' ? payload.content : '';
  const status = coerceThinkingStatus(payload.status);
  deps.setThinkingItems((prev) => {
    if (prev.some((item) => item.id === id)) {
      return prev.map((item) => (item.id === id ? { ...item, status, content: content || item.content } : item));
    }
    return [...prev, { id, run_id: envelope.run_id, status, content, seq: nextTimelineSeq() }];
  });
}

function appendThinkingStream(
  envelope: IAgentStreamEnvelopeV2,
  payload: Record<string, unknown>,
  deps: AgentStreamHandlerDeps,
): void {
  if (!deps.setThinkingItems) return;
  const delta = typeof payload.delta === 'string' ? payload.delta : '';
  if (!delta) return;
  const id = String(payload.message_id || compactEventId(envelope, 'thinking'));
  deps.setThinkingItems((prev) => {
    if (prev.some((item) => item.id === id)) {
      return prev.map((item) => (item.id === id ? { ...item, status: 'streaming', content: `${item.content}${delta}` } : item));
    }
    return [...prev, { id, run_id: envelope.run_id, status: 'streaming', content: delta, seq: nextTimelineSeq() }];
  });
}

function upsertExecutionStatus(
  envelope: IAgentStreamEnvelopeV2,
  payload: Record<string, unknown>,
  deps: AgentStreamHandlerDeps,
): void {
  const title = typeof payload.title === 'string' ? payload.title : envelope.display_name || getNodeDisplayName(envelope.node_id);
  const detail = typeof payload.detail === 'string' ? payload.detail : null;
  deps.setRuntimeFeedItems((prev) => upsertRuntimeFeed(prev, {
    id: compactEventId(envelope, 'execution'),
    type: 'node',
    status: coerceFeedStatus(payload.status),
    title,
    message: detail,
  }));
}

function upsertInteractionRequest(
  envelope: IAgentStreamEnvelopeV2,
  payload: Record<string, unknown>,
  deps: AgentStreamHandlerDeps,
): void {
  const requestId = String(payload.request_id || compactEventId(envelope, 'interaction'));
  const item: IAgentInteractionRequestItem = {
    id: requestId,
    run_id: envelope.run_id,
    interaction_type: coerceInteractionType(payload.interaction_type),
    title: String(payload.title || '请确认'),
    prompt: String(payload.prompt || ''),
    data: (payload.data as Record<string, unknown>) || {},
    submit_label: String(payload.submit_label || '提交'),
    status: 'pending',
    seq: nextTimelineSeq(),
  };
  deps.setInteractionRequests?.((prev) => {
    const existing = prev.find((current) => current.id === item.id);
    const merged = existing ? { ...item, seq: existing.seq ?? item.seq } : item;
    return [merged, ...prev.filter((current) => current.id !== item.id)];
  });
  deps.setRuntimeFeedItems((prev) => upsertRuntimeFeed(prev, {
    id: `interaction-${requestId}`,
    type: 'action',
    status: 'pending',
    title: item.title,
    message: item.prompt || null,
  }));
}

function markInteractionResult(payload: Record<string, unknown>, deps: AgentStreamHandlerDeps): void {
  const requestId = String(payload.request_id || '');
  if (!requestId) return;
  deps.setInteractionRequests?.((prev) => prev.map((item) => (item.id === requestId ? { ...item, status: 'submitted' } : item)));
  deps.setRuntimeFeedItems((prev) => updateRuntimeFeedStatus(prev, `interaction-${requestId}`, 'success'));
}

/**
 * 将 workflow completed 事件中的最终业务 blocks 写入实时业务卡片状态。
 *
 * @param envelope v2 流式事件信封。
 * @param payload completed 事件载荷。
 * @param deps React 状态更新依赖。
 * @return void
 */
function appendCompletedBusinessCards(envelope: IAgentStreamEnvelopeV2, payload: Record<string, unknown>, deps: AgentStreamHandlerDeps): void {
  if (!Array.isArray(payload.blocks) || !deps.setBusinessCards) return;
  payload.blocks.forEach((block, index) => {
    if (!block || typeof block !== 'object' || Array.isArray(block)) return;
    const blockRecord = block as Record<string, unknown>;
    const cardType = coerceBusinessCardType(blockRecord.type);
    if (!cardType) return;
    const cardPayload = cardType === 'interview_question_set' ? blockRecord.question_set : blockRecord.report;
    if (!cardPayload || typeof cardPayload !== 'object' || Array.isArray(cardPayload)) return;
    const id = `${cardType}-${envelope.run_id}-${index}`;
    deps.setBusinessCards?.((prev) => {
      const existing = prev.find((it) => it.id === id);
      const card: IAgentBusinessCardItem = { id, run_id: envelope.run_id, type: cardType, payload: cardPayload as Record<string, unknown>, seq: existing?.seq ?? nextTimelineSeq() };
      return [card, ...prev.filter((it) => it.id !== id)];
    });
  });
}

function appendBusinessCard(
  envelope: IAgentStreamEnvelopeV2,
  payload: Record<string, unknown>,
  deps: AgentStreamHandlerDeps,
): void {
  const cardType = coerceBusinessCardType(payload.card_type || payload.type);
  if (!cardType || !deps.setBusinessCards) return;
  const id = String(payload.card_id || `${cardType}-${envelope.run_id}-${envelope.seq}`);
  deps.setBusinessCards((prev) => {
    const existing = prev.find((it) => it.id === id);
    const card: IAgentBusinessCardItem = { id, run_id: envelope.run_id, type: cardType, payload, seq: existing?.seq ?? nextTimelineSeq() };
    return [card, ...prev.filter((it) => it.id !== id)];
  });
}

function getV2NodeId(envelope: IAgentStreamEnvelopeV2): string {
  const payloadNodeId = envelope.payload.node_id;
  return String(payloadNodeId || envelope.node_id || 'coordinator');
}

function upsertRuntimeFeed(items: IAgentRuntimeFeedItem[], next: IAgentRuntimeFeedItem): IAgentRuntimeFeedItem[] {
  if (items.some((item) => item.id === next.id)) {
    return items.map((item) => (item.id === next.id ? { ...item, ...next, seq: item.seq ?? next.seq ?? nextTimelineSeq() } : item));
  }
  return [...items, { ...next, seq: next.seq ?? nextTimelineSeq() }];
}

function updateRuntimeFeedStatus(
  items: IAgentRuntimeFeedItem[],
  id: string,
  status: IAgentRuntimeFeedItem['status'],
  message: string | null = null,
): IAgentRuntimeFeedItem[] {
  return items.map((item) => (item.id === id ? { ...item, status, message } : item));
}

function markThinkingFeed(status: IAgentRuntimeFeedItem['status'], deps: AgentStreamHandlerDeps): void {
  if (!deps.enableThinking) return;
  deps.setRuntimeFeedItems((prev) => prev.map((item) => (item.id === `thinking-${deps.streamingMessageId}` ? { ...item, status } : item)));
}

function replaceStreamingMessageContent(content: string, deps: AgentStreamHandlerDeps): void {
  deps.setMessages((prev) => {
    const existing = prev.find((message) => message.id === deps.streamingMessageId);
    if (!existing) {
      return [...prev, createStreamingMessage(deps.streamingMessageId, deps.persistedSession.id, content, prev.length + 1)];
    }
    return prev.map((message) =>
      message.id === deps.streamingMessageId
        ? { ...message, content: { ...message.content, blocks: [{ type: 'text', text: content }] } }
        : message,
    );
  });
}

function buildV2Action(payload: Record<string, unknown>, envelope: IAgentStreamEnvelopeV2): IAgentActionStreamItem {
  const inputPayload = (payload.input_payload as Record<string, unknown>) || {};
  const rawPreviewPayload = (payload.preview_payload as Record<string, unknown>) || {};
  const targetStatus = rawPreviewPayload.target_status ?? rawPreviewPayload.to_status ?? inputPayload.status;
  const targetId = typeof payload.target_id === 'number' ? payload.target_id : Number(payload.target_id || 0) || null;
  return {
    id: String(payload.action_id || `action-${Date.now()}`),
    session_id: envelope.session_id,
    employee_id: 0,
    capability_key: String(payload.capability_key || ''),
    action_name: String(payload.action_name || '待确认操作'),
    target_type: typeof payload.target_type === 'string' ? payload.target_type : null,
    target_id: targetId,
    input_payload: inputPayload,
    preview_payload: {
      ...rawPreviewPayload,
      target_status: typeof targetStatus === 'number' ? targetStatus : Number(targetStatus || 0),
      application: rawPreviewPayload.application || rawPreviewPayload,
    },
    status: 1,
    idempotency_key: String(payload.action_id || ''),
    isStreaming: true,
  };
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
      // 使用函数式更新，保留用户已填写的 feedbackDraft 和 repairSuggestions
      deps.setPlanReview((prev) => ({
        instanceId: String(payload.instance_id || `plan-${parsed.revision}`),
        revision: parsed.revision,
        maxRevisions: parsed.max_revisions ?? (prev?.maxRevisions ?? 3),
        tasks: parsed.tasks,
        editable: parsed.editable !== false,
        repairSuggestions: prev?.repairSuggestions ?? [],
        feedbackDraft: prev?.feedbackDraft ?? '',
        phase: prev?.phase ?? 'pending',
      }));
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
    // lifecycle.interrupt 只是通知前端进入中断状态，不要覆盖用户已填写的内容
    // phase 保持不变，让 ui.render 事件来更新
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
    deps.setRuntimeFeedItems((prev) => {
      const existing = prev.find((item) => item.id === `node-${nodeId}`);
      if (existing) {
        // 更新现有条目
        return prev.map((item) =>
          item.id === `node-${nodeId}`
            ? { ...item, status: success ? 'success' : 'failed' as const }
            : item
        );
      }
      // 如果没有先收到 node_enter，直接创建条目（可能在 node_exit 之前没有 node_enter 事件）
      return [...prev, {
        id: `node-${nodeId}`,
        type: 'node' as const,
        status: success ? 'success' : 'failed' as const,
        title: getNodeDisplayName(nodeId),
        message: null,
      }];
    });
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
