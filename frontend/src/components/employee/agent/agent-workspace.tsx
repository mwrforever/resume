/**
 * AgentWorkspace：三栏布局组合（sidebar + message-list + composer）。
 */

import { useCallback, useEffect, useState } from 'react';
import { AgentSessionSidebar } from './agent-session-sidebar';
import { AgentMessageList } from './agent-message-list';
import { AgentComposer } from './agent-composer';
import { useAgentRun } from '@/hooks/use-agent-run';
import { employeeAgentApi } from '@/api/employee/agent';
import type { WorkspaceSession } from '@/types/agent';

export function AgentWorkspace() {
  const [sessions, setSessions] = useState<WorkspaceSession[]>([]);
  const [activeId, setActiveId] = useState<number | null>(null);
  const [keyword, setKeyword] = useState('');

  /** 刷新会话列表 */
  const refreshSessions = useCallback(async () => {
    const resp = await employeeAgentApi.listSessions({
      page: 1, page_size: 50, keyword: keyword || undefined,
    });
    const data = resp.data?.data ?? resp.data;
    const items = (data?.items ?? []) as WorkspaceSession[];
    setSessions(items);
    if (activeId === null && items.length) setActiveId(items[0].id);
  }, [keyword, activeId]);

  useEffect(() => { void refreshSessions(); }, [refreshSessions]);

  /** 创建新会话 */
  const onCreate = async () => {
    const resp = await employeeAgentApi.createSession({ title: undefined });
    const s = (resp.data?.data ?? resp.data) as WorkspaceSession;
    setSessions(prev => [s, ...prev]);
    setActiveId(s.id);
  };

  return (
    <div className="flex h-screen bg-gray-50">
      <AgentSessionSidebar
        sessions={sessions} activeId={activeId}
        onSelect={setActiveId} onCreate={() => void onCreate()} onSearch={setKeyword}
      />
      <main className="flex-1 flex flex-col">
        {activeId !== null ? (
          <WorkspaceMain
            sessionId={activeId}
            onSessionUpdate={(next) => {
              setSessions(prev => prev.map(s => s.id === next.id ? next : s));
            }}
          />
        ) : (
          <div className="flex-1 flex items-center justify-center text-gray-400">
            请选择或创建会话
          </div>
        )}
      </main>
    </div>
  );
}

/** 主内容区：消息列表 + 输入框 */
function WorkspaceMain({
  sessionId,
  onSessionUpdate,
}: {
  sessionId: number;
  onSessionUpdate: (s: WorkspaceSession) => void;
}) {
  const { session, messages, runState, sending, sendMessage, submit, abort } = useAgentRun(sessionId);

  if (!session) {
    return (
      <div className="flex-1 flex items-center justify-center text-gray-400">加载中…</div>
    );
  }

  return (
    <>
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
    </>
  );
}
