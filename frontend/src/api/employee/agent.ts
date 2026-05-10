import client from '@/api/client';
import type { IAgentReply, IAgentSessionDetail, ILlmConfigPayload } from '@/types/agent';

export const employeeLlmApi = {
  listOptions: () => client.get('/employee/llm-model-options'),
  listConfigs: () => client.get('/employee/llm-configs'),
  createConfig: (data: ILlmConfigPayload) => client.post('/employee/llm-configs', data),
  updateConfig: (id: number, data: Partial<ILlmConfigPayload>) => client.put(`/employee/llm-configs/${id}`, data),
  deleteConfig: (id: number) => client.delete(`/employee/llm-configs/${id}`),
  testConfig: (id: number) => client.post(`/employee/llm-configs/${id}/test`),
};

export const employeeAgentApi = {
  createSession: (data: { title: string; selected_model_name?: string | null }) => client.post('/employee/agent/sessions', data),
  listSessions: (params?: { page?: number; page_size?: number }) => client.get('/employee/agent/sessions', { params }),
  getSession: (id: number) => client.get<unknown, { data: IAgentSessionDetail }>(`/employee/agent/sessions/${id}`),
  sendMessage: (id: number, data: { content: string; context_refs?: Array<Record<string, unknown>> }) => client.post<unknown, { data: IAgentReply }>(`/employee/agent/sessions/${id}/messages`, data),
  selectModel: (id: number, model_name: string) => client.post(`/employee/agent/sessions/${id}/select-model`, { model_name }),
  listRuns: (id: number) => client.get(`/employee/agent/sessions/${id}/runs`),
  listActions: (id: number) => client.get(`/employee/agent/sessions/${id}/actions`),
  confirmAction: (id: number) => client.post(`/employee/agent/actions/${id}/confirm`),
  rejectAction: (id: number, reason?: string) => client.post(`/employee/agent/actions/${id}/reject`, { reason }),
};
