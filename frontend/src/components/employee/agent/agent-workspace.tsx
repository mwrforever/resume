/**
 * AgentWorkspace：消息运行区（瘦身版）
 *
 * 持有 prefilledPrompt 状态：EmptyState 点击卡片 → setPrefilledPrompt(prompt)
 * Composer 消费后调用 onPrefillConsumed 清除。
 * 跨模式新建会话由 onRequestNewSession 触发上层 layout 创建并切换。
 */

import { useCallback, useRef, useState } from 'react';
import { AgentMessageList } from './agent-message-list';
import { AgentComposer } from './agent-composer';
import { useAgentRun } from '@/hooks/use-agent-run';
import type { SendInput } from '@/hooks/use-agent-run';
import type { WorkflowType, WorkspaceSession } from '@/types/agent';

export interface AgentWorkspaceProps {
  sessionId: number | null;
  onSessionUpdate: (s: WorkspaceSession) => void;
  onRequestNewSession: (workflow: WorkflowType) => Promise<void>;
}

export function AgentWorkspace({ sessionId, onSessionUpdate, onRequestNewSession }: AgentWorkspaceProps) {
  if (sessionId === null) {
    return (
      <main className="flex-1 flex items-center justify-center text-sm text-[#94A3B8]">
        请选择或创建会话
      </main>
    );
  }
  return (
    <WorkspaceInner
      key={sessionId}
      sessionId={sessionId}
      onSessionUpdate={onSessionUpdate}
      onRequestNewSession={onRequestNewSession}
    />
  );
}

/** 主内容区：消息列表 + 输入框 */
function WorkspaceInner({
  sessionId,
  onSessionUpdate,
  onRequestNewSession,
}: {
  sessionId: number;
  onSessionUpdate: (s: WorkspaceSession) => void;
  onRequestNewSession: (workflow: WorkflowType) => Promise<void>;
}) {
  // 标题乐观更新回调：sendMessage 时由 hook 触发，同步到侧边栏 sessions 列表
  // （hook 内已 patchSession 更新本地 session，这里只负责同步上层 sessions）
  // 必须在 useAgentRun 之前用 useCallback 定义，避免 TDZ 与无限依赖
  const handleOptimisticSession = useCallback((next: WorkspaceSession) => {
    onSessionUpdate(next);
  }, [onSessionUpdate]);
  const { session, patchSession, messages, runState, sending, sendMessage, submit, abort } = useAgentRun(sessionId, handleOptimisticSession);
  const [prefilledPrompt, setPrefilledPrompt] = useState<string | null>(null);
  // 记录最近一次发送入参，供错误态"重试"复用
  const lastInputRef = useRef<SendInput | null>(null);

  // 发送时缓存入参，供错误态"重试"复用
  const handleSend = useCallback((input: SendInput) => {
    lastInputRef.current = input;
    void sendMessage(input);
  }, [sendMessage]);

  // 重试 = 重新发送最近一条用户消息
  const handleRetry = useCallback(() => {
    if (lastInputRef.current) void sendMessage(lastInputRef.current);
  }, [sendMessage]);

  // ⚠️ 所有 hooks 必须在任何 early return 之前调用完毕，
  // 否则 session null→非 null 切换时 hook 调用顺序变化会触发 React 报错。

  if (!session) {
    return (
      <main className="flex-1 flex items-center justify-center text-sm text-[#64748B]">
        加载中…（第 {sessionId} 号会话）
      </main>
    );
  }

  // 同时同步上层 sessions 数组与 hook 内 session（hook 内的才是 Composer 的渲染源）
  const handleSessionUpdate = (next: WorkspaceSession) => {
    patchSession(next);
    onSessionUpdate(next);
  };

  return (
    <main className="flex-1 flex flex-col min-w-0">
      <AgentMessageList
        messages={messages}
        runState={runState}
        sending={sending}
        onSubmitInteraction={submit}
        onPickPrompt={setPrefilledPrompt}
        onRetry={handleRetry}
      />
      <AgentComposer
        session={session}
        sending={sending}
        hasMessages={messages.length > 0}
        lastWorkflow={messages.length > 0 ? messages[messages.length - 1].workflow_type : 'interview_questions'}
        prefilledPrompt={prefilledPrompt}
        onPrefillConsumed={() => setPrefilledPrompt(null)}
        onSend={(input) => handleSend({ ...input, enable_thinking: session.enable_thinking })}
        onAbort={abort}
        onSessionUpdate={handleSessionUpdate}
        onRequestNewSession={onRequestNewSession}
      />
    </main>
  );
}
