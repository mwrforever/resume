import { AlertCircle, Bot, Brain, CheckCircle2, Loader2, UserRound, XCircle } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import type { IAgentActionStreamItem, IAgentInteractionRequestItem, IAgentMessageItem, IAgentRuntimeFeedItem, IAgentThinkingStreamItem, IPlanReviewUiState } from '@/types/agent';
import { AgentActionCard } from './agent-action-card';
import { AgentMarkdownContent } from './agent-markdown-content';
import { AgentInteractionCard } from './agent-interaction-card';
import { AgentRunCompactTimeline } from './agent-run-compact-timeline';
import { AgentThinkingPanel } from './agent-thinking-panel';
import { PlanReviewTree } from './plan-review-tree';
import { hiddenScrollClass, messageText } from './agent-ui-utils';

interface AgentMessageListProps {
  messages: IAgentMessageItem[];
  actionsByMessageId: Map<number, IAgentActionStreamItem[]>;
  runtimeFeedItems: IAgentRuntimeFeedItem[];
  thinkingItems?: IAgentThinkingStreamItem[];
  interactionRequests?: IAgentInteractionRequestItem[];
  planReview: IPlanReviewUiState | null;
  sending: boolean;
  errorMessage: string;
  messagesEndRef: React.RefObject<HTMLDivElement | null>;
  onConfirmAction: (action: IAgentActionStreamItem) => void;
  onRejectAction: (action: IAgentActionStreamItem) => void;
  onSubmitInteraction?: (requestId: string, values: Record<string, unknown>) => void;
  onPlanReviewFeedbackChange: (value: string) => void;
  onPlanReviewTaskInstructionChange: (taskId: string, instruction: string) => void;
  onPlanReviewApprove: () => void;
  onPlanReviewReject: () => void;
}

function RuntimeFeedRow({
  item,
  onConfirmAction,
  onRejectAction,
}: {
  item: IAgentRuntimeFeedItem;
  onConfirmAction: (action: IAgentActionStreamItem) => void;
  onRejectAction: (action: IAgentActionStreamItem) => void;
}) {
  if (item.type === 'action' && item.action) {
    return <AgentActionCard action={item.action} onConfirm={onConfirmAction} onReject={onRejectAction} />;
  }
  const isRunning = item.status === 'running';
  const isFailed = item.status === 'failed';
  return (
    <div
      className="ml-0 flex max-w-3xl items-center gap-3 rounded-3xl border border-sky-100 bg-sky-50/80 px-4 py-3 text-sm text-slate-700 shadow-sm shadow-sky-100/70 md:ml-12"
      data-runtime-feed-item={item.type}
    >
      <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-2xl bg-white text-sky-600 shadow-sm">
        {item.type === 'thinking' && <Brain size={15} className={isRunning ? 'animate-pulse' : ''} aria-hidden="true" />}
        {item.type === 'tool' && isRunning && <Loader2 size={15} className="animate-spin" aria-hidden="true" />}
        {item.type === 'tool' && item.status === 'success' && <CheckCircle2 size={15} className="text-emerald-600" aria-hidden="true" />}
        {isFailed && <XCircle size={15} className="text-red-600" aria-hidden="true" />}
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate font-semibold text-slate-900">{item.title}</span>
        <span className="mt-0.5 block text-xs text-slate-500">
          {isRunning ? '执行中' : item.status === 'success' ? '执行完成' : isFailed ? '执行失败' : '待确认'}
        </span>
        {item.message && <span className="mt-0.5 block text-xs text-red-600">{item.message}</span>}
      </span>
    </div>
  );
}

