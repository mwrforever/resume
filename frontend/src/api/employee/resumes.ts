import client from '@/api/client';

export const employeeResumesApi = {
  list: () => client.get('/user/resumes'),

  get: (id: number) => client.get(`/user/resumes/${id}`),
};