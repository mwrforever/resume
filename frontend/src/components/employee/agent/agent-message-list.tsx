import { AlertCircle, Bot, Brain, CheckCircle2, Loader2, UserRound, XCircle } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import type { IAgentActionStreamItem, IAgentBusinessCardItem, IAgentInteractionRequestItem, IAgentMessageItem, IAgentRuntimeFeedItem, IAgentThinkingStreamItem, IPlanReviewUiState } from '@/types/agent';
import { AgentActionCard } from './agent-action-card';
import { AgentMarkdownContent } from './agent-markdown-content';
import { AgentInteractionCard } from './agent-interaction-card';
import { AgentRunCompactTimeline } from './agent-run-compact-timeline';
import { AgentThinkingPanel } from './agent-thinking-panel';
import { InterviewQuestionSetCard } from './interview-question-set-card';
import { PlanReviewTree } from './plan-review-tree';
import { ResumeEvaluationReportCard } from './resume-evaluation-report-card';
import { hiddenScrollClass, messageText } from './agent-ui-utils';


interface RestoredMessageBlocks {
  runtimeFeedItems: IAgentRuntimeFeedItem[];
  thinkingItems: IAgentThinkingStreamItem[];
  interactionRequests: IAgentInteractionRequestItem[];
  businessCards: IAgentBusinessCardItem[];
}

/**
 * 将未知 block 载荷收窄为普通对象。
 *
 * @param value 历史消息 block 或事件载荷。
 * @return Record<string, unknown> | null 可安全读取的对象，非法结构返回空。
 */
function coerceBlockRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

/**
 * 提取可作为正文渲染的消息块。
 *
 * @param blocks 消息中的全部内容块。
 * @return Array<Record<string, unknown>> 文本或 HTML 内容块。
 */
function textBlocks(blocks: Array<Record<string, unknown>>): Array<Record<string, unknown>> {
  return blocks.filter((block) => block.type === 'text' || typeof block.text === 'string' || typeof block.html === 'string');
}

/**
 * 从历史消息快照恢复前端紧凑渲染状态。
 *
 * @param blocks `agent_message.content.blocks` 历史快照。
 * @return RestoredMessageBlocks 可直接渲染的时间线、思考、交互和业务卡片。
 */
function restoreMessageBlocks(blocks: Array<Record<string, unknown>>): RestoredMessageBlocks {
  const restored: RestoredMessageBlocks = { runtimeFeedItems: [], thinkingItems: [], interactionRequests: [], businessCards: [] };
  const interactionResults = new Set<string>();

  blocks.forEach((block, blockIndex) => {
    if (block.type === 'interview_question_set') {
      const payload = coerceBlockRecord(block.question_set);
      if (payload) restored.businessCards.push({ id: `history-question-set-${blockIndex}`, run_id: 'history', type: 'interview_question_set', payload });
      return;
    }
    if (block.type === 'resume_evaluation_report') {
      const payload = coerceBlockRecord(block.report);
      if (payload) restored.businessCards.push({ id: `history-evaluation-report-${blockIndex}`, run_id: 'history', type: 'resume_evaluation_report', payload });
      return;
    }
    if (block.type !== 'stream_events' || !Array.isArray(block.events)) return;

    block.events.forEach((eventValue, eventIndex) => {
      const event = coerceBlockRecord(eventValue);
      const payload = coerceBlockRecord(event?.payload);
      if (!event || !payload) return;
      const eventName = String(event.event || '');
      const runId = String(event.run_id || 'history');
      const nodeId = String(event.node_id || eventIndex);

      if (eventName === 'execution_status') {
        restored.runtimeFeedItems.push({
          id: `history-execution-${runId}-${nodeId}-${eventIndex}`,
          type: 'node',
          status: payload.status === 'success' ? 'success' : payload.status === 'failed' ? 'failed' : payload.status === 'waiting' ? 'pending' : 'running',
          title: String(payload.title || nodeId),
          message: typeof payload.detail === 'string' ? payload.detail : null,
        });
        return;
      }

      if (eventName === 'thinking_status' || eventName === 'thinking_stream') {
        const id = String(payload.message_id || `history-thinking-${runId}-${nodeId}`);
        const delta = eventName === 'thinking_stream' && typeof payload.delta === 'string' ? payload.delta : '';
        const content = typeof payload.content === 'string' ? payload.content : delta;
        const existing = restored.thinkingItems.find((item) => item.id === id);
        if (existing) {
          existing.status = payload.status === 'completed' ? 'completed' : payload.status === 'unavailable' ? 'unavailable' : 'streaming';
          existing.content = `${existing.content}${delta || content}`;
        } else {
          restored.thinkingItems.push({ id, run_id: runId, status: payload.status === 'completed' ? 'completed' : payload.status === 'unavailable' ? 'unavailable' : 'streaming', content });
        }
        return;
      }

      if (eventName === 'interaction_request') {
        restored.interactionRequests.push({
          id: String(payload.request_id || `history-interaction-${runId}-${eventIndex}`),
          run_id: runId,
          interaction_type: payload.interaction_type === 'plan_approval' ? 'plan_approval' : payload.interaction_type === 'job_selection' ? 'job_selection' : 'dimension_selection',
          title: String(payload.title || '请确认'),
          prompt: String(payload.prompt || ''),
          data: coerceBlockRecord(payload.data) || {},
          submit_label: String(payload.submit_label || '提交'),
          status: 'pending',
        });
        return;
      }

      if (eventName === 'interaction_result') {
        const requestId = String(payload.request_id || '');
        if (requestId) interactionResults.add(requestId);
      }
    });
  });

  // 历史消息只恢复未完成 interrupt，避免刷新后重复展示已提交表单。
  restored.interactionRequests = restored.interactionRequests.filter((request) => !interactionResults.has(request.id));
  return restored;
}

