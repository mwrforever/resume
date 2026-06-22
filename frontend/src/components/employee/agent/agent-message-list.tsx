/**
 * AgentMessageList：消息列表渲染。
 *
 * 流式与历史共用同一管线：
 * - 历史消息：messages.map(MessageRow)
 * - 流式正在构造：与历史共用 AgentMessageCard 外壳（agent 头像 + accent 条 + divide blocks）
 *   渲染为"伪消息"。这样流式 → reload 历史时，DOM 结构一致，只有内容增减，
 *   避免视觉跳动。进度展示已由右上角悬浮进度岛 FloatingProgress 承载，本列表不再渲染步骤进度。
 */

import { useEffect, useMemo } from 'react';
import { AlertCircle, RefreshCw } from 'lucide-react';
import { InterruptBar } from './interrupt-bar';
import type { AgentMessage, AgentRunState, WorkflowType } from '@/types/agent';
import { useFollowBottom } from '@/hooks/use-follow-bottom';
import { EmptyState } from './empty-state';
import { ResumeFileIcon } from './resume-file-icon';
import { AgentMessageCard } from './agent-message-card';

/**
 * InterruptBar 显示判定（双信号 OR 兜底）。
 *
 * ① runState.aborted：前端即时信号。用户点击「暂停」瞬间置 true，不限 running 状态，
 *   中断瞬间与 pseudoStreamingMessage 同屏（内容冻结 + 中断提示），不等 reload。
 * ② !running && !sending && last.content.interrupted：后端持久化信号。刷新/断网恢复场景，
 *   aborted 已随内存丢失，靠 DB 标记兜底。!sending 排除重试发起窗口（aborted 已清但
 *   run.start 未到达、上一轮 content.interrupted 仍在）避免残留误导。
 *
 * error 非空时不显示（走红色 callout，互斥）。
 */
export function shouldShowInterruptBar(
  runState: AgentRunState,
  messages: AgentMessage[],
  sending: boolean,
): boolean {
  if (runState.error) return false;
  if (runState.aborted) return true;
  if (!runState.running && !sending) {
    const last = messages[messages.length - 1];
    return last?.content?.interrupted === true;
  }
  return false;
}

export interface AgentMessageListProps {
  messages: AgentMessage[];
  runState: AgentRunState;
  /** 是否正在提交 interaction / 发送消息 → 透传给 interaction 卡片禁用按钮 */
  sending?: boolean;
  onSubmitInteraction: (requestId: string, values: Record<string, unknown>) => void;
  /** 选中空态快捷问答：可同时回填文案与联动切换 workflow 模式 */
  onPickPrompt?: (prompt: string, workflow?: WorkflowType) => void;
  /** 错误重试（仅 runState.error 红色 callout 使用） */
  onRetry?: () => void;
  /** 中断恢复（调 store.resumeRun 续接 checkpoint，非重发）。
   *  仅在中断态 InterruptBar 使用；提供时显示"重试"按钮。 */
  onResume?: () => void;
}

export function AgentMessageList({
  messages, runState, sending, onSubmitInteraction, onPickPrompt, onRetry, onResume,
}: AgentMessageListProps) {
  const { ref, followIfNeeded, forceSmoothToBottom } = useFollowBottom();

  // 流式期间新增 envelope → 触发滚动 follow
  useEffect(() => {
    followIfNeeded();
  }, [runState.current_blocks.length, runState.steps.length, followIfNeeded]);

  // 流式结束 → smooth 对齐到底
  useEffect(() => {
    if (!runState.running) forceSmoothToBottom();
  }, [runState.running, forceSmoothToBottom]);

  // 把流式 runState 包装成"伪消息"，复用 AgentMessageCard 外壳：
  // - id 用固定 -1（不会与真实消息冲突）
  // - blocks 取自 runState.current_blocks
  // 此举让"流式 → reload 历史"切换时 DOM 结构一致，仅内容发生增减，避免高度跳动。
  // 必须在下方 early return 之前调用——否则 running 切换时 hook 数量变化会触发
  // "Rendered fewer hooks than expected" 崩溃（中断瞬间白屏）。
  const pseudoStreamingMessage = useMemo<AgentMessage | null>(() => {
    // 流式中（running）或中断后本地兜底（aborted + current_blocks 非空，reload 尚未替换为落库消息）。
    // 中断时 store.abort 已把 streaming block 标记为 cancelled，这里继续渲染让 UI 立即显示「已取消」。
    if (!runState.running && !runState.aborted) return null;
    if (runState.current_blocks.length === 0 && runState.steps.length === 0) return null;
    return {
      id: -1,
      session_id: 0,
      parent_message_id: null,
      role: 'agent',
      workflow_type: runState.workflow_type,
      run_id: runState.run_id,
      content: { blocks: runState.current_blocks },
      model_name: null,
      token_count: null,
      sort_order: Number.MAX_SAFE_INTEGER,
      create_time: null,
    };
  }, [runState.running, runState.aborted, runState.current_blocks, runState.steps.length, runState.run_id, runState.workflow_type]);

  // 空态：无历史消息 + 无 run 进行中（所有 hooks 已在上方无条件执行，符合 Hooks 规则）
  if (messages.length === 0 && !runState.running) {
    return (
      <div ref={ref} className="flex-1 overflow-y-auto thin-scroll bg-[#F8FAFC]">
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
    <div ref={ref} className="flex-1 overflow-y-auto thin-scroll bg-[#F8FAFC]">
      <div className="mx-auto max-w-[880px] px-4 py-6 space-y-6">
        {messages.map(msg => (
          <MessageRow
            key={msg.id}
            message={msg}
            submitting={sending}
            onSubmitInteraction={onSubmitInteraction}
          />
        ))}

        {/* 流式正在构造的 blocks：与历史卡共用 AgentMessageCard 外壳，避免切换跳动。
            流式期间 message.id=-1 视作占位伪消息；run.finish reload 后被真实消息替换，
            React 会按 key 销毁伪消息节点，但因为同一容器内的真实消息节点结构相同，
            视觉上像是"伪消息平滑变成真实消息"。 */}
        {pseudoStreamingMessage && (
          <AgentMessageCard
            message={pseudoStreamingMessage}
            submitting={sending}
            onSubmitInteraction={onSubmitInteraction}
            streaming
            showSkeleton={showSkeleton}
          />
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
              <div className="font-medium">
                {runState.error.code === 'no_resumable_checkpoint' ? '流程状态已过期' : '运行出错了'}
              </div>
              <div className="text-xs text-[#B91C1C] mt-0.5">
                {runState.error.code === 'no_resumable_checkpoint'
                  ? '服务可能已重启，无法续接上次的流程。请重新发送消息开始新的流程。'
                  : `[${runState.error.code}] ${runState.error.message}`}
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

        {/* 中断提示：双信号 OR（shouldShowInterruptBar 纯函数封装，见文件顶部） */}
        {shouldShowInterruptBar(runState, messages, sending ?? false) && onResume && (
          <InterruptBar onResume={onResume} />
        )}
      </div>
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
