import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { PageLayout } from '@/components/layout/page-layout';
import { EmployeeNav } from '@/components/layout/employee-nav';
import { Card, CardContent } from '@/components/ui/card';
import { employeeAnalyticsApi } from '@/api/employee/analytics';
import { DashboardStats } from '@/types/employee';

export default function EmployeeDashboard() {
  const [stats, setStats] = useState<DashboardStats | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const loadStats = async () => {
      try {
        const res = await employeeAnalyticsApi.getDashboard();
        setStats(res.data);
      } catch (error) {
        console.error('Failed to load dashboard:', error);
      } finally {
        setLoading(false);
      }
    };
    loadStats();
  }, []);

  if (loading) {
    return (
      <PageLayout title="工作台" action={<EmployeeNav />}>
        <div className="animate-pulse space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6">
            {[...Array(4)].map((_, i) => (
              <div key={i} className="h-24 bg-muted rounded-xl" />
            ))}
          </div>
        </div>
      </PageLayout>
    );
  }

  if (!stats) {
    return (
      <PageLayout title="工作台" action={<EmployeeNav />}>
        <div className="text-center py-12">加载失败</div>
      </PageLayout>
    );
  }

  const statCards = [
    { label: '在招岗位', value: stats.job_count },
    { label: '简历总数', value: stats.resume_count },
    { label: '待评估', value: stats.pending_eval_count },
    { label: '平均匹配率', value: `${stats.avg_match_score}%` },
  ];

  return (
    <PageLayout title="工作台" subtitle="欢迎回来" action={<EmployeeNav />}>
      {/* Stats Grid */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6 mb-8">
        {statCards.map((stat, index) => (
          <Card key={index}>
            <CardContent className="pt-6">
              <p className="text-sm text-muted-foreground mb-1">{stat.label}</p>
              <span className="text-3xl font-bold">{stat.value}</span>
            </CardContent>
          </Card>
        ))}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
        {/* Recent Activity */}
        <Card>
          <CardContent className="pt-6">
            <h2 className="text-lg font-semibold mb-4">最近动态</h2>
            <div className="space-y-4">
              {stats.recent_activities.map((activity) => (
                <div key={activity.id} className="flex items-start gap-3">
                  <div className="w-2 h-2 rounded-full bg-accent mt-2" />
                  <div className="flex-1">
                    <p className="text-sm">{activity.text}</p>
                    <p className="text-xs text-muted-foreground">{activity.time}</p>
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>

        {/* Quick Actions */}
        <Card>
          <CardContent className="pt-6">
            <h2 className="text-lg font-semibold mb-4">快捷操作</h2>
            <div className="grid grid-cols-2 gap-3">
              <Link
                to="/employee/jobs/create"
                className="p-4 rounded-lg border border-border hover:border-accent hover:bg-accent/5 transition-all"
              >
                <p className="font-medium">发布岗位</p>
                <p className="text-xs text-muted-foreground">创建新职位</p>
              </Link>
              <Link
                to="/employee/evaluations"
                className="p-4 rounded-lg border border-border hover:border-accent hover:bg-accent/5 transition-all"
              >
                <p className="font-medium">批量评估</p>
                <p className="text-xs text-muted-foreground">AI评分</p>
              </Link>
              <Link
                to="/employee/resumes"
                className="p-4 rounded-lg border border-border hover:border-accent hover:bg-accent/5 transition-all"
              >
                <p className="font-medium">简历库</p>
                <p className="text-xs text-muted-foreground">浏览全部</p>
              </Link>
              <Link
                to="/employee/jobs"
                className="p-4 rounded-lg border border-border hover:border-accent hover:bg-accent/5 transition-all"
              >
                <p className="font-medium">岗位管理</p>
                <p className="text-xs text-muted-foreground">编辑职位</p>
              </Link>
            </div>
          </CardContent>
        </Card>
      </div>
    </PageLayout>
  );
}