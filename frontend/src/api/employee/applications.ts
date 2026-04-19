import client from '@/api/client';

export const employeeApplicationsApi = {
  list: (params?: { job_id?: number; page?: number; page_size?: number }) =>
    client.get('/employee/applications', { params }),

  updateStatus: (id: number, status: number) =>
    client.put(`/employee/applications/${id}/status`, null, { params: { status } }),
};
