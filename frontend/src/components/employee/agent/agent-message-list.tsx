/**
 * AgentMessageList：消息列表渲染。
 *
 * 流式与历史共用同一管线：
 * - 历史消息：messages.map(MessageRow)
 * - 流式正在构造：与历史共用 AgentMessageCard 外壳（agent 头像 + accent 条 + divide blocks）
 *   渲染为"伪消息"。这样流式 → reload 历史时，DOM 结构一致，只有内容增减 + 头部
 *   StepStrip 折叠，避免视觉跳动。
 */

import { useEffect, useMemo } from 'react';
import { AlertCircle, RefreshCw } from 'lucide-react';
import { InterruptBar } from './interrupt-bar';
import type { AgentMessage, AgentRunState, WorkflowType } from '@/types/agent';
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
  /** 错误重试（仅 runState.error 红色 callout 使用） */
  onRetry?: () => void;
  /** 中断重发（用最后一条 user 消息内容重新发起，bug 1） */
  onRetryFromLastUser?: () => void;
}

export function AgentMessageList({
  messages, runState, sending, onSubmitInteraction, onPickPrompt, onRetry, onRetryFromLastUser,
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

  // 空态：无历史消息 + 无 run 进行中（所有 hooks 已在上方无条件执行，符合 Hooks 规则）
  if (messages.length === 0 && !runState.running) {
    return (
      <div ref={ref} className="flex-1 overflow-y-auto bg-[#F8FAFC]">
        <EmptyState onPickPrompt={onPickPrompt ?? (() => {})} />
      </div>
    );
  }

  // 把流式 runState 包装成"伪消息"，复用 AgentMessageCard 外壳：
  // - id 用固定 -1（不会与真实消息冲突）
  // - blocks 取自 runState.current_blocks
  // - 通过把 runState 透传给 AgentMessageCard 的 runState 入参，渲染 StepStrip
  // 此举让"流式 → reload 历史"切换时 DOM 结构一致，仅内容发生增减，避免高度跳动。
  const pseudoStreamingMessage = useMemo<AgentMessage | null>(() => {
    if (!runState.running) return null;
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
  }, [runState.running, runState.current_blocks, runState.steps.length, runState.run_id, runState.workflow_type]);

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

        {/* 流式正在构造的 blocks：与历史卡共用 AgentMessageCard 外壳，避免切换跳动。
            流式期间 message.id=-1 视作占位伪消息；run.finish reload 后被真实消息替换，
            React 会按 key 销毁伪消息节点，但因为同一容器内的真实消息节点结构相同，
            视觉上像是"伪消息平滑变成真实消息"。 */}
        {pseudoStreamingMessage && (
          <AgentMessageCard
            message={pseudoStreamingMessage}
            runState={runState}
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

        {/* 中断提示（bug 1）：刷新打断或后端 error 后，最后一条 agent 消息含 streaming block 时显示。
            仅在没有正在跑的 run 时显示（避免和流式状态条同屏）；
            runState.error 红色 callout 与本 pill 不会同屏（前者依赖 runState.error，后者依赖 !runState.running 且无 runState.error）。 */}
        {!runState.running && !runState.error && isLastAgentMessageInterrupted(messages) && onRetryFromLastUser && (
          <InterruptBar
            onRetry={onRetryFromLastUser}
            retrying={sending}
          />
        )}
      </div>
    </div>
  );
}

/**
 * 判定最后一条 agent 消息是否被中断。
 *
 * 后端在客户端断开 / 后端 error 时，finally 块仍把已生成的 envelopes 折叠落库
 * （agent_runtime_service._persist_agent_message），但部分 block 来不及发 block.stop，
 * 落库时 status 仍为 'streaming'。
 *
 * 其它结束路径不会留 streaming：
 * - 正常 END：全 success
 * - interrupt 暂停（人机交互卡）：interaction block 是 pending（runner.py:107 emit 时就是 pending）
 *   text/tool_use 都是 success
 * - 用户 abort：interaction 是 expired
 *
 * 因此 'streaming' 是「被中断」的精确信号，pending interaction 不会误命中。
 *
 * @param messages 落库消息数组
 * @returns true 表示最后一条 agent 消息被中断（应渲染 InterruptBar）
 */
export function isLastAgentMessageInterrupted(messages: AgentMessage[]): boolean {
  if (messages.length === 0) return false;
  const last = messages[messages.length - 1];
  if (last.role !== 'agent') return false;
  return (last.content.blocks ?? []).some(b => b.status === 'streaming');
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
      runState={null}
      submitting={submitting}
      onSubmitInteraction={onSubmitInteraction}
    />
  );
}
