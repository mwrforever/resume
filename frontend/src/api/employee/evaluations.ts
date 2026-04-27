import client from '@/api/client';

export const employeeEvaluationsApi = {
  batchEvaluate: (data: { application_ids: number[] }) =>
    client.post('/employee/evaluations/batch', data),

  getEvaluation: (matchId: number) =>
    client.get(`/employee/evaluations/${matchId}`),

  getSkillHits: (matchId: number) =>
    client.get(`/employee/evaluations/${matchId}/skill-hits`),
};