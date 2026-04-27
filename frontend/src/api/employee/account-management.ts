import client from '@/api/client';
import type { IEmployeeImportResult, IManagedEmployee, IManagedUser } from '@/types/employee';

export interface AccountListParams {
  page?: number;
  page_size?: number;
  status?: number;
  search?: string;
}

export type ManagedUserPayload = Omit<IManagedUser, 'id' | 'create_time' | 'update_time'> & { password?: string };
export type ManagedEmployeePayload = Omit<IManagedEmployee, 'id' | 'create_time' | 'update_time' | 'dept_name' | 'depts'> & {
  password?: string;
  dept_ids?: number[];
  primary_dept_id?: number;
};

export const employeeAccountManagementApi = {
  listUsers: (params?: AccountListParams) => client.get('/employee/account-management/users', { params }),
  createUser: (data: ManagedUserPayload) => client.post('/employee/account-management/users', data),
  updateUser: (id: number, data: Partial<ManagedUserPayload>) => client.put(`/employee/account-management/users/${id}`, data),
  deleteUser: (id: number) => client.delete(`/employee/account-management/users/${id}`),
  listEmployees: (params?: AccountListParams) => client.get('/employee/account-management/employees', { params }),
  createEmployee: (data: ManagedEmployeePayload) => client.post('/employee/account-management/employees', data),
  updateEmployee: (id: number, data: Partial<ManagedEmployeePayload>) => client.put(`/employee/account-management/employees/${id}`, data),
  deleteEmployee: (id: number) => client.delete(`/employee/account-management/employees/${id}`),
  importEmployees: (file: File) => {
    const formData = new FormData();
    formData.append('file', file);
    return client.post('/employee/account-management/employees/import', formData) as unknown as Promise<{ code: number; message: string; data: IEmployeeImportResult }>;
  },
};
