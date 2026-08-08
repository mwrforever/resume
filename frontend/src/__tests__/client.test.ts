import { describe, it, expect, vi, beforeEach } from 'vitest';
import client from '@/api/client';

// 模拟 auth store，观察 logout 是否被触发
const mockLogout = vi.fn();
vi.mock('@/store/auth', () => ({
  useAuthStore: {
    getState: vi.fn(() => ({
      accessToken: null,
      refreshToken: null,
      userType: null,
      setTokens: vi.fn(),
      logout: mockLogout,
    })),
  },
}));

/** 构造一个始终以 401 拒绝的 axios adapter，用于触发响应拦截器逻辑 */
function mockAdapterReject401() {
  client.defaults.adapter = async (config) => {
    const error: any = new Error('Request failed with status code 401');
    error.config = config;
    error.response = { status: 401, data: { detail: '用户名或密码错误' }, headers: {}, config };
    throw error;
  };
}

describe('client 响应拦截器 - 401 处理', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockAdapterReject401();
  });

  it('登录接口返回 401 时不触发 logout，错误原样抛给页面展示', async () => {
    // 员工登录失败（后端返回 401：账号密码错误）
    await expect(
      client.post('/employee/auth/login', { identifier: 'x', login_type: 'password', password: 'bad' })
    ).rejects.toMatchObject({
      response: { status: 401 },
    });

    // 关键断言：登录失败不得走 refresh/logout 流程，否则会整页跳转导致提示消失
    expect(mockLogout).not.toHaveBeenCalled();
  });

  it('非认证接口返回 401 时仍触发 logout（token 过期场景保持原行为）', async () => {
    await expect(client.get('/user/jobs')).rejects.toBeTruthy();

    // token 过期时无 refresh token，应走 logout 清理状态
    expect(mockLogout).toHaveBeenCalled();
  });
});
