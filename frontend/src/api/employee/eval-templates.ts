import client from '@/api/client';

export const employeeEvalTemplatesApi = {
  list: (params?: { page?: number; page_size?: number; status?: number; search?: string }) =>
    client.get('/employee/eval-templates', { params }),
  get: (id: number) =>
    client.get(`/employee/eval-templates/${id}`),
  createDimension: (data: {
    dimension_name: string;
    description?: string;
    default_prompt_template?: string;
    sort_order?: number;
    status?: number;
  }) =>
    client.post('/employee/eval-dimensions', data),
  create: (data: {
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
  }) =>
    client.post('/employee/eval-templates', data),
};
