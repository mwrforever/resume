import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import UserJobs from '@/pages/user/jobs';

// Mock the API module
vi.mock('@/api/user/jobs', () => ({
  userJobsApi: {
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

import { userJobsApi } from '@/api/user/jobs';

const mockJobs = [
  { id: 1, name: 'Frontend Developer', description: 'Build React apps', status: 1, create_time: '2024-01-15T00:00:00Z' },
  { id: 2, name: 'Backend Engineer', description: 'Build APIs', status: 1, create_time: '2024-01-16T00:00:00Z' },
];

describe('UserJobs Page', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('RED Phase - Failing Tests', () => {
    it('test_job_list_renders_jobs', async () => {
      vi.mocked(userJobsApi.list).mockResolvedValue({
        data: { items: mockJobs, total: 2 }
      } as any);

      render(
        <MemoryRouter>
          <UserJobs />
        </MemoryRouter>
      );

      await waitFor(() => {
        expect(screen.getByText('Frontend Developer')).toBeInTheDocument();
      });
    });

    it('test_job_card_shows_title_and_skills', async () => {
      const jobsWithSkills = [
        { id: 1, name: 'Frontend Developer', description: 'Build React apps', status: 1, create_time: '2024-01-15T00:00:00Z', skills: ['React', 'TypeScript'] },
      ];
      vi.mocked(userJobsApi.list).mockResolvedValue({
        data: { items: jobsWithSkills, total: 1 }
      } as any);

      render(
        <MemoryRouter>
          <UserJobs />
        </MemoryRouter>
      );

      await waitFor(() => {
        expect(screen.getByText('Frontend Developer')).toBeInTheDocument();
        expect(screen.getByText('React')).toBeInTheDocument();
      });
    });

    it('test_click_job_navigates_to_detail', async () => {
      vi.mocked(userJobsApi.list).mockResolvedValue({
        data: { items: mockJobs, total: 2 }
      } as any);

      render(
        <MemoryRouter>
          <UserJobs />
        </MemoryRouter>
      );

      await waitFor(() => {
        const jobLinks = screen.getAllByRole('link', { name: /查看详情/i });
        expect(jobLinks[0]).toHaveAttribute('href', '/user/jobs/1');
      });
    });

    it('test_jobs_display_with_infinite_scroll_indicator', async () => {
      const loadedJobs = Array.from({ length: 11 }, (_, index) => ({
        ...mockJobs[0],
        id: index + 1,
        name: `Frontend Developer ${index + 1}`,
      }));
      vi.mocked(userJobsApi.list).mockResolvedValue({
        data: { items: loadedJobs, total: 11 }
      } as any);

      render(
        <MemoryRouter>
          <UserJobs />
        </MemoryRouter>
      );

      await waitFor(() => {
        expect(screen.getByText('已经到底了哦 (11 条)')).toBeInTheDocument();
      }, { timeout: 2000 });
    });

    it('test_empty_state_when_no_jobs', async () => {
      vi.mocked(userJobsApi.list).mockResolvedValue({
        data: { items: [], total: 0 }
      } as any);

      render(
        <MemoryRouter>
          <UserJobs />
        </MemoryRouter>
      );

      await waitFor(() => {
        expect(screen.getByText('暂无岗位')).toBeInTheDocument();
      });
    });
  });
});
