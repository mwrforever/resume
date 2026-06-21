import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { InteractionBlock } from '../interaction-block';

vi.mock('@/api/employee/agent', () => ({
  employeeAgentApi: {
    uploadResume: vi.fn(async (_f: File) => ({
      data: { data: { file_path: '/up/r.pdf', file_name: 'r.pdf' } },
    })),
  },
}));

describe('ResumeUpload 交互卡（A1）', () => {
  function renderPending() {
    return render(
      <InteractionBlock
        block={{
          type: 'interaction', index: 0, request_id: 'resume_1',
          interaction_type: 'resume_upload', title: '需要先上传一份简历',
          prompt: '请上传后继续', data: {}, status: 'pending',
        }}
        submitting={false}
        onSubmit={vi.fn()}
      />,
    );
  }

  it('pending 态渲染上传区与标题（不落入 default 错误卡）', () => {
    renderPending();
    expect(screen.getByText('需要先上传一份简历')).toBeInTheDocument();
    expect(screen.queryByText(/不支持的交互类型/)).not.toBeInTheDocument();
  });

  it('上传成功后确认按钮可点，点击提交 {file_path, file_name}', async () => {
    const onSubmit = vi.fn();
    render(
      <InteractionBlock
        block={{
          type: 'interaction', index: 0, request_id: 'resume_2',
          interaction_type: 'resume_upload', title: '需要先上传一份简历',
          prompt: '', data: {}, status: 'pending',
        }}
        submitting={false}
        onSubmit={onSubmit}
      />,
    );
    const input = screen.getByLabelText(/上传简历/);
    const file = new File(['content'], 'resume.pdf', { type: 'application/pdf' });
    fireEvent.change(input, { target: { files: [file] } });
    await waitFor(() => {
      expect(screen.getByRole('button', { name: /确认/ })).not.toBeDisabled();
    });
    fireEvent.click(screen.getByRole('button', { name: /确认/ }));
    await waitFor(() => {
      expect(onSubmit).toHaveBeenCalledWith('resume_2', { file_path: '/up/r.pdf', file_name: 'r.pdf' });
    });
  });
});
