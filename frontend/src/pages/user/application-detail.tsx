import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { Briefcase, CalendarDays, Eye, FileText } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { EvaluationRadarChart } from '@/components/common/radar-chart';
import { SkillTag } from '@/components/common/skill-tag';
import { MatchBadge } from '@/components/common/match-badge';
import { EvalPending } from '@/components/common/eval-pending';
import { userApplicationsApi } from '@/api/user/applications';
import { resumePreviewApi } from '@/api/user/resumes';
import { EmptyState, PageSkeleton, ResumePreviewModal, SectionCard, StatusPill } from '@/components/user/user-ui';
import { UserShell } from '@/components/user/user-shell';

interface Evaluation {
  final_score: number;
  final_label: '优秀' | '良好' | '一般' | '未达标';
  advantage_comment: string;
  disadvantage_comment: string;
  dimensions: { dimension_name: string; score: number }[];
  skill_hits: {
    skill_name: string;
    skill_type: number;
    is_hit: boolean;
    match_label?: string;
    hit_context?: string;
  }[];
}

interface Application {
  id: number;
  job_id: number;
  resume_id: number;
  status: number;
  status_name: string;
  create_time: string;
  job_name?: string;
  resume_name?: string;
  resume_file_path?: string;
  evaluation?: Evaluation;
}

function getStatusColor(status: number) {
  switch (status) {
    case 0: return 'bg-amber-50 text-amber-700 ring-1 ring-amber-200';
    case 1: return 'bg-blue-50 text-blue-700 ring-1 ring-blue-200';
    case 2: return 'bg-slate-100 text-slate-700 ring-1 ring-slate-200';
    case 3: return 'bg-orange-50 text-orange-700 ring-1 ring-orange-200';
    case 4: return 'bg-red-50 text-red-700 ring-1 ring-red-200';
    case 5: return 'bg-emerald-50 text-emerald-700 ring-1 ring-emerald-200';
    default: return 'bg-slate-100 text-slate-700 ring-1 ring-slate-200';
  }
}

