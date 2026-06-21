/**
 * AgentStandaloneLayout：独立布局容器
 *
 * 状态管理已上提到 useAgentStore（单一数据源）：会话列表、激活 ID、每会话运行态。
 * 本层只做：初次加载 sessions、自动新建空会话（进入即空态页）、
 * 渲染 Topbar/Sidebar/Workspace，以及统一管理重命名/搜索弹窗。
 *
 * 会话新建/删除/重命名均由 store 处理；搜索改为弹窗分页（侧栏不再内联搜索）。
 */

import { useEffect } from 'react';
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
  const bootstrap = useAgentStore((s) => s.bootstrap);

  const activeSession = sessions.find(s => s.id === activeId) ?? null;

  // 首次加载会话列表（仅一次，搜索已改为弹窗内独立请求，这里不再轮询/防抖）
  useEffect(() => {
    void refreshSessions();
  }, [refreshSessions]);

  // 进入工作台默认打开「新建会话页」：
  // 调用 store 幂等 bootstrap，确保存在一个空虚拟会话作为 activeId。
  // 幂等判定收敛到 store（isEmptyVirtual），不再依赖组件 useRef——
  // 后者在 StrictMode 双跑 / HMR 重挂载下会失效，是 Bug1 串史的加固缺口。
  useEffect(() => {
    bootstrap();
  }, [bootstrap]);

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
