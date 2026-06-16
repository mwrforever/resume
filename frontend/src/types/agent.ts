/**
 * Agent 模块类型定义（重写版）。
 *
 * 全部以 block 为中心；事件协议字段与后端 9 type / 6 block 严格对齐。
 * 后端字段一律 snake_case，TypeScript 不在 client 端做 camelCase 转换。
 */

// ====== Workflow ======

/** 工作流类型 */
export type WorkflowType = 'interview_questions' | 'resume_evaluation';

export const WORKFLOW_LABELS: Record<WorkflowType, string> = {
  interview_questions: '简历问答',
  resume_evaluation: '简历评估',
};

// ====== Block ======

/** block 状态枚举 */
export type BlockStatus =
  | 'streaming' | 'success' | 'failed'
  | 'pending' | 'submitted' | 'rejected' | 'expired';

/** interaction 类型 */
export type InteractionType =
  | 'dimension_selection' | 'plan_approval' | 'job_selection';

/** 6 种 block 联合类型（discriminated union on type） */
export type AgentBlock =
  | { type: 'text'; index: number; text: string; status: BlockStatus }
  | { type: 'thinking'; index: number; text: string; status: BlockStatus }
  | {
      type: 'tool_use'; index: number;
      tool_name: string; display_name: string;
      input: Record<string, unknown>;
      output?: Record<string, unknown>;
      status: BlockStatus; error?: string;
    }
  | {
      type: 'interaction'; index: number;
      request_id: string; interaction_type: InteractionType;
      title: string; prompt: string;
      data: Record<string, unknown>;
      status: BlockStatus;
      values?: Record<string, unknown>;
    }
  | { type: 'interview_questions'; index: number; question_set: QuestionSet; status: BlockStatus }
  | { type: 'evaluation_report'; index: number; report: EvaluationReport; status: BlockStatus };

// ====== Envelope（与后端 9 type 一一对应） ======

/** SSE 信封联合类型 */
export type AgentEnvelope =
  | { v: 1; seq: number; ts: number; run_id: string; session_id: number;
      type: 'run.start'; data: { run_id: string; workflow_type: WorkflowType;
                                  enable_thinking: boolean; user_message_id: number | null;
                                  resume?: boolean } }
  | { v: 1; seq: number; ts: number; run_id: string; session_id: number;
      type: 'run.finish'; data: { agent_message_id: number; next_task_id?: string } }
  | { v: 1; seq: number; ts: number; run_id: string; session_id: number;
      type: 'run.error'; data: { code: string; message: string; retriable: boolean } }
  | { v: 1; seq: number; ts: number; run_id: string; session_id: number;
      type: 'step.update'; data: { step_id: string; title: string;
                                     status: 'pending' | 'running' | 'success' | 'failed';
                                     detail?: string } }
  | { v: 1; seq: number; ts: number; run_id: string; session_id: number;
      type: 'block.start'; data: { index: number; block: Record<string, unknown> } }
  | { v: 1; seq: number; ts: number; run_id: string; session_id: number;
      type: 'block.delta'; data: { index: number; delta: Record<string, unknown> } }
  | { v: 1; seq: number; ts: number; run_id: string; session_id: number;
      type: 'block.stop'; data: { index: number } }
  | { v: 1; seq: number; ts: number; run_id: string; session_id: number;
      type: 'interaction.request'; data: { request_id: string; interaction_type: InteractionType;
                                             title: string; prompt: string;
                                             schema?: Record<string, unknown>;
                                             data: Record<string, unknown> } }
  | { v: 1; seq: number; ts: number; run_id: string; session_id: number;
      type: 'interaction.resolve'; data: { request_id: string; values: Record<string, unknown> } };

// ====== Message ======

/** Agent 消息 */
export interface AgentMessage {
  id: number;
  session_id: number;
  parent_message_id: number | null;
  role: 'user' | 'agent';
  workflow_type: WorkflowType;
  run_id: string | null;
  content: { blocks: AgentBlock[] };
  model_name: string | null;
  token_count: number | null;
  sort_order: number;
  create_time: string | null;
}

// ====== Session ======

/** Agent 工作台会话 */
export interface WorkspaceSession {
  id: number;
  session_key: string;
  /** 当前运行任务的 thread_id（模型上下文隔离）；工作流正常 END 时由后端推进 */
  current_task_id: string;
  employee_id: number;
  title: string | null;
  selected_model_name: string | null;
  enable_thinking: boolean;
  status: number;
  last_message_time: string | null;
  create_time: string | null;
  update_time: string | null;
}

// ====== Run state ======

/** 步骤信息 */
export interface AgentStep {
  step_id: string;
  title: string;
  status: 'pending' | 'running' | 'success' | 'failed';
  detail?: string;
}

/** 一次 run 的实时状态（reducer 管理） */
export interface AgentRunState {
  running: boolean;
  run_id: string | null;
  workflow_type: WorkflowType;
  enable_thinking: boolean;
  steps: AgentStep[];
  current_blocks: AgentBlock[];
  error: { code: string; message: string } | null;
}

// ====== 业务卡 payload ======

/** 面试题 */
export interface QuestionItem {
  question: string;
  dimension: string;
  difficulty: string;
  evaluation_points: string[];
  follow_up_suggestions: string[];
  excellent_signals: string[];
  average_signals: string[];
  risk_signals: string[];
}

/** 面试题集合 */
export interface QuestionSet {
  title: string;
  total_questions: number;
  dimensions: string[];
  questions: QuestionItem[];
}

/** 简历评估报告 */
export interface EvaluationReport {
  final_score: number;
  final_label: string;
  decision: string;
  summary: string;
  match_overview: Record<string, unknown>;
  resume_structure: Record<string, unknown>;
  experience_timeline: Array<Record<string, unknown>>;
  skill_dimensions: Array<Record<string, unknown>>;
  job_gaps: Array<Record<string, unknown>>;
  /** 方案 B 新增：候选人画像摘要 */
  profile_summary?: { years?: number; education?: string; stack?: string[]; stability?: string };
  /** 面试建议（重点考察项） */
  interview_suggestions?: Array<{ focus: string; reason: string }>;
  /** 综合评语（优势/风险总评） */
  comprehensive_comment?: { advantages?: string; risks?: string };
}

// ====== LLM 配置（保留，供 llm-configs 页面使用） ======

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

// ====== 向后兼容别名（Stage 8 后可删除） ======

export type TAgentWorkflowType = WorkflowType;
export type IAgentSessionItem = WorkspaceSession;
export type IAgentMessageItem = AgentMessage;
export type IAgentSessionDetail = { session: WorkspaceSession; messages: AgentMessage[] };
export type IAgentRuntimeOptions = { enable_thinking?: boolean };
export type IAgentMessageCreatePayload = {
  content: string;
  workflow_type?: WorkflowType;
  context_refs?: Array<Record<string, unknown>>;
  runtime_options?: IAgentRuntimeOptions;
};
export type IAgentFormSubmitRequest = {
  request_id: string;
  values: Record<string, unknown>;
};
