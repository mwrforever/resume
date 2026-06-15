/**
 * useAgentRun：以单一 hook 把流式 + 历史封装为前端唯一对外入口。
 *
 * 薄封装：所有运行态已上提到 useAgentStore（支持多会话并发），
 * 本 hook 仅从 store 按 sessionId 读取并绑定 store action，mount 时 ensureLoaded。
 * 保持返回签名与旧版一致，上层 agent-workspace.tsx 几乎不动。
 *
 * 调用者只需 .sendMessage / .submit / .abort / .patchSession / .reload；
 * 同时拿到 messages 列表与 runState（流式正在构造的临时 blocks）。
 */

import { useEffect } from 'react';
import { useAgentStore } from '@/store/agent';
import type { SendInput } from '@/store/agent';
import { INITIAL_RUN_STATE } from '@/utils/agent-run-reducer';
import type { AgentMessage, WorkflowType, WorkspaceSession } from '@/types/agent';

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

export type { SendInput };

/**
 * Agent Run hook（store 薄封装）。
 *
 * @param sessionId - 会话 ID
 * @param onSessionUpdate - 可选回调：会话字段被乐观更新时（如标题）同步给上层。
 *                          现已由 store 统一管理 sessions，该回调保留兼容但不再必需。
 * @returns 流式运行控制接口 + 实时状态
 */
export function useAgentRun(
  sessionId: number,
  _onSessionUpdate?: (next: WorkspaceSession) => void,
): UseAgentRunResult {
  // 按 sessionId 订阅对应会话运行态（未加载时给空默认，避免 undefined）
  const run = useAgentStore((s) => s.runs[sessionId]);
  const sendMessage = useAgentStore((s) => s.sendMessage);
  const submitInteraction = useAgentStore((s) => s.submitInteraction);
  const abortAll = useAgentStore((s) => s.abort);
  const updateSession = useAgentStore((s) => s.updateSession);
  const ensureLoaded = useAgentStore((s) => s.ensureLoaded);

  // mount / sessionId 切换时拉取会话详情（已 loaded 则跳过）
  useEffect(() => {
    void ensureLoaded(sessionId);
  }, [sessionId, ensureLoaded]);

  const session = run?.session ?? null;
  const messages = run?.messages ?? EMPTY_MESSAGES;
  const runState = run?.runState ?? INITIAL_RUN_STATE;
  const sending = run?.sending ?? false;

  return {
    session,
    patchSession: (patch) => updateSession({ ...patch, id: sessionId }),
    messages,
    runState,
    sending,
    sendMessage: (input) => sendMessage(sessionId, input),
    submit: (requestId, values) => submitInteraction(sessionId, requestId, values),
    reload: () => ensureLoaded(sessionId),
    abort: () => abortAll(sessionId),
  };
}

/** 仅用于类型兼容导出（旧 import 路径） */
export type { WorkflowType };

/** 空数组单例：run 未加载时返回稳定引用，避免下游 useEffect 因新数组引用误触发 */
const EMPTY_MESSAGES: AgentMessage[] = [];
