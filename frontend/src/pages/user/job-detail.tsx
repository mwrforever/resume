import { lazy, Suspense, useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { CheckCircle2, ClipboardCheck, Eye, FileText, Trash2 } from 'lucide-react';
import { userJobsApi } from '@/api/user/jobs';
import { userApplicationsApi } from '@/api/user/applications';
import { Button } from '@/components/ui/button';
import { ResumeSelectorDialog } from '@/components/resume-selector-dialog';
import { EmptyState, PageSkeleton, SectionCard, SkillPill, StatusPill } from '@/components/user/user-ui';
import { UserShell } from '@/components/user/user-shell';

const ResumePreviewDialog = lazy(async () => {
  const module = await import('@/components/common/resume-preview-dialog');
  return { default: module.ResumePreviewDialog };
});

interface Job {
  id: number;
  name: string;
  description: string;
  skills: string[];
  applied: boolean;
  application_id: number | null;
}

interface UploadedResume {
  id: number;
  file_name: string;
  file_path: string;
}

function ResumeAttachmentCard({
  resume,
  onPreview,
  onRemove,
}: {
  resume: UploadedResume;
  onPreview: () => void;
  onRemove?: () => void;
}) {
  return (
    <div className="flex items-center justify-between gap-3 rounded-2xl border border-border bg-muted/40 p-4">
      <div className="flex min-w-0 items-center gap-3">
        <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-white text-accent shadow-sm" aria-hidden="true">
          <FileText className="h-5 w-5" />
        </div>
        <div className="min-w-0">
          <p className="truncate text-sm font-semibold text-foreground">{resume.file_name}</p>
          <p className="text-xs text-muted-foreground">附件简历</p>
        </div>
      </div>
      <div className="flex shrink-0 items-center gap-1">
        <Button variant="outline" size="sm" onClick={onPreview} aria-label="预览简历" className="gap-1.5">
          <Eye className="h-4 w-4" aria-hidden="true" />
          预览
        </Button>
        {onRemove ? (
          <Button variant="ghost" size="sm" onClick={onRemove} aria-label="移除简历" className="text-muted-foreground hover:text-destructive">
            <Trash2 className="h-4 w-4" aria-hidden="true" />
          </Button>
        ) : null}
      </div>
    </div>
  );
}

export default function UserJobDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [job, setJob] = useState<Job | null>(null);
  const [loading, setLoading] = useState(true);
  const [applying, setApplying] = useState(false);
  const [attachedResume, setAttachedResume] = useState<UploadedResume | null>(null);
  const [appliedResume, setAppliedResume] = useState<UploadedResume | null>(null);
  const [previewResume, setPreviewResume] = useState<UploadedResume | null>(null);
  const [showResumeDialog, setShowResumeDialog] = useState(false);

  useEffect(() => {
    const loadData = async () => {
      try {
        const jobRes = await userJobsApi.get(Number(id));
        const jobData = jobRes.data;
        setJob(jobData);

        // 如果已投递，加载投递详情获取简历信息
        if (jobData.applied && jobData.application_id) {
          const appRes = await userApplicationsApi.get(jobData.application_id);
          const appData = appRes.data;
          if (appData.resume_id) {
            setAppliedResume({
              id: appData.resume_id,
              file_name: appData.resume_name || '简历',
              file_path: appData.resume_file_path || '',
            });
          }
        }
      } catch (error) {
        console.error('Failed to load data:', error);
      } finally {
        setLoading(false);
      }
    };
    loadData();
  }, [id]);

  const handleSelectResume = (resume: { id: number; file_name: string; file_path: string }) => {
    setAttachedResume({
      id: resume.id,
      file_name: resume.file_name,
      file_path: resume.file_path,
    });
  };

  const handleRemoveResume = () => {
    setAttachedResume(null);
  };

  const handlePreview = (resume: UploadedResume) => {
    setPreviewResume(resume);
  };

  const handleApply = async () => {
    if (!attachedResume) return;
    setApplying(true);
    try {
      await userApplicationsApi.apply({
        job_id: Number(id),
        resume_id: attachedResume.id
      });
      navigate('/user/my-applications');
    } catch (error) {
      console.error('Failed to apply:', error);
    } finally {
      setApplying(false);
    }
  };

  if (loading) {
    return (
      <UserShell title="加载中…" subtitle="正在获取岗位详情" eyebrow="Job Detail">
        <PageSkeleton rows={3} />
      </UserShell>
    );
  }

  if (!job) {
    return (
      <UserShell title="岗位不存在" subtitle="该岗位已下架或不存在" eyebrow="Job Detail">
        <EmptyState title="未找到岗位" description="请返回岗位列表查看当前开放的招聘机会。" />
      </UserShell>
    );
  }

  return (
    <UserShell
      title={job.name}
      subtitle="查看岗位描述、技能要求，并选择附件简历完成投递。"
      eyebrow="Job Detail"
      action={
        <StatusPill className={job.applied ? 'bg-emerald-50 text-emerald-700 ring-1 ring-emerald-200' : 'bg-accent/10 text-accent ring-1 ring-accent/20'}>
          {job.applied ? '已投递' : '可投递'}
        </StatusPill>
      }
    >
      {previewResume && (
        <Suspense fallback={null}>
          <ResumePreviewDialog
            resumeId={previewResume.id}
            fileName={previewResume.file_name}
            fileUrl={`/api/v1/user/resumes/${previewResume.id}/file`}
            open={!!previewResume}
            onClose={() => setPreviewResume(null)}
          />
        </Suspense>
      )}

      <div className="grid grid-cols-1 gap-8 lg:grid-cols-3">
        <div className="space-y-6 lg:col-span-2">
          <SectionCard title="技能要求" description="岗位期望候选人具备的能力标签">
            {job.skills && job.skills.length > 0 ? (
              <div className="flex flex-wrap gap-2">
                {job.skills.map((skill, idx) => (
                  <SkillPill key={`${skill}-${idx}`} tone="accent">
                    {skill}
                  </SkillPill>
                ))}
              </div>
            ) : (
              <p className="text-sm text-muted-foreground">暂无技能要求</p>
            )}
          </SectionCard>

          <SectionCard title="岗位描述" description="阅读岗位职责与任职要求">
            <p className="whitespace-pre-wrap break-words text-sm leading-7 text-muted-foreground md:text-base">
              {job.description || '暂无详细描述'}
            </p>
          </SectionCard>
        </div>

        <aside className="space-y-6">
          <SectionCard title="附件简历" description={job.applied ? '你已完成投递，可查看已使用的简历。' : '选择一份简历后即可提交投递。'}>
            {job.applied && appliedResume ? (
              // 已投递，显示简历信息，无添加按钮
              <div className="space-y-4">
                <ResumeAttachmentCard resume={appliedResume} onPreview={() => handlePreview(appliedResume)} />
                <div className="flex items-center justify-center gap-2 rounded-2xl bg-emerald-50 px-4 py-3 text-sm font-medium text-emerald-700">
                  <CheckCircle2 className="h-4 w-4" aria-hidden="true" />
                  已投递
                </div>
              </div>
            ) : attachedResume ? (
              // 未投递但选择了简历
              <div className="space-y-4">
                <ResumeAttachmentCard resume={attachedResume} onPreview={() => handlePreview(attachedResume)} onRemove={handleRemoveResume} />
                <Button
                  className="w-full"
                  disabled={applying}
                  onClick={handleApply}
                >
                  {applying ? '投递中…' : '确认投递'}
                </Button>
              </div>
            ) : (
              // 未投递且未选择简历
              <div className="space-y-4">
                <div className="rounded-2xl border border-dashed border-border bg-muted/30 px-4 py-8 text-center">
                  <ClipboardCheck className="mx-auto h-8 w-8 text-accent" aria-hidden="true" />
                  <p className="mt-3 text-sm font-medium text-foreground">还未选择附件简历</p>
                  <p className="mt-1 text-xs leading-5 text-muted-foreground">请选择已上传简历，或在弹窗中上传新简历。</p>
                </div>
                <Button
                  className="w-full"
                  variant="outline"
                  onClick={() => setShowResumeDialog(true)}
                >
                  添加附件简历
                </Button>
              </div>
            )}
          </SectionCard>
        </aside>
      </div>

      <ResumeSelectorDialog
        open={showResumeDialog}
        onOpenChange={setShowResumeDialog}
        onSelect={handleSelectResume}
      />
    </UserShell>
  );
}
