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

export type AgentStreamEventName = 'user_message' | 'run_started' | 'context_ready' | 'token' | 'final' | 'error' | 'tool_call' | 'tool_result' | 'action_required';

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

export interface IAgentActionStreamItem extends IAgentActionItem {
  isStreaming?: boolean;
}
