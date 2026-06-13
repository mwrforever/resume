/**
 * AgentWorkspace：消息运行区（瘦身版）
 *
 * 持有 prefilledPrompt 状态：EmptyState 点击卡片 → setPrefilledPrompt(prompt)
 * Composer 消费后调用 onPrefillConsumed 清除。
 * 跨模式新建会话由 onRequestNewSession 触发上层 layout 创建并切换。
 */

import { useState } from 'react';
import { AgentMessageList } from './agent-message-list';
import { AgentComposer } from './agent-composer';
import { useAgentRun } from '@/hooks/use-agent-run';
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
  const { session, patchSession, messages, runState, sending, sendMessage, submit, abort } = useAgentRun(sessionId);
  const [prefilledPrompt, setPrefilledPrompt] = useState<string | null>(null);

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
        onSubmitInteraction={submit}
        onPickPrompt={setPrefilledPrompt}
      />
      <AgentComposer
        session={session}
        sending={sending}
        hasMessages={messages.length > 0}
        prefilledPrompt={prefilledPrompt}
        onPrefillConsumed={() => setPrefilledPrompt(null)}
        onSend={(input) => void sendMessage({ ...input, enable_thinking: session.enable_thinking })}
        onAbort={abort}
        onSessionUpdate={handleSessionUpdate}
        onRequestNewSession={onRequestNewSession}
      />
    </main>
  );
}
