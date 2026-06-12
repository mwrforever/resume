/**
 * AgentStandaloneLayout：独立布局容器
 *
 * 状态管理：会话列表、激活 ID、关键词由本层保持。
 * 负责与 employeeAgentApi 通信拉取/创建会话。
 * 通过 props 向下分发给 TopBar / Sidebar / Workspace。
 */

import { useCallback, useEffect, useState } from 'react';
import { AgentTopbar } from './agent-topbar';
import { AgentSidebarDrawer } from './agent-sidebar-drawer';
import { AgentWorkspace } from '../agent-workspace';
import { employeeAgentApi } from '@/api/employee/agent';
import type { WorkspaceSession } from '@/types/agent';

export function AgentStandaloneLayout() {
  const [sessions, setSessions] = useState<WorkspaceSession[]>([]);
  const [activeId, setActiveId] = useState<number | null>(null);
  const [keyword, setKeyword] = useState('');

  const activeSession = sessions.find(s => s.id === activeId) ?? null;

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

  const onCreate = async () => {
    const resp = await employeeAgentApi.createSession({ title: undefined });
    const s = (resp.data?.data ?? resp.data) as WorkspaceSession;
    setSessions(prev => [s, ...prev]);
    setActiveId(s.id);
  };

  // Tab 标题
  useEffect(() => {
    document.title = activeSession?.title
      ? `${activeSession.title} · HR·Agent`
      : 'HR·Agent';
  }, [activeSession]);

  return (
    <div className="h-screen flex flex-col bg-[#F8FAFC] font-['Plus_Jakarta_Sans',system-ui,sans-serif]">
      <AgentTopbar session={activeSession} />
      <div className="flex flex-1 overflow-hidden">
        <AgentSidebarDrawer
          sessions={sessions}
          activeId={activeId}
          onSelect={setActiveId}
          onCreate={() => void onCreate()}
          onSearch={setKeyword}
        />
        <AgentWorkspace
          sessionId={activeId}
          onSessionUpdate={(next) => {
            setSessions(prev => prev.map(s => s.id === next.id ? next : s));
          }}
        />
      </div>
    </div>
  );
}
