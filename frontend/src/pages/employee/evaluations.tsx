import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { AdminLayout } from '@/components/layout/admin-layout';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { MatchPieChart } from '@/components/common/match-pie-chart';
import { MatchBadge } from '@/components/common/match-badge';
import { employeeJobsApi } from '@/api/employee/jobs';
import { employeeEvaluationsApi } from '@/api/employee/evaluations';
import { employeeAnalyticsApi } from '@/api/employee/analytics';
import { employeeResumesApi } from '@/api/employee/resumes';
import { MatchDistribution, ResumeWithEvaluation, Job } from '@/types/employee';
import { Loader2, RotateCcw, X, Download } from 'lucide-react';
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog';

export default function EmployeeEvaluations() {
  const [jobs, setJobs] = useState<Job[]>([]);
  const [jobSelectOpen, setJobSelectOpen] = useState(false);
  const [selectedJobId, setSelectedJobId] = useState<number | null>(null);
  const [distribution, setDistribution] = useState<MatchDistribution | null>(null);
  const [resumes, setResumes] = useState<ResumeWithEvaluation[]>([]);
  const [selectedApplicationIds, setSelectedApplicationIds] = useState<number[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [evaluatingApplicationIds, setEvaluatingApplicationIds] = useState<Set<number>>(new Set());
  const [loading, setLoading] = useState(false);

  // 加载岗位列表
  useEffect(() => {
    const loadJobs = async () => {
      try {
        const jobRes = await employeeJobsApi.list({ page: 1, page_size: 100 });
        setJobs(jobRes.data.items || []);
      } catch (error) {
        console.error('Failed to load jobs:', error);
      }
    };
    loadJobs();
  }, []);

  // 加载选中岗位的匹配度分布和简历列表
  useEffect(() => {
    if (!selectedJobId) return;

    const loadData = async () => {
      setLoading(true);
      try {
        const [distRes, listRes] = await Promise.all([
          employeeAnalyticsApi.getMatchDistribution(selectedJobId),
          employeeAnalyticsApi.getJobResumeList(selectedJobId),
        ]);
        setDistribution(distRes.data);
        setResumes(listRes.data.items || []);
      } catch (error) {
        console.error('Failed to load data:', error);
      } finally {
        setLoading(false);
      }
    };
    loadData();
  }, [selectedJobId]);

  const toggleApplication = (id: number) => {
    setSelectedApplicationIds(prev =>
      prev.includes(id) ? prev.filter(i => i !== id) : [...prev, id]
    );
  };

  // 与投递管理保持一致：按钮即状态（评估中 / 已提交 / 重新评估 / AI评估），不再用顶部 toast
  const [submittedIds, setSubmittedIds] = useState<Set<number>>(new Set());

  const reloadJobData = async (jobId: number) => {
    const [distRes, listRes] = await Promise.all([
      employeeAnalyticsApi.getMatchDistribution(jobId),
      employeeAnalyticsApi.getJobResumeList(jobId),
    ]);
    setDistribution(distRes.data);
    setResumes(listRes.data.items || []);
  };

  const markSubmitted = (ids: number[]) => {
    setSubmittedIds((prev) => {
      const next = new Set(prev);
      ids.forEach((id) => next.add(id));
      return next;
    });
    setTimeout(() => {
      setSubmittedIds((prev) => {
        const next = new Set(prev);
        ids.forEach((id) => next.delete(id));
        return next;
      });
    }, 4000);
  };

  const handleBatchEvaluate = async () => {
    if (!selectedJobId || selectedApplicationIds.length === 0) return;
    setSubmitting(true);
    try {
      await employeeEvaluationsApi.batchEvaluate({
        application_ids: selectedApplicationIds,
      });
      markSubmitted(selectedApplicationIds);
      setSelectedApplicationIds([]);
      await reloadJobData(selectedJobId);
    } catch (error) {
      console.error('Failed to submit:', error);
    } finally {
      setSubmitting(false);
    }
  };

  const handleEvaluateOne = async (applicationId: number) => {
    if (!selectedJobId || evaluatingApplicationIds.has(applicationId)) return;
    setEvaluatingApplicationIds((prev) => new Set(prev).add(applicationId));
    try {
      await employeeEvaluationsApi.batchEvaluate({
        application_ids: [applicationId],
      });
      markSubmitted([applicationId]);
      await reloadJobData(selectedJobId);
    } catch (error) {
      console.error('Failed to submit:', error);
    } finally {
      setEvaluatingApplicationIds((prev) => {
        const next = new Set(prev);
        next.delete(applicationId);
        return next;
      });
    }
  };

  const allSelected = resumes.length > 0 && resumes.every((r) => selectedApplicationIds.includes(r.application_id));
  const selectedJob = jobs.find((j) => j.id === selectedJobId);
  const toggleAll = () => {
    if (allSelected) setSelectedApplicationIds([]);
    else setSelectedApplicationIds(resumes.map((r) => r.application_id));
  };

  const handleDownload = async (resume: ResumeWithEvaluation) => {
    try {
      const res = await employeeResumesApi.getFile(resume.resume_id);
      const blob = res.data;
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = resume.file_name;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch (error) {
      console.error('Failed to download resume:', error);
    }
  };

  return (
    <AdminLayout breadcrumbs={[{ label: '评估管理' }]} title="评估管理">
      <div className="grid grid-cols-1 lg:grid-cols-4 gap-6">
        {/* 左侧：岗位选择 + 饼图 */}
        <div className="lg:col-span-1 space-y-4">
          <Card>
            <CardHeader>
              <div className="flex items-center justify-between">
                <CardTitle className="text-sm">选择目标岗位</CardTitle>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="h-auto p-1 text-[#94A3B8] hover:text-[#64748B]"
                  disabled={!selectedJobId}
                  onClick={() => { setSelectedJobId(null); setDistribution(null); setResumes([]); setSelectedApplicationIds([]); }}
                  aria-label="清除筛选"
                >
                  <RotateCcw size={14} aria-hidden="true" />
                </Button>
              </div>
            </CardHeader>
            <CardContent className="pt-0">
              <div>
                <button
                  type="button"
                  onClick={() => setJobSelectOpen(true)}
                  className="min-h-9 w-full rounded-md border border-[#E2E8F0] bg-white px-3 py-1.5 text-left text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#2563EB]"
                >
                  {selectedJob ? (
                    <span className="inline-flex items-center gap-1 rounded bg-blue-50 px-2 py-0.5 text-xs text-[#2563EB]">
                      {selectedJob.name}
                      <span
                        role="button"
                        tabIndex={0}
                        onClick={(event) => { event.stopPropagation(); setSelectedJobId(null); setDistribution(null); setResumes([]); setSelectedApplicationIds([]); }}
                        onKeyDown={(event) => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); event.stopPropagation(); setSelectedJobId(null); setDistribution(null); setResumes([]); setSelectedApplicationIds([]); } }}
                        className="rounded hover:bg-blue-100"
                        aria-label="清除岗位选择"
                      >
                        <X size={12} aria-hidden="true" />
                      </span>
                    </span>
                  ) : (
                    <span className="text-[#94A3B8] leading-6">请选择岗位</span>
                  )}
                </button>

                <Dialog open={jobSelectOpen} onOpenChange={setJobSelectOpen}>
                  <DialogContent>
                    <div className="mb-4 flex items-center justify-between">
                      <DialogTitle className="mb-0">选择岗位</DialogTitle>
                      <button
                        type="button"
                        onClick={() => setJobSelectOpen(false)}
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
                          const checked = job.id === selectedJobId;
                          return (
                            <label key={job.id} className="flex cursor-pointer items-center gap-3 border-b border-[#F1F5F9] px-4 py-3 text-sm hover:bg-[#F8FAFC] last:border-b-0">
                              <input
                                type="radio"
                                name="job-select"
                                checked={checked}
                                onChange={() => { setSelectedJobId(job.id); setJobSelectOpen(false); }}
                                className="accent-[#2563EB]"
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
                    <div className="mt-5 flex justify-end gap-3">
                      <Button type="button" onClick={() => setJobSelectOpen(false)} className="bg-[#2563EB] hover:bg-[#1D4ED8] text-white">
                        确定
                      </Button>
                    </div>
                  </DialogContent>
                </Dialog>
              </div>
            </CardContent>
          </Card>

          {selectedJobId && distribution && (
            <Card>
              <CardContent className="p-4">
                <p className="text-xs text-[#64748B] mb-3">匹配度分布</p>
                <MatchPieChart data={distribution} />
                <p className="text-center text-xl font-bold tabular-nums mt-3">{distribution.total}</p>
                <p className="text-center text-xs text-[#64748B]">份简历</p>
              </CardContent>
            </Card>
          )}

          {/* 批量评估操作 */}
          <Card>
            <CardContent className="p-4">
              <p className="text-xs text-[#64748B] mb-2">已选</p>
              <p className="text-2xl font-bold tabular-nums text-[#1E293B]">{selectedApplicationIds.length}</p>
              <p className="text-xs text-[#64748B] mb-4">份简历</p>
              <Button
                disabled={!selectedJobId || selectedApplicationIds.length === 0 || submitting}
                onClick={handleBatchEvaluate}
                className="w-full bg-[#2563EB] hover:bg-[#1D4ED8] text-white"
              >
                {submitting
                  ? <><Loader2 size={14} className="animate-spin mr-1.5" aria-hidden="true" />提交中…</>
                  : '开始 AI 评估'}
              </Button>
            </CardContent>
          </Card>
        </div>

        {/* 右侧：简历 Table */}
        <div className="lg:col-span-3">
          <div className="bg-white rounded-lg border border-[#E2E8F0] overflow-hidden">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-[#E2E8F0] bg-[#F8FAFC]">
                  <th className="px-4 py-3 w-10">
                    <input
                      type="checkbox"
                      checked={allSelected}
                      onChange={toggleAll}
                      aria-label="全选简历"
                      disabled={resumes.length === 0}
                      className="rounded border-[#CBD5E1] accent-[#2563EB]"
                    />
                  </th>
                  <th className="text-left px-4 py-3 font-medium text-[#64748B]">文件名</th>
                  <th className="text-left px-4 py-3 font-medium text-[#64748B] tabular-nums">匹配度</th>
                  <th className="text-left px-4 py-3 font-medium text-[#64748B]">标签</th>
                  <th className="text-left px-4 py-3 font-medium text-[#64748B]">评估状态</th>
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
                ) : resumes.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="px-4 py-14 text-center text-[#94A3B8]">
                      {selectedJobId ? '该岗位暂无简历' : '请先在左侧选择岗位'}
                    </td>
                  </tr>
                ) : (
                  resumes.map((resume) => {
                    const checked = selectedApplicationIds.includes(resume.application_id);
                    const isEvaluating = evaluatingApplicationIds.has(resume.application_id);
                    const isSubmitted = submittedIds.has(resume.application_id);
                    return (
                      <tr key={resume.application_id} className="border-b border-[#F1F5F9] hover:bg-[#F8FAFC] transition-colors">
                        <td className="px-4 py-3">
                          <input
                            type="checkbox"
                            checked={checked}
                            onChange={() => toggleApplication(resume.application_id)}
                            aria-label={`选择简历 ${resume.file_name}`}
                            className="rounded border-[#CBD5E1] accent-[#2563EB]"
                          />
                        </td>
                        <td className="px-4 py-3 max-w-[180px]">
                          <span className="truncate block font-medium text-[#1E293B]">{resume.file_name}</span>
                        </td>
                        <td className="px-4 py-3 tabular-nums text-[#1E293B]">
                          {resume.final_score != null ? resume.final_score : '—'}
                        </td>
                        <td className="px-4 py-3">
                          {resume.final_label
                            ? <MatchBadge label={resume.final_label as any} />
                            : <span className="text-[#94A3B8] text-xs">—</span>}
                        </td>
                        <td className="px-4 py-3">
                          {resume.status === 'processing'
                            ? <span className="inline-flex items-center gap-1 text-xs text-blue-600"><Loader2 size={12} className="animate-spin" aria-hidden="true" />评估中</span>
                            : resume.status === 'failed'
                            ? <span className="text-xs text-red-500">评估失败，可重试</span>
                            : resume.status === 'completed'
                            ? <span className="text-xs text-green-600">已完成</span>
                            : <span className="text-xs text-[#94A3B8]">待评估</span>}
                        </td>
                        <td className="px-4 py-3 text-right">
                          <div className="flex items-center justify-end gap-2">
                            <button
                              onClick={() => handleDownload(resume)}
                              className="inline-flex items-center gap-1 text-xs text-[#64748B] hover:text-[#2563EB] px-2 py-1 rounded hover:bg-blue-50 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#2563EB]"
                            >
                              <Download size={13} aria-hidden="true" />
                              下载
                            </button>
                            {resume.status === 'completed' && resume.match_id && (
                              <Link
                                to={`/employee/evaluations/${resume.match_id}`}
                                className="text-xs text-[#2563EB] hover:underline focus-visible:outline-none focus-visible:underline"
                              >
                                查看详情
                              </Link>
                            )}
                            {isSubmitted ? (
                              <span className="text-xs text-green-600 px-2">已提交</span>
                            ) : (
                              <button
                                onClick={() => handleEvaluateOne(resume.application_id)}
                                disabled={isEvaluating || submitting}
                                className="inline-flex items-center gap-1 text-xs text-[#2563EB] hover:underline disabled:opacity-50 px-2 py-1 rounded hover:bg-blue-50 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#2563EB]"
                              >
                                {isEvaluating
                                  ? <><Loader2 size={13} className="animate-spin" aria-hidden="true" />评估中</>
                                  : resume.match_id
                                  ? '重新评估'
                                  : 'AI评估'}
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
        </div>
      </div>
    </AdminLayout>
  );
}
