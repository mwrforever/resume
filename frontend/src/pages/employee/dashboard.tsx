import { PageLayout } from '@/components/layout/page-layout';
import { EmployeeNav } from '@/components/layout/employee-nav';
import { Card, CardContent } from '@/components/ui/card';
import { Link } from 'react-router-dom';

const stats = [
  { label: '在招岗位', value: '12', change: '+2 本月' },
  { label: '简历总数', value: '156', change: '+23 本周' },
  { label: '待评估', value: '8', change: '-3 已完成' },
  { label: '匹配率', value: '76%', change: '+5%' },
];

const recentActivities = [
  { id: 1, text: '张三投递了 前端工程师 岗位', time: '10分钟前' },
  { id: 2, text: '李四完成了 AI评估', time: '30分钟前' },
  { id: 3, text: '王五上传了新简历', time: '1小时前' },
  { id: 4, text: '系统完成了 5 份简历评估', time: '2小时前' },
];

export default function EmployeeDashboard() {
  return (
    <PageLayout title="工作台" subtitle="欢迎回来" action={<EmployeeNav />}>
      {/* Stats Grid */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6 mb-8">
        {stats.map((stat, index) => (
          <Card key={index}>
            <CardContent className="pt-6">
              <p className="text-sm text-muted-foreground mb-1">{stat.label}</p>
              <div className="flex items-baseline gap-2">
                <span className="text-3xl font-bold">{stat.value}</span>
                <span className="text-xs text-muted-foreground">{stat.change}</span>
              </div>
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
              {recentActivities.map((activity) => (
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
