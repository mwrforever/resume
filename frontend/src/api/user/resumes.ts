import client from '@/api/client';

export const userResumesApi = {
  upload: (file: File) => {
    const formData = new FormData();
    formData.append('file', file);
    return client.post('/user/resumes', formData);
  },

  list: () => client.get('/user/resumes'),

  get: (id: number) => client.get(`/user/resumes/${id}`),

  delete: (id: number) => client.delete(`/user/resumes/${id}`),
};

// 简历预览（不走api前缀，直接访问后端文件）
export const resumePreviewApi = {
  getUrl: (filePath: string) => `/preview/${filePath}`,
};