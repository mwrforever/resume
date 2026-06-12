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

  /** 切换会话模型 */
  selectModel: (id: number, model_name: string | null) =>
    client.put(`/employee/agent/sessions/${id}/model`, { model_name }),

  /** 切换 thinking 开关 */
  setThinking: (id: number, enable: boolean) =>
    client.put(`/employee/agent/sessions/${id}/thinking`, null, { params: { enable } }),

  /** 软删除会话 */
  deleteSession: (id: number) =>
    client.delete(`/employee/agent/sessions/${id}`),

  /** 流式发送消息（返回 AsyncIterableIterator） */
  streamMessage: (
    sessionId: number,
    data: {
      content: string;
      workflow_type?: WorkflowType;
      context_refs?: Array<Record<string, unknown>>;
      runtime_options?: { enable_thinking?: boolean };
    },
    signal?: AbortSignal,
  ): AsyncIterableIterator<AgentEnvelope> => {
    return openAgentStream(
      `/api/v1/employee/agent/sessions/${sessionId}/messages/stream`,
      data,
      { signal },
    );
  },

  /** 提交 interaction（返回 AsyncIterableIterator） */
  submitInteraction: (
    sessionId: number,
    requestId: string,
    values: Record<string, unknown>,
    signal?: AbortSignal,
  ): AsyncIterableIterator<AgentEnvelope> => {
    return openAgentStream(
      `/api/v1/employee/agent/sessions/${sessionId}/interactions/${requestId}`,
      { values },
      { signal },
    );
  },

  /** 上传简历 */
  uploadResume: (sessionId: number, file: File, jobId?: number) => {
    const form = new FormData();
    form.append('file', file);
    if (jobId !== undefined) form.append('job_id', String(jobId));
    return client.post(`/employee/agent/sessions/${sessionId}/resumes`, form, {
      headers: { 'Content-Type': 'multipart/form-data' },
    });
  },
};
