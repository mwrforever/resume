import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { PageLayout } from '@/components/layout/page-layout';
import { EmployeeNav } from '@/components/layout/employee-nav';
import { employeeJobsApi } from '@/api/employee/jobs';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';

interface Job {
  id: number;
  name: string;
  description: string;
  status: number;
  create_time: string;
}

export default function EmployeeJobs() {
  const [jobs, setJobs] = useState<Job[]>([]);
  const [loading, setLoading] = useState(true);

  const loadJobs = async () => {
    setLoading(true);
    try {
      const res = await employeeJobsApi.list();
      setJobs(res.data.items || []);
    } catch (error) {
      console.error('Failed to load jobs:', error);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadJobs();
  }, []);

  const handleDelete = async (id: number) => {
    if (!confirm('确定要删除这个岗位吗？')) return;
    try {
      await employeeJobsApi.delete(id);
      await loadJobs();
    } catch (error) {
      console.error('Failed to delete job:', error);
    }
  };

  return (
    <PageLayout
      title="岗位管理"
      subtitle="管理招聘信息"
      action={<EmployeeNav />}
    >
      <div className="flex justify-between items-center mb-6">
        <Link to="/employee/jobs/create">
          <Button>创建岗位</Button>
        </Link>
      </div>

      {loading ? (
        <div className="animate-pulse space-y-4">
          <div className="h-20 bg-muted rounded-xl" />
          <div className="h-20 bg-muted rounded-xl" />
          <div className="h-20 bg-muted rounded-xl" />
        </div>
      ) : jobs.length === 0 ? (
        <Card>
          <CardContent className="py-12 text-center">
            <p className="text-muted-foreground">还没有创建过岗位</p>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-4">
          {jobs.map((job) => (
            <Card key={job.id}>
              <CardContent className="flex justify-between items-center py-4">
                <div>
                  <p className="font-medium">{job.name}</p>
                  <p className="text-sm text-muted-foreground">
                    {job.status === 1 ? '招聘中' : '已下架'} | {job.create_time?.split('T')[0]}
                  </p>
                </div>
                <div className="flex gap-2">
                  <Link to={`/employee/jobs/${job.id}/edit`}>
                    <Button variant="outline" size="sm">编辑</Button>
                  </Link>
                  <Button
                    variant="danger"
                    size="sm"
                    onClick={() => handleDelete(job.id)}
                  >
                    删除
                  </Button>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </PageLayout>
  );
}
