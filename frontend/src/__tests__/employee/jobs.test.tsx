import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import EmployeeJobs from '@/pages/employee/jobs';

// Mock the API module
vi.mock('@/api/employee/jobs', () => ({
  employeeJobsApi: {
    list: vi.fn(),
    delete: vi.fn(),
  },
}));

// Mock auth store
vi.mock('@/store/auth', () => ({
  useAuthStore: vi.fn(() => ({
    accessToken: 'mock-token',
    refreshToken: 'mock-refresh',
    userType: 'employee',
  })),
}));

import { employeeJobsApi } from '@/api/employee/jobs';

const mockJobs = [
  { id: 1, name: 'Frontend Developer', description: 'Build React apps', status: 1, create_time: '2024-01-15T00:00:00Z' },
  { id: 2, name: 'Backend Engineer', description: 'Build APIs', status: 2, create_time: '2024-01-16T00:00:00Z' },
];

describe('EmployeeJobs Page', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('RED Phase - Failing Tests', () => {
    it('test_employee_jobs_list_renders_own_jobs', async () => {
      vi.mocked(employeeJobsApi.list).mockResolvedValue({
        data: { items: mockJobs, total: 2 }
      } as any);

      render(
        <MemoryRouter>
          <EmployeeJobs />
        </MemoryRouter>
      );

      await waitFor(() => {
        expect(screen.getByText('Frontend Developer')).toBeInTheDocument();
        expect(screen.getByText('Backend Engineer')).toBeInTheDocument();
      });
    });

    it('test_create_job_button_exists', async () => {
      vi.mocked(employeeJobsApi.list).mockResolvedValue({
        data: { items: mockJobs, total: 2 }
      } as any);

      render(
        <MemoryRouter>
          <EmployeeJobs />
        </MemoryRouter>
      );

      await waitFor(() => {
        expect(screen.getByRole('link', { name: '创建岗位' })).toBeInTheDocument();
      });
    });

    it('test_job_status_shown_per_job', async () => {
      vi.mocked(employeeJobsApi.list).mockResolvedValue({
        data: { items: mockJobs, total: 2 }
      } as any);

      render(
        <MemoryRouter>
          <EmployeeJobs />
        </MemoryRouter>
      );

      await waitFor(() => {
        expect(screen.getByText(/招聘中/)).toBeInTheDocument();
        expect(screen.getByText(/已下架/)).toBeInTheDocument();
      });
    });

    it('test_delete_job_removes_from_list', async () => {
      vi.mocked(employeeJobsApi.list).mockResolvedValue({
        data: { items: mockJobs, total: 2 }
      } as any);
      vi.mocked(employeeJobsApi.delete).mockResolvedValue({ data: null } as any);

      // Mock window.confirm
      const originalConfirm = window.confirm;
      window.confirm = vi.fn().mockReturnValue(true);

      render(
        <MemoryRouter>
          <EmployeeJobs />
        </MemoryRouter>
      );

      await waitFor(() => {
        expect(screen.getByText('Frontend Developer')).toBeInTheDocument();
      });

      // Click delete button for first job
      const deleteButtons = screen.getAllByRole('button', { name: '删除' });
      await deleteButtons[0].click();

      // After delete, the list should reload with only 1 job
      vi.mocked(employeeJobsApi.list).mockResolvedValue({
        data: { items: [mockJobs[1]], total: 1 }
      } as any);

      await waitFor(() => {
        expect(screen.queryByText('Frontend Developer')).not.toBeInTheDocument();
      });

      window.confirm = originalConfirm;
    });
  });
});
