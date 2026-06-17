/**
 * RenameSessionDialog：会话重命名弹窗。
 *
 * 替代原 inline 编辑：打开弹窗 → 输入新标题 → Enter/确认提交，Esc/取消放弃。
 * 复用 ui/Dialog 与 ui/Button，保持与全站弹窗一致的视觉语言。
 */

import { useEffect, useRef, useState } from 'react';
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';

export interface RenameSessionDialogProps {
  /** 是否打开 */
  open: boolean;
  /** 初始标题（打开时回填，空标题给默认占位） */
  initialTitle: string;
  /** 提交回调（传入新标题；空串不提交） */
  onConfirm: (title: string) => void;
  /** 取消/关闭回调 */
  onCancel: () => void;
}

export function RenameSessionDialog({
  open, initialTitle, onConfirm, onCancel,
}: RenameSessionDialogProps) {
  const [draft, setDraft] = useState(initialTitle);
  const inputRef = useRef<HTMLInputElement>(null);

  // 每次打开时同步初始值并聚焦+全选，方便直接覆盖
  useEffect(() => {
    if (open) {
      setDraft(initialTitle);
      // 等下一帧确保 input 已挂载
      requestAnimationFrame(() => {
        inputRef.current?.focus();
        inputRef.current?.select();
      });
    }
  }, [open, initialTitle]);

  const submit = () => {
    const trimmed = draft.trim();
    if (!trimmed) return;
    onConfirm(trimmed);
  };

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onCancel()}>
      <DialogContent>
        <DialogTitle>重命名会话</DialogTitle>
        <input
          ref={inputRef}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') submit();
            else if (e.key === 'Escape') onCancel();
          }}
          placeholder="输入会话标题"
          maxLength={60}
          className="w-full h-10 px-3 rounded-lg border border-[#CBD5E1] text-sm
                     text-[#020617] placeholder:text-[#94A3B8]
                     focus:outline-none focus:ring-2 focus:ring-[#0EA5E9] focus:border-transparent
                     transition-all mb-2"
        />
        <div className="flex justify-end gap-3 mt-4">
          <Button variant="outline" onClick={onCancel}>取消</Button>
          <Button onClick={submit} disabled={!draft.trim()}>保存</Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
