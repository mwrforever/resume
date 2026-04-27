import client from '@/api/client';
import type { IDeptItem, IDeptImportResult, IDeptTreeItem } from '@/types/employee';

export interface DeptListParams {
  page?: number;
  page_size?: number;
  status?: number;
  search?: string;
}

export type DeptPayload = Omit<IDeptItem, 'id' | 'create_time' | 'update_time' | 'leader_name' | 'employee_count'>;

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
};
