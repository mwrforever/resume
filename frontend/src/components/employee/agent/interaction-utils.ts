/**
 * interaction 判定工具（纯函数，无副作用）。
 *
 * 供 store.sendMessage（发送前自动中断判定）与 AgentWorkspace（按钮态判定）复用，
 * 避免在多处重复实现“最近一条 agent 消息是否含未提交 interaction”逻辑。
 */

import type { AgentMessage } from '@/types/agent';

/**
 * 判断会话是否处于人机交互等待态（pending interaction）。
 *
 * 语义：倒序找到最近一条 agent 消息，若其 blocks 中存在 type==='interaction'
 * 且 status==='pending' 的块，则流程正暂停等用户输入，返回 true。
 * interaction 的终态（submitted/rejected/expired）不算 pending。
 *
 * @param messages 当前会话的消息列表（含 user 与 agent，按时间升序）
 * @returns true 表示存在未完成的人机交互（流程已暂停）
 */
export function hasPendingInteraction(messages: AgentMessage[]): boolean {
  // 倒序找最近一条 agent 消息（interaction 只可能出现在 agent 消息里）
  const lastAgent = [...messages].reverse().find(m => m.role === 'agent');
  if (!lastAgent) return false;
  // 该 agent 消息中存在 pending 的 interaction block 即为等待态
  return (lastAgent.content.blocks ?? []).some(
    b => b.type === 'interaction' && b.status === 'pending',
  );
}
