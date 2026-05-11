import { useCallback, useEffect, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { AdminLayout } from '@/components/layout/admin-layout';
import { ConfirmDialog } from '@/components/common/confirm-dialog';
import { Pagination } from '@/components/common/pagination';
import { employeeJobsApi } from '@/api/employee/jobs';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { useDebounce, useThrottleCallback } from '@/hooks/use-debounce';
import { Plus, Pencil, Trash2, RefreshCw, Loader2, X, Eye, Send } from 'lucide-react';
import { CreateJobModal } from '@/components/employee/create-job-modal';

// ─── Edit-only dialog ──────────────────────────────────────────────────────

interface JobEditDialogProps {
  jobId: number;
  onClose: () => void;
  onSuccess: () => void;
}

function JobEditDialog({ jobId, onClose, onSuccess }: JobEditDialogProps) {
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [status, setStatus] = useState(1);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    employeeJobsApi.get(jobId).then(res => {
      const job = res.data?.data ?? res.data;
      setName(job.name ?? '');
      setDescription(job.description ?? '');
      setStatus(job.status ?? 1);
    }).catch(() => setError('加载失败，请关闭重试')).finally(() => setLoading(false));
  }, [jobId]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return;
    setSaving(true); setError('');
    try {
      await employeeJobsApi.update(jobId, { name, description, status });
      onSuccess();
    } catch {
      setError('保存失败，请重试');
      setSaving(false);
    }
  };

  return (
    <Dialog open onOpenChange={onClose} containerClassName="max-w-lg">
      <DialogContent>
        <div className="flex items-center justify-between mb-4">
          <DialogTitle className="mb-0">编辑岗位</DialogTitle>
          <button onClick={onClose} aria-label="关闭" className="text-[#94A3B8] hover:text-[#1E293B] transition-colors focus-visible:outline-none">
            <X size={18} />
          </button>
        </div>
        {loading ? (
          <div className="flex items-center justify-center py-10 text-[#94A3B8]">
            <Loader2 size={20} className="animate-spin mr-2" />加载中…
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="edit-job-name">岗位名称 <span className="text-red-500">*</span></Label>
              <Input id="edit-job-name" value={name} onChange={e => setName(e.target.value)} required className="h-10" />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="edit-job-desc">岗位描述</Label>
              <Textarea id="edit-job-desc" value={description} onChange={e => setDescription(e.target.value)} className="min-h-[90px] resize-none" />
            </div>
            <div className="space-y-1.5">
              <Label>岗位状态</Label>
              <div className="flex gap-3">
                {[{ val: 2, label: '待发布', active: 'bg-amber-100 text-amber-700 border-amber-300' }, { val: 0, label: '已下架', active: 'bg-[#F1F5F9] text-[#64748B] border-[#CBD5E1]' }].map(opt => (
                  <button key={opt.val} type="button" onClick={() => setStatus(opt.val)}
                    className={`px-4 py-2 rounded-lg text-sm font-medium border transition-colors focus-visible:outline-none ${status === opt.val ? opt.active : 'bg-white text-[#64748B] border-[#E2E8F0] hover:bg-[#F8FAFC]'}`}>
                    {opt.label}
                  </button>
                ))}
              </div>
            </div>
            {error && <p className="text-sm text-red-500">{error}</p>}
            <div className="flex justify-end gap-2 pt-1">
              <Button type="button" variant="outline" onClick={onClose} disabled={saving}>取消</Button>
              <Button type="submit" disabled={saving || !name.trim()} className="bg-[#2563EB] hover:bg-[#1D4ED8] text-white">
                {saving ? <><Loader2 size={14} className="animate-spin mr-1.5" />保存中…</> : '保存修改'}
              </Button>
            </div>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}

const DEFAULT_PAGE_SIZE = 10;

interface Job {
  id: number;
  name: string;
  dept_name?: string;
  dept_code?: string;
  status: number;
  resume_count?: number;
  create_time: string;
}

// ─── Main Page ───────────────────────────────────────────────────────────────

export default function EmployeeJobs() {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const [jobs, setJobs] = useState<Job[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<Job | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [publishingId, setPublishingId] = useState<number | null>(null);
  const [dialogMode, setDialogMode] = useState<'create' | 'edit' | null>(null);
  const [editJobId, setEditJobId] = useState<number | null>(null);
  const [searchText, setSearchText] = useState(searchParams.get('search') ?? '');

  const searchInput = searchParams.get('search') ?? '';
  const statusFilter = searchParams.get('status') ?? '';
  const page = Number(searchParams.get('page') ?? '1');
  const pageSize = Number(searchParams.get('page_size') ?? String(DEFAULT_PAGE_SIZE));

  const debouncedSearchText = useDebounce(searchText, 350);

  const loadJobs = useCallback(async (silent = false) => {
    if (!silent) setLoading(true);
    else setRefreshing(true);
    try {
      const params: Record<string, string> = { page: String(page), page_size: String(pageSize) };
      if (searchInput) params.search = searchInput;
      if (statusFilter) params.status = statusFilter;
      const res = await employeeJobsApi.list(params);
      setJobs(res.data.items || []);
      setTotal(res.data.total ?? 0);
    } catch (error) {
      console.error('Failed to load jobs:', error);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [searchInput, statusFilter, page, pageSize]);

  useEffect(() => { loadJobs(); }, [loadJobs]);

  useEffect(() => {
    setSearchText(searchInput);
  }, [searchInput]);

  useEffect(() => {
    if (debouncedSearchText === searchInput) return;
    setSearchParams(prev => {
      const next = new URLSearchParams(prev);
      if (debouncedSearchText) next.set('search', debouncedSearchText); else next.delete('search');
      next.delete('page');
      return next;
    });
  }, [debouncedSearchText, searchInput, setSearchParams]);

  const setParam = (key: string, val: string, resetPage = true) => {
    const next = new URLSearchParams(searchParams);
    if (val) next.set(key, val); else next.delete(key);
    if (resetPage) next.delete('page');
    setSearchParams(next);
  };

  const setPage = (p: number) => {
    const next = new URLSearchParams(searchParams);
    next.set('page', String(p));
    setSearchParams(next);
  };

  const setPageSize = (size: number) => {
    const next = new URLSearchParams(searchParams);
    next.set('page_size', String(size));
    next.delete('page');
    setSearchParams(next);
  };

  const handleDelete = async () => {
    if (!deleteTarget) return;
    setDeleting(true);
    try {
      await employeeJobsApi.delete(deleteTarget.id);
      setDeleteTarget(null);
      await loadJobs();
    } catch (error) {
      console.error('Failed to delete job:', error);
    } finally {
      setDeleting(false);
    }
  };

  const handlePublish = async (job: Job) => {
    setPublishingId(job.id);
    try {
      await employeeJobsApi.publish(job.id);
      await loadJobs();
    } catch (error) {
      console.error('Failed to publish job:', error);
    } finally {
      setPublishingId(null);
    }
  };

  const openEdit = (job: Job) => {
    if (job.status === 1 || (job.resume_count ?? 0) > 0) return;
    setEditJobId(job.id);
    setDialogMode('edit');
  };

  const closeDialog = () => {
    setDialogMode(null);
    setEditJobId(null);
  };

  const handleDialogSuccess = () => {
    closeDialog();
    loadJobs();
  };
  const handleRefresh = useThrottleCallback(() => loadJobs(true));

  return (
    <AdminLayout
      breadcrumbs={[{ label: '岗位管理' }]}
      title="岗位管理"
      headerAction={
        <Button onClick={() => setDialogMode('create')}>
          <Plus size={16} className="mr-1.5" aria-hidden="true" />
          创建岗位
        </Button>
      }
    >
      {/* Toolbar */}
      <div className="mb-4 flex flex-wrap items-center gap-3 rounded-2xl border border-white/80 bg-white/85 p-3 shadow-sm shadow-slate-200/70 backdrop-blur">
        <Input
          type="search"
          placeholder="搜索岗位名称…"
          value={searchText}
          onChange={(e) => setSearchText(e.target.value)}
          className="w-56 bg-white"
          name="job-search"
          autoComplete="off"
        />
        <Select value={statusFilter} onValueChange={(v) => setParam('status', v)}>
          <SelectTrigger className="w-36 bg-white">
            <SelectValue placeholder="全部状态" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="">全部状态</SelectItem>
            <SelectItem value="1">招聘中</SelectItem>
            <SelectItem value="2">待发布</SelectItem>
            <SelectItem value="0">已下架</SelectItem>
          </SelectContent>
        </Select>
        <button
          onClick={handleRefresh}
          disabled={refreshing}
          aria-label="刷新"
          className="inline-flex h-9 items-center gap-1.5 rounded-xl border border-border bg-white px-3 text-sm font-semibold text-slate-600 shadow-sm hover:border-primary/40 hover:bg-sky-50 hover:text-primary disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <RefreshCw size={14} className={refreshing ? 'animate-spin' : ''} aria-hidden="true" />
          刷新
        </button>
      </div>

      {/* Table */}
      <div className="overflow-hidden rounded-2xl border border-white/80 bg-white/90 shadow-sm shadow-slate-200/70 backdrop-blur">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-slate-200 bg-slate-50/80">
              <th className="px-4 py-3 text-left font-semibold text-slate-600">岗位名称</th>
              <th className="px-4 py-3 text-left font-semibold text-slate-600">部门</th>
              <th className="px-4 py-3 text-left font-semibold text-slate-600">状态</th>
              <th className="px-4 py-3 text-left font-semibold tabular-nums text-slate-600">简历数</th>
              <th className="px-4 py-3 text-left font-semibold text-slate-600">发布时间</th>
              <th className="px-4 py-3 text-right font-semibold text-slate-600">操作</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              [...Array(4)].map((_, i) => (
                <tr key={i} className="border-b border-slate-100">
                  {[...Array(6)].map((__, j) => (
                    <td key={j} className="px-4 py-3">
                      <div className="h-4 animate-pulse rounded bg-slate-100" />
                    </td>
                  ))}
                </tr>
              ))
            ) : jobs.length === 0 ? (
              <tr>
                <td colSpan={6} className="px-4 py-16 text-center text-slate-400">
                  <p className="mb-3">还没有创建过岗位</p>
                  <Button variant="outline" size="sm" onClick={() => setDialogMode('create')}>去创建第一个岗位</Button>
                </td>
              </tr>
            ) : (
              jobs.map((job) => {
                const resumeCount = job.resume_count ?? 0;
                const canEdit = job.status !== 1 && resumeCount === 0;
                return (
                <tr key={job.id} className="border-b border-slate-100 transition-colors hover:bg-sky-50/50">
                  <td className="px-4 py-3">
                    <button
                      onClick={() => openEdit(job)}
                      disabled={!canEdit}
                      className="text-left font-semibold text-slate-900 hover:text-primary focus-visible:outline-none focus-visible:underline disabled:cursor-not-allowed disabled:text-slate-500 disabled:hover:text-slate-500"
                    >
                      {job.name}
                    </button>
                  </td>
                  <td className="px-4 py-3 text-[#64748B]">
                    {job.dept_name
                      ? <span>{job.dept_name}{job.dept_code && <span className="ml-1.5 text-xs text-slate-400">({job.dept_code})</span>}</span>
                      : '—'}
                  </td>
                  <td className="px-4 py-3">
                    {job.status === 1
                      ? <Badge className="bg-green-100 text-green-700 border-green-200">招聘中</Badge>
                      : job.status === 2
                        ? <Badge className="bg-amber-100 text-amber-700 border-amber-200">待发布</Badge>
                      : <Badge className="bg-[#F1F5F9] text-[#64748B] border-[#E2E8F0]">已下架</Badge>
                    }
                  </td>
                  <td className="px-4 py-3 tabular-nums text-slate-600">{resumeCount}</td>
                  <td className="px-4 py-3 text-slate-600">
                    {new Intl.DateTimeFormat('zh-CN', { year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(job.create_time))}
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex items-center justify-end gap-2">
                      <button
                        onClick={() => navigate(`/employee/jobs/${job.id}/preview`)}
                        className="inline-flex items-center gap-1 rounded-lg px-2 py-1 text-xs font-semibold text-slate-600 hover:bg-slate-100 hover:text-slate-900 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                      >
                        <Eye size={13} aria-hidden="true" />
                        预览
                      </button>
                      {job.status !== 1 && (
                        <button
                          onClick={() => handlePublish(job)}
                          disabled={publishingId === job.id}
                          className="inline-flex items-center gap-1 rounded-lg px-2 py-1 text-xs font-semibold text-green-600 hover:bg-green-50 hover:underline disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-green-400"
                        >
                          {publishingId === job.id ? <Loader2 size={13} className="animate-spin" aria-hidden="true" /> : <Send size={13} aria-hidden="true" />}
                          发布
                        </button>
                      )}
                      <button
                        onClick={() => openEdit(job)}
                        disabled={!canEdit}
                        title={!canEdit ? '招聘中或已有投递的岗位不能编辑' : undefined}
                        className="inline-flex items-center gap-1 rounded-lg px-2 py-1 text-xs font-semibold text-primary hover:bg-sky-50 hover:underline disabled:cursor-not-allowed disabled:text-slate-400 disabled:hover:bg-transparent disabled:hover:no-underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                      >
                        <Pencil size={13} aria-hidden="true" />
                        编辑
                      </button>
                      <button
                        onClick={() => setDeleteTarget(job)}
                        className="inline-flex items-center gap-1 rounded-lg px-2 py-1 text-xs font-semibold text-red-500 hover:bg-red-50 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-400"
                      >
                        <Trash2 size={13} aria-hidden="true" />
                        删除
                      </button>
                    </div>
                  </td>
                </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>

      <Pagination page={page} pageSize={pageSize} total={total} onChange={setPage} onPageSizeChange={setPageSize} />

      <ConfirmDialog
        open={!!deleteTarget}
        title="确认删除岗位"
        description={`确定要删除「${deleteTarget?.name}」吗？删除后无法恢复。`}
        confirmLabel="删除"
        onConfirm={handleDelete}
        onCancel={() => setDeleteTarget(null)}
        loading={deleting}
      />

      <CreateJobModal
        open={dialogMode === 'create'}
        onClose={closeDialog}
        onSuccess={handleDialogSuccess}
      />

      {dialogMode === 'edit' && editJobId && (
        <JobEditDialog
          jobId={editJobId}
          onClose={closeDialog}
          onSuccess={handleDialogSuccess}
        />
      )}
    </AdminLayout>
  );
}
