/**
 * AgentMessageCard：Agent 响应消息（rail 骨架）
 *
 * 设计要点（对话流方案 A + dev 0ce2fb3 流式复用机制）：
 * - 去掉"外卡 + divide-y"，整段以左 accent rail + 头像锚点连成一条；
 * - block 之间用 spacing 而非 divider；
 * - 仅业务结果块（interview_questions / evaluation_report）由各自渲染器内
 *   使用 result-card 浮起，作为唯一"突出层"；
 * - 流式与历史复用同一个本组件：streaming flag 切换 rail 颜色 / 段头文案 /
 *   railGlow 呼吸光 / QuestionSkeleton 显隐 / 段尾可见性，
 *   流式 → reload 历史时 DOM 节点不重建，仅 className/子节点增减 → 无视觉跳动。
 *   （进度展示已迁至右上角悬浮进度岛 FloatingProgress，本组件不再承载步骤进度。）
 */

import type { AgentMessage } from '@/types/agent';
import { Sparkles } from 'lucide-react';
import { BlockRenderer } from './blocks/block-renderer';
import { attachReasoning } from './blocks/group-blocks';

export interface AgentMessageCardProps {
  message: AgentMessage;
  /** 是否处于流式渲染状态（伪消息）：影响段头文案 / rail 颜色 / railGlow 呼吸光 */
  streaming?: boolean;
  /** fanout 期间题目骨架屏（仅 streaming 有效） */
  showSkeleton?: boolean;
  /** interaction 提交进行中：禁用提交按钮防重复点击 */
  submitting?: boolean;
  onSubmitInteraction: (requestId: string, values: Record<string, unknown>) => void;
}

export function AgentMessageCard({
  message, streaming, showSkeleton, submitting, onSubmitInteraction,
}: AgentMessageCardProps) {
  const blocks = attachReasoning(message.content.blocks ?? []);

  // 流式期间即使无 block 也要渲染外壳（承载伪消息 blocks 与 QuestionSkeleton）；历史无 block 不渲染
  if (blocks.length === 0 && !streaming) return null;

  // rail border-image：流式更亮（sky300 起），历史主蓝（sky500 起），切换时无节点重建
  const railBorderImage = streaming
    ? '[border-image:linear-gradient(180deg,#7DD3FC_0%,#0EA5E9_50%,#0369A1_100%)_1]'
    : '[border-image:linear-gradient(180deg,#0EA5E9_0%,#0369A1_60%,transparent_100%)_1]';
  // railGlow 呼吸光：仅流式追加
  const railAnim = streaming
    ? 'animate-[railGlow_1.6s_cubic-bezier(0.4,0,0.6,1)_infinite] motion-reduce:animate-none'
    : '';

  return (
    <div className="relative pl-11">
      {/* Agent 助手徽标（rail 起点锚点，流式与历史同位置） */}
      <div className="absolute left-0 top-0 flex h-8 w-8 items-center justify-center rounded-xl
                      bg-gradient-to-br from-[#0EA5E9] to-[#0369A1] text-white
                      shadow-[0_4px_10px_-3px_rgba(3,105,161,0.5)]
                      ring-1 ring-inset ring-white/20">
        <Sparkles size={15} className="fill-white/25" strokeWidth={2.2} />
      </div>

      {/* 左 accent rail（border-image 渐变垂直线）：streaming 切换颜色与呼吸光 */}
      <div className={`relative pl-4 py-1 border-l-2 border-transparent ${railBorderImage} ${railAnim}`}>
        {/* 段头：流式 = '生成中…'，历史 = 'HR · Agent · 模型名' */}
        <div className="flex items-center gap-2 mb-2 text-[11px] text-[#64748B]">
          <span className="font-semibold text-[#334155]">HR · Agent</span>
          {streaming ? (
            <>
              <span className="w-[3px] h-[3px] rounded-full bg-[#CBD5E1]" />
              <span className="text-[#0EA5E9] font-medium animate-pulse">生成中…</span>
            </>
          ) : message.model_name ? (
            <>
              <span className="w-[3px] h-[3px] rounded-full bg-[#CBD5E1]" />
              <span className="font-mono">{message.model_name}</span>
            </>
          ) : null}
        </div>

        {/* Blocks：space-y-3 替代 divide-y（保留 rail 视觉） */}
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
          {/* fanout 骨架屏：仅 streaming && showSkeleton */}
          {streaming && showSkeleton && <QuestionSkeleton />}
        </div>

        {/* 段尾 inline 元信息：流式时不显示（避免 reload 后突然冒出抖一下）；历史时显示 */}
        {!streaming && (message.token_count != null || message.create_time) && (
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

/** fanout 期间题目骨架卡：shimmer 占位（流式复用 card 后归属本文件） */
function QuestionSkeleton() {
  return (
    <div className="space-y-2.5">
      {[0, 1, 2].map(i => (
        <div key={i} className="space-y-1.5">
          <div className="h-3 rounded bg-[#E2E8F0] bg-gradient-to-r from-[#E2E8F0] via-[#F1F5F9] to-[#E2E8F0]
                          bg-[length:200%_100%] animate-[shimmer_1.8s_linear_infinite] w-3/4" />
          <div className="h-2.5 rounded bg-[#E2E8F0] bg-gradient-to-r from-[#E2E8F0] via-[#F1F5F9] to-[#E2E8F0]
                          bg-[length:200%_100%] animate-[shimmer_1.8s_linear_infinite] w-full" />
          <div className="h-2.5 rounded bg-[#E2E8F0] bg-gradient-to-r from-[#E2E8F0] via-[#F1F5F9] to-[#E2E8F0]
                          bg-[length:200%_100%] animate-[shimmer_1.8s_linear_infinite] w-5/6" />
        </div>
      ))}
    </div>
  );
}
