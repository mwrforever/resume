/**
 * AgentMessageList：消息列表渲染。
 *
 * 流式与历史共用同一管线：
 * - 历史消息：messages.map(MessageRow)
 * - 流式正在构造：RunRow（流式 current_blocks）
 */

import { useEffect } from 'react';
import { AlertCircle, RefreshCw } from 'lucide-react';
import type { AgentMessage, AgentRunState, WorkflowType } from '@/types/agent';
import { BlockRenderer } from './blocks/block-renderer';
import { attachReasoning } from './blocks/group-blocks';
import { StepStrip } from './step-strip';
import { useFollowBottom } from '@/hooks/use-follow-bottom';
import { EmptyState } from './empty-state';
import { ResumeFileIcon } from './resume-file-icon';
import { AgentMessageCard } from './agent-message-card';

export interface AgentMessageListProps {
  messages: AgentMessage[];
  runState: AgentRunState;
  /** 是否正在提交 interaction / 发送消息 → 透传给 interaction 卡片禁用按钮 */
  sending?: boolean;
  onSubmitInteraction: (requestId: string, values: Record<string, unknown>) => void;
  /** 选中空态快捷问答：可同时回填文案与联动切换 workflow 模式 */
  onPickPrompt?: (prompt: string, workflow?: WorkflowType) => void;
  onRetry?: () => void;
}

export function AgentMessageList({ messages, runState, sending, onSubmitInteraction, onPickPrompt, onRetry }: AgentMessageListProps) {
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
        <EmptyState onPickPrompt={onPickPrompt ?? (() => {})} />
      </div>
    );
  }

  // 骨架屏条件：有 tool_use(running) 但还没产出 interview_questions
  // （fanout 并行生成期间，让用户看到题目正在加载）
  const hasToolRunning = runState.current_blocks.some(
    b => b.type === 'tool_use' && b.status === 'streaming',
  );
  const hasQuestionBlock = runState.current_blocks.some(b => b.type === 'interview_questions');
  const showSkeleton = runState.running && hasToolRunning && !hasQuestionBlock;

  return (
    <div ref={ref} className="flex-1 overflow-y-auto bg-[#F8FAFC]">
      <div className="mx-auto max-w-[880px] px-4 py-6 space-y-6">
        {messages.map(msg => (
          <MessageRow
            key={msg.id}
            message={msg}
            submitting={sending}
            onSubmitInteraction={onSubmitInteraction}
          />
        ))}

        {/* 流式正在构造的 blocks */}
        {runState.running && (
          <div className="space-y-2">
            <StepStrip steps={runState.steps} running={runState.running} />
            <div className="relative border border-[#BAE6FD]/60 rounded-2xl bg-white
                            overflow-hidden animate-[cardEnter_0.32s_cubic-bezier(0.16,1,0.3,1)]
                            shadow-[0_1px_3px_rgba(2,6,23,0.05),0_12px_32px_-12px_rgba(3,105,161,0.14)]">
              {/* 左侧 3px 品牌蓝 accent 条（渐变，与历史卡区分：流式更亮） */}
              <div className="absolute left-0 top-0 bottom-0 w-[3px] bg-gradient-to-b from-[#38BDF8] via-[#0EA5E9] to-[#0369A1]" />
              <div className="divide-y divide-[#E2E8F0]">
                {attachReasoning(runState.current_blocks).map(b => (
                  <div key={b.index} className="px-4 py-3">
                    <BlockRenderer
                      block={b}
                      submitting={sending}
                      onSubmitInteraction={
                        b.type === 'interaction' ? onSubmitInteraction : undefined
                      }
                    />
                  </div>
                ))}
                {/* fanout 骨架屏：题目正在并行生成 */}
                {showSkeleton && <QuestionSkeleton />}
              </div>
            </div>
          </div>
        )}

        {/* 错误提示：带重试按钮的卡片 */}
        {runState.error && (
          <div
            role="alert"
            className="flex items-start gap-3 rounded-2xl border border-[#FCA5A5]/80 bg-[#FEF2F2] p-3 text-sm text-[#DC2626]
                       shadow-[0_1px_3px_rgba(220,38,38,0.08),0_8px_20px_-12px_rgba(220,38,38,0.16)]
                       animate-[cardEnter_0.3s_ease]"
          >
            <AlertCircle size={16} className="mt-0.5 shrink-0" />
            <div className="flex-1">
              <div className="font-medium">运行出错了</div>
              <div className="text-xs text-[#B91C1C] mt-0.5">
                [{runState.error.code}] {runState.error.message}
              </div>
            </div>
            {onRetry && (
              <button
                type="button"
                onClick={onRetry}
                className="inline-flex items-center gap-1 h-7 px-2.5 rounded-md
                           border border-[#DC2626]/30 text-xs text-[#DC2626]
                           hover:bg-[#FEE2E2] transition-colors shrink-0"
              >
                <RefreshCw size={12} />
                <span>重试</span>
              </button>
            )}
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

/** 单条消息渲染 */
function MessageRow({
  message,
  submitting,
  onSubmitInteraction,
}: {
  message: AgentMessage;
  submitting?: boolean;
  onSubmitInteraction: (id: string, v: Record<string, unknown>) => void;
}) {
  if (message.role === 'user') {
    const userText = (message.content.blocks?.[0] as { type: 'text'; text: string } | undefined)?.text ?? '';
    // 本条消息附带的简历引用（后端已持久化到 content.context_refs，仅供展示文件图标）
    const resumeRefs = (message.content.context_refs ?? []).filter(
      r => String(r.type ?? '').toLowerCase() === 'resume',
    ) as Array<{ file_path?: string; file_name?: string }>;
    return (
      <div className="flex justify-end mb-4">
        <div className="max-w-[560px] flex flex-col items-end gap-1.5">
          {userText && (
            <div className="rounded-2xl rounded-br-lg bg-gradient-to-br from-[#0EA5E9] to-[#0369A1] text-white px-4 py-2.5 text-sm whitespace-pre-wrap leading-relaxed
                            shadow-[0_2px_8px_-3px_rgba(3,105,161,0.4)] ring-1 ring-inset ring-white/10">
              {userText}
            </div>
          )}
          {resumeRefs.map((r, i) => {
            const fileName = String(r.file_name ?? '');
            return (
              <div
                key={i}
                className="inline-flex items-center gap-2 rounded-lg bg-[#E0F2FE] text-[#0369A1] text-xs font-medium border border-[#0EA5E9]/20 px-2.5 py-1.5"
                title={fileName}
              >
                <ResumeFileIcon fileName={fileName} size={16} />
                <span className="truncate max-w-[220px]">{fileName}</span>
              </div>
            );
          })}
        </div>
      </div>
    );
  }
  return (
    <AgentMessageCard
      message={message}
      submitting={submitting}
      onSubmitInteraction={onSubmitInteraction}
    />
  );
}
