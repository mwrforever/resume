import client from '@/api/client';

export const employeeJobsApi = {
  list: () => client.get('/employee/jobs'),

  create: (data: { name: string; description?: string; dept_id: number }) =>
    client.post('/employee/jobs', data),

  update: (id: number, data: { name?: string; description?: string; status?: number }) =>
    client.put(`/employee/jobs/${id}`, data),

  delete: (id: number) => client.delete(`/employee/jobs/${id}`),

  suggestSkills: (data: { name: string; description: string }) =>
    client.post('/employee/jobs/skill/suggest', data),
};
