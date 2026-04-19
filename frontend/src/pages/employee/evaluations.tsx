import { useState } from 'react';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { employeeEvaluationsApi } from '@/api/employee/evaluations';

export default function EmployeeEvaluations() {
  const [selectedResumes, setSelectedResumes] = useState<number[]>([]);
  const [jobId, setJobId] = useState<number>(1);
  const [submitting, setSubmitting] = useState(false);

  const handleToggle = (resumeId: number) => {
    setSelectedResumes(prev =>
      prev.includes(resumeId)
        ? prev.filter(id => id !== resumeId)
        : [...prev, resumeId]
    );
  };

  const handleBatchEvaluate = async () => {
    if (selectedResumes.length === 0 || !jobId) return;

    setSubmitting(true);
    try {
      await employeeEvaluationsApi.batchEvaluate({
        resume_ids: selectedResumes,
        job_id: jobId
      });
      alert('评估任务已提交');
      setSelectedResumes([]);
    } catch (error) {
      console.error('批量评估失败:', error);
      alert('提交失败，请重试');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="container mx-auto py-8">
      <Card className="mb-6">
        <CardHeader>
          <CardTitle>批量评估</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-secondary mb-4">
            选择简历和目标岗位，点击&quot;开始评估&quot;触发AI评估流程
          </p>

          <div className="flex gap-4 items-center mb-6">
            <span>目标岗位ID:</span>
            <input
              type="number"
              value={jobId}
              onChange={(e) => setJobId(Number(e.target.value))}
              className="border rounded px-3 py-2 w-32"
            />
          </div>

          <Button
            onClick={handleBatchEvaluate}
            disabled={selectedResumes.length === 0 || submitting}
          >
            {submitting ? '提交中...' : `开始评估 (${selectedResumes.length})`}
          </Button>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>待评估简历列表</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-secondary">
            TODO: 从API加载待评估简历列表并显示复选框
          </p>
        </CardContent>
      </Card>
    </div>
  );
}