import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Briefcase, CalendarDays, RotateCcw } from 'lucide-react';
import { userApplicationsApi } from '@/api/user/applications';
import { Button } from '@/components/ui/button';
import { ConfirmDialog } from '@/components/common/confirm-dialog';
import { EmptyState, PageSkeleton, SectionCard, StatusPill } from '@/components/user/user-ui';
import { UserShell } from '@/components/user/user-shell';

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
  // 撤回二次确认弹窗：保留待撤回的投递对象，避免 window.confirm 风格
  const [withdrawTarget, setWithdrawTarget] = useState<Application | null>(null);
  const [withdrawing, setWithdrawing] = useState(false);

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

  const handleConfirmWithdraw = async () => {
    if (!withdrawTarget) return;
    setWithdrawing(true);
    try {
      await userApplicationsApi.withdraw(withdrawTarget.id);
      setWithdrawTarget(null);
      await loadApplications(page);
    } catch (error) {
      console.error('Failed to withdraw:', error);
    } finally {
      setWithdrawing(false);
    }
  };

  const getStatusColor = (status: number) => {
    switch (status) {
      case 0: return 'bg-amber-50 text-amber-700 ring-1 ring-amber-200';
      case 1: return 'bg-blue-50 text-blue-700 ring-1 ring-blue-200';
      case 2: return 'bg-slate-100 text-slate-700 ring-1 ring-slate-200';
      case 3: return 'bg-orange-50 text-orange-700 ring-1 ring-orange-200';
      case 4: return 'bg-red-50 text-red-700 ring-1 ring-red-200';
      case 5: return 'bg-emerald-50 text-emerald-700 ring-1 ring-emerald-200';
      default: return 'bg-slate-100 text-slate-700 ring-1 ring-slate-200';
    }
  };

  return (
    <UserShell
      title="我的投递"
      subtitle="跟踪投递进度、查看评估结果，也可以撤回仍在处理中的投递。"
      eyebrow="Applications"
      action={
        <StatusPill className="bg-accent/10 text-accent ring-1 ring-accent/20">
          {applications.length} 条记录
        </StatusPill>
      }
    >
      {loading ? (
        <PageSkeleton rows={3} />
      ) : applications.length === 0 ? (
        <EmptyState
          title="还没有投递过任何岗位"
          description="前往岗位列表，选择合适的机会并附上你的简历完成投递。"
          icon={<Briefcase className="h-8 w-8" aria-hidden="true" />}
          action={
            <Link to="/user/jobs">
              <Button>查看岗位</Button>
            </Link>
          }
        />
      ) : (
        <div className="space-y-4">
          {applications.map((app) => (
            <SectionCard key={app.id} className="transition-[border-color,box-shadow,transform] duration-200 hover:-translate-y-0.5 hover:border-accent/50 hover:shadow-lg hover:shadow-accent/10">
              <div className="flex flex-col gap-5 md:flex-row md:items-center md:justify-between">
                <div className="min-w-0 flex-1">
                  <div className="mb-3 flex flex-wrap items-center gap-2">
                    <StatusPill className={getStatusColor(app.status)}>
                      {app.status_name}
                    </StatusPill>
                    <span className="rounded-full bg-muted px-2.5 py-1 text-xs text-muted-foreground tabular-nums">
                      投递 ID #{app.id}
                    </span>
                  </div>
                  <h2 className="truncate text-xl font-semibold text-foreground">
                    {app.job_name || `岗位 ID: ${app.job_id}`}
                  </h2>
                  <p className="mt-2 flex items-center gap-1.5 text-sm text-muted-foreground">
                    <CalendarDays className="h-4 w-4" aria-hidden="true" />
                    投递时间：{app.create_time ? new Intl.DateTimeFormat('zh-CN').format(new Date(app.create_time)) : '-'}
                  </p>
                </div>
                <div className="flex shrink-0 flex-wrap items-center gap-2">
                  {/* 仅"待评估"投递允许撤回；其他状态隐藏按钮（与后端 status==0 校验对齐） */}
                  {app.status === 0 && (
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => setWithdrawTarget(app)}
                      className="gap-2 text-muted-foreground hover:text-destructive"
                    >
                      <RotateCcw className="h-4 w-4" aria-hidden="true" />
                      撤回
                    </Button>
                  )}
                </div>
              </div>
            </SectionCard>
          ))}
        </div>
      )}

      <ConfirmDialog
        open={withdrawTarget !== null}
        title="撤回投递"
        description={withdrawTarget ? `确定撤回岗位「${withdrawTarget.job_name || `ID ${withdrawTarget.job_id}`}」的投递吗？撤回后可以重新投递。` : ''}
        confirmLabel="确认撤回"
        onConfirm={handleConfirmWithdraw}
        onCancel={() => !withdrawing && setWithdrawTarget(null)}
        loading={withdrawing}
      />
    </UserShell>
  );
}
