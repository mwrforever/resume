import client from '@/api/client';
import type { IDimension, ISkill } from '@/types/employee';

export const employeeJobsApi = {
  list: (params?: { page?: number; page_size?: number; status?: number; search?: string }) =>
    client.get('/employee/jobs', { params }),
  get: (id: number) =>
    client.get(`/employee/jobs/${id}`),
  create: (data: {
    name: string;
    description?: string;
    dept_id: number;
    dimensions: IDimension[];
    skills?: ISkill[];
    tag_ids?: number[];
  }) =>
    client.post('/employee/jobs', data),
  update: (id: number, data: {
    name?: string;
    description?: string;
    status?: number;
    tag_ids?: number[];
  }) =>
    client.put(`/employee/jobs/${id}`, data),
  publish: (id: number) =>
    client.put(`/employee/jobs/${id}`, { status: 1 }),
  delete: (id: number) =>
    client.delete(`/employee/jobs/${id}`),

  // AI
  suggestSkills: (data: { name: string; description: string }) =>
    client.post('/employee/jobs/skill/suggest', data),
  aiSuggest: (data: { name: string; description: string }, signal?: AbortSignal) =>
    client.post('/employee/jobs/ai/suggest', data, { signal, timeout: 120000 }),

  // Tags global list
  listAllTags: (tag_type?: number) =>
    client.get('/employee/tags', { params: tag_type != null ? { tag_type } : {} }),

  // Departments list
  listDepts: () =>
    client.get('/employee/depts'),

  // Job-level dimensions
  getDimensions: (jobId: number) =>
    client.get(`/employee/jobs/${jobId}/dimensions`),
  addDimension: (jobId: number, data: IDimension) =>
    client.post(`/employee/jobs/${jobId}/dimensions`, data),
  updateDimension: (jobId: number, dimId: number, data: IDimension) =>
    client.put(`/employee/jobs/${jobId}/dimensions/${dimId}`, data),
  deleteDimension: (jobId: number, dimId: number) =>
    client.delete(`/employee/jobs/${jobId}/dimensions/${dimId}`),

  // Job-level skills
  getSkills: (jobId: number) =>
    client.get(`/employee/jobs/${jobId}/skills`),
  addSkill: (jobId: number, data: ISkill) =>
    client.post(`/employee/jobs/${jobId}/skills`, data),
  deleteSkill: (jobId: number, skillId: number) =>
    client.delete(`/employee/jobs/${jobId}/skills/${skillId}`),

  // Job-level tags
  getJobTags: (jobId: number) =>
    client.get(`/employee/jobs/${jobId}/tags`),
  setJobTags: (jobId: number, tag_ids: number[]) =>
    client.put(`/employee/jobs/${jobId}/tags`, { tag_ids }),
};
