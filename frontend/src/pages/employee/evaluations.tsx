import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { AdminLayout } from '@/components/layout/admin-layout';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { MatchPieChart } from '@/components/common/match-pie-chart';
import { MatchBadge } from '@/components/common/match-badge';
import { employeeJobsApi } from '@/api/employee/jobs';
import { employeeEvaluationsApi } from '@/api/employee/evaluations';
import { employeeAnalyticsApi } from '@/api/employee/analytics';
import { MatchDistribution, ResumeWithEvaluation, Job } from '@/types/employee';
import { Loader2 } from 'lucide-react';

export default function EmployeeEvaluations() {
  const [jobs, setJobs] = useState<Job[]>([]);
  const [selectedJobId, setSelectedJobId] = useState<number | null>(null);
  const [distribution, setDistribution] = useState<MatchDistribution | null>(null);
  const [resumes, setResumes] = useState<ResumeWithEvaluation[]>([]);
  const [selectedResumeIds, setSelectedResumeIds] = useState<number[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [loading, setLoading] = useState(false);

  // 加载岗位列表
  useEffect(() => {
    const loadJobs = async () => {
      try {
        const res = await employeeJobsApi.list();
        setJobs(res.data.items || []);
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

  const toggleResume = (id: number) => {
    setSelectedResumeIds(prev =>
      prev.includes(id) ? prev.filter(i => i !== id) : [...prev, id]
    );
  };

  const [submitted, setSubmitted] = useState(false);

  const handleBatchEvaluate = async () => {
    if (!selectedJobId || selectedResumeIds.length === 0) return;
    setSubmitting(true);
    try {
      await employeeEvaluationsApi.batchEvaluate({
        resume_ids: selectedResumeIds,
        job_id: selectedJobId,
      });
      setSubmitted(true);
      setSelectedResumeIds([]);
      setTimeout(() => setSubmitted(false), 4000);
      const [distRes, listRes] = await Promise.all([
        employeeAnalyticsApi.getMatchDistribution(selectedJobId),
        employeeAnalyticsApi.getJobResumeList(selectedJobId),
      ]);
      setDistribution(distRes.data);
      setResumes(listRes.data.items || []);
    } catch (error) {
      console.error('Failed to submit:', error);
    } finally {
      setSubmitting(false);
    }
  };

  const allSelected = resumes.length > 0 && resumes.every((r) => selectedResumeIds.includes(r.resume_id));
  const toggleAll = () => {
    if (allSelected) setSelectedResumeIds([]);
    else setSelectedResumeIds(resumes.map((r) => r.resume_id));
  };

  return (
    <AdminLayout breadcrumbs={[{ label: '评估管理' }]} title="评估管理">
      {submitted && (
        <div className="mb-4 px-4 py-3 bg-green-50 border border-green-200 rounded-lg text-sm text-green-700" aria-live="polite">
          评估任务已提交，请稍后查看结果
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-4 gap-6">
        {/* 左侧：岗位选择 + 饼图 */}
        <div className="lg:col-span-1 space-y-4">
          <Card>
            <CardHeader>
              <CardTitle className="text-sm">选择目标岗位</CardTitle>
            </CardHeader>
            <CardContent className="pt-0">
              <Select value={selectedJobId ? String(selectedJobId) : ''} onValueChange={(v) => setSelectedJobId(Number(v))}>
                <SelectTrigger>
                  <SelectValue placeholder="请选择岗位" />
                </SelectTrigger>
                <SelectContent>
                  {jobs.map((job) => (
                    <SelectItem key={job.id} value={String(job.id)}>
                      {job.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
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
              <p className="text-2xl font-bold tabular-nums text-[#1E293B]">{selectedResumeIds.length}</p>
              <p className="text-xs text-[#64748B] mb-4">份简历</p>
              <Button
                disabled={!selectedJobId || selectedResumeIds.length === 0 || submitting}
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
                    const checked = selectedResumeIds.includes(resume.resume_id);
                    return (
                      <tr key={resume.resume_id} className="border-b border-[#F1F5F9] hover:bg-[#F8FAFC] transition-colors">
                        <td className="px-4 py-3">
                          <input
                            type="checkbox"
                            checked={checked}
                            onChange={() => toggleResume(resume.resume_id)}
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
                          {resume.status === 'completed' && resume.match_id && (
                            <Link
                              to={`/employee/evaluations/${resume.match_id}`}
                              className="text-xs text-[#2563EB] hover:underline focus-visible:outline-none focus-visible:underline"
                            >
                              查看详情
                            </Link>
                          )}
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
