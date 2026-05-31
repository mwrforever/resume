/** Agent 流式协议 v1 与规划审批相关类型（与后端 schemas/agent 对齐） */

export type TAgentStreamProtocolVersion = '1.0';

/** 与后端 AgentNodeId 一致 */
export type TAgentNodeId =
  | 'input'
  | 'analyst'
  | 'human_feedback'
  | 'planner'
  | 'supervisor'
  | 'serial_route'
  | 'fan_out'
  | 'domain_agent'
  | 'result_merger'
  | 'legacy_executor'
  | 'evaluator'
  | 'compressor'
  | 'reporter';

/** 与后端 AgentEventTypeV1 一致 */
export type TAgentEventTypeV1 =
  | 'lifecycle.run_started'
  | 'lifecycle.run_finished'
  | 'lifecycle.run_failed'
  | 'lifecycle.node_enter'
  | 'lifecycle.node_exit'
  | 'lifecycle.node_error'
  | 'lifecycle.interrupt'
  | 'lifecycle.resume_ack'
  | 'stream.text_delta'
  | 'stream.text_done'
  | 'stream.thought_delta'
  | 'stream.thought_done'
  | 'ui.render'
  | 'ui.patch'
  | 'ui.dismiss'
  | 'plan.revision_started'
  | 'plan.revision_rejected'
  | 'plan.repair_suggestions'
  | 'plan.approved'
  | 'tool.call_start'
  | 'tool.call_log'
  | 'tool.call_end';

export type TUiComponentKey = 'PlanReviewTree' | 'PlanRepairHints' | 'ActionConfirmCard' | 'AgentStatusTimeline' | 'ToolExecutionCard' | 'ThinkingRenderer' | 'RepairSuggestionsPanel';

export type TPlanReviewDecision = 'approved' | 'rejected';

export type TAgentDomain = 'job' | 'application' | 'evaluation' | 'memory' | 'generic';

/** 规划子任务（对应后端 SubTaskDTO） */
export interface IPlanSubTask {
  task_id: string;
  domain: TAgentDomain;
  title: string;
  instruction: string;
  depends_on?: string[];
  status?: string;
  result_summary?: string | null;
}

/** SSE agent.v1 信封 */
export interface IAgentStreamEnvelopeV1 {
  protocol_version: TAgentStreamProtocolVersion;
  seq: number;
  run_id: string;
  stream_id: string;
  session_id: number;
  node_id: TAgentNodeId;
  event_type: TAgentEventTypeV1;
  timestamp: number;
  payload: Record<string, unknown>;
  branch_id?: string | null;
}

export type TAgentStreamProtocolVersionV2 = '2.0';

export type TAgentEventTypeV2 =
  | 'lifecycle.run.started'
  | 'lifecycle.run.finished'
  | 'lifecycle.run.failed'
  | 'lifecycle.node.enter'
  | 'lifecycle.node.exit'
  | 'lifecycle.node.error'
  | 'message.delta'
  | 'message.done'
  | 'tool.started'
  | 'tool.finished'
  | 'form.requested'
  | 'form.resolved'
  | 'action.requested'
  | 'action.resolved'
  | 'data.card'
  | 'data.evaluation_report'
  | 'error';

export interface IAgentStreamEnvelopeV2 {
  schema_version: TAgentStreamProtocolVersionV2;
  seq: number;
  run_id: string;
  session_id: number;
  node_id: string;
  agent_id?: string | null;
  event: TAgentEventTypeV2 | string;
  payload: Record<string, unknown>;
  ts: number;
  extensions?: Record<string, unknown> | null;
}

/** ui.render · PlanReviewTree 载荷 */
export interface IPlanReviewTreeRenderData {
  plan_id?: string;
  revision: number;
  max_revisions?: number;
  tasks: IPlanSubTask[];
  editable?: boolean;
}

/** 前端规划审批 UI 状态 */
export interface IPlanReviewUiState {
  instanceId: string;
  revision: number;
  maxRevisions: number;
  tasks: IPlanSubTask[];
  editable: boolean;
  repairSuggestions: string[];
  feedbackDraft: string;
  /** pending=待审批 submitting=已提交 resume 请求 */
  phase: 'pending' | 'submitting';
}

