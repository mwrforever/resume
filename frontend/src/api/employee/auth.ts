import client from '@/api/client';

export const employeeAuthApi = {
  sendCode: (email: string) =>
    client.post('/employee/auth/send-code', { email, user_type: 'employee' }),

  login: (data: { identifier: string; login_type: string; password?: string; code?: string }) =>
    client.post('/employee/auth/login', data),

  refresh: (refresh_token: string) =>
    client.post('/employee/auth/refresh', { refresh_token }),
};
