/**
 * 会话标题工具：与后端 AgentRuntimeService._make_title_from_content 完全一致。
 *
 * 用于首条消息发送时乐观更新会话标题，避免等待 run.finish 后 reload 才能在
 * 侧边栏看到标题。规则：strip → 换行/制表符替为单空格 → 合并连续空白 → 前 30 字。
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
 * 把用户消息内容压成单行 30 字以内的会话标题。
 * 与后端 _make_title_from_content 逐字对齐，保证乐观更新与落库结果一致。
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
  return flat.split(/\s+/).filter(Boolean).join(' ').slice(0, 30);
}
