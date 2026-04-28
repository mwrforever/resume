import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import UserMyApplications from '@/pages/user/my-applications';

// Mock the API module
vi.mock('@/api/user/applications', () => ({
  userApplicationsApi: {
    list: vi.fn(),
  },
}));

// Mock auth store
vi.mock('@/store/auth', () => ({
  useAuthStore: vi.fn(() => ({
    accessToken: 'mock-token',
    refreshToken: 'mock-refresh',
    userType: 'user',
  })),
}));

import { userApplicationsApi } from '@/api/user/applications';

const mockApplications = [
  {
    id: 1,
    job_id: 101,
    resume_id: 1,
    status: 1,
    status_name: '已投递',
    create_time: '2024-01-15T10:30:00Z'
  },
  {
    id: 2,
    job_id: 102,
    resume_id: 2,
    status: 2,
    status_name: '已查看',
    create_time: '2024-01-16T14:20:00Z'
  },
];

describe('UserMyApplications Page', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('RED Phase - Failing Tests', () => {
    it('test_applications_list_shows_user_applications', async () => {
      vi.mocked(userApplicationsApi.list).mockResolvedValue({
        data: { items: mockApplications, total: 2 }
      } as any);

      render(
        <MemoryRouter>
          <UserMyApplications />
        </MemoryRouter>
      );

      await waitFor(() => {
        expect(screen.getByText('岗位 ID: 101')).toBeInTheDocument();
        expect(screen.getByText('岗位 ID: 102')).toBeInTheDocument();
      });
    });

    it('test_application_status_displayed', async () => {
      vi.mocked(userApplicationsApi.list).mockResolvedValue({
        data: { items: mockApplications, total: 2 }
      } as any);

      render(
        <MemoryRouter>
          <UserMyApplications />
        </MemoryRouter>
      );

      await waitFor(() => {
        expect(screen.getByText('已投递')).toBeInTheDocument();
        expect(screen.getByText('已查看')).toBeInTheDocument();
      });
    });

    it('test_application_detail_entry_removed', async () => {
      vi.mocked(userApplicationsApi.list).mockResolvedValue({
        data: { items: mockApplications, total: 2 }
      } as any);

      render(
        <MemoryRouter>
          <UserMyApplications />
        </MemoryRouter>
      );

      await waitFor(() => {
        expect(screen.getByText('岗位 ID: 101')).toBeInTheDocument();
      });
      expect(screen.queryByRole('button', { name: /查看详情/i })).not.toBeInTheDocument();
    });
  });
});