/**
 * 按业务卡片类型分发到具体展示组件。
 *
 * @param props 业务卡片渲染项。
 * @return React.ReactElement 业务卡片组件。
 */
type TimelineEntry =
  | { kind: 'feed'; seq: number; item: IAgentRuntimeFeedItem }
  | { kind: 'thinking'; seq: number; item: IAgentThinkingStreamItem }
  | { kind: 'interaction'; seq: number; item: IAgentInteractionRequestItem; readOnly: boolean }
  | { kind: 'card'; seq: number; item: IAgentBusinessCardItem }
  | { kind: 'action'; seq: number; item: IAgentRuntimeFeedItem };

/**
 * 合并四类流式事件为按 seq 排序的统一时间线。
 *
 * 行为：
 *   - runtimeFeedItems 中 type==action 的项被剥离出来，由 RuntimeFeedRow 在末尾单独渲染（保留旧行为）；
 *   - 其余 feed、thinking、interaction、card 按各自首次推入时分配的 seq 升序穿插；
 *   - 缺失 seq 的旧条目按 0 处理，会优先排在前列，保证不丢条目。
 *
 * @param feed 运行 feed 集合
 * @param thinking 思考流集合
 * @param interactions 人机交互集合
 * @param cards 业务卡片集合
 * @param interactionReadOnly true 表示历史快照中的已结束交互（仅展示、不可重新提交）
 * @return TimelineEntry[] 按时间线穿插顺序的条目数组
 */
function buildMergedTimeline(
  feed: IAgentRuntimeFeedItem[],
  thinking: IAgentThinkingStreamItem[],
  interactions: IAgentInteractionRequestItem[],
  cards: IAgentBusinessCardItem[],
  interactionReadOnly: boolean,
): TimelineEntry[] {
  const entries: TimelineEntry[] = [];
  feed.forEach((item) => {
    if (item.type === 'action') return;
    entries.push({ kind: 'feed', seq: item.seq ?? 0, item });
  });
  thinking.forEach((item) => entries.push({ kind: 'thinking', seq: item.seq ?? 0, item }));
  interactions.forEach((item) => entries.push({ kind: 'interaction', seq: item.seq ?? 0, item, readOnly: interactionReadOnly }));
  cards.forEach((item) => entries.push({ kind: 'card', seq: item.seq ?? 0, item }));
  entries.sort((a, b) => a.seq - b.seq);
  return entries;
}

/**
 * 单条运行 feed 行渲染：复用 AgentRunCompactTimeline 的视觉风格，
 * 但只渲染一项以便参与时间线穿插。
 *
 * @param item 单个运行 feed 条目
 * @return React.ReactElement 紧凑型时间线行
 */
function SingleFeedRow({ item }: { item: IAgentRuntimeFeedItem }) {
  return <AgentRunCompactTimeline items={[item]} />;
}
function BusinessCardRenderer({ item }: { item: IAgentBusinessCardItem }) {
  if (item.type === 'interview_question_set') return <InterviewQuestionSetCard questionSet={item.payload} />;
  return <ResumeEvaluationReportCard report={item.payload} />;
}

interface AgentMessageListProps {
  messages: IAgentMessageItem[];
  actionsByMessageId: Map<number, IAgentActionStreamItem[]>;
  runtimeFeedItems: IAgentRuntimeFeedItem[];
  businessCards?: IAgentBusinessCardItem[];
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
  businessCards = [],
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
          const blocks = message.content.blocks || [];
          const restoredBlocks = !isUser ? restoreMessageBlocks(blocks) : null;
          const text = messageText(textBlocks(blocks));
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
                {restoredBlocks &&
                  buildMergedTimeline(
                    restoredBlocks.runtimeFeedItems,
                    restoredBlocks.thinkingItems,
                    restoredBlocks.interactionRequests,
                    restoredBlocks.businessCards,
                    true,
                  ).map((entry) => {
                    if (entry.kind === 'feed') return <SingleFeedRow key={'hist-feed-' + entry.item.id} item={entry.item} />;
                    if (entry.kind === 'thinking') return <AgentThinkingPanel key={'hist-think-' + entry.item.id} item={entry.item} />;
                    if (entry.kind === 'interaction') return (
                      <AgentInteractionCard key={'hist-inter-' + entry.item.id} item={{ ...entry.item, status: 'expired' }} onSubmit={() => undefined} />
                    );
                    if (entry.kind === 'card') return <BusinessCardRenderer key={'hist-card-' + entry.item.id} item={entry.item} />;
                    return null;
                  })}
                {index === insertRuntimeFeedAfterIndex &&
                  buildMergedTimeline(runtimeFeedItems, thinkingItems, interactionRequests, businessCards, false).map((entry) => {
                    if (entry.kind === 'feed') return <SingleFeedRow key={'live-feed-' + entry.item.id} item={entry.item} />;
                    if (entry.kind === 'thinking') return <AgentThinkingPanel key={'live-think-' + entry.item.id} item={entry.item} />;
                    if (entry.kind === 'interaction') return (
                      <AgentInteractionCard
                        key={'live-inter-' + entry.item.id}
                        item={entry.item}
                        onSubmit={onSubmitInteraction || (() => undefined)}
                      />
                    );
                    if (entry.kind === 'card') return <BusinessCardRenderer key={'live-card-' + entry.item.id} item={entry.item} />;
                    return null;
                  })}
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
