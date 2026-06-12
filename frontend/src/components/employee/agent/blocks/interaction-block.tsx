/**
 * InteractionBlock：用户交互卡片。
 *
 * - pending：显示表单选项/输入，等待用户提交
 * - submitted：已提交，显示已选值
 * - expired：超时未提交
 */

import { useState } from 'react';
import type { AgentBlock } from '@/types/agent';

interface InteractionBlockProps {
  block: AgentBlock & { type: 'interaction' };
  onSubmit?: (requestId: string, values: Record<string, unknown>) => void;
}

export function InteractionBlock({ block, onSubmit }: InteractionBlockProps) {
  const { request_id, title, prompt, data, status } = block;
  const [selectedItems, setSelectedItems] = useState<Set<string>>(new Set());

  const candidates = (data?.candidates ?? []) as Array<Record<string, unknown>>;

  /** 多选切换 */
  const toggleItem = (name: string) => {
    setSelectedItems(prev => {
      const next = new Set(prev);
      if (next.has(name)) next.delete(name);
      else next.add(name);
      return next;
    });
  };

  /** 提交选中项 */
  const handleSubmit = () => {
    if (onSubmit && selectedItems.size > 0) {
      onSubmit(request_id, { selected: Array.from(selectedItems) });
    }
  };

  // 已提交 / 已过期
  if (status === 'submitted') {
    return (
      <div className="rounded-md border border-border bg-surfaceMuted px-4 py-3">
        <p className="text-sm font-medium text-mutedText">{title}</p>
        <p className="text-xs text-success mt-1">✓ 已提交</p>
      </div>
    );
  }

  if (status === 'expired') {
    return (
      <div className="rounded-md border border-border bg-surfaceMuted px-4 py-3">
        <p className="text-sm font-medium text-mutedText">{title}</p>
        <p className="text-xs text-subtleText mt-1">已过期</p>
      </div>
    );
  }

  // pending：显示交互表单
  return (
    <div className="rounded-md border border-primary/30 bg-surface shadow-sm px-4 py-3">
      <p className="text-sm font-semibold text-foreground">{title}</p>
      {prompt && <p className="text-xs text-mutedText mt-1 mb-3">{prompt}</p>}

      {/* 候选项列表 */}
      {candidates.length > 0 && (
        <div className="space-y-1.5 mb-3">
          {candidates.map((c, i) => {
            const name = String(c.name ?? `选项 ${i + 1}`);
            const reason = c.reason ? String(c.reason) : null;
            const isSelected = selectedItems.has(name);
            return (
              <button
                key={name}
                type="button"
                className={`w-full flex items-center gap-2 px-3 py-2 rounded-md border text-left text-sm transition-all duration-fast
                  ${isSelected
                    ? 'border-primary bg-primary/5 text-primary'
                    : 'border-border bg-surface hover:bg-surfaceMuted text-foreground'}`}
                onClick={() => toggleItem(name)}
              >
                <span className={`w-4 h-4 rounded border flex-shrink-0 flex items-center justify-center text-xs
                  ${isSelected ? 'border-primary bg-primary text-onPrimary' : 'border-borderStrong'}`}>
                  {isSelected && '✓'}
                </span>
                <span className="font-medium">{name}</span>
                {reason && <span className="text-subtleText text-xs ml-auto">{reason}</span>}
              </button>
            );
          })}
        </div>
      )}

      {/* 提交按钮 */}
      <button
        type="button"
        className="px-4 py-1.5 rounded-md bg-primary text-onPrimary text-sm font-medium
                   hover:bg-primaryHover transition-colors duration-fast
                   disabled:opacity-50 disabled:cursor-not-allowed"
        disabled={selectedItems.size === 0}
        onClick={handleSubmit}
      >
        确认选择 ({selectedItems.size})
      </button>
    </div>
  );
}
