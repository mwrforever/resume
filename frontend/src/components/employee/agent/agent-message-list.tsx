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
import { EmptyState } from './empty-state';
import { AgentMessageCard } from './agent-message-card';

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

  // 空态：无历史消息 + 无 run 进行中（所有 hooks 已在上方无条件执行，符合 Hooks 规则）
  if (messages.length === 0 && !runState.running) {
    return (
      <div ref={ref} className="flex-1 overflow-y-auto bg-[#F8FAFC]">
        <EmptyState />
      </div>
    );
  }

  return (
    <div ref={ref} className="flex-1 overflow-y-auto bg-[#F8FAFC]">
      <div className="mx-auto max-w-[880px] px-4 py-6 space-y-6">
        {messages.map(msg => (
          <MessageRow key={msg.id} message={msg} onSubmitInteraction={onSubmitInteraction} />
        ))}

        {/* 流式正在构造的 blocks */}
        {runState.running && (
          <div className="space-y-2">
            <StepStrip steps={runState.steps} running={runState.running} />
            <div className="border border-[#E2E8F0] rounded-xl bg-white shadow-sm">
              <div className="divide-y divide-[#E2E8F0]">
                {runState.current_blocks.map(b => (
                  <div key={b.index} className="px-4 py-3">
                    <BlockRenderer
                      block={b}
                      onSubmitInteraction={
                        b.type === 'interaction' ? onSubmitInteraction : undefined
                      }
                    />
                  </div>
                ))}
              </div>
            </div>
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
      <div className="flex justify-end mb-4">
        <div className="max-w-[560px] rounded-2xl rounded-br-md bg-[#0369A1] text-white px-4 py-2.5 text-sm whitespace-pre-wrap leading-relaxed shadow-sm">
          {userText}
        </div>
      </div>
    );
  }
  return (
    <AgentMessageCard
      message={message}
      runState={null}
      onSubmitInteraction={onSubmitInteraction}
    />
  );
}
