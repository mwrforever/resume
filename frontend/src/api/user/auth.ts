import client from '@/api/client';

export interface AuthTokens {
  access_token: string;
  refresh_token: string;
  user_id: string | number;
}

export interface ApiEnvelope<T> {
  code: number;
  message: string;
  data: T;
}

export type AuthResult = AuthTokens | ApiEnvelope<AuthTokens>;

export const userAuthApi = {
  sendCode: (email: string) =>
    client.post('/verification/send-code', { email, user_type: 'user' }) as unknown as Promise<ApiEnvelope<null>>,

  register: (data: { email: string; password: string; code: string; real_name: string }) =>
    client.post('/user/auth/register', data) as unknown as Promise<AuthResult>,

  login: (data: { identifier: string; login_type: string; password?: string; code?: string }) =>
    client.post('/user/auth/login', data) as unknown as Promise<AuthResult>,

  refresh: (refresh_token: string) =>
    client.post('/user/auth/refresh', { refresh_token }) as unknown as Promise<AuthResult>,

  me: () => client.get('/user/auth/me'),
};
