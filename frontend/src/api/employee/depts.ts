import client from '@/api/client';
import type { IDeptItem } from '@/types/employee';

export interface DeptListParams {
  page?: number;
  page_size?: number;
  status?: number;
  search?: string;
}

export type DeptPayload = Omit<IDeptItem, 'id' | 'create_time' | 'update_time' | 'parent_name' | 'leader_id' | 'leader_name' | 'employee_count'> & { leader_id?: number | null };

export const deptApi = {
  listDepts: (params?: DeptListParams) =>
    client.get('/employee/depts', { params }),

  getDept: (id: number) =>
    client.get(`/employee/depts/${id}`),

  createDept: (data: DeptPayload) =>
    client.post('/employee/depts', data),

  updateDept: (id: number, data: Partial<DeptPayload>) =>
    client.put(`/employee/depts/${id}`, data),

  deleteDept: (id: number) =>
    client.delete(`/employee/depts/${id}`),

  importDepts: (file: File) => {
    const formData = new FormData();
    formData.append('file', file);
    return client.post('/employee/depts/import', formData);
  },

  getDeptTree: () =>
    client.get('/employee/depts/tree'),

  listLeaderOptions: () =>
    client.get('/employee/depts/leader-options'),
};
