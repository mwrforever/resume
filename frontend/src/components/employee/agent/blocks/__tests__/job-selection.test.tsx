import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { InteractionBlock } from '../interaction-block';

const candidates = Array.from({ length: 12 }, (_, i) => ({
  name: `岗位${i + 1}`, description: `描述${i + 1}`,
}));

function renderPending() {
  return render(
    <InteractionBlock
      block={{
        type: 'interaction', index: 0, request_id: 'job_1',
        interaction_type: 'job_selection', title: '请选择岗位',
        prompt: '', data: { candidates }, status: 'pending',
      }}
      submitting={false}
      onSubmit={vi.fn()}
    />,
  );
}

describe('JobSelection 分页+手动搜索', () => {
  it('初始仅渲染 5 条（第一页）', () => {
    renderPending();
    expect(screen.getByRole('button', { name: '岗位1' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '岗位6' })).not.toBeInTheDocument();
  });

  it('输入不触发过滤（手动搜索）', () => {
    renderPending();
    fireEvent.change(screen.getByPlaceholderText(/点击搜索/), { target: { value: '岗位1' } });
    expect(screen.getByRole('button', { name: '岗位2' })).toBeInTheDocument(); // 仍第一页5条
  });

  it('点击搜索按钮触发过滤', async () => {
    renderPending();
    fireEvent.change(screen.getByPlaceholderText(/点击搜索/), { target: { value: '岗位1' } });
    fireEvent.click(screen.getByRole('button', { name: '搜索' }));
    await waitFor(() => {
      expect(screen.getByRole('button', { name: '岗位1' })).toBeInTheDocument();
      expect(screen.queryByRole('button', { name: '岗位2' })).not.toBeInTheDocument();
    });
  });

  it('翻页：点下一页展示第 2 页', () => {
    renderPending();
    fireEvent.click(screen.getByRole('button', { name: '下一页' }));
    expect(screen.getByRole('button', { name: '岗位6' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '岗位1' })).not.toBeInTheDocument();
  });
});
