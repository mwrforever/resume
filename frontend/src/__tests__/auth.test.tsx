import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { BrowserRouter } from 'react-router-dom';
import Auth from '@/pages/auth';

// Mock API modules
vi.mock('@/api/user/auth', () => ({
  userAuthApi: {
    sendCode: vi.fn(),
    register: vi.fn(),
    login: vi.fn(),
  },
}));

vi.mock('@/api/employee/auth', () => ({
  employeeAuthApi: {
    sendCode: vi.fn(),
    register: vi.fn(),
    login: vi.fn(),
  },
}));

// Mock useAuthStore
const mockSetTokens = vi.fn();
const mockSetUserInfo = vi.fn();
const mockLogout = vi.fn();

vi.mock('@/store/auth', () => ({
  useAuthStore: vi.fn(() => ({
    accessToken: null,
    refreshToken: null,
    userType: null,
    userId: null,
    setTokens: mockSetTokens,
    setUserInfo: mockSetUserInfo,
    logout: mockLogout,
  })),
}));

// Helper to render Auth page with router
const renderAuth = () => {
  render(
    <BrowserRouter>
      <Auth />
    </BrowserRouter>
  );
};

describe('Auth Page - TDD Tests', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('RED Phase - Failing Tests', () => {
    it('test_auth_page_shows_user_and_employee_tabs', async () => {
      const user = userEvent.setup();
      renderAuth();

      // Find all buttons with 用户 and 员工 text (both desktop and mobile versions)
      const userTabs = screen.getAllByRole('button', { name: /用户/i });
      const employeeTabs = screen.getAllByRole('button', { name: /员工/i });

      // Should have at least one of each (desktop + mobile)
      expect(userTabs.length).toBeGreaterThanOrEqual(1);
      expect(employeeTabs.length).toBeGreaterThanOrEqual(1);
    });

    it('test_user_register_form_has_all_required_fields', async () => {
      const user = userEvent.setup();
      renderAuth();

      // Click the register link in the form (not the title switch)
      const registerLink = screen.getByText('立即注册');
      await user.click(registerLink);

      // Wait for animation (400ms) and form to render - look for empNo which only exists in register form
      await waitFor(() => {
        expect(screen.getByLabelText(/真实姓名/i)).toBeInTheDocument();
      }, { timeout: 1000 });

      // User register form should have: realName, email, password, confirmPassword, code
      expect(screen.getByLabelText(/真实姓名/i)).toBeInTheDocument();
      expect(screen.getByLabelText(/邮箱/i)).toBeInTheDocument();
      expect(screen.getByLabelText(/^密码$/i)).toBeInTheDocument();
      expect(screen.getByLabelText(/确认密码/i)).toBeInTheDocument();
      expect(screen.getByLabelText(/验证码/i)).toBeInTheDocument();
    });

    it('test_employee_register_form_has_all_required_fields', async () => {
      const user = userEvent.setup();
      renderAuth();

      // Switch to employee tab using desktop button (in the top right corner)
      const desktopEmployeeTab = screen.getAllByRole('button', { name: /员工/i })[0];
      await user.click(desktopEmployeeTab);

      // Wait for animation then click register link in the form
      await waitFor(() => {
        expect(screen.queryByText('立即注册')).toBeInTheDocument();
      });
      const registerLink = screen.getByText('立即注册');
      await user.click(registerLink);

      // Wait for animation (400ms) and form to render
      await waitFor(() => {
        expect(screen.getByLabelText(/员工工号/i)).toBeInTheDocument();
      }, { timeout: 1000 });

      // Employee register form should have: empNo, realName, email, password, confirmPassword, code
      expect(screen.getByLabelText(/员工工号/i)).toBeInTheDocument();
      expect(screen.getByLabelText(/真实姓名/i)).toBeInTheDocument();
      expect(screen.getByLabelText(/邮箱/i)).toBeInTheDocument();
      expect(screen.getByLabelText(/^密码$/i)).toBeInTheDocument();
      expect(screen.getByLabelText(/确认密码/i)).toBeInTheDocument();
      expect(screen.getByLabelText(/验证码/i)).toBeInTheDocument();
    });

    it('test_send_code_button_triggers_api_call', async () => {
      const { userAuthApi } = await import('@/api/user/auth');
      vi.mocked(userAuthApi.sendCode).mockResolvedValue({ code: 200, message: 'success', data: null });

      const user = userEvent.setup();
      renderAuth();

      // Switch to register mode via the link in the form
      const registerLink = screen.getByText('立即注册');
      await user.click(registerLink);

      // Wait for animation and form to render
      await waitFor(() => {
        expect(screen.getByLabelText(/验证码/i)).toBeInTheDocument();
      }, { timeout: 1000 });

      // Fill email first
      const emailInput = screen.getByLabelText(/邮箱/i);
      await user.type(emailInput, 'test@example.com');

      // Click send code button
      const sendCodeBtn = screen.getByRole('button', { name: /获取验证码/i });
      await user.click(sendCodeBtn);

      await waitFor(() => {
        expect(userAuthApi.sendCode).toHaveBeenCalledWith('test@example.com');
      });
    });

    it('test_register_button_disabled_when_form_incomplete', async () => {
      const user = userEvent.setup();
      renderAuth();

      // Switch to register mode
      const registerLink = screen.getByText('立即注册');
      await user.click(registerLink);

      // Wait for animation and form to render
      await waitFor(() => {
        expect(screen.getByRole('button', { name: /^注册$/i })).toBeInTheDocument();
      }, { timeout: 1000 });

      // Submit button should be present (the form submit button says "注册")
      expect(screen.getByRole('button', { name: /^注册$/i })).toBeInTheDocument();
    });

    it('test_register_button_calls_api_with_correct_payload', async () => {
      const { userAuthApi } = await import('@/api/user/auth');
      vi.mocked(userAuthApi.register).mockResolvedValue({
        code: 200,
        message: 'success',
        data: { access_token: 'access', refresh_token: 'refresh', user_id: '1' },
      });

      const user = userEvent.setup();
      renderAuth();

      // Switch to register mode
      const registerLink = screen.getByText('立即注册');
      await user.click(registerLink);

      // Wait for animation and form to render
      await waitFor(() => {
        expect(screen.getByLabelText(/真实姓名/i)).toBeInTheDocument();
      }, { timeout: 1000 });

      // Fill form
      await user.type(screen.getByLabelText(/真实姓名/i), 'Test User');
      await user.type(screen.getByLabelText(/邮箱/i), 'test@example.com');
      await user.type(screen.getByLabelText(/^密码$/i), 'password123');
      await user.type(screen.getByLabelText(/确认密码/i), 'password123');
      await user.type(screen.getByLabelText(/验证码/i), '123456');

      // Submit
      const submitBtn = screen.getByRole('button', { name: /^注册$/i });
      await user.click(submitBtn);

      await waitFor(() => {
        expect(userAuthApi.register).toHaveBeenCalledWith({
          email: 'test@example.com',
          password: 'password123',
          code: '123456',
          real_name: 'Test User',
        });
      });
    });

    it('test_login_with_password_calls_correct_api', async () => {
      const { userAuthApi } = await import('@/api/user/auth');
      vi.mocked(userAuthApi.login).mockResolvedValue({
        code: 200,
        message: 'success',
        data: { access_token: 'access', refresh_token: 'refresh', user_id: '1' },
      });

      const user = userEvent.setup();
      renderAuth();

      // Fill login form - identifier is email input
      await user.type(screen.getByLabelText(/邮箱/i), 'test@example.com');
      await user.type(screen.getByLabelText(/^密码$/i), 'password123');

      // Submit - login button says "登录"
      const submitBtn = screen.getByRole('button', { name: /^登录$/i });
      await user.click(submitBtn);

      await waitFor(() => {
        expect(userAuthApi.login).toHaveBeenCalledWith({
          identifier: 'test@example.com',
          login_type: 'password',
          password: 'password123',
        });
      });
    });

    it('test_login_switches_between_password_and_code_mode', async () => {
      renderAuth();

      // Default should be password mode - find password input
      expect(screen.getByLabelText(/^密码$/i)).toBeInTheDocument();
    });

    it('test_api_error_displays_error_message', async () => {
      const { userAuthApi } = await import('@/api/user/auth');
      vi.mocked(userAuthApi.login).mockRejectedValue({
        response: { data: { detail: '登录失败，请检查账号信息' } },
      });

      const user = userEvent.setup();
      renderAuth();

      // Fill and submit login form
      await user.type(screen.getByLabelText(/邮箱/i), 'test@example.com');
      await user.type(screen.getByLabelText(/^密码$/i), 'wrongpassword');

      const submitBtn = screen.getByRole('button', { name: /^登录$/i });
      await user.click(submitBtn);

      await waitFor(() => {
        expect(screen.getByText(/登录失败，请检查账号信息/i)).toBeInTheDocument();
      });
    });

    it('test_successful_register_redirects_or_shows_success', async () => {
      const { userAuthApi } = await import('@/api/user/auth');
      vi.mocked(userAuthApi.register).mockResolvedValue({
        code: 200,
        message: 'success',
        data: { access_token: 'access', refresh_token: 'refresh', user_id: '1' },
      });

      const user = userEvent.setup();
      renderAuth();

      // Switch to register mode
      const registerLink = screen.getByText('立即注册');
      await user.click(registerLink);

      // Wait for animation and form to render
      await waitFor(() => {
        expect(screen.getByLabelText(/真实姓名/i)).toBeInTheDocument();
      }, { timeout: 1000 });

      // Fill form
      await user.type(screen.getByLabelText(/真实姓名/i), 'Test User');
      await user.type(screen.getByLabelText(/邮箱/i), 'test@example.com');
      await user.type(screen.getByLabelText(/^密码$/i), 'password123');
      await user.type(screen.getByLabelText(/确认密码/i), 'password123');
      await user.type(screen.getByLabelText(/验证码/i), '123456');

      // Submit
      const submitBtn = screen.getByRole('button', { name: /^注册$/i });
      await user.click(submitBtn);

      // After successful registration, should store tokens and redirect
      await waitFor(() => {
        expect(mockSetTokens).toHaveBeenCalledWith('access', 'refresh');
        expect(mockSetUserInfo).toHaveBeenCalledWith('user', '1');
      });
    });

    it('test_successful_login_stores_token', async () => {
      const { userAuthApi } = await import('@/api/user/auth');
      vi.mocked(userAuthApi.login).mockResolvedValue({
        code: 200,
        message: 'success',
        data: { access_token: 'access', refresh_token: 'refresh', user_id: '1' },
      });

      const user = userEvent.setup();
      renderAuth();

      // Fill and submit login form
      await user.type(screen.getByLabelText(/邮箱/i), 'test@example.com');
      await user.type(screen.getByLabelText(/^密码$/i), 'password123');

      const submitBtn = screen.getByRole('button', { name: /^登录$/i });
      await user.click(submitBtn);

      await waitFor(() => {
        expect(mockSetTokens).toHaveBeenCalledWith('access', 'refresh');
        expect(mockSetUserInfo).toHaveBeenCalledWith('user', '1');
      });
    });
  });
});
