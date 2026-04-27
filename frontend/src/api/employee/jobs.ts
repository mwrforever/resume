import client from '@/api/client';

export const employeeJobsApi = {
  list: (params?: { page?: number; page_size?: number; status?: number; search?: string }) =>
    client.get('/employee/jobs', { params }),
  get: (id: number) =>
    client.get(`/employee/jobs/${id}`),
  create: (data: {
    name: string;
    description: string;
    dept_id: number;
    template_id?: number | null;
  }) =>
    client.post('/employee/jobs', data),
  update: (id: number, data: {
    name?: string;
    description?: string;
    template_id?: number | null;
    status?: number;
  }) =>
    client.put(`/employee/jobs/${id}`, data),
  publish: (id: number) =>
    client.put(`/employee/jobs/${id}`, { status: 1 }),
  delete: (id: number) =>
    client.delete(`/employee/jobs/${id}`),

  aiSuggest: (data: { name: string; description: string }, signal?: AbortSignal) =>
    client.post('/employee/jobs/ai/suggest', data, { signal, timeout: 120000 }),

  // Tags global list
  listAllTags: (tag_type?: number) =>
    client.get('/employee/tags', { params: tag_type != null ? { tag_type } : {} }),

  // Departments list
  listDepts: () =>
    client.get('/employee/depts'),
};
