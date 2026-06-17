import { describe, it, expect } from 'vitest';
import type { WorkspaceSession } from '@/types/agent';
import { sortSessionsByTime } from '../agent-sidebar-drawer';

/** 构造最小合法 WorkspaceSession（仅排序用到的字段有值）。 */
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

describe('sortSessionsByTime', () => {
  it('按 last_message_time 降序（新的在上）', () => {
    const today = new Date();
    const at = (h: number) => {
      const d = new Date(today.getFullYear(), today.getMonth(), today.getDate(), h);
      return d.toISOString();
    };
    const sessions = [mkSession(1, at(10)), mkSession(2, at(18)), mkSession(3, at(12))];
    const sorted = sortSessionsByTime(sessions);
    expect(sorted.map(s => s.id)).toEqual([2, 3, 1]);
  });

  it('无 last_message_time 的会话排到末尾（视为最早）', () => {
    const now = new Date();
    const recent = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 12).toISOString();
    const sessions = [
      { ...mkSession(2, '') },
      { ...mkSession(1, recent) },
    ];
    const sorted = sortSessionsByTime(sessions as WorkspaceSession[]);
    // 有时间的在前，空时间的在后
    expect(sorted.map(s => s.id)).toEqual([1, 2]);
  });

  it('不修改原数组（返回新数组）', () => {
    const sessions = [mkSession(1, '2026-01-01T00:00:00.000Z'), mkSession(2, '2026-06-01T00:00:00.000Z')];
    const sorted = sortSessionsByTime(sessions);
    expect(sorted).not.toBe(sessions);
    expect(sessions.map(s => s.id)).toEqual([1, 2]); // 原数组不变
    expect(sorted.map(s => s.id)).toEqual([2, 1]); // 排序结果
  });

  it('跨大时间跨度也能正确降序（今天的在两月前的之前）', () => {
    const now = new Date();
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 12).toISOString();
    const old = new Date(now.getFullYear(), now.getMonth() - 2, 1, 12).toISOString();
    const sessions = [
      { ...mkSession(2, old) },
      { ...mkSession(1, today) },
    ];
    const sorted = sortSessionsByTime(sessions);
    expect(sorted.map(s => s.id)).toEqual([1, 2]);
  });
});
