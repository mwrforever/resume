import { useCallback, useEffect, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { AdminLayout } from '@/components/layout/admin-layout';
import { Pagination } from '@/components/common/pagination';
import { ResumePreviewDialog } from '@/components/common/resume-preview-dialog';
import { EvaluationRadarChart } from '@/components/common/radar-chart';
import { MatchBadge } from '@/components/common/match-badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { employeeApplicationsApi } from '@/api/employee/applications';
import { employeeEvaluationsApi } from '@/api/employee/evaluations';
import { BarChart2, ChevronDown, Eye, Loader2, RefreshCw, X } from 'lucide-react';

const DEFAULT_PAGE_SIZE = 10;

interface Evaluation {
  final_score: number;
  final_label: '优秀' | '良好' | '一般' | '未达标';
  advantage_comment: string;
  disadvantage_comment: string;
  dimensions: { dimension_name: string; score: number }[];
  skill_hits: { skill_name: string; skill_type: number; is_hit: boolean }[];
}

function EvalReportDialog({ matchId, onClose }: { matchId: number; onClose: () => void }) {
  const [evaluation, setEvaluation] = useState<Evaluation | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    employeeEvaluationsApi.getEvaluation(matchId)
      .then((res) => setEvaluation(res.data))
      .catch(() => setEvaluation(null))
      .finally(() => setLoading(false));
  }, [matchId]);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
      onMouseDown={onClose}
    >
      <div
        className="bg-[#F5F7FA] rounded-xl w-full max-w-4xl max-h-[90vh] overflow-y-auto shadow-2xl"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-6 py-4 border-b border-[#E2E8F0] bg-white rounded-t-xl">
          <h2 className="text-base font-semibold text-[#1E293B]">简历分析报告</h2>
          <button
            onClick={onClose}
            className="text-[#64748B] hover:text-[#1E293B] p-1 rounded transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#2563EB]"
            aria-label="关闭"
          >
            <X size={18} />
          </button>
        </div>

        <div className="p-6">
          {loading ? (
            <div className="space-y-4">
              {[...Array(3)].map((_, i) => <div key={i} className="h-32 bg-white rounded-lg animate-pulse" />)}
            </div>
          ) : !evaluation ? (
            <p className="text-[#94A3B8] text-center py-12">评估记录不存在</p>
          ) : (
            <>
              <Card className="mb-6">
                <CardContent className="p-6 flex items-center gap-6">
                  <div>
                    <p className="text-sm text-[#64748B] mb-1">综合匹配度</p>
                    <p className="text-4xl font-bold tabular-nums text-[#1E293B]">{evaluation.final_score}</p>
                    <p className="text-sm text-[#94A3B8]">/100</p>
                  </div>
                  <div className="flex-1 space-y-2">
                    <MatchBadge label={evaluation.final_label} />
                    <div className="w-full bg-[#F1F5F9] rounded-full h-2 mt-2">
                      <div
                        className="h-2 rounded-full bg-[#2563EB] transition-all"
                        style={{ width: `${evaluation.final_score}%` }}
                        role="progressbar"
                        aria-valuenow={evaluation.final_score}
                        aria-valuemin={0}
                        aria-valuemax={100}
                      />
                    </div>
                  </div>
                </CardContent>
              </Card>

              <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                <div className="space-y-6">
                  <Card>
                    <CardHeader><CardTitle className="text-sm">多维度得分</CardTitle></CardHeader>
                    <CardContent>
                      <EvaluationRadarChart
                        data={evaluation.dimensions.map((d) => ({ dimension: d.dimension_name, score: d.score }))}
                      />
                    </CardContent>
                  </Card>
                  <Card>
                    <CardHeader><CardTitle className="text-sm">优缺点评价</CardTitle></CardHeader>
                    <CardContent className="space-y-3">
                      {evaluation.advantage_comment && (
                        <div className="p-3 bg-green-50 border border-green-200 rounded-lg">
                          <p className="text-xs font-semibold text-green-700 mb-1">优点</p>
                          <p className="text-sm text-[#1E293B]">{evaluation.advantage_comment}</p>
                        </div>
                      )}
                      <div className="p-3 bg-[#FFF7ED] border border-orange-200 rounded-lg">
                        <p className="text-xs font-semibold text-orange-700 mb-1">待提升</p>
                        <p className="text-sm text-[#1E293B]">{evaluation.disadvantage_comment || '这份简历挺符合岗位预期 🎉'}</p>
                      </div>
                    </CardContent>
                  </Card>
                </div>

                <Card>
                  <CardHeader><CardTitle className="text-sm">技能命中详情</CardTitle></CardHeader>
                  <CardContent className="p-0">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="border-b border-[#E2E8F0] bg-[#F8FAFC]">
                          <th className="text-left px-4 py-3 font-medium text-[#64748B]">技能</th>
                          <th className="text-left px-4 py-3 font-medium text-[#64748B]">类型</th>
                          <th className="text-left px-4 py-3 font-medium text-[#64748B]">命中</th>
                        </tr>
                      </thead>
                      <tbody>
                        {evaluation.skill_hits.map((hit, idx) => (
                          <tr key={idx} className="border-b border-[#F1F5F9]">
                            <td className="px-4 py-2.5 text-[#1E293B]">{hit.skill_name ?? '—'}</td>
                            <td className="px-4 py-2.5 text-[#64748B]">
                              {hit.skill_type === 1 ? '必须满足' : hit.skill_type === 2 ? '优先匹配' : '普通技能'}
                            </td>
                            <td className="px-4 py-2.5">
                              {hit.is_hit
                                ? <span className="text-green-600 font-medium" aria-label="已命中">✓</span>
                                : <span className="text-[#94A3B8]" aria-label="未命中">✗</span>}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </CardContent>
                </Card>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

interface Application {
  id: number;
  user_id: number;
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
  const [reportMatchId, setReportMatchId] = useState<number | null>(null);
  const [evaluatingIds, setEvaluatingIds] = useState<Set<number>>(new Set());
  const [submittedIds, setSubmittedIds] = useState<Set<number>>(new Set());

  const filterStatus = searchParams.get('status') ?? '';
  const page = Number(searchParams.get('page') ?? '1');
  const pageSize = Number(searchParams.get('page_size') ?? String(DEFAULT_PAGE_SIZE));

  const loadApplications = useCallback(async (silent = false) => {
    if (!silent) setLoading(true);
    else setRefreshing(true);
    try {
      const params: Record<string, string> = { page: String(page), page_size: String(pageSize) };
      if (filterStatus) params.status = filterStatus;
      const res = await employeeApplicationsApi.list(params);
      setApplications(res.data.items || []);
      setTotal(res.data.total ?? 0);
    } catch (error) {
      console.error('Failed to load applications:', error);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [filterStatus, page, pageSize]);

  useEffect(() => { loadApplications(); }, [loadApplications]);

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
      await employeeEvaluationsApi.batchEvaluate({ resume_ids: [app.resume_id], job_id: app.job_id });
      setSubmittedIds((prev) => new Set(prev).add(app.id));
      setTimeout(() => setSubmittedIds((prev) => { const next = new Set(prev); next.delete(app.id); return next; }), 4000);
      loadApplications(true);
    } catch (error) {
      console.error('Failed to submit evaluation:', error);
    } finally {
      setEvaluatingIds((prev) => { const next = new Set(prev); next.delete(app.id); return next; });
    }
  };

  return (
    <AdminLayout breadcrumbs={[{ label: '投递管理' }]} title="投递管理">
      {/* Toolbar */}
      <div className="flex items-center gap-3 mb-4">
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
        <button
          onClick={() => loadApplications(true)}
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
                  {[...Array(6)].map((__, j) => (
                    <td key={j} className="px-4 py-3">
                      <div className="h-4 bg-[#F1F5F9] rounded animate-pulse" />
                    </td>
                  ))}
                </tr>
              ))
            ) : applications.length === 0 ? (
              <tr>
                <td colSpan={6} className="px-4 py-16 text-center text-[#94A3B8]">
                  暂无投递记录
                </td>
              </tr>
            ) : (
              applications.map((app) => {
                const isEvaluating = evaluatingIds.has(app.id);
                const isSubmitted = submittedIds.has(app.id);
                return (
                  <tr key={app.id} className="border-b border-[#F1F5F9] hover:bg-[#F8FAFC] transition-colors">
                    <td className="px-4 py-3 text-[#64748B] tabular-nums">用户 {app.user_id}</td>
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
                        {isSubmitted ? (
                          <span className="text-xs text-green-600 px-2">已提交</span>
                        ) : (
                          <button
                            onClick={() => handleEvaluate(app)}
                            disabled={isEvaluating}
                            className="inline-flex items-center gap-1 text-xs text-[#2563EB] hover:underline px-2 py-1 rounded hover:bg-blue-50 transition-colors disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#2563EB]"
                          >
                            {isEvaluating ? <><Loader2 size={13} className="animate-spin" aria-hidden="true" />评估中</> : 'AI评估'}
                          </button>
                        )}
                        {app.match_id && (
                          <button
                            onClick={() => setReportMatchId(app.match_id!)}
                            className="inline-flex items-center gap-1 text-xs text-[#2563EB] hover:underline px-2 py-1 rounded hover:bg-blue-50 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#2563EB]"
                          >
                            <BarChart2 size={13} aria-hidden="true" />
                            分析报告
                          </button>
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
        <ResumePreviewDialog
          resumeId={previewResume.id}
          fileName={previewResume.fileName}
          open={!!previewResume}
          onClose={() => setPreviewResume(null)}
        />
      )}
      {reportMatchId && (
        <EvalReportDialog matchId={reportMatchId} onClose={() => setReportMatchId(null)} />
      )}
    </AdminLayout>
  );
}