import { FormEvent, useCallback, useEffect, useState } from 'react';
import { Search, X } from 'lucide-react';
import { ConfirmDialog } from '@/components/common/confirm-dialog';
import { Pagination } from '@/components/common/pagination';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { employeeAgentApi } from '@/api/employee/agent';
import { formatAgentTime, hiddenScrollClass } from './agent-ui-utils';
import type { WorkspaceSession } from './agent-session-sidebar';

interface SessionDialogProps {
  open: boolean;
  initialTitle: string;
  saving: boolean;
  onClose: () => void;
  onSubmit: (title: string) => void;
}

export function SessionDialog({ open, initialTitle, saving, onClose, onSubmit }: SessionDialogProps) {
  const [title, setTitle] = useState(initialTitle);

  useEffect(() => {
    if (open) setTitle(initialTitle);
  }, [initialTitle, open]);

  const handleSubmit = (event: FormEvent) => {
    event.preventDefault();
    if (!title.trim()) return;
    onSubmit(title.trim());
  };

  return (
    <Dialog open={open} onOpenChange={(value) => !value && onClose()} containerClassName="max-w-md rounded-2xl">
      <DialogContent>
        <div className="mb-4 flex items-center justify-between">
          <DialogTitle className="mb-0">重命名会话</DialogTitle>
          <button type="button" onClick={onClose} aria-label="关闭" className="cursor-pointer rounded-lg p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"><X size={18} /></button>
        </div>
        <form className="space-y-4" onSubmit={handleSubmit}>
          <div className="space-y-1.5"><Label htmlFor="agent-session-title">会话名称</Label><Input id="agent-session-title" value={title} onChange={(event) => setTitle(event.target.value)} autoFocus required /></div>
          <div className="flex justify-end gap-2"><Button type="button" variant="outline" onClick={onClose} disabled={saving}>取消</Button><Button type="submit" disabled={saving || !title.trim()}>{saving ? '保存中...' : '保存'}</Button></div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

interface SessionSearchDialogProps {
  open: boolean;
  onClose: () => void;
  onOpenSession: (session: WorkspaceSession) => void;
}

export function SessionSearchDialog({ open, onClose, onOpenSession }: SessionSearchDialogProps) {
  const [keyword, setKeyword] = useState('');
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);
  const [total, setTotal] = useState(0);
  const [items, setItems] = useState<WorkspaceSession[]>([]);
  const [loading, setLoading] = useState(false);

  const loadData = useCallback(async () => {
    if (!open) return;
    setLoading(true);
    try {
      const res = await employeeAgentApi.listSessions({ page, page_size: pageSize, keyword: keyword.trim() || undefined });
      setItems(res.data?.items || []);
      setTotal(res.data?.total || 0);
    } finally {
      setLoading(false);
    }
  }, [keyword, open, page, pageSize]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  const handleSearch = (event: FormEvent) => {
    event.preventDefault();
    setPage(1);
    loadData();
  };

  return (
    <Dialog open={open} onOpenChange={(value) => !value && onClose()} containerClassName="max-w-3xl rounded-2xl">
      <DialogContent className={`max-h-[82vh] overflow-y-auto ${hiddenScrollClass}`}>
        <div className="mb-4 flex items-center justify-between"><DialogTitle className="mb-0">搜索会话</DialogTitle><button type="button" onClick={onClose} aria-label="关闭" className="cursor-pointer rounded-lg p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"><X size={18} /></button></div>
        <form className="mb-4 flex gap-2" onSubmit={handleSearch}><Input value={keyword} onChange={(event) => setKeyword(event.target.value)} placeholder="输入会话名称搜索" /><Button type="submit" disabled={loading}><Search size={15} className="mr-1.5" aria-hidden="true" />搜索</Button></form>
        <div className="space-y-2">
          {items.map((session) => <button key={session.id} type="button" onClick={() => { onOpenSession(session); onClose(); }} className="flex w-full cursor-pointer items-center justify-between gap-3 rounded-2xl border border-slate-200 bg-white p-3 text-left hover:border-primary/30 hover:bg-sky-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"><div className="min-w-0"><div className="truncate text-sm font-semibold text-slate-950">{session.title}</div><div className="mt-1 text-xs text-slate-500">{formatAgentTime(session.last_message_time || session.update_time)}</div></div><Badge variant="outline">打开</Badge></button>)}
          {!loading && items.length === 0 && <div className="rounded-2xl border border-dashed border-sky-200 bg-sky-50/50 p-6 text-sm text-slate-600">暂无匹配会话。</div>}
        </div>
        <Pagination page={page} pageSize={pageSize} total={total} onChange={setPage} onPageSizeChange={(size) => { setPageSize(size); setPage(1); }} />
      </DialogContent>
    </Dialog>
  );
}

interface DeleteSessionDialogProps {
  target: WorkspaceSession | null;
  loading: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

export function DeleteSessionDialog({ target, loading, onConfirm, onCancel }: DeleteSessionDialogProps) {
  return <ConfirmDialog open={!!target} title="确认删除会话" description={`确定要删除「${target?.title}」吗？删除后会话将不再展示。`} confirmLabel="删除" onConfirm={onConfirm} onCancel={onCancel} loading={loading} />;
}
