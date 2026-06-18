/**
 * AgentMessageCard：Agent 响应消息单卡片包裹
 *
 * 将一条 AgentMessage 的所有 block 包裹在同一个卡片容器内，
 * block 之间用 divider 分隔，底部显示模型/token 等元信息。
 */

import type { AgentMessage, AgentRunState } from '@/types/agent';
import { Sparkles } from 'lucide-react';
import { BlockRenderer } from './blocks/block-renderer';
import { attachReasoning } from './blocks/group-blocks';
import { StepStrip } from './step-strip';

export interface AgentMessageCardProps {
  message: AgentMessage;
  runState: AgentRunState | null;
  /** interaction 提交进行中：禁用提交按钮防重复点击 */
  submitting?: boolean;
  onSubmitInteraction: (requestId: string, values: Record<string, unknown>) => void;
}

export function AgentMessageCard({ message, runState, submitting, onSubmitInteraction }: AgentMessageCardProps) {
  const blocks = attachReasoning(message.content.blocks ?? []);

  // 无 block 的 agent 消息不渲染卡片
  if (blocks.length === 0) return null;

  return (
    <div className="relative pl-11">
      {/* Agent 助手徽标（贴在卡片左上，与顶栏 Logo 呼应，表达"AI 响应"语义） */}
      <div className="absolute left-0 top-0 flex h-8 w-8 items-center justify-center rounded-xl
                      bg-gradient-to-br from-[#0EA5E9] to-[#0369A1] text-white
                      shadow-[0_4px_10px_-3px_rgba(3,105,161,0.5)]
                      ring-1 ring-inset ring-white/20">
        <Sparkles size={15} className="fill-white/25" strokeWidth={2.2} />
      </div>
      <div className="relative border border-[#E2E8F0]/80 rounded-2xl bg-white
                    overflow-hidden
                    shadow-[0_1px_2px_rgba(2,6,23,0.04),0_4px_14px_-8px_rgba(2,6,23,0.08)]
                    animate-[fadeSlideUp_0.3s_ease]">
      {/* 左侧 3px 品牌蓝 accent 条（渐变提升质感） */}
      <div className="absolute left-0 top-0 bottom-0 w-[3px] bg-gradient-to-b from-[#0EA5E9] to-[#0369A1]" />

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
        <div className="flex items-center justify-between px-4 py-2 bg-[#FAFBFC] border-t border-[#E2E8F0]/70">
          <div className="flex items-center gap-3 text-[11px] text-[#94A3B8] font-mono">
            {message.model_name && <span className="font-sans">{message.model_name}</span>}
            {message.token_count != null && <span>{message.token_count} token</span>}
          </div>
          <div className="text-[11px] text-[#CBD5E1] font-mono">
            {message.create_time}
          </div>
        </div>
      )}
      </div>
    </div>
  );
}
