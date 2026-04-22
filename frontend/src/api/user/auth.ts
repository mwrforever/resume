import client from '@/api/client';

export const userAuthApi = {
  sendCode: (email: string) =>
    client.post('/user/auth/send-code', { email, user_type: 'user' }),

  register: (data: { email: string; password: string; code: string; real_name: string }) =>
    client.post('/user/auth/register', data),

  login: (data: { identifier: string; login_type: string; password?: string; code?: string }) =>
    client.post('/user/auth/login', data),

  refresh: (refresh_token: string) =>
    client.post('/user/auth/refresh', { refresh_token }),

  me: () => client.get('/user/auth/me'),
};
