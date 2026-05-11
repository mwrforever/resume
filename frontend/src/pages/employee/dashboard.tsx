import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { AdminLayout } from '@/components/layout/admin-layout';
import { Card, CardContent } from '@/components/ui/card';
import { employeeAnalyticsApi } from '@/api/employee/analytics';
import { DashboardStats } from '@/types/employee';
import { Briefcase, FileText, Clock, TrendingUp, Plus, ClipboardCheck } from 'lucide-react';
import { CreateJobModal } from '@/components/employee/create-job-modal';

const ACTIVITY_DOT_COLOR: Record<string, string> = {
  resume_upload: 'bg-purple-500',
  application: 'bg-blue-500',
  evaluation: 'bg-green-500',
  job_create: 'bg-orange-500',
};

export default function EmployeeDashboard() {
  const navigate = useNavigate();
  const [stats, setStats] = useState<DashboardStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [createModalOpen, setCreateModalOpen] = useState(false);

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

  const statCards = stats
    ? [
        { label: '在招岗位', value: stats.job_count, icon: Briefcase, color: 'text-blue-600', bg: 'bg-blue-50' },
        { label: '简历总数', value: stats.resume_count, icon: FileText, color: 'text-purple-600', bg: 'bg-purple-50' },
        { label: '待评估', value: stats.pending_eval_count, icon: Clock, color: 'text-orange-600', bg: 'bg-orange-50' },
        { label: '平均匹配率', value: `${stats.avg_match_score}%`, icon: TrendingUp, color: 'text-green-600', bg: 'bg-green-50' },
      ]
    : [];

  return (
    <AdminLayout breadcrumbs={[{ label: '工作台' }]} title="招聘工作台">
      {/* Stat Cards */}
      <div className="mb-6 grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-4">
        {loading
          ? [...Array(4)].map((_, i) => (
              <div key={i} className="h-28 animate-pulse rounded-2xl bg-white/80 shadow-sm shadow-slate-200/70" />
            ))
          : statCards.map((stat, idx) => {
              const Icon = stat.icon;
              return (
                <Card key={idx} className="border-white/80 bg-white/90 backdrop-blur">
                  <CardContent className="flex items-center gap-4 p-5">
                    <div className={`flex h-12 w-12 flex-shrink-0 items-center justify-center rounded-2xl ${stat.bg}`}>
                      <Icon size={22} className={stat.color} aria-hidden="true" />
                    </div>
                    <div className="min-w-0">
                      <p className="mb-0.5 text-sm text-slate-600">{stat.label}</p>
                      <p className="text-2xl font-bold tabular-nums text-slate-900">{stat.value}</p>
                    </div>
                  </CardContent>
                </Card>
              );
            })}
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        {/* Recent Activity - Timeline */}
        <Card className="border-white/80 bg-white/90 backdrop-blur">
          <CardContent className="p-5">
            <h2 className="mb-4 text-base font-semibold text-slate-900">最近动态</h2>
            {loading ? (
              <div className="space-y-3">
                {[...Array(4)].map((_, i) => <div key={i} className="h-10 animate-pulse rounded-xl bg-slate-100" />)}
              </div>
            ) : !stats || stats.recent_activities.length === 0 ? (
              <p className="py-6 text-center text-sm text-slate-400">暂无动态</p>
            ) : (
              <div className="relative pl-5">
                <div className="absolute bottom-0 left-1.5 top-0 w-px bg-slate-200" aria-hidden="true" />
                <div className="space-y-4">
                  {stats.recent_activities.map((activity) => (
                    <div key={activity.id} className="relative flex items-start gap-3">
                      <div
                        className={`absolute -left-5 mt-1.5 h-2.5 w-2.5 flex-shrink-0 rounded-full ${ACTIVITY_DOT_COLOR[activity.type] ?? 'bg-slate-400'}`}
                        aria-hidden="true"
                      />
                      <div className="min-w-0">
                        <p className="text-sm text-slate-900">{activity.text}</p>
                        <p className="mt-0.5 text-xs text-slate-400">
                          {new Intl.DateTimeFormat('zh-CN', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' }).format(new Date(activity.time))}
                        </p>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </CardContent>
        </Card>

        {/* Quick Actions */}
        <Card className="border-white/80 bg-white/90 backdrop-blur">
          <CardContent className="p-5">
            <h2 className="mb-4 text-base font-semibold text-slate-900">快捷操作</h2>
            <div className="grid grid-cols-2 gap-3">
              {[
                { to: '', icon: Plus, label: '发布岗位', sub: '创建新职位', color: 'text-blue-600', bg: 'bg-blue-50', onClick: () => setCreateModalOpen(true) },
                { to: '/employee/evaluations', icon: ClipboardCheck, label: '批量评估', sub: 'AI 智能评分', color: 'text-green-600', bg: 'bg-green-50', onClick: null },
                { to: '/employee/resumes', icon: FileText, label: '简历库', sub: '浏览全部简历', color: 'text-purple-600', bg: 'bg-purple-50', onClick: null },
                { to: '/employee/jobs', icon: Briefcase, label: '岗位管理', sub: '编辑招聘职位', color: 'text-orange-600', bg: 'bg-orange-50', onClick: null },
              ].map((item) => {
                const Icon = item.icon;
                const inner = (
                  <>
                    <div className={`flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-xl ${item.bg}`}>
                      <Icon size={18} className={item.color} aria-hidden="true" />
                    </div>
                    <div className="min-w-0">
                      <p className="truncate text-sm font-semibold text-slate-900">{item.label}</p>
                      <p className="truncate text-xs text-slate-400">{item.sub}</p>
                    </div>
                  </>
                );
                const cls = 'flex w-full items-center gap-3 rounded-2xl border border-slate-200 bg-white/70 p-4 text-left transition-[background-color,border-color,box-shadow] hover:border-primary/40 hover:bg-sky-50/70 hover:shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring';
                return item.onClick ? (
                  <button key={item.label} type="button" onClick={item.onClick} className={cls}>{inner}</button>
                ) : (
                  <Link key={item.to} to={item.to} className={cls}>{inner}</Link>
                );
              })}
            </div>
          </CardContent>
        </Card>
      </div>
      <CreateJobModal
        open={createModalOpen}
        onClose={() => setCreateModalOpen(false)}
        onSuccess={() => { setCreateModalOpen(false); navigate('/employee/jobs'); }}
      />
    </AdminLayout>
  );
}