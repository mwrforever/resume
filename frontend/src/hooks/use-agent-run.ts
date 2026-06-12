/**
 * useAgentRun：以单一 hook 把流式 + 历史封装为前端唯一对外入口。
 *
 * 调用者只需 .sendMessage / .submitInteraction / .reload；
 * 同时拿到 messages 列表与 runState（流式正在构造的临时 blocks）。
 */

import { useCallback, useEffect, useReducer, useRef, useState } from 'react';
import { employeeAgentApi } from '@/api/employee/agent';
import { INITIAL_RUN_STATE, agentRunReducer } from '@/utils/agent-run-reducer';
import type {
  AgentEnvelope, AgentMessage, WorkflowType, WorkspaceSession,
} from '@/types/agent';

/** hook 返回值 */
export interface UseAgentRunResult {
  session: WorkspaceSession | null;
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
 * @returns 流式运行控制接口 + 实时状态
 */
export function useAgentRun(sessionId: number): UseAgentRunResult {
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
    let lastMessageId: number | null = null;
    for await (const env of iter) {
      dispatch(env);
      if (env.type === 'run.finish') {
        lastMessageId = env.data.agent_message_id;
      }
    }
    // 落库完成后从后端拉取最新消息列表
    if (lastMessageId !== null) {
      await reload();
    }
  }, [reload]);

  /** 发送消息并启动流式 run */
  const sendMessage = useCallback(async (input: SendInput) => {
    abortRef.current?.abort();
    const ac = new AbortController();
    abortRef.current = ac;
    setSending(true);
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
  }, [sessionId, runEnvelopes]);

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

  // sessionId 切换时 abort 旧流
  useEffect(() => {
    return () => {
      abortRef.current?.abort();
    };
  }, [sessionId]);

  return { session, messages, runState, sending, sendMessage, submit, reload, abort };
}
