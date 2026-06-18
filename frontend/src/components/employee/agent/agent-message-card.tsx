/**
 * AgentMessageCard：Agent 响应消息（rail 骨架）
 *
 * 设计要点（对话流方案 A）：
 * - 取消"外卡 + divide-y"，整段以左 accent rail + 头像锚点连成一条；
 * - block 之间用 spacing 而非 divider；
 * - 仅业务结果块（interview_questions / evaluation_report）由各自渲染器内
 *   使用 result-card 浮起，作为唯一"突出层"；
 * - StepStrip 不在此渲染（仅流式时由 list 顶部展示）；
 * - 段头：HR · Agent · 模型名（仅有 model_name 时）；
 * - 段尾：token / 时间 元信息小字。
 */

import type { AgentMessage } from '@/types/agent';
import { Sparkles } from 'lucide-react';
import { BlockRenderer } from './blocks/block-renderer';
import { attachReasoning } from './blocks/group-blocks';

export interface AgentMessageCardProps {
  message: AgentMessage;
  /** interaction 提交进行中：禁用提交按钮防重复点击 */
  submitting?: boolean;
  onSubmitInteraction: (requestId: string, values: Record<string, unknown>) => void;
}

export function AgentMessageCard({ message, submitting, onSubmitInteraction }: AgentMessageCardProps) {
  const blocks = attachReasoning(message.content.blocks ?? []);

  // 无 block 的 agent 消息不渲染
  if (blocks.length === 0) return null;

  return (
    <div className="relative pl-11">
      {/* Agent 助手徽标（rail 起点锚点） */}
      <div className="absolute left-0 top-0 flex h-8 w-8 items-center justify-center rounded-xl
                      bg-gradient-to-br from-[#0EA5E9] to-[#0369A1] text-white
                      shadow-[0_4px_10px_-3px_rgba(3,105,161,0.5)]
                      ring-1 ring-inset ring-white/20">
        <Sparkles size={15} className="fill-white/25" strokeWidth={2.2} />
      </div>

      {/* 左 accent rail：sky 渐变垂直线，与流式态用同骨架不同色（流式更亮，由 list 渲染） */}
      <div
        className="relative pl-4 py-1
                   border-l-2 border-transparent
                   [border-image:linear-gradient(180deg,#0EA5E9_0%,#0369A1_60%,transparent_100%)_1]"
      >
        {/* 段头：HR · Agent · 模型名 */}
        <div className="flex items-center gap-2 mb-2 text-[11px] text-[#64748B]">
          <span className="font-semibold text-[#334155]">HR · Agent</span>
          {message.model_name && (
            <>
              <span className="w-[3px] h-[3px] rounded-full bg-[#CBD5E1]" />
              <span className="font-mono">{message.model_name}</span>
            </>
          )}
        </div>

        {/* Blocks：space-y 替代 divide */}
        <div className="space-y-3">
          {blocks.map((block) => (
            <BlockRenderer
              key={block.index}
              block={block}
              submitting={submitting}
              onSubmitInteraction={
                block.type === 'interaction' ? onSubmitInteraction : undefined
              }
            />
          ))}
        </div>

        {/* 段尾元信息：token + 时间 inline 小字 */}
        {(message.token_count != null || message.create_time) && (
          <div className="flex items-center gap-2 mt-3 text-[10.5px] text-[#94A3B8] font-mono">
            {message.token_count != null && <span>{message.token_count} token</span>}
            {message.token_count != null && message.create_time && (
              <span className="w-[3px] h-[3px] rounded-full bg-[#E2E8F0]" />
            )}
            {message.create_time && <span>{message.create_time}</span>}
          </div>
        )}
      </div>
    </div>
  );
}
