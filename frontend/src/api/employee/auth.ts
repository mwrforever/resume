import client from '@/api/client';
import type { ApiEnvelope, AuthResult } from '@/api/user/auth';

export const employeeAuthApi = {
  sendCode: (email: string) =>
    client.post('/verification/send-code', { email, user_type: 'employee' }) as unknown as Promise<ApiEnvelope<null>>,

  register: (data: { emp_no: string; email: string; password: string; code: string; real_name: string; dept_id?: number }) =>
    client.post('/employee/auth/register', data) as unknown as Promise<AuthResult>,

  login: (data: { identifier: string; login_type: string; password?: string; code?: string }) =>
    client.post('/employee/auth/login', data) as unknown as Promise<AuthResult>,

  refresh: (refresh_token: string) =>
    client.post('/employee/auth/refresh', { refresh_token }) as unknown as Promise<AuthResult>,
};