export default function UserApplicationDetail() {
  const { id } = useParams();
  const [application, setApplication] = useState<Application | null>(null);
  const [loading, setLoading] = useState(true);
  const [showPreview, setShowPreview] = useState(false);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);

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

  useEffect(() => {
    loadApplication();
  }, [id]);

  const handlePreviewResume = () => {
    if (!application?.resume_file_path) return;
    const url = resumePreviewApi.getUrl(application.resume_file_path);
    setPreviewUrl(url);
    setShowPreview(true);
  };

  if (loading) {
    return (
      <UserShell title="加载中…" subtitle="正在获取投递详情" eyebrow="Application Detail">
        <PageSkeleton rows={2} />
      </UserShell>
    );
  }

  if (!application) {
    return (
      <UserShell title="投递不存在" subtitle="该投递记录不存在或已被移除" eyebrow="Application Detail">
        <EmptyState
          title="未找到投递记录"
          description="请返回我的投递页面，查看当前有效的投递记录。"
          icon={<FileText className="h-8 w-8" aria-hidden="true" />}
        />
      </UserShell>
    );
  }

  const isEvaluated = application?.status === 2 && application?.evaluation;

  return (
    <UserShell
      title="投递详情"
      subtitle={`岗位：${application.job_name || `ID: ${application.job_id}`}`}
      eyebrow="Application Detail"
      action={
        <StatusPill className={getStatusColor(application.status)}>
          {application.status_name}
        </StatusPill>
      }
    >
      <ResumePreviewModal open={showPreview} url={previewUrl} onClose={() => setShowPreview(false)} />

      <SectionCard title="基本信息" description="本次岗位投递的摘要信息" className="mb-6">
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4">
          <div className="rounded-2xl bg-muted/50 p-4">
            <div className="mb-3 flex h-10 w-10 items-center justify-center rounded-xl bg-white text-accent shadow-sm" aria-hidden="true">
              <Briefcase className="h-5 w-5" />
            </div>
            <p className="text-sm text-muted-foreground">岗位</p>
            <p className="mt-1 truncate text-lg font-semibold text-foreground">{application.job_name || `ID: ${application.job_id}`}</p>
          </div>
          <div className="rounded-2xl bg-muted/50 p-4">
            <div className="mb-3 flex h-10 w-10 items-center justify-center rounded-xl bg-white text-accent shadow-sm" aria-hidden="true">
              <CalendarDays className="h-5 w-5" />
            </div>
            <p className="text-sm text-muted-foreground">投递时间</p>
            <p className="mt-1 text-lg font-semibold text-foreground">
              {application.create_time ? new Intl.DateTimeFormat('zh-CN').format(new Date(application.create_time)) : '-'}
            </p>
          </div>
          <div className="rounded-2xl bg-muted/50 p-4">
            <div className="mb-3 flex h-10 w-10 items-center justify-center rounded-xl bg-white text-accent shadow-sm" aria-hidden="true">
              <FileText className="h-5 w-5" />
            </div>
            <p className="text-sm text-muted-foreground">简历</p>
            <div className="mt-1 min-w-0">
              {application.resume_name ? (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={handlePreviewResume}
                  className="max-w-full justify-start gap-2 px-0 text-accent hover:bg-transparent"
                >
                  <span className="truncate">{application.resume_name}</span>
                  <Eye className="h-4 w-4 shrink-0" aria-hidden="true" />
                </Button>
              ) : (
                <span className="text-lg font-semibold text-foreground">-</span>
              )}
            </div>
          </div>
          <div className="rounded-2xl bg-muted/50 p-4">
            <p className="text-sm text-muted-foreground">状态</p>
            <div className="mt-3">
              <StatusPill className={getStatusColor(application.status)}>
                {application.status_name}
              </StatusPill>
            </div>
          </div>
        </div>
      </SectionCard>

      {!isEvaluated ? (
        <SectionCard>
            <EvalPending onRefresh={loadApplication} />
        </SectionCard>
      ) : (
        <div className="space-y-6">
          <SectionCard title="匹配度评估" description="系统基于岗位要求和附件简历生成的综合评估">
            <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
              <div className="flex items-center gap-4">
                <span className="text-4xl font-bold tabular-nums text-foreground">{application.evaluation!.final_score}</span>
                <span className="text-lg text-muted-foreground">/100</span>
                <MatchBadge label={application.evaluation!.final_label} />
              </div>
              <div className="h-3 w-full rounded-full bg-muted sm:max-w-md">
                <div
                  className="h-3 rounded-full bg-primary"
                  style={{ width: `${application.evaluation!.final_score}%` }}
                />
              </div>
            </div>
          </SectionCard>

          <SectionCard title="多维度得分" description="查看各评估维度的匹配表现">
            <EvaluationRadarChart data={application.evaluation!.dimensions.map(d => ({ dimension: d.dimension_name, score: d.score }))} />
          </SectionCard>

          <SectionCard title="优缺点评价" description="帮助你理解简历与岗位之间的关键匹配点">
            <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
              <div className="rounded-2xl border border-emerald-200 bg-emerald-50 p-5">
                <p className="mb-2 font-semibold text-emerald-700">优势</p>
                <p className="break-words text-sm leading-6 text-foreground">
                  {application.evaluation!.advantage_comment || '暂无明显优势'}
                </p>
              </div>
              <div className="rounded-2xl border border-red-200 bg-red-50 p-5">
                <p className="mb-2 font-semibold text-red-700">待提升</p>
                <p className="break-words text-sm leading-6 text-foreground">
                  {application.evaluation!.disadvantage_comment || "无明显缺点"}
                </p>
              </div>
            </div>
          </SectionCard>

          <SectionCard title="技能匹配" description="技能标签命中情况来自评估结果">
            <div className="flex flex-wrap gap-2">
              {application.evaluation!.skill_hits?.map((hit, idx) => (
                <SkillTag
                  key={`${hit.skill_name}-${idx}`}
                  skill={hit.skill_name}
                  type={hit.skill_type === 1 ? '必须满足' : hit.skill_type === 2 ? '优先匹配' : '普通技能'}
                  isHit={hit.is_hit}
                  matchLabel={hit.match_label}
                  hitContext={hit.hit_context}
                />
              ))}
            </div>
          </SectionCard>
        </div>
      )}
    </UserShell>
  );
}
