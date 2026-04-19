import client from '@/api/client';

export const userJobsApi = {
  list: (params?: { page?: number; page_size?: number }) =>
    client.get('/user/jobs', { params }),

  get: (id: number) => client.get(`/user/jobs/${id}`),
};
