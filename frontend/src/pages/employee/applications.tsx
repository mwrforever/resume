import { lazy, Suspense, useCallback, useEffect, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { AdminLayout } from '@/components/layout/admin-layout';
import { Pagination } from '@/components/common/pagination';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { DepartmentMultiSelect } from '@/components/employee/department-multi-select';
import { employeeApplicationsApi } from '@/api/employee/applications';
import { employeeResumesApi } from '@/api/employee/resumes';
import { employeeEvaluationsApi } from '@/api/employee/evaluations';
import { employeeJobsApi } from '@/api/employee/jobs';
import { deptApi } from '@/api/employee/depts';
import { useDebounce, useThrottleCallback } from '@/hooks/use-debounce';
import type { IDeptItem, Job } from '@/types/employee';
import { BarChart2, ChevronDown, Download, Eye, Loader2, RefreshCw, RotateCcw, Search, X, Zap } from 'lucide-react';

const DEFAULT_PAGE_SIZE = 10;
const ResumePreviewDialog = lazy(async () => {
  const module = await import('@/components/common/resume-preview-dialog');
  return { default: module.ResumePreviewDialog };
});

interface Application {
  id: number;
  user_id: number;
  user_real_name?: string;
  job_id: number;
  job_name: string;
  resume_id: number;
  resume_file_name?: string;
  match_id?: number;
  status: number;
  status_name: string;
  create_time: string;
}

const STATUS_OPTIONS = [
  { value: 0, label: '待评估', cls: 'bg-yellow-100 text-yellow-700' },
  { value: 1, label: '待处理', cls: 'bg-blue-100 text-blue-700' },
  { value: 2, label: '已查看', cls: 'bg-[#F1F5F9] text-[#64748B]' },
  { value: 3, label: '面试中', cls: 'bg-orange-100 text-orange-700' },
  { value: 4, label: '已拒绝', cls: 'bg-red-100 text-red-700' },
  { value: 5, label: '已录用', cls: 'bg-green-100 text-green-700' },
];

function StatusPopover({ app, onUpdate }: { app: Application; onUpdate: (id: number, status: number) => void }) {
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState({ top: 0, left: 0 });
  const btnRef = useRef<HTMLButtonElement>(null);
  const badge = STATUS_OPTIONS.find((o) => o.value === app.status) ?? STATUS_OPTIONS[0];

  const handleToggle = () => {
    if (!open && btnRef.current) {
      const r = btnRef.current.getBoundingClientRect();
      setPos({ top: r.bottom + 4, left: r.left });
    }
    setOpen((v) => !v);
  };

  return (
    <>
      <button
        ref={btnRef}
        onClick={handleToggle}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={`当前状态：${badge.label}，点击修改`}
        className={`inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs font-medium cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#2563EB] ${badge.cls}`}
      >
        {badge.label}
        <ChevronDown size={11} aria-hidden="true" />
      </button>
      {open && (
        <>
          <div className="fixed inset-0 z-40" onMouseDown={() => setOpen(false)} aria-hidden="true" />
          <div
            role="listbox"
            aria-label="选择新状态"
            style={{ position: 'fixed', top: pos.top, left: pos.left, zIndex: 50 }}
            className="bg-white border border-[#E2E8F0] rounded-lg shadow-lg py-1 min-w-[110px]"
          >
            {STATUS_OPTIONS.map((opt) => (
              <button
                key={opt.value}
                role="option"
                aria-selected={opt.value === app.status}
                onClick={() => { onUpdate(app.id, opt.value); setOpen(false); }}
                className={`w-full text-left px-3 py-1.5 text-xs transition-colors hover:bg-[#F8FAFC] focus-visible:outline-none focus-visible:bg-[#F1F5F9] ${
                  opt.value === app.status ? 'font-semibold text-[#2563EB]' : 'text-[#1E293B]'
                }`}
              >
                {opt.label}
              </button>
            ))}
          </div>
        </>
      )}
    </>
  );
}

export default function EmployeeApplications() {
  const [searchParams, setSearchParams] = useSearchParams();
  const [applications, setApplications] = useState<Application[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [previewResume, setPreviewResume] = useState<{ id: number; fileName: string } | null>(null);
  const [evaluatingIds, setEvaluatingIds] = useState<Set<number>>(new Set());
  const [submittedIds, setSubmittedIds] = useState<Set<number>>(new Set());
  const [selectedAppIds, setSelectedAppIds] = useState<number[]>([]);
  const [batchSubmitting, setBatchSubmitting] = useState(false);
  const [jobs, setJobs] = useState<Job[]>([]);
  const [depts, setDepts] = useState<IDeptItem[]>([]);
  const [deptFilterOpen, setDeptFilterOpen] = useState(false);

  const [searchInput, setSearchInput] = useState(() => searchParams.get('search') ?? '');
  const debouncedSearch = useDebounce(searchInput, 400);
  const [jobDialogOpen, setJobDialogOpen] = useState(false);

  const filterStatus = searchParams.get('status') ?? '';
  const filterJobIds = searchParams.getAll('job_ids').map(Number).filter(Boolean);
  const filterDeptIds = searchParams.getAll('dept_ids').map(Number).filter(Boolean);
  const filterSearch = searchParams.get('search') ?? '';
  const page = Number(searchParams.get('page') ?? '1');
  const pageSize = Number(searchParams.get('page_size') ?? String(DEFAULT_PAGE_SIZE));

  // Sync debounced search to URL
  useEffect(() => {
    const next = new URLSearchParams(searchParams);
    if (debouncedSearch) next.set('search', debouncedSearch);
    else next.delete('search');
    if (next.get('search') !== filterSearch) {
      next.delete('page');
      setSearchParams(next);
    }
  }, [debouncedSearch]);

  const loadApplications = useCallback(async (silent = false) => {
    if (!silent) setLoading(true);
    else setRefreshing(true);
    try {
      const params = new URLSearchParams({ page: String(page), page_size: String(pageSize) });
      if (filterStatus) params.set('status', filterStatus);
      filterJobIds.forEach((id) => params.append('job_ids', String(id)));
      filterDeptIds.forEach((id) => params.append('dept_ids', String(id)));
      if (filterSearch) params.set('search', filterSearch);
      const res = await employeeApplicationsApi.list(params);
      setApplications(res.data.items || []);
      setTotal(res.data.total ?? 0);
      setSelectedAppIds([]);
    } catch (error) {
      console.error('Failed to load applications:', error);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [filterStatus, filterJobIds.join(','), filterDeptIds.join(','), filterSearch, page, pageSize]);

  useEffect(() => { loadApplications(); }, [loadApplications]);

  useEffect(() => {
    employeeJobsApi.list({ page: 1, page_size: 100 })
      .then((res) => setJobs(res.data.items || []))
      .catch((error) => console.error('Failed to load jobs:', error));
    deptApi.listDepts()
      .then((res) => setDepts(res.data || []))
      .catch((error) => console.error('Failed to load depts:', error));
  }, []);

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
  const handleRefresh = useThrottleCallback(() => loadApplications(true));

  const handleStatusUpdate = async (appId: number, newStatus: number) => {
    try {
      await employeeApplicationsApi.updateStatus(appId, newStatus);
      setApplications((prev) =>
        prev.map((a) =>
          a.id === appId
            ? { ...a, status: newStatus, status_name: STATUS_OPTIONS.find((o) => o.value === newStatus)?.label ?? '' }
            : a
        )
      );
    } catch (error) {
      console.error('Failed to update status:', error);
    }
  };

  const handleEvaluate = async (app: Application) => {
    setEvaluatingIds((prev) => new Set(prev).add(app.id));
    try {
      await employeeEvaluationsApi.batchEvaluate({ application_ids: [app.id] });
      setSubmittedIds((prev) => new Set(prev).add(app.id));
      setTimeout(() => setSubmittedIds((prev) => { const next = new Set(prev); next.delete(app.id); return next; }), 4000);
      loadApplications(true);
    } catch (error) {
      console.error('Failed to submit evaluation:', error);
    } finally {
      setEvaluatingIds((prev) => { const next = new Set(prev); next.delete(app.id); return next; });
    }
  };

  const selectedApps = applications.filter((app) => selectedAppIds.includes(app.id));
  const selectedJobIds = Array.from(new Set(selectedApps.map((app) => app.job_id)));
  const canBatchEvaluate = selectedApps.length > 0 && selectedJobIds.length === 1 && !batchSubmitting;
  const allSelected = applications.length > 0 && applications.every((app) => selectedAppIds.includes(app.id));

  const toggleApplication = (appId: number) => {
    setSelectedAppIds((prev) => prev.includes(appId) ? prev.filter((id) => id !== appId) : [...prev, appId]);
  };

  const toggleAll = () => {
    setSelectedAppIds(allSelected ? [] : applications.map((app) => app.id));
  };

  const handleBatchEvaluate = async () => {
    if (!canBatchEvaluate) return;
    setBatchSubmitting(true);
    try {
      await employeeEvaluationsApi.batchEvaluate({
        application_ids: selectedApps.map((app) => app.id),
      });
      setSubmittedIds((prev) => {
        const next = new Set(prev);
        selectedApps.forEach((app) => next.add(app.id));
        return next;
      });
      setSelectedAppIds([]);
      setTimeout(() => {
        setSubmittedIds((prev) => {
          const next = new Set(prev);
          selectedApps.forEach((app) => next.delete(app.id));
          return next;
        });
      }, 4000);
      loadApplications(true);
    } catch (error) {
      console.error('Failed to submit batch evaluation:', error);
    } finally {
      setBatchSubmitting(false);
    }
  };

  const handleDownload = async (app: Application) => {
    try {
      const res = await employeeResumesApi.getFile(app.resume_id);
      const blob = res.data;
      const fileName = app.resume_file_name ?? `resume_${app.resume_id}.pdf`;
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = fileName;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch (error) {
      console.error('Failed to download resume:', error);
    }
  };

  const selectedFilterJobs = jobs.filter((job) => filterJobIds.includes(job.id));

  const setFilterJobIds = (jobIds: number[]) => {
    const next = new URLSearchParams(searchParams);
    next.delete('job_ids');
    jobIds.forEach((id) => next.append('job_ids', String(id)));
    next.delete('page');
    setSearchParams(next);
  };

  const toggleFilterJob = (jobId: number) => {
    setFilterJobIds(filterJobIds.includes(jobId) ? filterJobIds.filter((id) => id !== jobId) : [...filterJobIds, jobId]);
  };

  const setFilterDeptIds = (deptIds: number[]) => {
    const next = new URLSearchParams(searchParams);
    next.delete('dept_ids');
    deptIds.forEach((id) => next.append('dept_ids', String(id)));
    next.delete('page');
    setSearchParams(next);
  };

  const handleResetFilters = () => {
    setSearchInput('');
    const next = new URLSearchParams();
    next.set('page', '1');
    next.set('page_size', String(pageSize));
    setSearchParams(next);
  };

  const hasActiveFilters = filterStatus || filterJobIds.length > 0 || filterDeptIds.length > 0 || filterSearch;

  return (
    <AdminLayout breadcrumbs={[{ label: '投递管理' }]} title="投递管理">
      {/* Toolbar */}
      <div className="flex flex-wrap items-center gap-3 mb-4">
        <Select
          value={filterStatus}
          onValueChange={(v) => {
            const next = new URLSearchParams(searchParams);
            if (v) next.set('status', v); else next.delete('status');
            next.delete('page');
            setSearchParams(next);
          }}
        >
          <SelectTrigger className="w-36 bg-white">
            <SelectValue placeholder="全部状态" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="">全部状态</SelectItem>
            {STATUS_OPTIONS.map((opt) => (
              <SelectItem key={opt.value} value={String(opt.value)}>{opt.label}</SelectItem>
            ))}
          </SelectContent>
        </Select>

        {/* Job filter — Dialog style */}
        <div className="w-full max-w-xs">
          <button
            type="button"
            onClick={() => setJobDialogOpen(true)}
            className="min-h-9 w-full rounded-md border border-[#E2E8F0] bg-white px-3 py-1.5 text-left text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#2563EB]"
          >
            {filterJobIds.length === 0 ? (
              <span className="text-[#94A3B8] leading-6">按岗位筛选</span>
            ) : (
              <span className="flex flex-wrap gap-1.5">
                {selectedFilterJobs.map((job) => (
                  <span key={job.id} className="inline-flex items-center gap-1 rounded bg-blue-50 px-2 py-0.5 text-xs text-[#2563EB]">
                    {job.name}
                    <span
                      role="button"
                      tabIndex={0}
                      onClick={(event) => { event.stopPropagation(); toggleFilterJob(job.id); }}
                      onKeyDown={(event) => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); event.stopPropagation(); toggleFilterJob(job.id); } }}
                      className="rounded hover:bg-blue-100"
                      aria-label={`移除岗位 ${job.name}`}
                    >
                      <X size={12} aria-hidden="true" />
                    </span>
                  </span>
                ))}
              </span>
            )}
          </button>

          <Dialog open={jobDialogOpen} onOpenChange={setJobDialogOpen}>
            <DialogContent>
              <div className="mb-4 flex items-center justify-between">
                <DialogTitle className="mb-0">选择岗位</DialogTitle>
                <button
                  type="button"
                  onClick={() => setJobDialogOpen(false)}
                  aria-label="关闭岗位选择"
                  className="text-[#94A3B8] hover:text-[#1E293B] focus-visible:outline-none"
                >
                  <X size={18} aria-hidden="true" />
                </button>
              </div>
              <div className="max-h-80 overflow-auto rounded-lg border border-[#E2E8F0]">
                {jobs.length === 0 ? (
                  <p className="px-4 py-8 text-center text-sm text-[#94A3B8]">暂无岗位</p>
                ) : (
                  jobs.map((job) => {
                    const checked = filterJobIds.includes(job.id);
                    return (
                      <label key={job.id} className="flex cursor-pointer items-center gap-3 border-b border-[#F1F5F9] px-4 py-3 text-sm hover:bg-[#F8FAFC] last:border-b-0">
                        <input
                          type="checkbox"
                          checked={checked}
                          onChange={() => toggleFilterJob(job.id)}
                          className="rounded border-[#CBD5E1] accent-[#2563EB]"
                        />
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-[#1E293B]">{job.name}</span>
                          {job.dept_name && <span className="block truncate text-xs text-[#94A3B8]">{job.dept_name}</span>}
                        </span>
                      </label>
                    );
                  })
                )}
              </div>
              <div className="mt-5 flex justify-between gap-3">
                <Button type="button" variant="outline" onClick={() => setFilterJobIds([])} disabled={filterJobIds.length === 0}>
                  清空
                </Button>
                <Button type="button" onClick={() => setJobDialogOpen(false)} className="bg-[#2563EB] hover:bg-[#1D4ED8] text-white">
                  确定
                </Button>
              </div>
            </DialogContent>
          </Dialog>
        </div>

        <DepartmentMultiSelect
          depts={depts}
          selectedIds={filterDeptIds}
          onChange={setFilterDeptIds}
          open={deptFilterOpen}
          onOpenChange={setDeptFilterOpen}
          placeholder="按部门筛选"
          className="w-full max-w-xs"
        />

        {/* Search input */}
        <div className="relative w-full max-w-xs">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-[#94A3B8]" aria-hidden="true" />
          <input
            type="text"
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
            placeholder="搜索简历或用户姓名"
            className="h-9 w-full rounded-md border border-[#E2E8F0] bg-white pl-8 pr-3 text-sm placeholder:text-[#94A3B8] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#2563EB]"
          />
        </div>

        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={handleResetFilters}
          disabled={!hasActiveFilters}
          className="h-9 text-[#64748B]"
        >
          <RotateCcw size={14} className="mr-1" aria-hidden="true" />
          重置
        </Button>

        <button
          onClick={handleRefresh}
          disabled={refreshing}
          aria-label="刷新"
          className="inline-flex items-center gap-1.5 px-3 h-9 rounded-md border border-[#E2E8F0] bg-white text-sm text-[#64748B] hover:bg-[#F8FAFC] transition-colors disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#2563EB]"
        >
          <RefreshCw size={14} className={refreshing ? 'animate-spin' : ''} aria-hidden="true" />
          刷新
        </button>
        <button
          onClick={handleBatchEvaluate}
          disabled={!canBatchEvaluate}
          title={selectedApps.length > 0 && selectedJobIds.length > 1 ? '只能批量评估同一岗位的投递' : undefined}
          className="inline-flex items-center gap-1.5 px-3 h-9 rounded-md bg-[#2563EB] text-sm text-white hover:bg-[#1D4ED8] transition-colors disabled:cursor-not-allowed disabled:bg-[#CBD5E1] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#2563EB]"
        >
          {batchSubmitting ? <Loader2 size={14} className="animate-spin" aria-hidden="true" /> : <Zap size={14} aria-hidden="true" />}
          批量AI评估{selectedAppIds.length > 0 ? `（${selectedAppIds.length}）` : ''}
        </button>
        {selectedApps.length > 0 && selectedJobIds.length > 1 && (
          <span className="text-xs text-amber-600">请选择同一岗位的投递进行批量评估</span>
        )}
      </div>

      {/* Table */}
      <div className="bg-white rounded-lg border border-[#E2E8F0] overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-[#E2E8F0] bg-[#F8FAFC]">
              <th className="px-4 py-3 w-10">
                <input
                  type="checkbox"
                  checked={allSelected}
                  onChange={toggleAll}
                  disabled={applications.length === 0}
                  aria-label="全选投递"
                  className="rounded border-[#CBD5E1] accent-[#2563EB]"
                />
              </th>
              <th className="text-left px-4 py-3 font-medium text-[#64748B]">求职者</th>
              <th className="text-left px-4 py-3 font-medium text-[#64748B]">投递岗位</th>
              <th className="text-left px-4 py-3 font-medium text-[#64748B]">简历</th>
              <th className="text-left px-4 py-3 font-medium text-[#64748B]">投递时间</th>
              <th className="text-left px-4 py-3 font-medium text-[#64748B]">状态</th>
              <th className="text-right px-4 py-3 font-medium text-[#64748B]">操作</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              [...Array(4)].map((_, i) => (
                <tr key={i} className="border-b border-[#F1F5F9]">
                  {[...Array(7)].map((__, j) => (
                    <td key={j} className="px-4 py-3">
                      <div className="h-4 bg-[#F1F5F9] rounded animate-pulse" />
                    </td>
                  ))}
                </tr>
              ))
            ) : applications.length === 0 ? (
              <tr>
                <td colSpan={7} className="px-4 py-16 text-center text-[#94A3B8]">
                  暂无投递记录
                </td>
              </tr>
            ) : (
              applications.map((app) => {
                const isEvaluating = evaluatingIds.has(app.id);
                const isSubmitted = submittedIds.has(app.id);
                return (
                  <tr key={app.id} className="border-b border-[#F1F5F9] hover:bg-[#F8FAFC] transition-colors">
                    <td className="px-4 py-3">
                      <input
                        type="checkbox"
                        checked={selectedAppIds.includes(app.id)}
                        onChange={() => toggleApplication(app.id)}
                        aria-label={`选择投递 ${app.id}`}
                        className="rounded border-[#CBD5E1] accent-[#2563EB]"
                      />
                    </td>
                    <td className="px-4 py-3 font-medium text-[#1E293B]">{app.user_real_name || `用户 ${app.user_id}`}</td>
                    <td className="px-4 py-3 font-medium text-[#1E293B]">{app.job_name}</td>
                    <td className="px-4 py-3 text-[#64748B] max-w-[180px]">
                      <span className="truncate block">{app.resume_file_name ?? `简历 #${app.resume_id}`}</span>
                    </td>
                    <td className="px-4 py-3 text-[#64748B]">
                      {new Intl.DateTimeFormat('zh-CN', { year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(app.create_time))}
                    </td>
                    <td className="px-4 py-3">
                      <StatusPopover app={app} onUpdate={handleStatusUpdate} />
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-center justify-end gap-2">
                        <button
                          onClick={() => setPreviewResume({ id: app.resume_id, fileName: app.resume_file_name ?? `简历#${app.resume_id}` })}
                          className="inline-flex items-center gap-1 text-xs text-[#64748B] hover:text-[#2563EB] px-2 py-1 rounded hover:bg-blue-50 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#2563EB]"
                        >
                          <Eye size={13} aria-hidden="true" />
                          预览
                        </button>
                        <button
                          onClick={() => handleDownload(app)}
                          className="inline-flex items-center gap-1 text-xs text-[#64748B] hover:text-[#2563EB] px-2 py-1 rounded hover:bg-blue-50 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#2563EB]"
                        >
                          <Download size={13} aria-hidden="true" />
                          下载
                        </button>
                        {isSubmitted ? (
                          <span className="text-xs text-green-600 px-2">已提交</span>
                        ) : (
                          <button
                            onClick={() => handleEvaluate(app)}
                            disabled={isEvaluating}
                            className="inline-flex items-center gap-1 text-xs text-[#2563EB] hover:underline px-2 py-1 rounded hover:bg-blue-50 transition-colors disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#2563EB]"
                          >
                            {isEvaluating ? <><Loader2 size={13} className="animate-spin" aria-hidden="true" />评估中</> : app.match_id ? '重新评估' : 'AI评估'}
                          </button>
                        )}
                        {app.match_id && (
                          <Link
                            to={`/employee/evaluations/${app.match_id}`}
                            className="inline-flex items-center gap-1 text-xs text-[#2563EB] hover:underline px-2 py-1 rounded hover:bg-blue-50 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#2563EB]"
                          >
                            <BarChart2 size={13} aria-hidden="true" />
                            分析报告
                          </Link>
                        )}
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

      {previewResume && (
        <Suspense fallback={null}>
          <ResumePreviewDialog
            resumeId={previewResume.id}
            fileName={previewResume.fileName}
            open={!!previewResume}
            onClose={() => setPreviewResume(null)}
          />
        </Suspense>
      )}
    </AdminLayout>
  );
}