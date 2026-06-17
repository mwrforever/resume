/**
 * attachReasoning：把连续的 thinking 块吸附到相邻业务块，作为其 reasoning 字段。
 *
 * 规则：
 * - 连续的 thinking 块累积文本，吸附到其后紧跟的业务块。
 * - 末尾孤立的 thinking（后面无业务块）吸附到最后一个业务块。
 * - **保留业务块自带的 reasoning**（tool_use 块的思考内容已由后端落库进 block.reasoning
 *   字段）。仅当有前置 thinking 块时才前置追加，不覆盖已有值。这保证历史消息里
 *   各维度/阶段的思考内容（运行结束后）仍可展开查看。
 */

import type { AgentBlock } from '@/types/agent';

/** 带 reasoning 的 block 类型（渲染层用）。 */
export type BlockWithReasoning = AgentBlock & { reasoning?: string };

export function attachReasoning(blocks: AgentBlock[]): BlockWithReasoning[] {
  const result: BlockWithReasoning[] = [];
  let pendingReasoning = '';

  for (const b of blocks) {
    if (b.type === 'thinking') {
      // 累积思考文本（thinking 块的 text 字段）
      pendingReasoning += b.text;
      continue;
    }
    // 业务块：合并"前置 thinking 吸附"与"block 自带 reasoning"（自带值优先保留）
    // block.reasoning 适用于 tool_use 等已落库思考内容的块类型
    const selfReasoning = (b as BlockWithReasoning).reasoning;
    const merged = pendingReasoning || selfReasoning
      ? (pendingReasoning + (selfReasoning ?? ''))
      : undefined;
    result.push({ ...b, reasoning: merged });
    pendingReasoning = '';
  }

  // 末尾孤立的 thinking：追加到最后一个业务块（不覆盖其自带 reasoning）
  if (pendingReasoning && result.length > 0) {
    const last = result[result.length - 1];
    last.reasoning = (last.reasoning ?? '') + pendingReasoning;
  }

  return result;
}
