import { useState, useEffect } from 'react';
import { Lightbulb, Loader2, ChevronRight } from 'lucide-react';
import { Button } from '@/components/ui/button';
import type { IRepairSuggestionsPanelProps } from '@/types/agent';

export function RepairSuggestionsPanel({
  suggestions,
  selectionMode,
  customInputFirst,
  customInput,
  onSuggestionToggle,
  onCustomInputChange,
  onSubmit,
  submitting,
}: IRepairSuggestionsPanelProps) {
  const [localCustomInput, setLocalCustomInput] = useState(customInput);
  const [selectedIndices, setSelectedIndices] = useState<number[]>([]);

  // 当 customInputFirst 为 true 且自定义输入有内容时，清除建议选项的选中状态
  useEffect(() => {
    if (customInputFirst && localCustomInput.trim()) {
      setSelectedIndices([]);
    }
  }, [localCustomInput, customInputFirst]);

  // 渲染自定义输入区域的分隔线
  const renderDivider = () => (
    <div className="my-4 flex items-center gap-3">
      <div className="h-px flex-1 border-t border-amber-200" />
      <span className="text-xs text-slate-500">或者输入你的想法</span>
      <div className="h-px flex-1 border-t border-amber-200" />
    </div>
  );

  // 渲染自定义输入框
  const renderCustomInput = () => (
    <textarea
      className="w-full resize-y rounded-xl border border-amber-200 bg-white px-3 py-2 text-sm text-slate-700 focus:border-amber-400 focus:outline-none focus:ring-2 focus:ring-amber-200 disabled:bg-slate-50"
      rows={3}
      placeholder="请说明需要调整的方向，例如缺少岗位维度分析..."
      value={localCustomInput}
      onChange={(e) => {
        setLocalCustomInput(e.target.value);
        onCustomInputChange(e.target.value);
      }}
      disabled={submitting}
      aria-label="自定义调整意见"
    />
  );

  // 渲染建议选项列表
  const renderSuggestions = () => (
    <div className="space-y-2">
      {suggestions.map((suggestion, index) => {
        const isSelected = selectedIndices.includes(index);
        return (
          <label
            key={index}
            className={`flex cursor-pointer items-center gap-3 rounded-xl border p-3 transition-all duration-150 ${
              isSelected
                ? 'border-amber-400 bg-amber-100/50 scale-102'
                : 'border-amber-200 bg-white/80 opacity-60 scale-98 hover:opacity-100 hover:scale-100'
            } ${submitting ? 'opacity-50 cursor-not-allowed' : ''}`}
          >
            {selectionMode === 'single' ? (
              <input
                type="radio"
                name="repair-suggestion"
                checked={isSelected}
                onChange={() => handleSuggestionToggle(index)}
                className="h-4 w-4 text-amber-600 accent-amber-600"
                disabled={submitting}
              />
            ) : (
              <input
                type="checkbox"
                checked={isSelected}
                onChange={() => handleSuggestionToggle(index)}
                className="h-4 w-4 rounded border-amber-400 text-amber-600 accent-amber-600"
                disabled={submitting}
              />
            )}
            <span className="flex-1 text-slate-700">{suggestion}</span>
            {isSelected && (
              <ChevronRight size={14} className="text-amber-600" aria-hidden="true" />
            )}
          </label>
        );
      })}
    </div>
  );

  const handleSuggestionToggle = (index: number) => {
    if (submitting) return;

    if (selectionMode === 'single') {
      // 单选模式：取消其他选择，只保留当前
      setSelectedIndices([index]);
      onSuggestionToggle(index);
    } else {
      // 多选模式：切换选中状态
      setSelectedIndices((prev) => {
        const newIndices = prev.includes(index)
          ? prev.filter((i) => i !== index)
          : [...prev, index];
        return newIndices;
      });
      onSuggestionToggle(index);
    }
  };

  const handleSubmit = () => {
    // 优先使用自定义输入
    if (localCustomInput.trim()) {
      onSubmit([], localCustomInput.trim());
    } else {
      // 否则使用选中的建议
      const selected = suggestions.filter((_, i) => selectedIndices.includes(i));
      onSubmit(selected, '');
    }
  };

  const isDisabled = submitting || (!localCustomInput.trim() && selectedIndices.length === 0);

  // 根据 customInputFirst 决定渲染顺序
  const renderContent = () => {
    if (customInputFirst) {
      return (
        <>
          {renderCustomInput()}
          {renderDivider()}
          {renderSuggestions()}
        </>
      );
    }
    return (
      <>
        {renderSuggestions()}
        {renderDivider()}
        {renderCustomInput()}
      </>
    );
  };

  return (
    <div className="ml-0 max-w-3xl rounded-3xl border border-amber-200 bg-amber-50/80 p-4 text-sm shadow-sm shadow-amber-100/70 md:ml-12">
      <div className="mb-3 flex items-center gap-2 font-semibold text-slate-950">
        <Lightbulb size={15} className="text-amber-600" aria-hidden="true" />
        规划调整建议
      </div>

      {renderContent()}

      {/* 提交按钮 */}
      <div className="mt-4 flex flex-wrap justify-end gap-2">
        <Button
          type="button"
          size="sm"
          variant="outline"
          disabled={isDisabled}
          onClick={() => onSubmit([], localCustomInput.trim())}
        >
          {submitting ? <Loader2 size={14} className="animate-spin duration-200" aria-hidden="true" /> : null}
          重新规划
        </Button>
        <Button
          type="button"
          size="sm"
          disabled={isDisabled}
          onClick={handleSubmit}
        >
          {submitting ? <Loader2 size={14} className="animate-spin duration-200" aria-hidden="true" /> : null}
          确认并批准
        </Button>
      </div>
    </div>
  );
}