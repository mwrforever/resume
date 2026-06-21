/**
 * AgentWorkspace：消息运行区（瘦身版）
 *
 * 持有 prefill 状态：EmptyState 点击卡片 → setPrefill({ prompt, workflow? })
 * Composer 消费后调用 onPrefillConsumed 清除；workflow 可联动切换模式。
 */

import { useCallback, useRef, useState } from 'react';
import { AgentMessageList } from './agent-message-list';
import { AgentComposer } from './agent-composer';
import { FloatingProgress } from './progress-tracker/floating-progress';
import { selectProgressSource } from './progress-source';
import { useAgentRun } from '@/hooks/use-agent-run';
import { useAgentStore } from '@/store/agent';
import type { SendInput } from '@/hooks/use-agent-run';
import type { WorkflowType, WorkspaceSession } from '@/types/agent';

export interface AgentWorkspaceProps {
  sessionId: number | null;
  onSessionUpdate: (s: WorkspaceSession) => void;
}

export function AgentWorkspace({ sessionId, onSessionUpdate }: AgentWorkspaceProps) {
  if (sessionId === null) {
    return (
      <main className="flex-1 flex items-center justify-center text-sm text-[#94A3B8]">
        请选择或创建会话
      </main>
    );
  }
  return (
    <WorkspaceInner
      key={sessionId}
      sessionId={sessionId}
      onSessionUpdate={onSessionUpdate}
    />
  );
}

/** 主内容区：消息列表 + 输入框 */
function WorkspaceInner({
  sessionId,
  onSessionUpdate,
}: {
  sessionId: number;
  onSessionUpdate: (s: WorkspaceSession) => void;
}) {
  // 标题乐观更新回调：sendMessage 时由 hook 触发，同步到侧边栏 sessions 列表
  // （hook 内已 patchSession 更新本地 session，这里只负责同步上层 sessions）
  // 必须在 useAgentRun 之前用 useCallback 定义，避免 TDZ 与无限依赖
  const handleOptimisticSession = useCallback((next: WorkspaceSession) => {
    onSessionUpdate(next);
  }, [onSessionUpdate]);
  const { session, messages, runState, sending, sendMessage, submit, abort } = useAgentRun(sessionId, handleOptimisticSession);
  // 思考模式/模型选择走 store action（区分空会话写全局默认 / 中途会话仅写当前会话）
  const toggleThinking = useAgentStore((s) => s.toggleThinking);
  const selectModel = useAgentStore((s) => s.selectModel);
  // A2：中断恢复走 store.resumeRun（续接 LangGraph checkpoint，非重发）
  const resumeRun = useAgentStore((s) => s.resumeRun);
  /** 空态快捷问答回填：可携带 workflow（点击评估类问答联动切换 Composer 模式） */
  const [prefill, setPrefill] = useState<{ prompt: string; workflow?: WorkflowType } | null>(null);
  // 记录最近一次发送入参，供错误态"重试"复用
  const lastInputRef = useRef<SendInput | null>(null);

  // 发送时缓存入参，供错误态"重试"复用
  const handleSend = useCallback((input: SendInput) => {
    lastInputRef.current = input;
    void sendMessage(input);
  }, [sendMessage]);

  // 重试 = 重新发送最近一条用户消息
  const handleRetry = useCallback(() => {
    if (lastInputRef.current) void sendMessage(lastInputRef.current);
  }, [sendMessage]);

  // 中断重发（bug 1）：用 messages 数组里最后一条 user 消息内容重新发起。
  // 与 handleRetry 区别：handleRetry 用 lastInputRef（内存中的本次 send 入参），
  // 刷新后内存丢失但 messages 还有落库的 user 消息，所以中断重发必须从 messages 取。
  const handleRetryFromLastUser = useCallback(() => {
    // 倒序找最近一条 user 消息
    const lastUser = [...messages].reverse().find(m => m.role === 'user');
    if (!lastUser) return;
    // 查找 type==='text' 的 block（user 消息通常只有一个 text block，但用 find 更严谨）
    const textBlock = (lastUser.content.blocks ?? []).find(
      b => b.type === 'text',
    ) as { type: 'text'; text: string } | undefined;
    const userText = textBlock?.text?.trim() ?? '';
    if (!userText) return;
    handleSend({
      content: userText,
      workflow_type: lastUser.workflow_type,
      context_refs: lastUser.content.context_refs,
    });
  }, [messages, handleSend]);

  // ⚠️ 所有 hooks 必须在任何 early return 之前调用完毕，
  // 否则 session null→非 null 切换时 hook 调用顺序变化会触发 React 报错。

  if (!session) {
    return (
      <main className="flex-1 flex items-center justify-center text-sm text-[#64748B]">
        加载中…（第 {sessionId} 号会话）
      </main>
    );
  }

  // 同时同步上层 sessions 数组与 hook 内 session（hook 内的才是 Composer 的渲染源）

  // 进度数据源（修复 Bug1：取信息更完整的一方，避免结束瞬间闪空）
  const progress = selectProgressSource({
    runStateSteps: runState.steps,
    runStateWorkflow: runState.workflow_type,
    sessionProgress: session.progress ?? null,
    lastMessageWorkflow: messages.length > 0 ? messages[messages.length - 1].workflow_type : undefined,
  });

  return (
    <div className="relative flex flex-1 min-w-0">
      <main className="flex flex-1 flex-col min-w-0">
        <AgentMessageList
          messages={messages}
          runState={runState}
          sending={sending}
          onSubmitInteraction={submit}
          onPickPrompt={(prompt, workflow) => setPrefill({ prompt, workflow })}
          onRetry={handleRetry}
          onResume={() => void resumeRun(sessionId)}
          onRetryFromLastUser={handleRetryFromLastUser}
        />
        <AgentComposer
          session={session}
          sending={sending}
          lastWorkflow={messages.length > 0 ? messages[messages.length - 1].workflow_type : 'interview_questions'}
          prefill={prefill}
          onPrefillConsumed={() => setPrefill(null)}
          onSend={(input) => handleSend({
            ...input,
            enable_thinking: session.enable_thinking,
            model_name: session.selected_model_name,
          })}
          onAbort={abort}
          onToggleThinking={() => toggleThinking(sessionId)}
          onPickModel={(modelName) => selectModel(sessionId, modelName)}
          isEmptySession={messages.length === 0}
        />
      </main>
      {/* 右上角悬浮进度岛（替换旧侧边第三栏）。
          Bug3：仅在已有消息（已发送到后端）时渲染；新建/空会话不显示，
          避免空 steps 经模板填充成 pending 节点后误显一串灰节点。 */}
      {messages.length > 0 && (
        <div data-testid="floating-progress">
          <FloatingProgress
            steps={progress.steps}
            running={runState.running}
            workflowType={progress.workflowType}
          />
        </div>
      )}
    </div>
  );
}
