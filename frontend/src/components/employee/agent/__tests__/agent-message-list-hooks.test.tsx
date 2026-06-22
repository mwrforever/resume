/**
 * AgentMessageList Hooks 安全单测。
 *
 * 复现：流式中（running=true）useMemo(pseudoStreamingMessage) 执行 → 中断后空态
 * （running=false + messages 空）走 early return、useMemo 被跳过 → React 检测到
 * hook 数量从 4 变 3，抛 "Rendered fewer hooks than expected" → 整个组件白屏崩溃。
 *
 * 根因：useMemo 写在 early return 之后，违反 Hooks 规则。
 * 修复：useMemo 移到 early return 之前，无条件执行。
 */
import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import { AgentMessageList } from '../agent-message-list';
import type { AgentRunState } from '@/types/agent';

// jsdom 未实现 Element.scrollTo（use-follow-bottom 的自动滚动会调用），补桩避免渲染抛错。
if (!Element.prototype.scrollTo) {
  Element.prototype.scrollTo = () => {};
}

const runningState: AgentRunState = {
  running: true, run_id: 'r1', workflow_type: 'interview_questions',
  enable_thinking: false, steps: [], current_blocks: [], error: null,
};
const idleState: AgentRunState = {
  running: false, run_id: null, workflow_type: 'interview_questions',
  enable_thinking: false, steps: [], current_blocks: [], error: null,
};

describe('AgentMessageList hooks 安全', () => {
  it('从流式切到空态（中断瞬间）不崩溃', () => {
    // 首次：running=true → 不走 early return → useMemo 执行
    const { rerender } = render(
      <AgentMessageList
        messages={[]}
        runState={runningState}
        onSubmitInteraction={() => {}}
      />,
    );
    // 二次：中断后 running=false + messages 空 → 走 early return。
    // 修复前：useMemo 被跳过，React 抛 "Rendered fewer hooks than expected"
    expect(() =>
      rerender(
        <AgentMessageList
          messages={[]}
          runState={idleState}
          onSubmitInteraction={() => {}}
        />,
      ),
    ).not.toThrow();
  });
});
