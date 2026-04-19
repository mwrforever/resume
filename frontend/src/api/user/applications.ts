import client from '@/api/client';

export const userApplicationsApi = {
  apply: (data: { job_id: number; resume_id: number }) =>
    client.post('/user/applications', data),

  list: (params?: { page?: number; page_size?: number }) =>
    client.get('/user/applications', { params }),

  get: (id: number) => client.get(`/user/applications/${id}`),
};
