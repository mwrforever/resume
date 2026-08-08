import axios from 'axios';
import { useAuthStore } from '@/store/auth';

const client = axios.create({
  baseURL: '/api/v1',
  timeout: 30000,
});

/**
 * refresh token 并发控制：多个请求同时 401 时，只发起一次 refresh，其他请求等待同一个 Promise 结果
 */
let refreshPromise: Promise<{ access_token: string; refresh_token: string } | null> | null = null;

function doRefresh(): Promise<{ access_token: string; refresh_token: string } | null> {
  if (refreshPromise) return refreshPromise;

  refreshPromise = (async () => {
    const { refreshToken, userType } = useAuthStore.getState();
    if (!refreshToken || !userType) return null;
    try {
      const refreshUrl = userType === 'employee' ? '/employee/auth/refresh' : '/user/auth/refresh';
      const res = await axios.post(`/api/v1${refreshUrl}`, { refresh_token: refreshToken });
      const data = res.data?.data;
      if (!data?.access_token || !data?.refresh_token) return null;
      useAuthStore.getState().setTokens(data.access_token, data.refresh_token);
      return { access_token: data.access_token, refresh_token: data.refresh_token };
    } catch {
      return null;
    } finally {
      refreshPromise = null;
    }
  })();

  return refreshPromise;
}

/** refresh 失败后清除状态并跳转到登录页（logout 内部已包含跳转逻辑） */
function handleRefreshFailure() {
  useAuthStore.getState().logout();
}

/**
 * 判断请求是否为登录/注册接口
 * 这些接口返回 401 表示账号或密码错误，而非 token 过期，不应触发 refresh 流程，
 * 否则登录失败会误触发 logout 整页跳转，导致错误提示一闪而过、员工登录退回用户登录。
 */
const isAuthEndpoint = (url?: string) =>
  !!url && /^\/(?:user|employee)\/auth\/(?:login|register)$/.test(url);

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
    if (error.response?.status === 401 && !originalRequest._retry && !isAuthEndpoint(originalRequest.url)) {
      originalRequest._retry = true;
      const tokens = await doRefresh();
      if (tokens) {
        originalRequest.headers.Authorization = `Bearer ${tokens.access_token}`;
        return client(originalRequest);
      }
      handleRefreshFailure();
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
