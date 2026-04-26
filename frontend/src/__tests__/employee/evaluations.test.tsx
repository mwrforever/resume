import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import EmployeeEvaluations from '@/pages/employee/evaluations';

// Mock the API module
vi.mock('@/api/employee/evaluations', () => ({
  employeeEvaluationsApi: {
    batchEvaluate: vi.fn(),
  },
}));

vi.mock('@/api/employee/jobs', () => ({
  employeeJobsApi: {
    list: vi.fn(),
  },
}));

vi.mock('@/api/employee/analytics', () => ({
  employeeAnalyticsApi: {
    getMatchDistribution: vi.fn(),
    getJobResumeList: vi.fn(),
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

import { employeeEvaluationsApi } from '@/api/employee/evaluations';
import { employeeJobsApi } from '@/api/employee/jobs';
import { employeeAnalyticsApi } from '@/api/employee/analytics';

const mockJobs = [
  { id: 1, name: 'Frontend Developer', status: 1, create_time: '2024-01-15T00:00:00Z' },
];

const mockResumes = [
  { resume_id: 1, file_name: 'resume_frontend.pdf', status: 'pending' },
  { resume_id: 2, file_name: 'resume_backend.pdf', status: 'pending' },
  { resume_id: 3, file_name: 'resume_fullstack.pdf', status: 'pending' },
];

describe('EmployeeEvaluations Page', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(employeeJobsApi.list).mockResolvedValue({
      data: { items: mockJobs, total: 1 }
    } as any);
    vi.mocked(employeeAnalyticsApi.getMatchDistribution).mockResolvedValue({
      data: { total: 3, excellent: 0, good: 0, average: 0, fail: 0 }
    } as any);
    vi.mocked(employeeAnalyticsApi.getJobResumeList).mockResolvedValue({
      data: { items: mockResumes, total: 3 }
    } as any);
  });

  describe('RED Phase - Failing Tests', () => {
    it('test_evaluations_list_renders_with_scores', async () => {
      const user = userEvent.setup();

      render(
        <MemoryRouter>
          <EmployeeEvaluations />
        </MemoryRouter>
      );

      await user.click(await screen.findByRole('button', { name: '请选择岗位' }));
      await user.click(screen.getByRole('option', { name: 'Frontend Developer' }));

      await waitFor(() => {
        expect(screen.getByText('resume_frontend.pdf')).toBeInTheDocument();
        expect(screen.getByText('resume_backend.pdf')).toBeInTheDocument();
        expect(screen.getByText('resume_fullstack.pdf')).toBeInTheDocument();
      });
    });

    it('test_evaluation_detail_modal_opens', async () => {
      const user = userEvent.setup();

      render(
        <MemoryRouter>
          <EmployeeEvaluations />
        </MemoryRouter>
      );

      await user.click(await screen.findByRole('button', { name: '请选择岗位' }));
      await user.click(screen.getByRole('option', { name: 'Frontend Developer' }));

      await waitFor(() => {
        expect(screen.getByLabelText('选择简历 resume_frontend.pdf')).toBeInTheDocument();
      });
    });

    it('test_batch_evaluate_button_triggers_action', async () => {
      vi.mocked(employeeEvaluationsApi.batchEvaluate).mockResolvedValue({
        data: { success: true }
      } as any);

      const user = userEvent.setup();
      render(
        <MemoryRouter>
          <EmployeeEvaluations />
        </MemoryRouter>
      );

      await user.click(await screen.findByRole('button', { name: '请选择岗位' }));
      await user.click(screen.getByRole('option', { name: 'Frontend Developer' }));

      await waitFor(() => {
        expect(screen.getByText('resume_frontend.pdf')).toBeInTheDocument();
      });

      await user.click(screen.getByLabelText('选择简历 resume_frontend.pdf'));
      await user.click(screen.getByLabelText('选择简历 resume_backend.pdf'));

      await waitFor(() => {
        const batchButton = screen.getByRole('button', { name: /开始 AI 评估/i });
        expect(batchButton).not.toBeDisabled();
      });
    });
  });
});
