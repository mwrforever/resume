import { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { userApplicationsApi } from '@/api/user/applications';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';

interface Application {
  id: number;
  job_id: number;
  resume_id: number;
  status: number;
  status_name: string;
  create_time: string;
  evaluation: any;
}

export default function UserApplicationDetail() {
  const { id } = useParams();
  const navigate = useNavigate();

  const [application, setApplication] = useState<Application | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const loadApplication = async () => {
      try {
        const res = await userApplicationsApi.get(Number(id));
        setApplication(res.data);
      } catch (error) {
        console.error('Failed to load application:', error);
      } finally {
        setLoading(false);
      }
    };
    loadApplication();
  }, [id]);

  if (loading) {
    return <div className="text-center py-12">加载中...</div>;
  }

  if (!application) {
    return <div className="text-center py-12">投递记录不存在</div>;
  }

  return (
    <div className="container mx-auto py-8">
      <Card className="mb-6">
        <CardHeader>
          <CardTitle>投递详情</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-4">
            <div>
              <p className="text-sm text-secondary">岗位ID</p>
              <p className="font-medium">{application.job_id}</p>
            </div>
            <div>
              <p className="text-sm text-secondary">简历ID</p>
              <p className="font-medium">{application.resume_id}</p>
            </div>
            <div>
              <p className="text-sm text-secondary">投递时间</p>
              <p className="font-medium">
                {application.create_time?.split('T')[0]}
              </p>
            </div>
            <div>
              <p className="text-sm text-secondary">状态</p>
              <p className="font-medium">{application.status_name}</p>
            </div>
            {application.evaluation && (
              <div>
                <p className="text-sm text-secondary">评估结果</p>
                <p className="font-medium">{JSON.stringify(application.evaluation)}</p>
              </div>
            )}
          </div>
        </CardContent>
      </Card>

      <Button variant="outline" onClick={() => navigate('/user/my-applications')}>
        返回列表
      </Button>
    </div>
  );
}
