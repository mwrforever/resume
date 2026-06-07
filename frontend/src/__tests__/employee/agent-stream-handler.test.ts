import { describe, it, expect } from 'vitest';
import type { SetStateAction } from 'react';
import type { WorkspaceSession } from '@/components/employee/agent/agent-session-sidebar';
import type {
  IAgentActionStreamItem,
  IAgentMemoryItem,
  IAgentMessageItem,
  IAgentInteractionRequestItem,
  IAgentRuntimeFeedItem,
  IAgentThinkingStreamItem,
  IAgentToolStreamItem,
  IPlanReviewUiState,
} from '@/types/agent';
import { handleAgentStreamEvent, type AgentStreamHandlerDeps } from '@/utils/agent-stream-handler';
import { parseAgentStreamEnvelopeV1, getUiComponentKey, parsePlanReviewTreeData } from '@/utils/agent-stream-v1';
import { parseAgentStreamEnvelopeV2 } from '@/utils/agent-stream-v2';

interface StateBox<T> {
  value: T;
}

function createSetter<T>(box: StateBox<T>) {
  return (next: SetStateAction<T>) => {
    box.value = typeof next === 'function' ? (next as (prev: T) => T)(box.value) : next;
  };
}

function createHandlerDeps() {
  const session: WorkspaceSession = {
    id: 1,
    session_key: 'session-1',
    employee_id: 1,
    title: '测试会话',
    status: 1,
    selected_model_name: null,
    selected_model_source: null,
    context_summary: null,
    last_message_time: null,
    version: 1,
    create_time: null,
    update_time: null,
  };
  const messages: StateBox<IAgentMessageItem[]> = { value: [] };
  const toolEvents: StateBox<IAgentToolStreamItem[]> = { value: [] };
  const runtimeFeedItems: StateBox<IAgentRuntimeFeedItem[]> = { value: [] };
  const actions: StateBox<IAgentActionStreamItem[]> = { value: [] };
  const planReview: StateBox<IPlanReviewUiState | null> = { value: null };
  const memories: StateBox<IAgentMemoryItem[]> = { value: [] };
  const deps: AgentStreamHandlerDeps = {
    streamingMessageId: -1,
    persistedSession: session,
    oldSessionId: -1,
    enableThinking: true,
    setMessages: createSetter(messages),
    setToolEvents: createSetter(toolEvents),
    setRuntimeFeedItems: createSetter(runtimeFeedItems),
    setActions: createSetter(actions),
    setPlanReview: createSetter(planReview),
    replaceSession: () => undefined,
    setMemories: createSetter(memories),
  };
  return { deps, messages, toolEvents, runtimeFeedItems, actions, planReview };
}

describe('agent-stream-v1', () => {
  describe('parseAgentStreamEnvelopeV1', () => {
    it('should parse valid v1 envelope', () => {
      const data = {
        protocol_version: '1.0',
        seq: 1,
        event_type: 'lifecycle.node_enter',
        payload: { node_id: 'analyst' },
      };
      const result = parseAgentStreamEnvelopeV1(data);
      expect(result).not.toBeNull();
      expect(result?.event_type).toBe('lifecycle.node_enter');
    });

    it('should return null for invalid version', () => {
      const data = { protocol_version: '2.0', seq: 1, event_type: 'test', payload: {} };
      const result = parseAgentStreamEnvelopeV1(data);
      expect(result).toBeNull();
    });

    it('should return null for missing seq', () => {
      const data = { protocol_version: '1.0', event_type: 'test', payload: {} };
      const result = parseAgentStreamEnvelopeV1(data);
      expect(result).toBeNull();
    });
  });

  describe('getUiComponentKey', () => {
    it('should return PlanReviewTree for PlanReviewTree key', () => {
      const result = getUiComponentKey({ component_key: 'PlanReviewTree' });
      expect(result).toBe('PlanReviewTree');
    });

    it('should return PlanRepairHints for PlanRepairHints key', () => {
      const result = getUiComponentKey({ component_key: 'PlanRepairHints' });
      expect(result).toBe('PlanRepairHints');
    });

    it('should return ActionConfirmCard for ActionConfirmCard key', () => {
      const result = getUiComponentKey({ component_key: 'ActionConfirmCard' });
      expect(result).toBe('ActionConfirmCard');
    });

    it('should return null for unknown key', () => {
      const result = getUiComponentKey({ component_key: 'Unknown' });
      expect(result).toBeNull();
    });

    it('should return null for AgentStatusTimeline key (not in allowlist)', () => {
      const result = getUiComponentKey({ component_key: 'AgentStatusTimeline' });
      expect(result).toBeNull();
    });
  });

  describe('parsePlanReviewTreeData', () => {
    it('should parse valid plan review data', () => {
      const data = {
        revision: 1,
        max_revisions: 3,
        tasks: [
          { task_id: 't1', domain: 'job', title: '任务1', instruction: '执行任务1' },
          { task_id: 't2', domain: 'application', title: '任务2', instruction: '执行任务2' },
        ],
      };
      const result = parsePlanReviewTreeData(data);
      expect(result).not.toBeNull();
      expect(result?.revision).toBe(1);
      expect(result?.tasks.length).toBe(2);
    });

    it('should return null for empty tasks', () => {
      const data = { revision: 1, tasks: [] };
      const result = parsePlanReviewTreeData(data);
      expect(result).toBeNull();
    });

    it('should return null for missing tasks', () => {
      const data = { revision: 1 };
      const result = parsePlanReviewTreeData(data);
      expect(result).toBeNull();
    });
  });
});

