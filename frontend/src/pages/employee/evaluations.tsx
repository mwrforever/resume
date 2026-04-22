import { useEffect, useState } from 'react';
import { PageLayout } from '@/components/layout/page-layout';
import { EmployeeNav } from '@/components/layout/employee-nav';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { employeeEvaluationsApi } from '@/api/employee/evaluations';
import { employeeResumesApi } from '@/api/employee/resumes';

interface Resume {
  id: number;
  file_name: string;
}

export default function EmployeeEvaluations() {
  const [jobId, setJobId] = useState<number | ''>('');
  const [selectedResumeIds, setSelectedResumeIds] = useState<number[]>([]);
  const [resumes, setResumes] = useState<Resume[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [success, setSuccess] = useState(false);

  useEffect(() => {
    loadResumes();
  }, []);

  const loadResumes = async () => {
    try {
      const res = await employeeResumesApi.list();
      setResumes(res.data.items || []);
    } catch (error) {
      console.error('Failed to load resumes:', error);
    }
  };

  const toggleResume = (id: number) => {
    setSelectedResumeIds(prev =>
      prev.includes(id) ? prev.filter(i => i !== id) : [...prev, id]
    );
  };

  const handleBatchEvaluate = async () => {
    if (!jobId || selectedResumeIds.length === 0) return;
    setSubmitting(true);
    try {
      await employeeEvaluationsApi.batchEvaluate({
        resume_ids: selectedResumeIds,
        job_id: jobId as number
      });
      setSuccess(true);
      setSelectedResumeIds([]);
      setTimeout(() => setSuccess(false), 3000);
    } catch (error) {
      console.error('Failed to submit:', error);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <PageLayout title="AI评估" subtitle="批量评估简历匹配度" action={<EmployeeNav />}>
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
        <div className="lg:col-span-2 space-y-6">
          {/* Job Selection */}
          <Card>
            <CardHeader>
              <CardTitle>选择目标岗位</CardTitle>
            </CardHeader>
            <CardContent>
              <Input
                type="number"
                placeholder="输入岗位ID"
                value={jobId}
                onChange={(e) => setJobId(e.target.value ? Number(e.target.value) : '')}
                className="max-w-xs"
              />
            </CardContent>
          </Card>

          {/* Resume Selection */}
          <Card>
            <CardHeader>
              <CardTitle>选择简历 ({selectedResumeIds.length} 份)</CardTitle>
            </CardHeader>
            <CardContent>
              {resumes.length === 0 ? (
                <p className="text-muted-foreground py-8 text-center">暂无简历</p>
              ) : (
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  {resumes.map((resume) => (
                    <button
                      key={resume.id}
                      onClick={() => toggleResume(resume.id)}
                      className={`p-4 rounded-lg border text-left transition-all ${
                        selectedResumeIds.includes(resume.id)
                          ? 'border-accent bg-accent/5'
                          : 'border-border hover:border-accent/50'
                      }`}
                    >
                      <p className="font-medium truncate">{resume.file_name}</p>
                      <p className="text-xs text-muted-foreground mt-1">
                        ID: {resume.id}
                      </p>
                    </button>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </div>

        {/* Action Panel */}
        <div className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle>开始评估</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="text-center py-6">
                <div className="text-4xl font-bold text-accent mb-2">
                  {selectedResumeIds.length}
                </div>
                <p className="text-sm text-muted-foreground">份简历待评估</p>
              </div>

              {success && (
                <div className="p-3 rounded-lg bg-green-500/10 text-green-600 text-sm text-center">
                  评估任务已提交
                </div>
              )}

              <Button
                className="w-full"
                disabled={!jobId || selectedResumeIds.length === 0 || submitting}
                onClick={handleBatchEvaluate}
              >
                {submitting ? '提交中...' : '开始AI评估'}
              </Button>

              <p className="text-xs text-muted-foreground text-center">
                评估结果将在评估完成后显示
              </p>
            </CardContent>
          </Card>
        </div>
      </div>
    </PageLayout>
  );
}