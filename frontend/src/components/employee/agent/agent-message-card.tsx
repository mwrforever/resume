/**
 * AgentMessageCard：Agent 响应消息单卡片包裹
 *
 * 将一条 AgentMessage 的所有 block 包裹在同一个卡片容器内，
 * block 之间用 divider 分隔，底部显示模型/token 等元信息。
 *
 * 流式与历史共用本组件以保持 DOM 结构一致：
 * - streaming=true：accent 条更亮（亮蓝 → 主蓝渐变），渲染 StepStrip 与可选骨架屏；
 * - streaming=false：accent 条主蓝、隐藏 StepStrip；底部显示元信息行。
 * 二者切换时仅 className / 子节点增减，外层节点不变 → 视觉无跳动。
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
  /** 是否处于流式渲染状态（伪消息）：影响 accent 颜色 / StepStrip / 元信息行可见性 */
  streaming?: boolean;
  /** fanout 期间题目骨架屏（仅 streaming 有效） */
  showSkeleton?: boolean;
}

export function AgentMessageCard({
  message, runState, submitting, onSubmitInteraction, streaming, showSkeleton,
}: AgentMessageCardProps) {
  const blocks = attachReasoning(message.content.blocks ?? []);

  // 流式期间即使无 block 也要渲染外壳（让用户看到 StepStrip 进度）；历史无 block 不渲染。
  if (blocks.length === 0 && !streaming) return null;

  // accent 条样式：流式期间更亮（38BDF8 → 0EA5E9 → 0369A1，与原流式卡保持一致），
  // 历史固化为主蓝（0EA5E9 → 0369A1）。通过 CSS transition 实现渐变切换。
  const accentClass = streaming
    ? 'bg-gradient-to-b from-[#38BDF8] via-[#0EA5E9] to-[#0369A1]'
    : 'bg-gradient-to-b from-[#0EA5E9] to-[#0369A1]';

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
                    transition-shadow duration-300 ease-[cubic-bezier(0.16,1,0.3,1)]">
      {/* 左侧 3px accent 条：流式 → 历史时颜色渐变过渡（不重建节点）。
          流式 → 历史切换时整张卡的 DOM 不变，仅 className 切换 + 子节点折叠 → 无跳动。 */}
      <div
        className={`absolute left-0 top-0 bottom-0 w-[3px] transition-colors duration-300 ${accentClass}`}
      />

      {/* StepStrip（仅流式或当前 run 中显示）：max-height 折叠过渡避免直接 unmount 导致高度突变 */}
      <div
        className={`overflow-hidden transition-[max-height,opacity] duration-300 ease-[cubic-bezier(0.16,1,0.3,1)]
                    ${streaming && runState && runState.steps.length > 0
                      ? 'max-h-[200px] opacity-100 border-b border-[#E2E8F0]'
                      : 'max-h-0 opacity-0'}`}
      >
        {runState && runState.steps.length > 0 && (
          <StepStrip steps={runState.steps} running={runState.running} />
        )}
      </div>

      {/* Blocks */}
      <div className="divide-y divide-[#E2E8F0]">
        {blocks.map((block) => (
          <div
            key={block.index}
            className="px-4 py-3 animate-[blockEnter_0.24s_cubic-bezier(0.16,1,0.3,1)_both]"
          >
            <BlockRenderer
              block={block}
              submitting={submitting}
              onSubmitInteraction={
                block.type === 'interaction' ? onSubmitInteraction : undefined
              }
            />
          </div>
        ))}
        {/* fanout 期间题目骨架屏：仅 streaming 有效 */}
        {streaming && showSkeleton && <QuestionSkeleton />}
      </div>

      {/* 元信息 Footer：流式期间不显示（避免 reload 后突然冒出抖一下高度）；历史时显示 */}
      {!streaming && (message.model_name || message.token_count || message.create_time) && (
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

/** fanout 期间题目骨架卡：shimmer 占位 */
function QuestionSkeleton() {
  return (
    <div className="px-4 py-3 space-y-2.5">
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
