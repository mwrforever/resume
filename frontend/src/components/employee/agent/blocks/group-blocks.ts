/**
 * attachReasoning：把连续的 thinking 块吸附到相邻业务块，作为其 reasoning 字段。
 *
 * 规则：
 * - 连续的 thinking 块累积文本，吸附到其后紧跟的业务块（text/interaction/report/questions/tool_use）。
 * - 末尾孤立的 thinking（后面无业务块）吸附到最后一个业务块。
 * - 业务块带上 reasoning（无对应思考时为 undefined）。
 *
 * 渲染层据此把思考内容嵌入业务块内的 ReasoningSection，不再渲染独立 thinking 卡片。
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
    // 业务块：附上累积的 reasoning（若有）
    result.push({ ...b, reasoning: pendingReasoning || undefined });
    pendingReasoning = '';
  }

  // 末尾孤立的 thinking：吸附到最后一个业务块
  if (pendingReasoning && result.length > 0) {
    const last = result[result.length - 1];
    last.reasoning = (last.reasoning ?? '') + pendingReasoning;
  }

  return result;
}
