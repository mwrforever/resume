import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { AgentComposer } from '@/components/employee/agent/agent-composer';


describe('AgentComposer workflow switcher', () => {
  it('renders workflow options and calls onWorkflowChange', async () => {
    const onWorkflowChange = vi.fn();
    render(
      <AgentComposer
        input=""
        sending={false}
        resumeFile={null}
        workflowType="interview_questions"
        onWorkflowChange={onWorkflowChange}
        onInputChange={() => undefined}
        onResumeFileChange={() => undefined}
        onSubmit={(event) => event.preventDefault()}
      />,
    );

    await userEvent.click(screen.getByRole('button', { name: '简历评估' }));

    expect(screen.getByRole('button', { name: '简历问答' })).toBeInTheDocument();
    expect(onWorkflowChange).toHaveBeenCalledWith('resume_evaluation');
  });
});