/** 恢复 interrupt 请求体（对应 PlanReviewResumePayload） */
export interface IPlanReviewResumePayload {
  decision: TPlanReviewDecision;
  tasks?: IPlanSubTask[] | null;
  feedback?: string | null;
}

export interface IAgentRunResumeRequest {
  interrupt_kind: 'plan_review';
  payload: IPlanReviewResumePayload;
}

export interface IAgentFormSubmitRequest {
  request_id: string;
  values: Record<string, unknown>;
}

export interface IAgentRuntimeOptions {
  enable_thinking?: boolean;
}

export interface IAgentTemporaryActionExecute {
  action_id: string;
  capability_key: string;
  action_name: string;
  target_type?: string | null;
  target_id?: number | null;
  input_payload: Record<string, unknown>;
  preview_payload: Record<string, unknown>;
}

export interface ILlmConfigItem {
  id: number;
  biz_type: 'employee' | 'dept';
  biz_id: number;
  config_name: string;
  protocol: 'openai';
  base_url: string;
  api_key_mask: string;
  model_name: string;
  fallback_model_name?: string | null;
  extra_body?: Record<string, unknown> | null;
  enable_thinking: boolean;
  enable_tools: boolean;
  enable_prompt_cache: boolean;
  enable_memory: boolean;
  temperature: number;
  top_p: number;
  max_tokens: number;
  presence_penalty: number;
  frequency_penalty: number;
  timeout_seconds: number;
  max_retries: number;
  status: number;
  last_test_at?: string | null;
  last_test_status?: number | null;
  last_test_message?: string | null;
  create_time?: string | null;
  update_time?: string | null;
  can_manage?: boolean;
}

export interface ILlmConfigPayload {
  biz_type: 'employee' | 'dept';
  biz_id: number;
  config_name: string;
  protocol: 'openai';
  base_url: string;
  api_key: string;
  model_name: string;
  fallback_model_name?: string | null;
  extra_body?: Record<string, unknown> | null;
  enable_thinking: boolean;
  enable_tools: boolean;
  enable_prompt_cache: boolean;
  enable_memory: boolean;
  temperature: number;
  top_p: number;
  max_tokens: number;
  presence_penalty: number;
  frequency_penalty: number;
  timeout_seconds: number;
  max_retries: number;
  status: number;
}

export interface ILlmModelOption {
  model_name: string;
  source: 'employee' | 'dept' | 'env';
  config_id?: number | null;
  biz_type?: string | null;
  biz_id?: number | null;
  config_name: string;
  base_url: string;
}

export interface IAgentRuntimeConfig {
  id?: number | null;
  employee_id: number;
  model_name: string;
  model_source: 'employee' | 'dept' | 'env';
  llm_config_id?: number | null;
  enable_thinking: boolean;
  enable_tools: boolean;
  enable_prompt_cache: boolean;
  enable_memory: boolean;
  temperature: number;
  top_p: number;
  max_tokens: number;
  presence_penalty: number;
  frequency_penalty: number;
  extra_body?: Record<string, unknown> | null;
  last_used_at?: string | null;
  create_time?: string | null;
  update_time?: string | null;
}

export type IAgentRuntimeConfigPayload = Pick<IAgentRuntimeConfig, 'enable_thinking' | 'enable_tools' | 'enable_prompt_cache' | 'enable_memory' | 'temperature' | 'top_p' | 'max_tokens' | 'presence_penalty' | 'frequency_penalty' | 'extra_body'>;

export interface IAgentSessionItem {
  id: number;
  session_key: string;
  employee_id: number;
  title: string;
  status: number;
  selected_model_name?: string | null;
  selected_model_source?: string | null;
  context_summary?: string | null;
  last_message_time?: string | null;
  version: number;
  create_time?: string | null;
  update_time?: string | null;
}

export interface IAgentMessageItem {
  id: number;
  session_id: number;
  parent_message_id?: number | null;
  role: 'user' | 'agent' | 'system' | 'tool' | 'summary';
  message_type: string;
  content: {
    context_refs?: Array<Record<string, unknown>>;
    blocks: Array<Record<string, unknown>>;
  };
  model_name?: string | null;
  token_count?: number | null;
  sort_order: number;
  create_time?: string | null;
}

