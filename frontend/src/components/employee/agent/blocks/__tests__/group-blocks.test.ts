import { describe, it, expect } from 'vitest';
import type { AgentBlock } from '@/types/agent';
import { attachReasoning } from '../group-blocks';

const text = (i: number, t: string): AgentBlock =>
  ({ type: 'text', index: i, text: t, status: 'success' });
const thinking = (i: number, t: string): AgentBlock =>
  ({ type: 'thinking', index: i, text: t, status: 'success' });
/** tool_use 块（可携带后端落库的 reasoning 字段） */
const toolUse = (i: number, name: string, reasoning?: string): AgentBlock =>
  ({ type: 'tool_use', index: i, tool_name: 'g', display_name: name, input: {}, status: 'success', ...(reasoning ? { reasoning } : {}) }) as AgentBlock;

describe('attachReasoning', () => {
  it('thinking 吸附到其后紧跟的业务块', () => {
    const blocks: AgentBlock[] = [
      thinking(0, '先想想'),
      text(1, '答案'),
    ];
    const out = attachReasoning(blocks);
    expect(out).toHaveLength(1);
    expect(out[0].type).toBe('text');
    expect((out[0] as { reasoning?: string }).reasoning).toBe('先想想');
  });

  it('连续多个 thinking 合并后吸附到下一个业务块', () => {
    const blocks: AgentBlock[] = [
      thinking(0, 'A'),
      thinking(1, 'B'),
      text(2, '正文'),
    ];
    const out = attachReasoning(blocks);
    expect(out).toHaveLength(1);
    expect((out[0] as { reasoning?: string }).reasoning).toBe('AB');
  });

  it('没有前置 thinking 的业务块 reasoning 为 undefined', () => {
    const blocks: AgentBlock[] = [text(0, '直接回答')];
    const out = attachReasoning(blocks);
    expect((out[0] as { reasoning?: string }).reasoning).toBeUndefined();
  });

  it('末尾孤立的 thinking 吸附到最后一个业务块', () => {
    const blocks: AgentBlock[] = [
      text(0, '正文'),
      thinking(1, '收尾思考'),
    ];
    const out = attachReasoning(blocks);
    expect(out).toHaveLength(1);
    expect((out[0] as { reasoning?: string }).reasoning).toBe('收尾思考');
  });

  it('多个业务块各吸附自己的前置 thinking', () => {
    const blocks: AgentBlock[] = [
      thinking(0, 'T1'),
      text(1, 'A'),
      thinking(2, 'T2'),
      text(3, 'B'),
    ];
    const out = attachReasoning(blocks);
    expect(out.map(b => b.type)).toEqual(['text', 'text']);
    expect((out[0] as { reasoning?: string }).reasoning).toBe('T1');
    expect((out[1] as { reasoning?: string }).reasoning).toBe('T2');
  });

  it('保留 tool_use 块自带的 reasoning（后端已落库思考内容，不可覆盖）', () => {
    const blocks: AgentBlock[] = [
      toolUse(0, '生成【后端】题目', '维度块的独立思考'),
    ];
    const out = attachReasoning(blocks);
    expect((out[0] as { reasoning?: string }).reasoning).toBe('维度块的独立思考');
  });

  it('前置 thinking 与 tool_use 自带 reasoning 合并（前置在前）', () => {
    const blocks: AgentBlock[] = [
      thinking(0, '前置思考'),
      toolUse(1, '生成【后端】题目', '自带思考'),
    ];
    const out = attachReasoning(blocks);
    // thinking 块被过滤，tool_use 在 out[0]
    expect(out).toHaveLength(1);
    expect((out[0] as { reasoning?: string }).reasoning).toBe('前置思考自带思考');
  });

  it('多个 tool_use 块各自保留/合并自己的 reasoning（fanout 不串台）', () => {
    const blocks: AgentBlock[] = [
      toolUse(0, '生成【A】题目', '思考A'),
      toolUse(1, '生成【B】题目', '思考B'),
    ];
    const out = attachReasoning(blocks);
    expect((out[0] as { reasoning?: string }).reasoning).toBe('思考A');
    expect((out[1] as { reasoning?: string }).reasoning).toBe('思考B');
  });
});
