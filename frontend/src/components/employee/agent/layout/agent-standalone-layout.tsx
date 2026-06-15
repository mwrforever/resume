/**
 * AgentStandaloneLayout：独立布局容器
 *
 * 状态管理已上提到 useAgentStore（单一数据源）：会话列表、激活 ID、每会话运行态。
 * 本层只做：初次加载 sessions、渲染 Topbar/Sidebar/Workspace、delegate 搜索。
 * 跨模式新建会话由 store.createSession 处理。
 */

import { useCallback, useEffect, useState } from 'react';
import { AgentTopbar } from './agent-topbar';
import { AgentSidebarDrawer } from './agent-sidebar-drawer';
import { AgentWorkspace } from '../agent-workspace';
import { useAgentStore } from '@/store/agent';
import type { WorkflowType, WorkspaceSession } from '@/types/agent';

export function AgentStandaloneLayout() {
  const sessions = useAgentStore((s) => s.sessions);
  const activeId = useAgentStore((s) => s.activeId);
  const refreshSessions = useAgentStore((s) => s.refreshSessions);
  const setActive = useAgentStore((s) => s.setActive);
  const createSession = useAgentStore((s) => s.createSession);
  const [keyword, setKeyword] = useState('');

  const activeSession = sessions.find(s => s.id === activeId) ?? null;

  useEffect(() => { void refreshSessions(keyword); }, [refreshSessions, keyword]);

  // 跨模式切换专用：创建新会话并切到该会话（workflow 仅作语义记录，会话本身不绑定 workflow）
  const onRequestNewSession = useCallback(async (_workflow: WorkflowType) => {
    await createSession();
  }, [createSession]);

  // Tab 标题
  useEffect(() => {
    document.title = activeSession?.title
      ? `${activeSession.title} · HR·Agent`
      : 'HR·Agent';
  }, [activeSession]);

  // onSessionUpdate：Composer 等组件的局部更新走 store.updateSession（同步 sessions 与 runs）
  const onSessionUpdate = (next: WorkspaceSession) => {
    useAgentStore.getState().updateSession({ ...next, id: next.id });
  };

  return (
    <div className="h-screen flex flex-col bg-[#F8FAFC] font-['Plus_Jakarta_Sans',system-ui,sans-serif]">
      <AgentTopbar session={activeSession} />
      <div className="flex flex-1 overflow-hidden">
        <AgentSidebarDrawer
          sessions={sessions}
          activeId={activeId}
          onSelect={setActive}
          onCreate={() => void createSession()}
          onSearch={setKeyword}
        />
        <AgentWorkspace
          sessionId={activeId}
          onSessionUpdate={onSessionUpdate}
          onRequestNewSession={onRequestNewSession}
        />
      </div>
    </div>
  );
}
