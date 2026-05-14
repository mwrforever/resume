import type { BadgeProps } from '@/components/ui/badge';
import type { IAgentMessageItem, IAgentToolStreamItem } from '@/types/agent';

export type BadgeVariant = BadgeProps['variant'];

export const DEFAULT_MODEL_VALUE = '__default__';
export const hiddenScrollClass = '[scrollbar-width:none] [&::-webkit-scrollbar]:hidden';

const actionStatusLabelMap: Record<number, string> = { 1: '待确认', 3: '已确认', 4: '已拒绝' };
export const applicationStatusLabelMap: Record<number, string> = { 1: '待处理', 2: '已查看', 3: '面试中', 4: '已拒绝', 5: '已录用' };

export function getActionStatusVariant(status: number): BadgeVariant {
  if (status === 1) return 'warning';
  if (status === 3) return 'success';
  return 'secondary';
}

export function getActionStatusLabel(status: number) {
  return actionStatusLabelMap[status] || '已处理';
}

export function getToolEventVariant(item: IAgentToolStreamItem): BadgeVariant {
  if (item.type === 'result' && item.success === false) return 'danger';
  return 'secondary';
}

export function getToolEventLabel(type: IAgentToolStreamItem['type']) {
  return type === 'call' ? '调用' : '结果';
}

export function blockText(block: Record<string, unknown>) {
  if (typeof block.text === 'string') return block.text;
  if (typeof block.html === 'string') return block.html;
  return JSON.stringify(block);
}

export function messageText(blocks: Array<Record<string, unknown>> = []) {
  return blocks.map((block) => blockText(block)).join('\n');
}

/** 格式化 Agent 消息时间戳为本地中文日期+时间显示 */
export function formatAgentTime(value?: string | null) {
  if (!value) return '未保存';
  return new Intl.DateTimeFormat('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' }).format(new Date(value));
}

/** 根据用户输入内容构建本地会话标题，去除多余空白并截断至 50 字符 */
export function buildLocalTitle(content: string) {
  return content.replace(/\s+/g, ' ').trim().slice(0, 50) || '新会话';
}

/** 构造流式消息初始对象，用于 SSE token 事件中首次收到增量时插入消息列表 */
export function createStreamingMessage(
  id: number,
  sessionId: number,
  delta: string,
  sortOrder: number,
): IAgentMessageItem {
  return {
    id,
    session_id: sessionId,
    parent_message_id: null,
    role: 'agent',
    message_type: 'text',
    content: { context_refs: [], blocks: [{ type: 'text', text: delta }] },
    model_name: null,
    token_count: null,
    sort_order: sortOrder,
    create_time: null,
  };
}
