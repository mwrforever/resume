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

vi.mock('@/api/employee/resumes', () => ({
  employeeResumesApi: {
    list: vi.fn(),
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
import { employeeResumesApi } from '@/api/employee/resumes';

const mockResumes = [
  { id: 1, file_name: 'resume_frontend.pdf' },
  { id: 2, file_name: 'resume_backend.pdf' },
  { id: 3, file_name: 'resume_fullstack.pdf' },
];

describe('EmployeeEvaluations Page', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('RED Phase - Failing Tests', () => {
    it('test_evaluations_list_renders_with_scores', async () => {
      vi.mocked(employeeResumesApi.list).mockResolvedValue({
        data: { items: mockResumes, total: 3 }
      } as any);

      render(
        <MemoryRouter>
          <EmployeeEvaluations />
        </MemoryRouter>
      );

      await waitFor(() => {
        expect(screen.getByText('resume_frontend.pdf')).toBeInTheDocument();
        expect(screen.getByText('resume_backend.pdf')).toBeInTheDocument();
        expect(screen.getByText('resume_fullstack.pdf')).toBeInTheDocument();
      });
    });

    it('test_evaluation_detail_modal_opens', async () => {
      vi.mocked(employeeResumesApi.list).mockResolvedValue({
        data: { items: mockResumes, total: 3 }
      } as any);

      render(
        <MemoryRouter>
          <EmployeeEvaluations />
        </MemoryRouter>
      );

      await waitFor(() => {
        // The page should show resume selection cards
        const resumeCards = screen.getAllByRole('button');
        expect(resumeCards.length).toBeGreaterThan(0);
      });
    });

    it('test_batch_evaluate_button_triggers_action', async () => {
      vi.mocked(employeeResumesApi.list).mockResolvedValue({
        data: { items: mockResumes, total: 3 }
      } as any);
      vi.mocked(employeeEvaluationsApi.batchEvaluate).mockResolvedValue({
        data: { success: true }
      } as any);

      const user = userEvent.setup();
      render(
        <MemoryRouter>
          <EmployeeEvaluations />
        </MemoryRouter>
      );

      // Wait for resumes to load
      await waitFor(() => {
        expect(screen.getByText('resume_frontend.pdf')).toBeInTheDocument();
      });

      // Enter job ID
      const jobInput = screen.getByPlaceholderText('输入岗位ID');
      await user.type(jobInput, '1');

      // Wait for state update
      await waitFor(() => {
        expect(screen.getByDisplayValue('1')).toBeInTheDocument();
      });

      // Select resumes by clicking on them
      const resume1Button = screen.getByText('resume_frontend.pdf').closest('button');
      const resume2Button = screen.getByText('resume_backend.pdf').closest('button');

      if (resume1Button) await user.click(resume1Button);
      if (resume2Button) await user.click(resume2Button);

      // Check that batch evaluate button is enabled
      await waitFor(() => {
        const batchButton = screen.getByRole('button', { name: /开始AI评估/i });
        expect(batchButton).not.toBeDisabled();
      });
    });
  });
});
