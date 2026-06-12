/**
 * Agent API 层（重构中精简版）。
 *
 * SSE 流式函数将在 Stage 8 用新协议重写。
 * 当前保留 LLM 配置 API 和基础 session CRUD。
 */

import client from '@/api/client';
import { useAuthStore } from '@/store/auth';
import type {
  IAgentFormSubmitRequest,
  IAgentMessageCreatePayload,
  IAgentSessionDetail,
  ILlmConfigItem,
  ILlmConfigPayload,
} from '@/types/agent';

const LLM_REQUEST_TIMEOUT_MS = 730000;
const llmRequestConfig = { timeout: LLM_REQUEST_TIMEOUT_MS };

async function refreshStreamAccessToken() {
  const { refreshToken, userType, setTokens, logout } = useAuthStore.getState();
  if (!refreshToken || !userType) return null;

  const refreshUrl = userType === 'employee' ? '/employee/auth/refresh' : '/user/auth/refresh';
  const response = await fetch(`/api/v1${refreshUrl}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ refresh_token: refreshToken }),
  });

  const payload = response.ok ? await response.json() : null;
  const accessToken = payload?.data?.access_token;
  const nextRefreshToken = payload?.data?.refresh_token;

  if (!accessToken || !nextRefreshToken) {
    logout();
    return null;
  }
  setTokens(accessToken, nextRefreshToken);
  return accessToken as string;
}

async function fetchStreamWithAuth(url: string, body: string, signal?: AbortSignal) {
  const buildHeaders = (token: string | null) => ({
    'Content-Type': 'application/json',
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
  });
  const firstToken = useAuthStore.getState().accessToken;
  let response = await fetch(url, { method: 'POST', headers: buildHeaders(firstToken), body, ...(signal ? { signal } : {}) });
  if (response.status !== 401) return response;
  const refreshedToken = await refreshStreamAccessToken();
  if (!refreshedToken) return response;
  response = await fetch(url, { method: 'POST', headers: buildHeaders(refreshedToken), body, ...(signal ? { signal } : {}) });
  return response;
}

async function readErrorMessage(response: Response) {
  try {
    const payload = await response.clone().json();
    return payload?.message || payload?.detail || `HTTP ${response.status}`;
  } catch {
    return `HTTP ${response.status}`;
  }
}

/** SSE 事件回调类型（重构中临时保留，Stage 8 重写） */
interface IAgentStreamEvent {
  event: string;
  data: Record<string, unknown>;
}

function parseStreamPart(part: string, onEvent: (event: IAgentStreamEvent) => void) {
  const lines = part.split('\n');
  const eventLine = lines.find((line) => line.startsWith('event:'));
  const dataLines = lines.filter((line) => line.startsWith('data:'));
  if (!eventLine || dataLines.length === 0) return;
  onEvent({
    event: eventLine.slice(6).trim(),
    data: JSON.parse(dataLines.map((line) => line.slice(5).trim()).join('\n')),
  });
}

/** 消费 SSE 响应体并逐条回调 */
async function consumeSseResponse(response: Response, onEvent: (event: IAgentStreamEvent) => void) {
  if (!response.ok) throw new Error(await readErrorMessage(response));
  if (!response.body) throw new Error('流式响应为空');
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const parts = buffer.split('\n\n');
    buffer = parts.pop() || '';
    parts.forEach((part) => parseStreamPart(part, onEvent));
  }
  if (buffer.trim()) parseStreamPart(buffer, onEvent);
}

async function streamAgentMessage(
  id: number,
  data: IAgentMessageCreatePayload,
  onEvent: (event: IAgentStreamEvent) => void,
  signal?: AbortSignal,
) {
  const response = await fetchStreamWithAuth(`/api/v1/employee/agent/sessions/${id}/messages/stream`, JSON.stringify(data), signal);
  await consumeSseResponse(response, onEvent);
}

/** 提交 interaction 结果（Stage 8 重写路由） */
async function streamAgentFormSubmit(id: number, data: IAgentFormSubmitRequest, onEvent: (event: IAgentStreamEvent) => void) {
  const response = await fetchStreamWithAuth(`/api/v1/employee/agent/sessions/${id}/forms/submit`, JSON.stringify(data));
  await consumeSseResponse(response, onEvent);
}

export const employeeLlmApi = {
  listOptions: () => client.get('/employee/llm-model-options'),
  listConfigs: (params?: { page?: number; page_size?: number; keyword?: string; biz_type?: string; status?: number }) => client.get<unknown, { data: { total: number; items: ILlmConfigItem[] } }>('/employee/llm-configs', { params }),
  createConfig: (data: ILlmConfigPayload) => client.post('/employee/llm-configs', data),
  updateConfig: (id: number, data: Partial<ILlmConfigPayload>) => client.put(`/employee/llm-configs/${id}`, data),
  deleteConfig: (id: number) => client.delete(`/employee/llm-configs/${id}`),
  testConfig: (id: number) => client.post(`/employee/llm-configs/${id}/test`, undefined, llmRequestConfig),
};

export const employeeAgentApi = {
  createSession: (data: { title: string; selected_model_name?: string | null }) => client.post('/employee/agent/sessions', data),
  listSessions: (params?: { page?: number; page_size?: number; keyword?: string }) => client.get('/employee/agent/sessions', { params }),
  getSession: (id: number) => client.get<unknown, { data: IAgentSessionDetail }>(`/employee/agent/sessions/${id}`),
  updateSession: (id: number, data: { title: string }) => client.put(`/employee/agent/sessions/${id}`, data),
  deleteSession: (id: number) => client.delete(`/employee/agent/sessions/${id}`),
  streamMessage: streamAgentMessage,
  submitForm: streamAgentFormSubmit,
  selectModel: (id: number, model_name: string | null) => client.post(`/employee/agent/sessions/${id}/select-model`, { model_name }),
};