export function AgentMessageList({
  messages,
  actionsByMessageId,
  runtimeFeedItems,
  thinkingItems = [],
  interactionRequests = [],
  planReview,
  sending,
  errorMessage,
  messagesEndRef,
  onConfirmAction,
  onRejectAction,
  onSubmitInteraction,
  onPlanReviewFeedbackChange,
  onPlanReviewTaskInstructionChange,
  onPlanReviewApprove,
  onPlanReviewReject,
}: AgentMessageListProps) {
  const firstAgentMessageIndex = messages.findIndex((message) => message.role === 'agent');
  const insertRuntimeFeedAfterIndex = firstAgentMessageIndex > 0 ? firstAgentMessageIndex - 1 : messages.length - 1;

  return (
    <div
      className={`min-h-0 flex-1 overflow-y-auto bg-[radial-gradient(circle_at_top_left,rgba(14,165,233,0.08),transparent_18rem),linear-gradient(180deg,#ffffff_0%,#f8fafc_100%)] px-4 py-6 ${hiddenScrollClass}`}
      aria-live="polite"
    >
      {errorMessage && (
        <div role="alert" className="mx-auto mb-4 flex max-w-4xl gap-2 rounded-2xl border border-red-200 bg-red-50 p-3 text-sm text-red-700">
          <AlertCircle size={16} className="mt-0.5 shrink-0" aria-hidden="true" />
          <span>{errorMessage}</span>
        </div>
      )}
      <div className="mx-auto flex max-w-4xl flex-col gap-5">
        {messages.map((message, index) => {
          const isUser = message.role === 'user';
          const text = messageText(message.content.blocks || []);
          return (
            <div key={message.id} className="space-y-3">
              <div className="space-y-3">
                <div className={`flex gap-3 ${isUser ? 'justify-end' : 'justify-start'}`}>
                  {!isUser && (
                    <div className="mt-1 flex h-9 w-9 shrink-0 items-center justify-center rounded-2xl bg-sky-100 text-primary">
                      <Bot size={17} aria-hidden="true" />
                    </div>
                  )}
                  <div
                    className={`${isUser ? 'max-w-[78%] rounded-[1.4rem] bg-primary px-4 py-3 text-white shadow-sm shadow-sky-900/10' : 'max-w-[88%] rounded-[1.6rem] border border-slate-200 bg-white px-5 py-4 text-slate-900 shadow-sm shadow-slate-200/70'} text-sm leading-6`}
                  >
                    <div className="mb-2 flex items-center gap-2 text-xs font-semibold opacity-80">
                      {isUser ? <UserRound size={14} aria-hidden="true" /> : <Bot size={14} aria-hidden="true" />}
                      {isUser ? '你' : 'Agent'}
                      {message.model_name && <span>· {message.model_name}</span>}
                    </div>
                    {isUser ? <div className="whitespace-pre-wrap">{text}</div> : <AgentMarkdownContent content={text} />}
                    {message.token_count ? <div className="mt-3 text-xs opacity-70">tokens: {message.token_count}</div> : null}
                  </div>
                  {isUser && (
                    <div className="mt-1 flex h-9 w-9 shrink-0 items-center justify-center rounded-2xl bg-slate-950 text-white">
                      <UserRound size={17} aria-hidden="true" />
                    </div>
                  )}
                </div>
                {index === insertRuntimeFeedAfterIndex && <AgentRunCompactTimeline items={runtimeFeedItems} />}
                {index === insertRuntimeFeedAfterIndex && thinkingItems.map((item) => <AgentThinkingPanel key={item.id} item={item} />)}
                {index === insertRuntimeFeedAfterIndex &&
                  interactionRequests.map((item) => (
                    <AgentInteractionCard key={item.id} item={item} onSubmit={onSubmitInteraction || (() => undefined)} />
                  ))}
                {index === insertRuntimeFeedAfterIndex &&
                  runtimeFeedItems
                    .filter((item) => item.type === 'action' && item.action)
                    .map((item) => (
                      <RuntimeFeedRow key={item.id} item={item} onConfirmAction={onConfirmAction} onRejectAction={onRejectAction} />
                    ))}
              </div>
              {(actionsByMessageId.get(message.id) || []).map((action) => (
                <AgentActionCard key={action.id} action={action} onConfirm={onConfirmAction} onReject={onRejectAction} />
              ))}
            </div>
          );
        })}
        {planReview && (
          <PlanReviewTree
            revision={planReview.revision}
            maxRevisions={planReview.maxRevisions}
            tasks={planReview.tasks}
            editable={planReview.editable}
            repairSuggestions={planReview.repairSuggestions}
            feedbackDraft={planReview.feedbackDraft}
            submitting={planReview.phase === 'submitting' || sending}
            onFeedbackChange={onPlanReviewFeedbackChange}
            onTaskInstructionChange={onPlanReviewTaskInstructionChange}
            onApprove={onPlanReviewApprove}
            onReject={onPlanReviewReject}
          />
        )}
        {sending && !planReview && (
          <div className="flex items-center gap-3 text-sm text-slate-500">
            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-2xl bg-sky-100 text-primary">
              <Bot size={17} aria-hidden="true" />
            </div>
            <div className="rounded-2xl border border-slate-200 bg-white px-4 py-3 shadow-sm shadow-slate-200/70">Agent 正在生成...</div>
          </div>
        )}
        {messages.length === 0 && (
          <div className="flex min-h-[380px] items-center justify-center text-center">
            <div className="max-w-xl">
              <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-3xl bg-sky-100 text-primary shadow-sm shadow-sky-100">
                <Bot size={25} aria-hidden="true" />
              </div>
              <div className="mt-5 text-2xl font-semibold text-slate-950">开始一次招聘 Agent 对话</div>
              <p className="mt-3 text-sm leading-6 text-slate-600">
                可以让 Agent 分析候选人、总结岗位投递、生成面试建议，或准备需要你确认的招聘状态操作。
              </p>
              <div className="mt-5 flex flex-wrap justify-center gap-2">
                {['分析近期候选人质量', '帮我总结岗位投递情况', '生成面试推进建议'].map((item) => (
                  <Badge key={item} variant="secondary">
                    {item}
                  </Badge>
                ))}
              </div>
            </div>
          </div>
        )}
        <div ref={messagesEndRef} />
      </div>
    </div>
  );
}
