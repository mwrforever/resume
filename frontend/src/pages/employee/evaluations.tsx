import { useEffect, useState } from 'react';
import { PageLayout } from '@/components/layout/page-layout';
import { EmployeeNav } from '@/components/layout/employee-nav';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { MatchPieChart } from '@/components/common/match-pie-chart';
import { MatchBadge } from '@/components/common/match-badge';
import { employeeJobsApi } from '@/api/employee/jobs';
import { employeeEvaluationsApi } from '@/api/employee/evaluations';
import { employeeAnalyticsApi } from '@/api/employee/analytics';
import { MatchDistribution, ResumeWithEvaluation, Job } from '@/types/employee';

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

  const handleBatchEvaluate = async () => {
    if (!selectedJobId || selectedResumeIds.length === 0) return;
    setSubmitting(true);
    try {
      await employeeEvaluationsApi.batchEvaluate({
        resume_ids: selectedResumeIds,
        job_id: selectedJobId,
      });
      alert('评估任务已提交，请稍后查看');
      setSelectedResumeIds([]);
      // Refresh data
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

  return (
    <PageLayout title="AI评估" subtitle="批量评估简历匹配度" action={<EmployeeNav />}>
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
        {/* 左侧：岗位选择 */}
        <Card>
          <CardHeader>
            <CardTitle>选择目标岗位</CardTitle>
          </CardHeader>
          <CardContent>
            <Select onValueChange={(v) => setSelectedJobId(Number(v))}>
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

            {selectedJobId && distribution && (
              <div className="mt-6">
                <h3 className="text-sm font-medium mb-4">匹配度分布</h3>
                <MatchPieChart data={distribution} />
                <div className="mt-4 text-center text-2xl font-bold">
                  {distribution.total} 份简历
                </div>
              </div>
            )}
          </CardContent>
        </Card>

        {/* 中间：简历列表 */}
        <div className="lg:col-span-2 space-y-6">
          <Card>
            <CardHeader>
              <CardTitle>选择简历 ({selectedResumeIds.length} 份)</CardTitle>
            </CardHeader>
            <CardContent>
              {loading ? (
                <div className="text-center py-8">加载中...</div>
              ) : resumes.length === 0 ? (
                <div className="text-center py-8 text-muted-foreground">
                  {selectedJobId ? '暂无简历' : '请先选择岗位'}
                </div>
              ) : (
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  {resumes.map((resume) => (
                    <button
                      key={resume.resume_id}
                      onClick={() => toggleResume(resume.resume_id)}
                      className={`p-4 rounded-lg border text-left transition-all ${
                        selectedResumeIds.includes(resume.resume_id)
                          ? 'border-accent bg-accent/5'
                          : 'border-border hover:border-accent/50'
                      }`}
                    >
                      <div className="flex justify-between items-start">
                        <div className="flex-1 min-w-0">
                          <p className="font-medium truncate">{resume.file_name}</p>
                          <div className="flex items-center gap-2 mt-1">
                            {resume.final_score !== undefined && resume.final_score !== null ? (
                              <>
                                <span className="text-sm font-semibold">{resume.final_score}</span>
                                <MatchBadge label={resume.final_label || '待评估'} />
                              </>
                            ) : (
                              <span className="text-sm text-muted-foreground">待评估</span>
                            )}
                          </div>
                        </div>
                        <div className={`w-5 h-5 rounded border flex items-center justify-center ${
                          selectedResumeIds.includes(resume.resume_id)
                            ? 'bg-accent border-accent'
                            : 'border-muted-foreground'
                        }`}>
                          {selectedResumeIds.includes(resume.resume_id) && (
                            <span className="text-white text-xs">✓</span>
                          )}
                        </div>
                      </div>
                    </button>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>

          {/* 操作面板 */}
          <Card>
            <CardContent className="pt-6">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-2xl font-bold">{selectedResumeIds.length}</p>
                  <p className="text-sm text-muted-foreground">份简历待评估</p>
                </div>
                <Button
                  disabled={!selectedJobId || selectedResumeIds.length === 0 || submitting}
                  onClick={handleBatchEvaluate}
                >
                  {submitting ? '提交中...' : '开始AI评估'}
                </Button>
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
    </PageLayout>
  );
}
