import axios from 'axios';
import { useAuthStore } from '@/store/auth';

const client = axios.create({
  baseURL: '/api/v1',
  timeout: 30000,
});

// Request interceptor
client.interceptors.request.use(
  (config) => {
    const token = useAuthStore.getState().accessToken;
    if (token) {
      config.headers.Authorization = `Bearer ${token}`;
    }
    return config;
  },
  (error) => Promise.reject(error)
);

// Response interceptor
client.interceptors.response.use(
  (response) => {
    if (response.config?.responseType === 'blob') return response;
    return response.data;
  },
  async (error) => {
    const originalRequest = error.config;
    if (error.response?.status === 401 && !originalRequest._retry) {
      originalRequest._retry = true;
      const { refreshToken, userType } = useAuthStore.getState();
      if (refreshToken && userType) {
        try {
          const refreshUrl = userType === 'employee' ? '/employee/auth/refresh' : '/user/auth/refresh';
          const res = await axios.post(`/api/v1${refreshUrl}`, { refresh_token: refreshToken });
          const { access_token, refresh_token: new_refresh_token } = res.data.data;
          useAuthStore.getState().setTokens(access_token, new_refresh_token);
          originalRequest.headers.Authorization = `Bearer ${access_token}`;
          return client(originalRequest);
        } catch {
          useAuthStore.getState().logout();
        }
      }
    }
    return Promise.reject(error);
  }
);

export interface ApiResponse<T = any> {
  code: number;
  message: string;
  data: T;
}

export default client;
