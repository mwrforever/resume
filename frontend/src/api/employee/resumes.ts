import client from '@/api/client';

export const employeeResumesApi = {
  list: (params?: { page?: number; page_size?: number; status?: number }) =>
    client.get('/employee/resumes', { params }),

  get: (id: number) => client.get(`/employee/resumes/${id}`),

  getFile: (id: number) =>
    client.get(`/employee/resumes/${id}/file`, { responseType: 'blob' }),
};