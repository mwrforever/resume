/**
 * AgentWorkspace：消息运行区（瘦身版）
 *
 * session 管理已上提到 AgentStandaloneLayout。
 * 本组件只接收 sessionId 和 onSessionUpdate。
 */

import { AgentMessageList } from './agent-message-list';
import { AgentComposer } from './agent-composer';
import { useAgentRun } from '@/hooks/use-agent-run';
import type { WorkspaceSession } from '@/types/agent';

export interface AgentWorkspaceProps {
  sessionId: number | null;
  onSessionUpdate: (s: WorkspaceSession) => void;
}

export function AgentWorkspace({ sessionId, onSessionUpdate }: AgentWorkspaceProps) {
  if (sessionId === null) {
    return (
      <main className="flex-1 flex items-center justify-center text-sm text-[#94A3B8]">
        请选择或创建会话
      </main>
    );
  }
  return <WorkspaceInner sessionId={sessionId} onSessionUpdate={onSessionUpdate} />;
}

/** 主内容区：消息列表 + 输入框 */
function WorkspaceInner({
  sessionId,
  onSessionUpdate,
}: {
  sessionId: number;
  onSessionUpdate: (s: WorkspaceSession) => void;
}) {
  const { session, messages, runState, sending, sendMessage, submit, abort } = useAgentRun(sessionId);

  if (!session) {
    return (
      <main className="flex-1 flex items-center justify-center text-sm text-[#64748B]">
        加载中…（第 {sessionId} 号会话）
      </main>
    );
  }

  return (
    <main className="flex-1 flex flex-col min-w-0">
      <AgentMessageList
        messages={messages}
        runState={runState}
        onSubmitInteraction={submit}
      />
      <AgentComposer
        session={session}
        sending={sending}
        onSend={(input) => void sendMessage({ ...input, enable_thinking: session.enable_thinking })}
        onAbort={abort}
        onSessionUpdate={onSessionUpdate}
      />
    </main>
  );
}
