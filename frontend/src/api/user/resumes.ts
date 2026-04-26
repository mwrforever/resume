import client from '@/api/client';

export interface UserResume {
  id: number;
  file_name: string;
  file_path: string;
  status: number;
  create_time: string;
}

export interface ResumeUploadResult {
  id: number;
  file_name: string;
  file_path: string;
}

export const userResumesApi = {
  upload: (file: File) => {
    const formData = new FormData();
    formData.append('file', file);
    return client.post('/user/resumes', formData) as unknown as Promise<{ code: number; message: string; data: ResumeUploadResult }>;
  },

  list: () => client.get('/user/resumes') as unknown as Promise<{ code: number; message: string; data: { total: number; items: UserResume[] } }>,

  get: (id: number) => client.get(`/user/resumes/${id}`),

  delete: (id: number) => client.delete(`/user/resumes/${id}`),
};

// 简历预览（不走api前缀，直接访问后端文件）
export const resumePreviewApi = {
  getUrl: (filePath: string) => `/preview/${filePath}`,
};