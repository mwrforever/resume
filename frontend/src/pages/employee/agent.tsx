/**
 * Agent 工作台入口 — 独立布局
 *
 * 通过 window.open 新 Tab 打开时不挂 AdminLayout。
 */

import { AgentStandaloneLayout } from '@/components/employee/agent/layout/agent-standalone-layout';

export default function AgentPage() {
  return <AgentStandaloneLayout />;
}
