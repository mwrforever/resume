/**
 * 会话标题工具：与后端 AgentRuntimeService._make_title_from_content 完全一致。
 *
 * 用于首条消息发送时乐观更新会话标题，避免等待 run.finish 后 reload 才能在
 * 侧边栏看到标题。规则：strip → 换行/制表符替为单空格 → 合并连续空白 → 截至 DB 列上限（80 字）。
 *
 * 标题落库存全文（≤80 字），展示侧由 .truncate 单行省略，保证侧栏与 Topbar 不换行。
 */

/** 默认占位标题集合：命中其一视为"尚未命名" */
const DEFAULT_TITLES = new Set(['', '新会话', '未命名会话']);

/**
 * 判断标题是否为默认空标题（None/空/占位）。
 * @param t - 当前标题
 * @returns true 表示尚未命名，可被乐观更新
 */
export function isDefaultTitle(t: string | null | undefined): boolean {
  return DEFAULT_TITLES.has((t ?? '').trim());
}

/**
 * 把用户消息内容压成单行 ≤80 字的会话标题（与 DB 列上限对齐）。
 * 与后端 _make_title_from_content 逐字对齐，保证乐观更新与落库结果一致。
 *
 * 80 字以内的问题原样落库（保证标题信息完整）；超长由展示侧的 .truncate 截断展示，
 * 落库值仍是完整问题，鼠标悬浮可看全。
 *
 * @param content - 用户消息原文
 * @returns 截断后的标题（可能为空字符串）
 */
export function makeTitleFromContent(content: string): string {
  if (!content) return '';
  const flat = content
    .replace(/\r/g, ' ')
    .replace(/\n/g, ' ')
    .replace(/\t/g, ' ');
  return flat.split(/\s+/).filter(Boolean).join(' ').slice(0, 80);
}
