import client from '@/api/client';

export const userResumesApi = {
  upload: (file: File) => {
    const formData = new FormData();
    formData.append('file', file);
    return client.post('/user/resumes', formData, {
      headers: { 'Content-Type': 'multipart/form-data' },
    });
  },

  list: () => client.get('/user/resumes'),

  get: (id: number) => client.get(`/user/resumes/${id}`),

  delete: (id: number) => client.delete(`/user/resumes/${id}`),
};