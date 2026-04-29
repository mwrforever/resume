import { lazy, Suspense, useCallback, useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { AdminLayout } from '@/components/layout/admin-layout';
import { Button } from '@/components/ui/button';
import { Pagination } from '@/components/common/pagination';
import { employeeResumesApi } from '@/api/employee/resumes';
import { useDebounce, useThrottleCallback } from '@/hooks/use-debounce';
import { Eye, RefreshCw, RotateCcw, Search } from 'lucide-react';

const DEFAULT_PAGE_SIZE = 10;
const ResumePreviewDialog = lazy(async () => {
  const module = await import('@/components/common/resume-preview-dialog');
  return { default: module.ResumePreviewDialog };
});

interface Resume {
  id: number;
  file_name: string;
  user_id?: number;
  user_name?: string;
  status: number;
  create_time: string;
}

const STATUS_BADGE: Record<number, { label: string; cls: string }> = {
  0: { label: '正常', cls: 'bg-green-100 text-green-700' },
  1: { label: '异常', cls: 'bg-red-100 text-red-600' },
};

export default function EmployeeResumes() {
  const [searchParams, setSearchParams] = useSearchParams();
  const [resumes, setResumes] = useState<Resume[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [previewResume, setPreviewResume] = useState<{ id: number; fileName: string } | null>(null);

  const [searchInput, setSearchInput] = useState(() => searchParams.get('search') ?? '');
  const debouncedSearch = useDebounce(searchInput, 400);

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

  const load = useCallback(async (silent = false) => {
    if (!silent) setLoading(true);
    else setRefreshing(true);
    try {
      const res = await employeeResumesApi.list({ page, page_size: pageSize, ...(filterSearch ? { search: filterSearch } : {}) } as any);
      setResumes(res.data.items || []);
      setTotal(res.data.total ?? 0);
    } catch (error) {
      console.error('Failed to load resumes:', error);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [page, pageSize, filterSearch]);

  useEffect(() => { load(); }, [load]);

  const setPage = (p: number) => setSearchParams(prev => { const next = new URLSearchParams(prev); next.set('page', String(p)); return next; });

  const setPageSize = (size: number) => setSearchParams(prev => { const next = new URLSearchParams(prev); next.set('page_size', String(size)); next.delete('page'); return next; });
  const handleRefresh = useThrottleCallback(() => load(true));
  const handleReset = () => {
    setSearchInput('');
    setSearchParams(prev => { const next = new URLSearchParams(prev); next.delete('search'); next.set('page', '1'); return next; });
  };

  return (
    <AdminLayout breadcrumbs={[{ label: '简历库' }]} title="简历库">
      {/* Toolbar */}
      <div className="flex flex-wrap items-center gap-3 mb-4">
        <div className="relative w-full max-w-xs">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-[#94A3B8]" aria-hidden="true" />
          <input
            type="text"
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
            placeholder="搜索简历文件名或上传者"
            className="h-9 w-full rounded-md border border-[#E2E8F0] bg-white pl-8 pr-3 text-sm placeholder:text-[#94A3B8] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#2563EB]"
          />
        </div>
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={handleReset}
          disabled={!filterSearch}
          className="h-9 text-[#64748B]"
        >
          <RotateCcw size={14} className="mr-1" aria-hidden="true" />
          重置
        </Button>
        <div className="flex-1" />
        <button
          onClick={handleRefresh}
          disabled={refreshing}
          aria-label="刷新"
          className="inline-flex items-center gap-1.5 px-3 h-9 rounded-md border border-[#E2E8F0] bg-white text-sm text-[#64748B] hover:bg-[#F8FAFC] transition-colors disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#2563EB]"
        >
          <RefreshCw size={14} className={refreshing ? 'animate-spin' : ''} aria-hidden="true" />
          刷新
        </button>
      </div>

      {/* Table */}
      <div className="bg-white rounded-lg border border-[#E2E8F0] overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-[#E2E8F0] bg-[#F8FAFC]">
              <th className="text-left px-4 py-3 font-medium text-[#64748B]">文件名</th>
              <th className="text-left px-4 py-3 font-medium text-[#64748B]">上传者</th>
              <th className="text-left px-4 py-3 font-medium text-[#64748B]">状态</th>
              <th className="text-left px-4 py-3 font-medium text-[#64748B]">上传时间</th>
              <th className="text-right px-4 py-3 font-medium text-[#64748B]">操作</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              [...Array(4)].map((_, i) => (
                <tr key={i} className="border-b border-[#F1F5F9]">
                  {[...Array(5)].map((__, j) => (
                    <td key={j} className="px-4 py-3">
                      <div className="h-4 bg-[#F1F5F9] rounded animate-pulse" />
                    </td>
                  ))}
                </tr>
              ))
            ) : resumes.length === 0 ? (
              <tr>
                <td colSpan={5} className="px-4 py-16 text-center text-[#94A3B8]">暂无简历</td>
              </tr>
            ) : (
              resumes.map((resume) => {
                const badge = STATUS_BADGE[resume.status] ?? { label: '未知', cls: 'bg-[#F1F5F9] text-[#64748B]' };
                return (
                  <tr key={resume.id} className="border-b border-[#F1F5F9] hover:bg-[#F8FAFC] transition-colors">
                    <td className="px-4 py-3 max-w-xs">
                      <button
                        onClick={() => setPreviewResume({ id: resume.id, fileName: resume.file_name })}
                        className="font-medium text-[#1E293B] hover:text-[#2563EB] transition-colors truncate block max-w-full text-left focus-visible:outline-none focus-visible:underline"
                      >
                        {resume.file_name}
                      </button>
                    </td>
                    <td className="px-4 py-3 text-[#64748B]">{resume.user_name ?? '—'}</td>
                    <td className="px-4 py-3">
                      <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${badge.cls}`}>
                        {badge.label}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-[#64748B]">
                      {new Intl.DateTimeFormat('zh-CN', { year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(resume.create_time))}
                    </td>
                    <td className="px-4 py-3 text-right">
                      <button
                        onClick={() => setPreviewResume({ id: resume.id, fileName: resume.file_name })}
                        aria-label={`预览简历 ${resume.file_name}`}
                        className="inline-flex items-center gap-1 text-xs text-[#2563EB] hover:underline px-2 py-1 rounded hover:bg-blue-50 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#2563EB]"
                      >
                        <Eye size={13} aria-hidden="true" />
                        预览
                      </button>
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
