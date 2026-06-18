/**
 * 会话分组（今天 / 本周更早 / 更早）单测。
 *
 * 边界规则：
 * - 今天：last_message_time >= 本地今天 00:00
 * - 本周更早：本周一 00:00 <= last_message_time < 今天 00:00
 * - 更早：last_message_time < 本周一 00:00 或解析失败 / 为空
 * - 周一计算用 ISO（周一为周首）
 * - 同组内按时间降序
 */

import { describe, it, expect } from 'vitest';
import type { WorkspaceSession } from '@/types/agent';
import { groupSessionsByTime } from '../agent-sidebar-drawer';

/** 构造最小合法 WorkspaceSession（仅 last_message_time / id 有意义） */
function mk(id: number, lastMessageTime: string): WorkspaceSession {
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

/** 固定 now：2026-06-17（周三）13:00 本地时间 */
const NOW = new Date(2026, 5, 17, 13, 0, 0);

/** 构造给定本地时间点的 ISO 字符串 */
function isoAt(y: number, m: number, d: number, h = 12): string {
  return new Date(y, m, d, h, 0, 0).toISOString();
}

describe('groupSessionsByTime', () => {
  it('返回三组：today / thisWeek / earlier，顺序固定', () => {
    const groups = groupSessionsByTime([], NOW);
    expect(groups.map(g => g.key)).toEqual(['today', 'thisWeek', 'earlier']);
    expect(groups.map(g => g.label)).toEqual(['今天', '本周更早', '更早']);
  });

  it('「今天」=本地今天 00:00 之后', () => {
    const sessions = [
      mk(1, isoAt(2026, 5, 17, 0)),   // 今天 00:00（含）
      mk(2, isoAt(2026, 5, 17, 12)),  // 今天中午
      mk(3, isoAt(2026, 5, 16, 23)),  // 昨晚
    ];
    const groups = groupSessionsByTime(sessions, NOW);
    const today = groups.find(g => g.key === 'today')!;
    expect(today.items.map(s => s.id)).toEqual([2, 1]); // 同组内降序
    const thisWeek = groups.find(g => g.key === 'thisWeek')!;
    expect(thisWeek.items.map(s => s.id)).toEqual([3]);
  });

  it('「本周更早」=本周一 00:00 ~ 今天 00:00', () => {
    // 本周一是 2026-06-15
    const sessions = [
      mk(1, isoAt(2026, 5, 15, 0)),  // 周一 00:00（含）
      mk(2, isoAt(2026, 5, 16, 23)), // 周二晚
      mk(3, isoAt(2026, 5, 14, 23)), // 上周日
    ];
    const groups = groupSessionsByTime(sessions, NOW);
    const thisWeek = groups.find(g => g.key === 'thisWeek')!;
    expect(thisWeek.items.map(s => s.id)).toEqual([2, 1]);
    const earlier = groups.find(g => g.key === 'earlier')!;
    expect(earlier.items.map(s => s.id)).toEqual([3]);
  });

  it('「更早」=本周一之前 + 空时间 + 解析失败', () => {
    const sessions = [
      mk(1, isoAt(2026, 5, 14, 12)), // 上周日
      mk(2, isoAt(2026, 0, 1, 12)),  // 半年前
      mk(3, ''),                      // 空时间
      mk(4, 'not-a-date'),            // 无效
    ];
    const groups = groupSessionsByTime(sessions, NOW);
    const earlier = groups.find(g => g.key === 'earlier')!;
    // 有效时间降序在前，空/无效放最后（按 id 升序兜底，stable）
    expect(earlier.items.map(s => s.id)).toEqual([1, 2, 3, 4]);
  });

  it('周一 00:00 边界：恰为周一 0 点 → 本周更早', () => {
    // NOW = 周三 13:00；本周一 = 2026-06-15 00:00:00
    const sessions = [
      mk(1, new Date(2026, 5, 15, 0, 0, 0).toISOString()),
      mk(2, new Date(2026, 5, 14, 23, 59, 59).toISOString()),
    ];
    const groups = groupSessionsByTime(sessions, NOW);
    expect(groups.find(g => g.key === 'thisWeek')!.items.map(s => s.id)).toEqual([1]);
    expect(groups.find(g => g.key === 'earlier')!.items.map(s => s.id)).toEqual([2]);
  });

  it('NOW 是周一时：本周一 = 当天 00:00，「本周更早」可能为空', () => {
    const monday = new Date(2026, 5, 15, 10, 0, 0); // 周一 10:00
    const sessions = [
      mk(1, new Date(2026, 5, 15, 9).toISOString()),  // 今天 09:00
      mk(2, new Date(2026, 5, 14, 23).toISOString()), // 上周日
    ];
    const groups = groupSessionsByTime(sessions, monday);
    expect(groups.find(g => g.key === 'today')!.items.map(s => s.id)).toEqual([1]);
    expect(groups.find(g => g.key === 'thisWeek')!.items).toEqual([]);
    expect(groups.find(g => g.key === 'earlier')!.items.map(s => s.id)).toEqual([2]);
  });

  it('不修改原数组', () => {
    const sessions = [mk(1, isoAt(2026, 5, 17, 12)), mk(2, isoAt(2026, 5, 14, 12))];
    const original = [...sessions];
    groupSessionsByTime(sessions, NOW);
    expect(sessions).toEqual(original);
  });
});
