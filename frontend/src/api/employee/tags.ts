import client from '@/api/client';
import type { ITag } from '@/types/employee';

export interface TagListParams {
  page?: number;
  page_size?: number;
  tag_type?: number;
  status?: number;
  search?: string;
}

export type TagPayload = Omit<ITag, 'id' | 'job_count'>;

export const employeeTagsApi = {
  list: (params?: TagListParams) => client.get('/employee/tags', { params }),
  get: (id: number) => client.get(`/employee/tags/${id}`),
  create: (data: TagPayload) => client.post('/employee/tags', data),
  update: (id: number, data: Partial<TagPayload>) => client.put(`/employee/tags/${id}`, data),
  delete: (id: number) => client.delete(`/employee/tags/${id}`),
};
