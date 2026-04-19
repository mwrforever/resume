import { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { userJobsApi } from '@/api/user/jobs';
import { userResumesApi } from '@/api/user/resumes';
import { userApplicationsApi } from '@/api/user/applications';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { useAuthStore } from '@/store/auth';

interface Job {
  id: number;
  name: string;
  description: string;
}

interface Resume {
  id: number;
  file_name: string;
}

export default function UserJobDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const userId = useAuthStore((state) => state.userId);

  const [job, setJob] = useState<Job | null>(null);
  const [resumes, setResumes] = useState<Resume[]>([]);
  const [selectedResume, setSelectedResume] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [applying, setApplying] = useState(false);

  useEffect(() => {
    const loadData = async () => {
      try {
        const jobRes = await userJobsApi.get(Number(id));
        setJob(jobRes.data);

        const resumeRes = await userResumesApi.list();
        setResumes(resumeRes.data.items || []);
      } catch (error) {
        console.error('Failed to load data:', error);
      } finally {
        setLoading(false);
      }
    };
    loadData();
  }, [id]);

  const handleApply = async () => {
    if (!selectedResume) {
      alert('请先选择要投递的简历');
      return;
    }

    setApplying(true);
    try {
      await userApplicationsApi.apply({
        job_id: Number(id),
        resume_id: selectedResume
      });
      alert('投递成功！');
      navigate('/user/my-applications');
    } catch (error) {
      console.error('Failed to apply:', error);
      alert('投递失败，请重试');
    } finally {
      setApplying(false);
    }
  };

  if (loading) {
    return <div className="text-center py-12">加载中...</div>;
  }

  if (!job) {
    return <div className="text-center py-12">岗位不存在</div>;
  }

  return (
    <div className="container mx-auto py-8">
      <Card className="mb-6">
        <CardHeader>
          <CardTitle>{job.name}</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-gray-600 mb-4">{job.description || "暂无岗位描述"}</p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>投递简历</CardTitle>
        </CardHeader>
        <CardContent>
          {resumes.length === 0 ? (
            <div className="text-center py-6">
              <p className="text-secondary mb-4">您还没有上传过简历</p>
              <Button onClick={() => navigate('/user/my-resumes')}>
                去上传简历
              </Button>
            </div>
          ) : (
            <>
              <p className="mb-4">选择要投递的简历：</p>
              <div className="space-y-2 mb-6">
                {resumes.map((resume) => (
                  <div
                    key={resume.id}
                    className={`p-3 border rounded cursor-pointer ${
                      selectedResume === resume.id ? 'border-primary bg-primary/5' : ''
                    }`}
                    onClick={() => setSelectedResume(resume.id)}
                  >
                    {resume.file_name}
                  </div>
                ))}
              </div>
              <Button
                onClick={handleApply}
                disabled={!selectedResume || applying}
                className="w-full"
              >
                {applying ? '投递中...' : '确认投递'}
              </Button>
            </>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
