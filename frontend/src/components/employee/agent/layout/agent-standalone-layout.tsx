/**
 * AgentStandaloneLayout：独立布局容器
 *
 * 状态管理已上提到 useAgentStore（单一数据源）：会话列表、激活 ID、每会话运行态。
 * 本层只做：初次加载 sessions、自动新建空会话（进入即空态页）、
 * 渲染 Topbar/Sidebar/Workspace，以及统一管理重命名/搜索弹窗。
 *
 * 会话新建/删除/重命名均由 store 处理；搜索改为弹窗分页（侧栏不再内联搜索）。
 */

import { useEffect, useRef } from 'react';
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

  const activeSession = sessions.find(s => s.id === activeId) ?? null;

  // 首次加载会话列表（仅一次，搜索已改为弹窗内独立请求，这里不再轮询/防抖）
  useEffect(() => {
    void refreshSessions();
  }, [refreshSessions]);

  // 进入工作台默认打开「新建会话页」：
  // sessions 加载完成后，若无激活会话（首次进入 / 无历史会话），自动新建一个空虚拟会话。
  // 用 ref 防重复触发，避免每次 sessions 变化都新建。
  const didAutoCreate = useRef(false);
  useEffect(() => {
    if (didAutoCreate.current) return;
    // sessions 已至少加载过一次（非初始空数组也允许，避免无会话用户卡住）
    if (activeId === null) {
      didAutoCreate.current = true;
      void createSession();
    }
  }, [activeId, createSession]);

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
    <div
      className="h-screen flex flex-col font-['Plus_Jakarta_Sans',system-ui,sans-serif]
                 bg-[#F8FAFC]
                 bg-[radial-gradient(120%_60%_at_50%_-10%,rgba(14,165,233,0.06),transparent_60%)]"
    >
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
