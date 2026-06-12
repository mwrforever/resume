/**
 * AgentMessageList：消息列表渲染。
 *
 * 流式与历史共用同一管线：
 * - 历史消息：messages.map(MessageRow)
 * - 流式正在构造：RunRow（流式 current_blocks）
 */

import { useEffect } from 'react';
import type { AgentMessage, AgentRunState } from '@/types/agent';
import { BlockRenderer } from './blocks/block-renderer';
import { StepStrip } from './step-strip';
import { useFollowBottom } from '@/hooks/use-follow-bottom';

export interface AgentMessageListProps {
  messages: AgentMessage[];
  runState: AgentRunState;
  onSubmitInteraction: (requestId: string, values: Record<string, unknown>) => void;
}

export function AgentMessageList({ messages, runState, onSubmitInteraction }: AgentMessageListProps) {
  const { ref, followIfNeeded, forceSmoothToBottom } = useFollowBottom();

  // 流式期间新增 envelope → 触发滚动 follow
  useEffect(() => {
    followIfNeeded();
  }, [runState.current_blocks.length, runState.steps.length, followIfNeeded]);

  // 流式结束 → smooth 对齐到底
  useEffect(() => {
    if (!runState.running) forceSmoothToBottom();
  }, [runState.running, forceSmoothToBottom]);

  return (
    <div ref={ref} className="flex-1 overflow-y-auto bg-gray-50">
      <div className="mx-auto max-w-[760px] px-4 py-6 space-y-4">
        {messages.map(msg => (
          <MessageRow key={msg.id} message={msg} onSubmitInteraction={onSubmitInteraction} />
        ))}

        {/* 流式正在构造的 blocks */}
        {runState.running && (
          <div className="space-y-2">
            <StepStrip steps={runState.steps} running={runState.running} />
            {runState.current_blocks.map(b => (
              <BlockRenderer key={b.index} block={b} onSubmitInteraction={onSubmitInteraction} />
            ))}
          </div>
        )}

        {/* 错误提示 */}
        {runState.error && (
          <div role="alert" className="my-2 rounded border border-red-300 bg-red-50 p-3 text-sm text-red-600">
            [{runState.error.code}] {runState.error.message}
          </div>
        )}
      </div>
    </div>
  );
}

/** 单条消息渲染 */
function MessageRow({
  message,
  onSubmitInteraction,
}: {
  message: AgentMessage;
  onSubmitInteraction: (id: string, v: Record<string, unknown>) => void;
}) {
  if (message.role === 'user') {
    const userText = (message.content.blocks?.[0] as { type: 'text'; text: string } | undefined)?.text ?? '';
    return (
      <div className="flex justify-end">
        <div className="max-w-[560px] rounded-lg bg-blue-600 text-white px-4 py-2 text-sm whitespace-pre-wrap">
          {userText}
        </div>
      </div>
    );
  }
  return (
    <div className="space-y-2">
      {(message.content.blocks ?? []).map(b => (
        <BlockRenderer key={b.index} block={b} onSubmitInteraction={onSubmitInteraction} />
      ))}
    </div>
  );
}
