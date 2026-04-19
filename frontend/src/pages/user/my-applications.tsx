import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { userApplicationsApi } from '@/api/user/applications';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';

interface Application {
  id: number;
  job_id: number;
  resume_id: number;
  status: number;
  status_name: string;
  create_time: string;
}

export default function UserMyApplications() {
  const [applications, setApplications] = useState<Application[]>([]);
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(1);

  const loadApplications = async (pageNum: number = 1) => {
    setLoading(true);
    try {
      const res = await userApplicationsApi.list({ page: pageNum, page_size: 20 });
      setApplications(res.data.items || []);
    } catch (error) {
      console.error('Failed to load applications:', error);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadApplications(page);
  }, [page]);

  return (
    <div className="container mx-auto py-8">
      <h1 className="text-2xl font-bold mb-6">我的投递记录</h1>

      {loading ? (
        <div className="text-center py-12 text-secondary">加载中...</div>
      ) : applications.length === 0 ? (
        <Card>
          <CardContent className="py-12 text-center text-secondary">
            还没有投递过任何岗位
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-4">
          {applications.map((app) => (
            <Card key={app.id}>
              <CardContent className="flex justify-between items-center py-4">
                <div>
                  <p className="font-medium">岗位ID: {app.job_id}</p>
                  <p className="text-sm text-secondary">
                    投递时间: {app.create_time?.split('T')[0]}
                  </p>
                  <p className="text-sm">
                    状态: <span className="font-medium">{app.status_name}</span>
                  </p>
                </div>
                <Link to={`/user/my-applications/${app.id}`}>
                  <Button variant="outline" size="sm">查看详情</Button>
                </Link>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