export interface IAgentRunItem {
  id: number;
  trace_id: string;
  parent_run_id?: number | null;
  session_id: number;
  message_id?: number | null;
  run_type: string;
  status: number;
  model_name?: string | null;
  prompt_tokens: number;
  completion_tokens: number;
  total_tokens: number;
  latency_ms?: number | null;
  input_payload?: Record<string, unknown> | null;
  output_payload?: Record<string, unknown> | null;
  error_message?: string | null;
  create_time?: string | null;
  update_time?: string | null;
}

export interface IAgentActionItem {
  id: number;
  session_id: number;
  message_id?: number | null;
  run_id?: number | null;
  employee_id: number;
  capability_key: string;
  action_name: string;
  target_type?: string | null;
  target_id?: number | null;
  input_payload: Record<string, unknown>;
  preview_payload: Record<string, unknown>;
  status: number;
  idempotency_key: string;
  error_message?: string | null;
  create_time?: string | null;
  update_time?: string | null;
  confirmed_at?: string | null;
  rejected_at?: string | null;
  executed_at?: string | null;
}

export interface IAgentMemoryItem {
  id: number;
  employee_id: number;
  memory_type: string;
  memory_key: string;
  content: string;
  importance_score: number;
  confidence_score: number;
  source_session_id?: number | null;
  last_access_time?: string | null;
  create_time?: string | null;
  update_time?: string | null;
}

export interface IAgentContextSnapshotItem {
  id: number;
  session_id: number;
  snapshot_version: number;
  summary_text: string;
  covered_message_start_id: number;
  covered_message_end_id: number;
  message_count: number;
  token_count: number;
  model_name?: string | null;
  create_time?: string | null;
}

export interface IAgentSessionWindowItem {
  snapshot?: IAgentContextSnapshotItem | null;
  recent_messages: IAgentMessageItem[];
  token_count: number;
  prompt_prefix_hash?: string | null;
}

export interface IAgentSessionDetail {
  session: IAgentSessionItem;
  messages: IAgentMessageItem[];
  memories: IAgentMemoryItem[];
  snapshots: IAgentContextSnapshotItem[];
  session_window?: IAgentSessionWindowItem | null;
}

export interface IAgentReply {
  user_message: IAgentMessageItem;
  agent_message: IAgentMessageItem;
  run: IAgentRunItem;
  session?: IAgentSessionItem | null;
  snapshot?: IAgentContextSnapshotItem | null;
  memories: IAgentMemoryItem[];
  session_window?: IAgentSessionWindowItem | null;
}

export type AgentStreamEventName =
  | 'user_message'
  | 'run_started'
  | 'context_ready'
  | 'token'
  | 'final'
  | 'error'
  | 'tool_call'
  | 'tool_result'
  | 'action_required'
  | 'agent'
  | 'agent.v1';

export interface IAgentStreamEvent {
  event: AgentStreamEventName | string;
  data: Record<string, unknown>;
}

export interface IAgentToolStreamItem {
  id: string;
  type: 'call' | 'result';
  tool_name: string;
  display_name: string;
  payload: Record<string, unknown>;
  success?: boolean;
  error_message?: string | null;
}

export interface IAgentActionStreamItem extends Omit<IAgentActionItem, 'id'> {
  id: string;
  isStreaming?: boolean;
}

/** 消息列表下方的运行时动态条目（思考、工具、待确认动作） */
export interface IAgentRuntimeFeedItem {
  id: string;
  type: 'thinking' | 'tool' | 'action' | 'node';
  status: 'running' | 'success' | 'failed' | 'pending';
  title: string;
  message?: string | null;
  action?: IAgentActionStreamItem;
}

/** RepairSuggestionsPanel 组件 Props */
export interface IRepairSuggestionsPanelProps {
  suggestions: string[];
  selectionMode: 'single' | 'multiple';
  customInputFirst: boolean;
  customInput: string;
  onSuggestionToggle: (index: number) => void;
  onCustomInputChange: (value: string) => void;
  onSubmit: (selectedSuggestions: string[], customInput: string) => void;
  submitting: boolean;
}
