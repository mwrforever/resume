import client from '@/api/client';

export interface EvalTemplatePayload {
  template_name: string;
  description?: string;
  status?: number;
  dimensions: Array<{
    dimension_id: number;
    weight: number;
    prompt_template?: string;
    sort_order?: number;
  }>;
  skills?: Array<{
    skill_name: string;
    skill_type: number;
    match_label?: string;
    is_ai_generated?: number;
  }>;
  tag_ids?: number[];
}

export const employeeEvalTemplatesApi = {
  list: (params?: { page?: number; page_size?: number; status?: number; search?: string }) =>
    client.get('/employee/eval-templates', { params }),
  get: (id: number) =>
    client.get(`/employee/eval-templates/${id}`),
  listDimensions: (params?: { page?: number; page_size?: number; status?: number; search?: string }) =>
    client.get('/employee/eval-dimensions', { params }),
  getDimension: (id: number) =>
    client.get(`/employee/eval-dimensions/${id}`),
  suggestDimension: (data: { job_name: string; job_description: string }, signal?: AbortSignal) =>
    client.post('/employee/eval-dimensions/ai/suggest', data, { signal, timeout: 120000 }),
  createDimension: (data: {
    dimension_name: string;
    description?: string;
    default_prompt_template?: string;
    sort_order?: number;
    status?: number;
  }) =>
    client.post('/employee/eval-dimensions', data),
  updateDimension: (id: number, data: {
    dimension_name?: string;
    description?: string;
    default_prompt_template?: string;
    sort_order?: number;
    status?: number;
  }) =>
    client.put(`/employee/eval-dimensions/${id}`, data),
  deleteDimension: (id: number) =>
    client.delete(`/employee/eval-dimensions/${id}`),
  create: (data: EvalTemplatePayload) =>
    client.post('/employee/eval-templates', data),
  update: (id: number, data: EvalTemplatePayload) =>
    client.put(`/employee/eval-templates/${id}`, data),
  delete: (id: number) =>
    client.delete(`/employee/eval-templates/${id}`),
  suggestJobTemplate: (data: { job_name: string; job_description: string }, signal?: AbortSignal) =>
    client.post('/employee/eval-templates/ai/suggest', data, { signal, timeout: 120000 }),
  suggestTemplateSkills: (data: {
    dimensions: Array<{
      dimension_name: string;
      weight: number;
      prompt_template: string;
    }>;
  }, signal?: AbortSignal) =>
    client.post('/employee/eval-templates/skills/ai/suggest', data, { signal, timeout: 120000 }),
};
