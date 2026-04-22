import { useEffect, useState } from 'react';
import { PageLayout } from '@/components/layout/page-layout';
import { EmployeeNav } from '@/components/layout/employee-nav';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { employeeApplicationsApi } from '@/api/employee/applications';

interface Application {
  id: number;
  user_id: number;
  job_id: number;
  job_name: string;
  resume_id: number;
  status: number;
  status_name: string;
  create_time: string;
}

const STATUS_OPTIONS = [
  { value: '0', label: '已取消' },
  { value: '1', label: '待处理' },
  { value: '2', label: '已查看' },
  { value: '3', label: '面试中' },
  { value: '4', label: '已拒绝' },
  { value: '5', label: '已录用' },
];

export default function EmployeeApplications() {
  const [applications, setApplications] = useState<Application[]>([]);
  const [loading, setLoading] = useState(true);
  const [filterStatus, setFilterStatus] = useState<string>('');

  const loadApplications = async () => {
    setLoading(true);
    try {
      const params: any = {};
      if (filterStatus) params.status = filterStatus;
      const res = await employeeApplicationsApi.list(params);
      setApplications(res.data.items || []);
    } catch (error) {
      console.error('Failed to load applications:', error);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadApplications();
  }, [filterStatus]);

  const handleStatusChange = async (appId: number, newStatus: number) => {
    try {
      await employeeApplicationsApi.updateStatus(appId, newStatus);
      await loadApplications();
    } catch (error) {
      console.error('Failed to update status:', error);
    }
  };

  const getStatusColor = (status: number) => {
    switch (status) {
      case 1: return 'bg-yellow-100 text-yellow-800';
      case 2: return 'bg-blue-100 text-blue-800';
      case 3: return 'bg-green-100 text-green-800';
      case 4: return 'bg-red-100 text-red-800';
      case 5: return 'bg-green-100 text-green-800';
      default: return 'bg-gray-100 text-gray-800';
    }
  };

  return (
    <PageLayout title="投递管理" subtitle="管理所有投递记录" action={<EmployeeNav />}>
      <div className="mb-6">
        <Select onValueChange={setFilterStatus} value={filterStatus}>
          <SelectTrigger className="w-40">
            <SelectValue placeholder="筛选状态" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="">全部</SelectItem>
            {STATUS_OPTIONS.map(opt => (
              <SelectItem key={opt.value} value={opt.value}>{opt.label}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {loading ? (
        <div className="animate-pulse space-y-4">
          <div className="h-20 bg-muted rounded-xl" />
        </div>
      ) : applications.length === 0 ? (
        <Card>
          <CardContent className="py-12 text-center">
            <p className="text-muted-foreground">暂无投递记录</p>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-4">
          {applications.map((app) => (
            <Card key={app.id}>
              <CardContent className="flex justify-between items-center py-4">
                <div>
                  <p className="font-medium">用户 {app.user_id} → {app.job_name}</p>
                  <div className="flex items-center gap-3 mt-1">
                    <span className={`text-xs px-2 py-1 rounded ${getStatusColor(app.status)}`}>
                      {app.status_name}
                    </span>
                    <span className="text-sm text-muted-foreground">
                      {app.create_time?.split('T')[0]}
                    </span>
                  </div>
                </div>
                <Select onValueChange={(v) => handleStatusChange(app.id, Number(v))} defaultValue={String(app.status)}>
                  <SelectTrigger className="w-32">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {STATUS_OPTIONS.map(opt => (
                      <SelectItem key={opt.value} value={opt.value}>{opt.label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </PageLayout>
  );
}