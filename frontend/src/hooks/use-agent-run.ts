/**
 * useAgentRun：以单一 hook 把流式 + 历史封装为前端唯一对外入口。
 *
 * 调用者只需 .sendMessage / .submitInteraction / .reload；
 * 同时拿到 messages 列表与 runState（流式正在构造的临时 blocks）。
 */

import { useCallback, useEffect, useReducer, useRef, useState } from 'react';
import { employeeAgentApi } from '@/api/employee/agent';
import { INITIAL_RUN_STATE, agentRunReducer } from '@/utils/agent-run-reducer';
import { isDefaultTitle, makeTitleFromContent } from '@/utils/title';
import type {
  AgentEnvelope, AgentMessage, WorkflowType, WorkspaceSession,
} from '@/types/agent';

/** hook 返回值 */
export interface UseAgentRunResult {
  session: WorkspaceSession | null;
  /** 局部更新会话（如切换模型/思考开关），不触发后端重新拉取 */
  patchSession: (patch: Partial<WorkspaceSession>) => void;
  messages: AgentMessage[];
  runState: typeof INITIAL_RUN_STATE;
  sending: boolean;
  sendMessage: (input: SendInput) => Promise<void>;
  submit: (requestId: string, values: Record<string, unknown>) => Promise<void>;
  reload: () => Promise<void>;
  abort: () => void;
}

/** sendMessage 输入参数 */
export interface SendInput {
  content: string;
  workflow_type: WorkflowType;
  enable_thinking?: boolean;
  context_refs?: Array<Record<string, unknown>>;
}

/**
 * Agent Run hook。
 *
 * @param sessionId - 会话 ID
 * @param onSessionUpdate - 可选回调：会话字段被乐观更新时（如标题）同步给上层
 *                          侧边栏列表，避免等待 run.finish 后 reload
 * @returns 流式运行控制接口 + 实时状态
 */
export function useAgentRun(
  sessionId: number,
  onSessionUpdate?: (next: WorkspaceSession) => void,
): UseAgentRunResult {
  const [session, setSession] = useState<WorkspaceSession | null>(null);
  const [messages, setMessages] = useState<AgentMessage[]>([]);
  const [runState, dispatch] = useReducer(agentRunReducer, INITIAL_RUN_STATE);
  const [sending, setSending] = useState(false);
  const abortRef = useRef<AbortController | null>(null);

  /** 重新加载会话详情（含消息列表） */
  const reload = useCallback(async () => {
    const resp = await employeeAgentApi.getSession(sessionId);
    const detail = resp.data?.data ?? resp.data;
    if (detail?.session) {
      setSession(detail.session);
      setMessages(detail.messages ?? []);
    }
  }, [sessionId]);

  useEffect(() => {
    void reload();
  }, [reload]);

  /** 消费 envelope 迭代器，dispatch 到 reducer */
  const runEnvelopes = useCallback(async (
    iter: AsyncIterableIterator<AgentEnvelope>,
  ) => {
    // run.finish 不立即 dispatch：先 reload 拿到落库后的 agent 消息，
    // 再紧随其后 dispatch run.finish 清空 current_blocks。这两步都处于
    // await reload() 返回后的同一微任务延续中，React 18 会自动批处理
    // setMessages + dispatch，单帧完成"RunRow → 新消息"的对调，避免
    // 出现 RunRow 已消失但新消息还没到的留白闪烁。
    let pendingFinish: AgentEnvelope | null = null;
    for await (const env of iter) {
      if (env.type === 'run.finish') {
        pendingFinish = env;
        continue;
      }
      dispatch(env);
    }
    if (pendingFinish) {
      await reload();
      dispatch(pendingFinish);
    }
  }, [reload]);

  /** 发送消息并启动流式 run */
  const sendMessage = useCallback(async (input: SendInput) => {
    abortRef.current?.abort();
    const ac = new AbortController();
    abortRef.current = ac;
    setSending(true);
    // 乐观追加用户消息：发送后立即在 UI 中展示，无需等待后端 run.finish 后 reload
    // 使用负数临时 id 作占位（后端真实 id 在 reload 后会替换整段消息列表）
    const optimisticUserMessage: AgentMessage = {
      id: -Date.now(),
      session_id: sessionId,
      parent_message_id: null,
      role: 'user',
      workflow_type: input.workflow_type,
      run_id: null,
      content: { blocks: [{ type: 'text', index: 0, text: input.content, status: 'success' }] },
      model_name: null,
      token_count: null,
      sort_order: 0,
      create_time: new Date().toISOString(),
    };
    setMessages(prev => [...prev, optimisticUserMessage]);
    // 标题乐观更新：首条消息时若会话仍是默认空标题，本地算标题立即更新
    // 让 Composer/Topbar/侧边栏同步显示，无需等待 run.finish 后 reload
    setSession(prev => {
      if (!prev) return prev;
      if (!isDefaultTitle(prev.title)) return prev;
      const optimisticTitle = makeTitleFromContent(input.content);
      if (!optimisticTitle) return prev;
      const next = { ...prev, title: optimisticTitle };
      onSessionUpdate?.(next);
      return next;
    });
    try {
      const iter = employeeAgentApi.streamMessage(
        sessionId,
        {
          content: input.content,
          workflow_type: input.workflow_type,
          context_refs: input.context_refs,
          runtime_options: input.enable_thinking !== undefined
            ? { enable_thinking: input.enable_thinking } : undefined,
        },
        ac.signal,
      );
      await runEnvelopes(iter);
    } finally {
      setSending(false);
    }
  }, [sessionId, runEnvelopes, onSessionUpdate]);

  /** 提交 interaction 卡片 */
  const submit = useCallback(async (requestId: string, values: Record<string, unknown>) => {
    abortRef.current?.abort();
    const ac = new AbortController();
    abortRef.current = ac;
    setSending(true);
    try {
      const iter = employeeAgentApi.submitInteraction(sessionId, requestId, values, ac.signal);
      await runEnvelopes(iter);
    } finally {
      setSending(false);
    }
  }, [sessionId, runEnvelopes]);

  /** 中止当前流式 run */
  const abort = useCallback(() => {
    abortRef.current?.abort();
  }, []);

  /** 局部更新会话字段（用于切换模型/思考开关后立刻反映到 UI） */
  const patchSession = useCallback((patch: Partial<WorkspaceSession>) => {
    setSession(prev => (prev ? { ...prev, ...patch } : prev));
  }, []);

  // sessionId 切换时 abort 旧流
  useEffect(() => {
    return () => {
      abortRef.current?.abort();
    };
  }, [sessionId]);

  return { session, patchSession, messages, runState, sending, sendMessage, submit, reload, abort };
}
