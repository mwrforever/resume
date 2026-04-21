import { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { PageLayout } from '@/components/layout/page-layout';
import { UserNav } from '@/components/layout/user-nav';
import { userJobsApi } from '@/api/user/jobs';
import { userApplicationsApi } from '@/api/user/applications';
import { resumePreviewApi } from '@/api/user/resumes';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { ResumeSelectorDialog } from '@/components/resume-selector-dialog';

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

export default function UserJobDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [job, setJob] = useState<Job | null>(null);
  const [loading, setLoading] = useState(true);
  const [applying, setApplying] = useState(false);
  const [attachedResume, setAttachedResume] = useState<UploadedResume | null>(null);
  const [appliedResume, setAppliedResume] = useState<UploadedResume | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [showPreview, setShowPreview] = useState(false);
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

  const handlePreview = (resume: UploadedResume) => {
    if (!resume.file_path) return;
    const url = resumePreviewApi.getUrl(resume.file_path);
    setPreviewUrl(url);
    setShowPreview(true);
  };

  const handleRemoveResume = () => {
    setAttachedResume(null);
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
      <PageLayout title="加载中..." action={<UserNav />}>
        <div className="animate-pulse space-y-6">
          <div className="h-8 w-64 bg-muted rounded" />
          <div className="h-32 bg-muted rounded-xl" />
          <div className="h-48 bg-muted rounded-xl" />
        </div>
      </PageLayout>
    );
  }

  if (!job) {
    return (
      <PageLayout title="岗位不存在" action={<UserNav />}>
        <div className="text-center py-24">
          <p className="text-muted-foreground">该岗位已下架或不存在</p>
        </div>
      </PageLayout>
    );
  }

  return (
    <PageLayout
      title={job.name}
      subtitle="岗位详情"
      action={<UserNav />}
    >
      {showPreview && previewUrl && (
        <div className="fixed inset-0 z-50 bg-black/80 flex items-center justify-center p-4">
          <div className="bg-white rounded-lg w-full max-w-4xl h-[90vh] flex flex-col">
            <div className="flex items-center justify-between p-4 border-b">
              <h3 className="font-semibold">简历预览</h3>
              <button onClick={() => setShowPreview(false)} className="text-muted-foreground hover:text-foreground">
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>
            <iframe src={previewUrl} className="flex-1 w-full" title="resume-preview" />
          </div>
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
        <div className="lg:col-span-2 space-y-6">
          <Card>
            <CardContent className="pt-6">
              {job.skills && job.skills.length > 0 && (
                <>
                  <h2 className="text-lg font-semibold mb-4">技能要求</h2>
                  <div className="flex flex-wrap gap-2 mb-4">
                    {job.skills.map((skill, idx) => (
                      <span key={idx} className="inline-flex items-center rounded-md bg-muted px-2.5 py-1 text-xs text-muted-foreground">
                        {skill}
                      </span>
                    ))}
                  </div>
                  <hr className="border-border mb-4" />
                </>
              )}
              <h2 className="text-lg font-semibold mb-4">岗位描述</h2>
              <p className="text-muted-foreground whitespace-pre-wrap">
                {job.description || '暂无详细描述'}
              </p>
            </CardContent>
          </Card>
        </div>

        <div className="space-y-6">
          <Card>
            <CardContent className="pt-6">
              <h2 className="text-lg font-semibold mb-4">附件简历</h2>
              {job.applied && appliedResume ? (
                // 已投递，显示简历信息，无添加按钮
                <div className="space-y-3">
                  <div className="flex items-center justify-between p-3 rounded-lg border border-border bg-muted/50">
                    <div className="flex items-center gap-2 min-w-0">
                      <svg className="w-5 h-5 text-muted-foreground flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                      </svg>
                      <span className="text-sm truncate">{appliedResume.file_name}</span>
                    </div>
                    <button
                      onClick={() => handlePreview(appliedResume)}
                      className="p-1.5 text-muted-foreground hover:text-accent transition-colors"
                      title="预览"
                    >
                      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
                      </svg>
                    </button>
                  </div>
                  <p className="text-sm text-muted-foreground text-center">已投递</p>
                </div>
              ) : attachedResume ? (
                // 未投递但选择了简历
                <div className="space-y-3">
                  <div className="flex items-center justify-between p-3 rounded-lg border border-border bg-muted/50">
                    <div className="flex items-center gap-2 min-w-0">
                      <svg className="w-5 h-5 text-muted-foreground flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                      </svg>
                      <span className="text-sm truncate">{attachedResume.file_name}</span>
                    </div>
                    <div className="flex gap-1 ml-2">
                      <button
                        onClick={() => handlePreview(attachedResume)}
                        className="p-1.5 text-muted-foreground hover:text-accent transition-colors"
                        title="预览"
                      >
                        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
                        </svg>
                      </button>
                      <button
                        onClick={handleRemoveResume}
                        className="p-1.5 text-muted-foreground hover:text-destructive transition-colors"
                        title="删除"
                      >
                        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                        </svg>
                      </button>
                    </div>
                  </div>
                  <Button
                    className="w-full"
                    disabled={applying}
                    onClick={handleApply}
                  >
                    {applying ? '投递中...' : '确认投递'}
                  </Button>
                </div>
              ) : (
                // 未投递且未选择简历
                <Button
                  className="w-full"
                  variant="outline"
                  onClick={() => setShowResumeDialog(true)}
                >
                  添加附件简历
                </Button>
              )}
            </CardContent>
          </Card>
        </div>
      </div>

      <ResumeSelectorDialog
        open={showResumeDialog}
        onOpenChange={setShowResumeDialog}
        onSelect={handleSelectResume}
      />
    </PageLayout>
  );
}
