/**
 * InterruptBar 单测：仅中断态，文案「任务已中断」+ RefreshCw 图标 + 「重试」按钮。
 * 点击触发 onResume（续接 checkpoint，A2 决策不变）。
 */
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { InterruptBar } from '../interrupt-bar';

describe('InterruptBar', () => {
  it('渲染「任务已中断」文案与「重试」按钮', () => {
    render(<InterruptBar onResume={() => {}} />);
    expect(screen.getByText('任务已中断')).toBeInTheDocument();
    expect(screen.getByText('重试')).toBeInTheDocument();
  });

  it('点击「重试」触发 onResume', () => {
    const onResume = vi.fn();
    render(<InterruptBar onResume={onResume} />);
    fireEvent.click(screen.getByText('重试'));
    expect(onResume).toHaveBeenCalledOnce();
  });
});
