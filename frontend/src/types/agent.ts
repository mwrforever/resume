/**
 * Agent 模块类型定义（重构中精简版）。
 *
 * 旧的 v1/v2 协议类型已删除，将在 Stage 8 用新协议类型重写。
 * 当前仅保留 LLM 配置相关类型和最简的 Agent session/message 类型。
 */

// ====== Workflow ======

/** 工作流类型 */
export type TAgentWorkflowType = 'interview_questions' | 'resume_evaluation';

// ====== LLM 配置 ======

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

// ====== Agent 会话/消息（最简版，Stage 8 重写） ======

export interface IAgentSessionItem {
  id: number;
  session_key: string;
  employee_id: number;
  title: string;
  status: number;
  selected_model_name?: string | null;
  last_message_time?: string | null;
  create_time?: string | null;
  update_time?: string | null;
}

export interface IAgentMessageItem {
  id: number;
  session_id: number;
  parent_message_id?: number | null;
  role: 'user' | 'agent';
  workflow_type?: TAgentWorkflowType | null;
  run_id?: string | null;
  content: {
    blocks: Array<Record<string, unknown>>;
  };
  model_name?: string | null;
  token_count?: number | null;
  sort_order: number;
  create_time?: string | null;
}

export interface IAgentSessionDetail {
  session: IAgentSessionItem;
  messages: IAgentMessageItem[];
}

// ====== Agent 请求（最简版） ======

export interface IAgentRuntimeOptions {
  enable_thinking?: boolean;
}

export interface IAgentMessageCreatePayload {
  content: string;
  workflow_type?: TAgentWorkflowType;
  context_refs?: Array<Record<string, unknown>>;
  runtime_options?: IAgentRuntimeOptions;
}

export interface IAgentFormSubmitRequest {
  request_id: string;
  values: Record<string, unknown>;
}
