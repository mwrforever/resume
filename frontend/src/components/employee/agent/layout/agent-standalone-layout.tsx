/**
 * AgentStandaloneLayout：独立布局容器
 *
 * 状态管理已上提到 useAgentStore（单一数据源）：会话列表、激活 ID、每会话运行态。
 * 本层只做：初次加载 sessions、渲染 Topbar/Sidebar/Workspace、delegate 搜索（带防抖）。
 * 会话新建/删除/重命名均由 store 处理。
 */

import { useEffect, useState } from 'react';
import { AgentTopbar } from './agent-topbar';
import { AgentSidebarDrawer } from './agent-sidebar-drawer';
import { AgentWorkspace } from '../agent-workspace';
import { useAgentStore } from '@/store/agent';
import type { WorkspaceSession } from '@/types/agent';

export function AgentStandaloneLayout() {
  const sessions = useAgentStore((s) => s.sessions);
  const activeId = useAgentStore((s) => s.activeId);
  const refreshSessions = useAgentStore((s) => s.refreshSessions);
  const setActive = useAgentStore((s) => s.setActive);
  const createSession = useAgentStore((s) => s.createSession);
  const [keyword, setKeyword] = useState('');
  const [debouncedKeyword, setDebouncedKeyword] = useState('');

  const activeSession = sessions.find(s => s.id === activeId) ?? null;

  // 输入值 300ms 防抖后再触发后端搜索，减少连续输入时的无效请求
  useEffect(() => {
    const t = setTimeout(() => setDebouncedKeyword(keyword), 300);
    return () => clearTimeout(t);
  }, [keyword]);

  useEffect(() => { void refreshSessions(debouncedKeyword); }, [refreshSessions, debouncedKeyword]);

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
      <AgentTopbar
        session={activeSession}
        onRename={(title) =>
          activeSession
            ? useAgentStore.getState().renameSession(activeSession.id, title)
            : Promise.resolve()
        }
      />
      <div className="flex flex-1 overflow-hidden">
        <AgentSidebarDrawer
          sessions={sessions}
          activeId={activeId}
          onSelect={setActive}
          onCreate={() => void createSession()}
          onSearch={setKeyword}
          onRename={(id, title) => useAgentStore.getState().renameSession(id, title)}
          onDelete={(id) => useAgentStore.getState().deleteSession(id)}
        />
        <AgentWorkspace
          sessionId={activeId}
          onSessionUpdate={onSessionUpdate}
        />
      </div>
    </div>
  );
}
