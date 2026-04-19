import client from '@/api/client';

export const employeeEvaluationsApi = {
  batchEvaluate: (data: { resume_ids: number[]; job_id: number }) =>
    client.post('/employee/evaluations/batch', data),

  getEvaluation: (matchId: number) =>
    client.get(`/employee/evaluations/${matchId}`),

  getSkillHits: (matchId: number) =>
    client.get(`/employee/evaluations/${matchId}/skill-hits`),
};