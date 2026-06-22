import { describe, it, expect } from 'vitest';
import type { WorkspaceSession } from '@/types/agent';
import { sortSessionsByTime } from '../agent-sidebar-drawer';
import { isEmptyVirtual } from '@/store/agent';

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
  it('按 create_time 降序（新的在上）', () => {
    const today = new Date();
    const at = (h: number) => {
      const d = new Date(today.getFullYear(), today.getMonth(), today.getDate(), h);
      return d.toISOString();
    };
    const sessions = [mkSession(1, at(10)), mkSession(2, at(18)), mkSession(3, at(12))];
    const sorted = sortSessionsByTime(sessions);
    expect(sorted.map(s => s.id)).toEqual([2, 3, 1]);
  });

  it('按 create_time 降序（忽略 last_message_time）', () => {
    // create_time 与 last_message_time 故意相反：排序应跟随 create_time
    const a = { ...mkSession(1, '2026-06-01T00:00:00.000Z'), last_message_time: '2026-06-22T00:00:00.000Z' };
    const b = { ...mkSession(2, '2026-06-10T00:00:00.000Z'), last_message_time: '2026-06-01T00:00:00.000Z' };
    const sorted = sortSessionsByTime([a, b]);
    // create_time 更晚的 id=2 在前（尽管其 last_message_time 更早）
    expect(sorted.map(s => s.id)).toEqual([2, 1]);
  });

  it('无 create_time 的会话排到末尾（视为最早）', () => {
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

describe('isEmptyVirtual（侧栏过滤空虚拟会话）', () => {
  it('负 id 且无 last_message_time 的会话视为空虚拟会话', () => {
    const virtual = { ...mkSession(-1718000000000, '') };
    expect(isEmptyVirtual(virtual)).toBe(true);
  });

  it('真实会话（正 id）即使无时间也不视为空虚拟会话', () => {
    const real = { ...mkSession(1, '') };
    expect(isEmptyVirtual(real)).toBe(false);
  });

  it('负 id 但已有 last_message_time（已发首条消息）不视为空虚拟会话', () => {
    const sent = { ...mkSession(-1718000000000, '2026-06-17T10:00:00.000Z') };
    expect(isEmptyVirtual(sent)).toBe(false);
  });

  it('过滤后空虚拟会话不进排序结果', () => {
    const now = new Date();
    const recent = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 12).toISOString();
    const sessions = [
      { ...mkSession(-1718000000000, '') }, // 空虚拟会话（应被过滤）
      { ...mkSession(1, recent) },          // 真实会话
    ];
    const visible = sessions.filter(s => !isEmptyVirtual(s));
    const sorted = sortSessionsByTime(visible);
    expect(sorted.map(s => s.id)).toEqual([1]);
  });
});
