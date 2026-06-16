import { describe, it, expect } from 'vitest';
import type { WorkspaceSession } from '@/types/agent';
import { groupSessionsByTime } from '../agent-sidebar-drawer';

/** 构造最小合法 WorkspaceSession（仅排序/分组用到的字段有值）。 */
function mkSession(id: number, lastMessageTime: string): WorkspaceSession {
  return {
    id,
    session_key: `k${id}`,
    current_task_id: `t${id}`,
    employee_id: 1,
    title: `s${id}`,
    selected_model_name: null,
    enable_thinking: false,
    status: 0,
    last_message_time: lastMessageTime,
    create_time: lastMessageTime,
    update_time: lastMessageTime,
  };
}

describe('groupSessionsByTime', () => {
  it('组内按 last_message_time 降序（新的在上）', () => {
    const today = new Date();
    const at = (h: number) => {
      const d = new Date(today.getFullYear(), today.getMonth(), today.getDate(), h);
      return d.toISOString();
    };
    const sessions = [mkSession(1, at(10)), mkSession(2, at(18)), mkSession(3, at(12))];
    const groups = groupSessionsByTime(sessions);
    const todayGroup = groups.find(g => g.key === 'today');
    expect(todayGroup?.items.map(i => i.id)).toEqual([2, 3, 1]);
  });

  it('无 last_message_time 的会话归到 earlier 组', () => {
    const sessions = [mkSession(1, '')];
    // 空字符串落到 earlier 分支（!last_message_time）
    const groups = groupSessionsByTime(sessions.map(s => ({ ...s, last_message_time: s.last_message_time || null })));
    const earlier = groups.find(g => g.key === 'earlier');
    expect(earlier?.items.map(i => i.id)).toEqual([1]);
  });

  it('跨组顺序：今天的在更早的之前（验证返回顺序大致为新的在前）', () => {
    const now = new Date();
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 12).toISOString();
    const old = new Date(now.getFullYear(), now.getMonth() - 2, 1, 12).toISOString();
    const sessions = [
      { ...mkSession(2, old) },      // earlier
      { ...mkSession(1, today) },    // today
    ];
    const groups = groupSessionsByTime(sessions);
    // today 组应排在 earlier 组之前
    expect(groups.map(g => g.key)).toEqual(['today', 'earlier']);
  });
});
