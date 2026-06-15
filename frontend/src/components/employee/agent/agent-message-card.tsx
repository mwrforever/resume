/**
 * AgentMessageCard：Agent 响应消息单卡片包裹
 *
 * 将一条 AgentMessage 的所有 block 包裹在同一个卡片容器内，
 * block 之间用 divider 分隔，底部显示模型/token 等元信息。
 */

import type { AgentMessage, AgentRunState } from '@/types/agent';
import { BlockRenderer } from './blocks/block-renderer';
import { StepStrip } from './step-strip';

export interface AgentMessageCardProps {
  message: AgentMessage;
  runState: AgentRunState | null;
  /** interaction 提交进行中：禁用提交按钮防重复点击 */
  submitting?: boolean;
  onSubmitInteraction: (requestId: string, values: Record<string, unknown>) => void;
}

export function AgentMessageCard({ message, runState, submitting, onSubmitInteraction }: AgentMessageCardProps) {
  const blocks = message.content.blocks ?? [];

  // 无 block 的 agent 消息不渲染卡片
  if (blocks.length === 0) return null;

  return (
    <div className="relative border border-[#E2E8F0] rounded-xl bg-white shadow-md
                    overflow-hidden animate-[fadeSlideUp_0.3s_ease]">
      {/* 左侧 3px 品牌蓝 accent 条 */}
      <div className="absolute left-0 top-0 bottom-0 w-[3px] bg-[#0369A1]" />

      {/* StepStrip（仅当前 run 中显示） */}
      {runState && runState.steps.length > 0 && (
        <div className="border-b border-[#E2E8F0]">
          <StepStrip steps={runState.steps} running={runState.running} />
        </div>
      )}

      {/* Blocks */}
      <div className="divide-y divide-[#E2E8F0]">
        {blocks.map((block) => (
          <div key={block.index} className="px-4 py-3">
            <BlockRenderer
              block={block}
              submitting={submitting}
              onSubmitInteraction={
                block.type === 'interaction' ? onSubmitInteraction : undefined
              }
            />
          </div>
        ))}
      </div>

      {/* 元信息 Footer */}
      {(message.model_name || message.token_count || message.create_time) && (
        <div className="flex items-center justify-between px-4 py-2 bg-[#F8FAFC] border-t border-[#E2E8F0]">
          <div className="flex items-center gap-3 text-xs text-[#64748B]">
            {message.model_name && <span>{message.model_name}</span>}
            {message.token_count != null && <span>{message.token_count} token</span>}
          </div>
          <div className="text-xs text-[#94A3B8]">
            {message.create_time}
          </div>
        </div>
      )}
    </div>
  );
}
