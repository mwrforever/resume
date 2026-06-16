import { describe, it, expect } from 'vitest';
import type { AgentBlock } from '@/types/agent';
import { attachReasoning } from '../group-blocks';

const text = (i: number, t: string): AgentBlock =>
  ({ type: 'text', index: i, text: t, status: 'success' });
const thinking = (i: number, t: string): AgentBlock =>
  ({ type: 'thinking', index: i, text: t, status: 'success' });

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
});
