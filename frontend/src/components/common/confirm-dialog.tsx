import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';

interface ConfirmDialogProps {
  open: boolean;
  title: string;
  description: string;
  confirmLabel?: string;
  onConfirm: () => void;
  onCancel: () => void;
  loading?: boolean;
}

export function ConfirmDialog({
  open,
  title,
  description,
  confirmLabel = '确认删除',
  onConfirm,
  onCancel,
  loading,
}: ConfirmDialogProps) {
  return (
    <Dialog open={open} onOpenChange={(o) => !o && onCancel()}>
      <DialogContent>
        <DialogTitle>{title}</DialogTitle>
        <p className="text-sm text-[#64748B] mb-6">{description}</p>
        <div className="flex justify-end gap-3">
          <Button variant="outline" onClick={onCancel} disabled={loading}>
            取消
          </Button>
          <button
            onClick={onConfirm}
            disabled={loading}
            className="inline-flex items-center justify-center rounded-md text-sm font-medium h-10 px-4 py-2 bg-red-600 text-white hover:bg-red-700 transition-colors disabled:pointer-events-none disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-400"
          >
            {loading ? '处理中…' : confirmLabel}
          </button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
