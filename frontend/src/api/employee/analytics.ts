import client from '@/api/client';

export const employeeAnalyticsApi = {
  getDashboard: () => client.get('/employee/analytics/dashboard'),

  getMatchDistribution: (jobId: number) =>
    client.get(`/employee/analytics/job/${jobId}/match-distribution`),

  getJobResumeList: (jobId: number, params?: { page?: number; page_size?: number }) =>
    client.get(`/employee/analytics/job/${jobId}/resume-list`, { params }),
};