import client from '@/api/client';
import { useAuthStore } from '@/store/auth';
import type {
  IAgentReply,
  IAgentRunResumeRequest,
  IAgentRuntimeOptions,
  IAgentSessionDetail,
  IAgentStreamEvent,
  IAgentTemporaryActionExecute,
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

async function readErrorMessage(response: Response) {
  try {
    const payload = await response.clone().json();
    return payload?.message || payload?.detail || `HTTP ${response.status}`;
  } catch {
    return `HTTP ${response.status}`;
  }
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
  data: { content: string; context_refs?: Array<Record<string, unknown>>; runtime_options?: IAgentRuntimeOptions },
  onEvent: (event: IAgentStreamEvent) => void,
) {
  const response = await fetchStreamWithAuth(`/api/v1/employee/agent/sessions/${id}/messages/stream`, JSON.stringify(data));
  await consumeSseResponse(response, onEvent);
}

/** 恢复 Planner interrupt（批准/驳回），SSE 协议与发消息流一致 */
async function streamAgentResume(id: number, data: IAgentRunResumeRequest, onEvent: (event: IAgentStreamEvent) => void) {
  const response = await fetchStreamWithAuth(`/api/v1/employee/agent/sessions/${id}/resume`, JSON.stringify(data));
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

/** 上传 Agent 会话简历附件（须绑定 job_id） */
async function uploadSessionResume(sessionId: number, file: File, jobId: number) {
  const formData = new FormData();
  formData.append('file', file);
  formData.append('job_id', String(jobId));
  const token = useAuthStore.getState().accessToken;
  const response = await fetch(`/api/v1/employee/agent/sessions/${sessionId}/attachments/resume`, {
    method: 'POST',
    headers: token ? { Authorization: `Bearer ${token}` } : {},
    body: formData,
  });
  if (!response.ok) {
    throw new Error(await readErrorMessage(response));
  }
  const payload = await response.json();
  return payload as { code: number; message: string; data: { resume_id: number; file_name: string; job_id: number } };
}

export const employeeAgentApi = {
  createSession: (data: { title: string; selected_model_name?: string | null }) => client.post('/employee/agent/sessions', data),
  listSessions: (params?: { page?: number; page_size?: number; keyword?: string }) => client.get('/employee/agent/sessions', { params }),
  getSession: (id: number) => client.get<unknown, { data: IAgentSessionDetail }>(`/employee/agent/sessions/${id}`),
  updateSession: (id: number, data: { title: string }) => client.put(`/employee/agent/sessions/${id}`, data),
  deleteSession: (id: number) => client.delete(`/employee/agent/sessions/${id}`),
  sendMessage: (id: number, data: { content: string; context_refs?: Array<Record<string, unknown>>; runtime_options?: IAgentRuntimeOptions }) => client.post<unknown, { data: IAgentReply }>(`/employee/agent/sessions/${id}/messages`, data, llmRequestConfig),
  streamMessage: streamAgentMessage,
  uploadSessionResume,
  streamResume: streamAgentResume,
  selectModel: (id: number, model_name: string | null) => client.post(`/employee/agent/sessions/${id}/select-model`, { model_name }),
  executeAction: (data: IAgentTemporaryActionExecute) => client.post('/employee/agent/actions/execute', data),
};
