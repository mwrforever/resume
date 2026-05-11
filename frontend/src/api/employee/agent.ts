import client from '@/api/client';
import { useAuthStore } from '@/store/auth';
import type { IAgentReply, IAgentSessionDetail, IAgentStreamEvent, ILlmConfigPayload } from '@/types/agent';

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
  if (!response.ok) {
    logout();
    return null;
  }
  const payload = await response.json();
  const accessToken = payload?.data?.access_token;
  const nextRefreshToken = payload?.data?.refresh_token;
  if (!accessToken || !nextRefreshToken) {
    logout();
    return null;
  }
  setTokens(accessToken, nextRefreshToken);
  return accessToken as string;
}

async function fetchStreamWithAuth(url: string, body: string) {
  const buildHeaders = (token: string | null) => ({
    'Content-Type': 'application/json',
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
  });
  const firstToken = useAuthStore.getState().accessToken;
  let response = await fetch(url, { method: 'POST', headers: buildHeaders(firstToken), body });
  if (response.status !== 401) return response;
  const refreshedToken = await refreshStreamAccessToken();
  if (!refreshedToken) return response;
  response = await fetch(url, { method: 'POST', headers: buildHeaders(refreshedToken), body });
  return response;
}

async function streamAgentMessage(
  id: number,
  data: { content: string; context_refs?: Array<Record<string, unknown>> },
  onEvent: (event: IAgentStreamEvent) => void,
) {
  const response = await fetchStreamWithAuth(`/api/v1/employee/agent/sessions/${id}/messages/stream`, JSON.stringify(data));
  if (!response.ok || !response.body) throw new Error(`HTTP ${response.status}`);
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const parts = buffer.split('\n\n');
    buffer = parts.pop() || '';
    parts.forEach((part) => {
      const eventLine = part.split('\n').find((line) => line.startsWith('event:'));
      const dataLine = part.split('\n').find((line) => line.startsWith('data:'));
      if (!eventLine || !dataLine) return;
      onEvent({
        event: eventLine.slice(6).trim(),
        data: JSON.parse(dataLine.slice(5).trim()),
      });
    });
  }
}

export const employeeLlmApi = {
  listOptions: () => client.get('/employee/llm-model-options'),
  listConfigs: () => client.get('/employee/llm-configs'),
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
  sendMessage: (id: number, data: { content: string; context_refs?: Array<Record<string, unknown>> }) => client.post<unknown, { data: IAgentReply }>(`/employee/agent/sessions/${id}/messages`, data, llmRequestConfig),
  streamMessage: streamAgentMessage,
  selectModel: (id: number, model_name: string | null) => client.post(`/employee/agent/sessions/${id}/select-model`, { model_name }),
  listRuns: (id: number) => client.get(`/employee/agent/sessions/${id}/runs`),
  listActions: (id: number) => client.get(`/employee/agent/sessions/${id}/actions`),
  confirmAction: (id: number) => client.post(`/employee/agent/actions/${id}/confirm`),
  rejectAction: (id: number, reason?: string) => client.post(`/employee/agent/actions/${id}/reject`, { reason }),
};