describe('agent-stream-v2', () => {
  it('should parse valid v2 envelope', () => {
    const result = parseAgentStreamEnvelopeV2({
      schema_version: '2.0',
      seq: 1,
      run_id: 'run-1',
      session_id: 1,
      node_id: 'coordinator',
      event: 'message.delta',
      payload: { message_id: 'msg-1', delta: '你好' },
      ts: 1,
    });

    expect(result).not.toBeNull();
    expect(result?.event).toBe('message.delta');
  });

  it('should parse workflow metadata and display name from v2 envelope', () => {
    const result = parseAgentStreamEnvelopeV2({
      schema_version: '2.0',
      seq: 1,
      run_id: 'run-1',
      session_id: 1,
      workflow_type: 'interview_questions',
      node_id: 'dimension_selection',
      display_name: '选择面试维度',
      event: 'interaction_request',
      payload: { request_id: 'req-1', interaction_type: 'dimension_selection', title: '选择面试维度', prompt: '', data: {} },
      ts: 1,
    });

    expect(result?.workflow_type).toBe('interview_questions');
    expect(result?.display_name).toBe('选择面试维度');
  });
  it('should append v2 message delta into the streaming message', () => {
    const { deps, messages } = createHandlerDeps();

    handleAgentStreamEvent({
      event: 'agent',
      data: {
        schema_version: '2.0',
        seq: 1,
        run_id: 'run-1',
        session_id: 1,
        node_id: 'coordinator',
        event: 'message.delta',
        payload: { message_id: 'msg-1', delta: '你好' },
        ts: 1,
      },
    }, deps);

    expect(messages.value).toHaveLength(1);
    expect(messages.value[0].content.blocks[0].text).toBe('你好');
  });

  it('should map v2 node, tool and action events into workspace state', () => {
    const { deps, runtimeFeedItems, toolEvents, actions } = createHandlerDeps();
    const baseEnvelope = {
      schema_version: '2.0',
      run_id: 'run-1',
      session_id: 1,
      node_id: 'application_agent',
      ts: 1,
    };

    handleAgentStreamEvent({ event: 'agent', data: { ...baseEnvelope, seq: 1, event: 'lifecycle.node.enter', payload: { node_id: 'application_agent' } } }, deps);
    handleAgentStreamEvent({ event: 'agent', data: { ...baseEnvelope, seq: 2, event: 'tool.started', payload: { call_id: 'call-1', tool_name: 'propose_application_status_update', display_name: '投递状态变更' } } }, deps);
    handleAgentStreamEvent({ event: 'agent', data: { ...baseEnvelope, seq: 3, event: 'tool.finished', payload: { call_id: 'call-1', tool_name: 'propose_application_status_update', display_name: '投递状态变更', success: true, output_payload: { status: 'pending' } } } }, deps);
    handleAgentStreamEvent({
      event: 'agent',
      data: {
        ...baseEnvelope,
        seq: 4,
        event: 'action.requested',
        payload: {
          action_id: 'action-1',
          capability_key: 'application.update_status',
          action_name: '更新投递状态',
          target_type: 'application',
          target_id: 10,
          input_payload: { application_id: 10, status: 3 },
          preview_payload: { user_name: '张三', job_name: '前端工程师', to_status: 3 },
        },
      },
    }, deps);

    expect(runtimeFeedItems.value.some((item) => item.id === 'node-application_agent' && item.status === 'running')).toBe(true);
    expect(runtimeFeedItems.value.some((item) => item.id === 'tool-call-1' && item.status === 'success')).toBe(true);
    expect(toolEvents.value).toHaveLength(2);
    expect(actions.value[0].id).toBe('action-1');
    expect(actions.value[0].status).toBe(1);
    expect(actions.value[0].preview_payload.target_status).toBe(3);
  });
});


describe('agent compact workflow events', () => {
  it('keeps thinking_stream separate from message text', () => {
    const { deps, messages } = createHandlerDeps();
    const thinkingItems: StateBox<IAgentThinkingStreamItem[]> = { value: [] };
    deps.setThinkingItems = createSetter(thinkingItems);

    handleAgentStreamEvent({
      event: 'agent',
      data: {
        schema_version: '2.0',
        seq: 1,
        run_id: 'run-1',
        session_id: 1,
        node_id: 'interview_questions',
        event: 'thinking_stream',
        payload: { message_id: 'think-1', delta: '内部思考' },
        ts: 1,
      },
    }, deps);

    expect(messages.value).toHaveLength(0);
    expect(thinkingItems.value[0].content).toBe('内部思考');
  });

  it('stores interaction_request as a pending interaction item', () => {
    const { deps } = createHandlerDeps();
    const interactionRequests: StateBox<IAgentInteractionRequestItem[]> = { value: [] };
    deps.setInteractionRequests = createSetter(interactionRequests);

    handleAgentStreamEvent({
      event: 'agent',
      data: {
        schema_version: '2.0',
        seq: 1,
        run_id: 'run-1',
        session_id: 1,
        node_id: 'dimension_selection',
        event: 'interaction_request',
        payload: {
          request_id: 'req-1',
          interaction_type: 'dimension_selection',
          title: '请选择面试重点',
          prompt: '选择维度',
          data: { dimensions: [{ name: '项目深度' }] },
          submit_label: '确认选择',
        },
        ts: 1,
      },
    }, deps);

    expect(interactionRequests.value[0]).toMatchObject({
      id: 'req-1',
      run_id: 'run-1',
      interaction_type: 'dimension_selection',
      status: 'pending',
    });
  });
});
