/**
 * Agent 接口层（重写版）。
 *
 * 仅四类调用：
 * - 会话 CRUD（GET/POST/PUT/DELETE）
 * - 流式 message：返回 AsyncIterable<AgentEnvelope>
 * - 交互提交：同样返回 AsyncIterable<AgentEnvelope>
 * - 简历上传：multipart/form-data
 */

import client from '@/api/client';
import { openAgentStream } from '@/utils/agent-stream-client';
import type {
  AgentEnvelope,
  ILlmConfigItem,
  ILlmConfigPayload,
  WorkflowType,
} from '@/types/agent';

const LLM_REQUEST_TIMEOUT_MS = 730000;
const llmRequestConfig = { timeout: LLM_REQUEST_TIMEOUT_MS };

// ---------- LLM 配置 ----------

export const employeeLlmApi = {
  listOptions: () => client.get('/employee/llm-model-options'),
  listConfigs: (params?: {
    page?: number; page_size?: number; keyword?: string; biz_type?: string; status?: number;
  }) => client.get<unknown, { data: { total: number; items: ILlmConfigItem[] } }>(
    '/employee/llm-configs', { params },
  ),
  createConfig: (data: ILlmConfigPayload) => client.post('/employee/llm-configs', data),
  updateConfig: (id: number, data: Partial<ILlmConfigPayload>) =>
    client.put(`/employee/llm-configs/${id}`, data),
  deleteConfig: (id: number) => client.delete(`/employee/llm-configs/${id}`),
  testConfig: (id: number) => client.post(
    `/employee/llm-configs/${id}/test`, undefined, llmRequestConfig,
  ),
};

// ---------- 会话 CRUD ----------

export const employeeAgentApi = {
  /** 创建新会话 */
  createSession: (data: { title?: string; selected_model_name?: string | null }) =>
    client.post('/employee/agent/sessions', data),

  /** 分页查询会话列表 */
  listSessions: (params?: { page?: number; page_size?: number; keyword?: string }) =>
    client.get('/employee/agent/sessions', { params }),

  /** 获取会话详情 */
  getSession: (id: number) =>
    client.get(`/employee/agent/sessions/${id}`),

  /** 更新会话（重命名） */
  updateSession: (id: number, data: { title: string }) =>
    client.put(`/employee/agent/sessions/${id}`, data),

  /** 软删除会话 */
  deleteSession: (id: number) =>
    client.delete(`/employee/agent/sessions/${id}`),

  /** 流式发送消息（返回 AsyncIterableIterator）
   *
   * runtime_options 携带思考开关 + 模型名（均为发送时动态参数，不依赖会话持久化）。
   */
  streamMessage: (
    sessionId: number,
    data: {
      content: string;
      workflow_type?: WorkflowType;
      context_refs?: Array<Record<string, unknown>>;
      runtime_options?: { enable_thinking?: boolean; model_name?: string | null };
    },
    signal?: AbortSignal,
  ): AsyncIterableIterator<AgentEnvelope> => {
    return openAgentStream(
      `/api/v1/employee/agent/sessions/${sessionId}/messages/stream`,
      data,
      { signal },
    );
  },

  /** 提交 interaction（返回 AsyncIterableIterator）
   *
   * workflowType 由前端显式携带（对齐后端 AgentInteractionSubmit.workflow_type），
   * 后端不再从历史消息推断路由（内容不当下文原则）。
   * enableThinking/modelName 沿用当前会话设置，续接 run 保持一致。
   */
  submitInteraction: (
    sessionId: number,
    requestId: string,
    values: Record<string, unknown>,
    workflowType: WorkflowType,
    runtimeOptions: { enableThinking: boolean; modelName: string | null },
    signal?: AbortSignal,
  ): AsyncIterableIterator<AgentEnvelope> => {
    return openAgentStream(
      `/api/v1/employee/agent/sessions/${sessionId}/interactions/${requestId}`,
      {
        values, workflow_type: workflowType,
        runtime_options: {
          enable_thinking: runtimeOptions.enableThinking,
          ...(runtimeOptions.modelName ? { model_name: runtimeOptions.modelName } : {}),
        },
      },
      { signal },
    );
  },

  /** 上传简历（脱离 session，只存文件返回路径） */
  uploadResume: (file: File) => {
    const form = new FormData();
    form.append('file', file);
    return client.post('/employee/agent/resumes', form, {
      headers: { 'Content-Type': 'multipart/form-data' },
    });
  },
};
