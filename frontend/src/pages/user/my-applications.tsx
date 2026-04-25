import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { PageLayout } from '@/components/layout/page-layout';
import { UserNav } from '@/components/layout/user-nav';
import { userApplicationsApi } from '@/api/user/applications';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';

interface Application {
  id: number;
  job_id: number;
  job_name: string | null;
  resume_id: number;
  status: number;
  status_name: string;
  create_time: string;
}

export default function UserMyApplications() {
  const [applications, setApplications] = useState<Application[]>([]);
  const [loading, setLoading] = useState(true);
  const [page] = useState(1);

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

  const handleWithdraw = async (id: number) => {
    if (!confirm('确定要撤回这份投递吗？')) return;
    try {
      await userApplicationsApi.withdraw(id);
      await loadApplications(page);
    } catch (error) {
      console.error('Failed to withdraw:', error);
    }
  };

  const getStatusColor = (status: number) => {
    switch (status) {
      case 0: return 'bg-yellow-100 text-yellow-800';
      case 1: return 'bg-blue-100 text-blue-800';
      case 2: return 'bg-gray-100 text-gray-800';
      case 3: return 'bg-orange-100 text-orange-800';
      case 4: return 'bg-red-100 text-red-800';
      case 5: return 'bg-green-100 text-green-800';
      default: return 'bg-gray-100 text-gray-800';
    }
  };

  return (
    <PageLayout
      title="我的投递"
      subtitle="查看投递记录"
      action={<UserNav />}
    >
      {loading ? (
        <div className="animate-pulse space-y-4">
          <div className="h-20 bg-muted rounded-xl" />
          <div className="h-20 bg-muted rounded-xl" />
          <div className="h-20 bg-muted rounded-xl" />
        </div>
      ) : applications.length === 0 ? (
        <Card>
          <CardContent className="py-12 text-center">
            <p className="text-muted-foreground">还没有投递过任何岗位</p>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-4">
          {applications.map((app) => (
            <Card key={app.id}>
              <CardContent className="flex justify-between items-center py-4">
                <div className="min-w-0 flex-1">
                  <p className="font-medium text-lg truncate">{app.job_name || `岗位ID: ${app.job_id}`}</p>
                  <p className="text-sm text-muted-foreground">
                    投递时间: {app.create_time?.split('T')[0]}
                  </p>
                  <span className={`inline-block mt-1 px-2 py-0.5 rounded-full text-xs font-medium ${getStatusColor(app.status)}`}>
                    {app.status_name}
                  </span>
                </div>
                <div className="flex items-center gap-2 ml-4">
                  {(app.status === 0 || app.status === 1) && (
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => handleWithdraw(app.id)}
                      className="text-muted-foreground hover:text-destructive"
                    >
                      撤回
                    </Button>
                  )}
                  <Link to={`/user/my-applications/${app.id}`}>
                    <Button variant="outline" size="sm">查看详情</Button>
                  </Link>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </PageLayout>
  );
}
