import client from '@/api/client';

export const employeeApplicationsApi = {
  list: (params?: { job_id?: number; job_ids?: number[]; dept_ids?: number[]; status?: string | number; page?: number; page_size?: number } | Record<string, string> | URLSearchParams) =>
    client.get('/employee/applications', { params }),

  updateStatus: (id: number, status: number) =>
    client.put(`/employee/applications/${id}/status`, null, { params: { status } }),
};
