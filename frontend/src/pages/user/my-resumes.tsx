import { Suspense, lazy, useEffect, useRef, useState } from 'react';
import { CalendarDays, Eye, FileText, Mail, Trash2, Upload, UserRound } from 'lucide-react';
import { userAuthApi } from '@/api/user/auth';
import { userResumesApi } from '@/api/user/resumes';
import { Button } from '@/components/ui/button';
import { useAuthStore } from '@/store/auth';
import { EmptyState, PageSkeleton, SectionCard, StatusPill } from '@/components/user/user-ui';
import { UserShell } from '@/components/user/user-shell';

const ResumePreviewDialog = lazy(() =>
  import('@/components/common/resume-preview-dialog').then((module) => ({ default: module.ResumePreviewDialog }))
);

interface UserInfo {
  id: number;
  email: string;
  real_name: string;
  create_time: string;
}

interface Resume {
  id: number;
  file_name: string;
  file_path: string;
  status: number;
  create_time: string;
}

export default function UserProfile() {
  const { userId } = useAuthStore();
  const uploadInputRef = useRef<HTMLInputElement>(null);
  const [userInfo, setUserInfo] = useState<UserInfo | null>(null);
  const [resumes, setResumes] = useState<Resume[]>([]);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState('');
  const [previewResume, setPreviewResume] = useState<{ id: number; fileName: string } | null>(null);

  const loadData = async () => {
    try {
      const [userRes, resumesRes] = await Promise.all([
        userAuthApi.me(),
        userResumesApi.list(),
      ]);
      setUserInfo(userRes.data);
      setResumes(resumesRes.data.items || []);
    } catch (error) {
      console.error('Failed to load data:', error);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadData();
  }, []);

  const handleUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setUploadError('');
    setUploading(true);
    try {
      await userResumesApi.upload(file);
      await loadData();
    } catch (error: any) {
      console.error('Upload failed:', error);
      setUploadError(error.response?.data?.message || error.response?.data?.detail || '上传失败，请确认文件格式后重试');
    } finally {
      setUploading(false);
      if (uploadInputRef.current) uploadInputRef.current.value = '';
    }
  };

  const handleUploadClick = () => {
    if (uploading) return;
    uploadInputRef.current?.click();
  };

  const handleDelete = async (id: number) => {
    if (!confirm('确定要删除这份简历吗？')) return;
    try {
      await userResumesApi.delete(id);
      await loadData();
    } catch (error) {
      console.error('Delete failed:', error);
    }
  };

  const handlePreview = (resume: Resume) => {
    setPreviewResume({ id: resume.id, fileName: resume.file_name });
  };

  if (loading) {
    return (
      <UserShell title="加载中…" subtitle="正在获取你的账户和简历信息" eyebrow="Profile">
        <PageSkeleton rows={2} />
      </UserShell>
    );
  }

  return (
    <UserShell
      title="简历中心"
      subtitle="管理你的账户信息和附件简历，投递岗位时可直接选择已上传文件。"
      eyebrow="Profile & Resumes"
      action={
        <StatusPill className="bg-accent/10 text-accent ring-1 ring-accent/20">
          {resumes.length} 份简历
        </StatusPill>
      }
    >
      {previewResume && (
        <Suspense fallback={null}>
          <ResumePreviewDialog
            resumeId={previewResume.id}
            fileName={previewResume.fileName}
            fileUrl={`/api/v1/user/resumes/${previewResume.id}/file`}
            open={!!previewResume}
            onClose={() => setPreviewResume(null)}
          />
        </Suspense>
      )}

      {/* 个人信息卡片 */}
      <SectionCard title="基本信息" description="当前登录账户信息" className="mb-6">
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4">
          <div className="rounded-2xl bg-muted/50 p-4">
            <div className="mb-3 flex h-10 w-10 items-center justify-center rounded-xl bg-white text-accent shadow-sm" aria-hidden="true">
              <UserRound className="h-5 w-5" />
            </div>
            <p className="text-sm text-muted-foreground">姓名</p>
            <p className="mt-1 truncate text-lg font-semibold text-foreground">{userInfo?.real_name || '-'}</p>
          </div>
          <div className="rounded-2xl bg-muted/50 p-4">
            <div className="mb-3 flex h-10 w-10 items-center justify-center rounded-xl bg-white text-accent shadow-sm" aria-hidden="true">
              <Mail className="h-5 w-5" />
            </div>
            <p className="text-sm text-muted-foreground">邮箱</p>
            <p className="mt-1 truncate text-lg font-semibold text-foreground">{userInfo?.email || '-'}</p>
          </div>
          <div className="rounded-2xl bg-muted/50 p-4">
            <div className="mb-3 flex h-10 w-10 items-center justify-center rounded-xl bg-white text-accent shadow-sm" aria-hidden="true">
              <CalendarDays className="h-5 w-5" />
            </div>
            <p className="text-sm text-muted-foreground">注册时间</p>
            <p className="mt-1 text-lg font-semibold text-foreground">
              {userInfo?.create_time ? new Intl.DateTimeFormat('zh-CN').format(new Date(userInfo.create_time)) : '-'}
            </p>
          </div>
          <div className="rounded-2xl bg-muted/50 p-4">
            <div className="mb-3 flex h-10 w-10 items-center justify-center rounded-xl bg-white text-accent shadow-sm" aria-hidden="true">
              <FileText className="h-5 w-5" />
            </div>
            <p className="text-sm text-muted-foreground">用户 ID</p>
            <p className="mt-1 text-lg font-semibold tabular-nums text-foreground">{userId || userInfo?.id || '-'}</p>
          </div>
        </div>
      </SectionCard>

      {/* 简历管理卡片 */}
      <SectionCard
        title="附件简历"
        description="支持 PDF 和 DOCX 文件"
        action={
          <div>
            <input
              ref={uploadInputRef}
              type="file"
              accept=".pdf,.docx"
              onChange={handleUpload}
              disabled={uploading}
              className="sr-only"
            />
            <Button type="button" disabled={uploading} onClick={handleUploadClick} className="gap-2">
              <Upload className="h-4 w-4" aria-hidden="true" />
              {uploading ? '上传中…' : '上传简历'}
            </Button>
          </div>
        }
      >
        {uploadError ? (
          <div className="mb-4 rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
            {uploadError}
          </div>
        ) : null}
        {resumes.length === 0 ? (
          <EmptyState
            title="还没有上传过简历"
            description="上传附件简历后，投递岗位时可以直接选择并提交。"
            icon={<FileText className="h-8 w-8" aria-hidden="true" />}
          />
        ) : (
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
            {resumes.map((resume) => (
              <article
                key={resume.id}
                className="flex min-w-0 flex-col justify-between gap-5 rounded-3xl border border-border/80 bg-white p-5 shadow-sm shadow-slate-200/60 transition-[border-color,box-shadow,transform] duration-200 hover:-translate-y-0.5 hover:border-accent/60 hover:shadow-lg hover:shadow-accent/10"
              >
                <div className="flex min-w-0 items-start gap-4">
                  <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-accent/10 text-accent" aria-hidden="true">
                    <FileText className="h-6 w-6" />
                  </div>
                  <div className="min-w-0">
                    <h3 className="truncate text-base font-semibold text-foreground">{resume.file_name}</h3>
                    <p className="mt-1 text-sm text-muted-foreground">
                      上传时间：{resume.create_time ? new Intl.DateTimeFormat('zh-CN').format(new Date(resume.create_time)) : '-'}
                    </p>
                  </div>
                </div>
                <div className="flex items-center justify-end gap-2 border-t border-border/70 pt-4">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => handlePreview(resume)}
                    className="gap-2"
                  >
                    <Eye className="h-4 w-4" aria-hidden="true" />
                    预览
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => handleDelete(resume.id)}
                    className="gap-2 text-muted-foreground hover:text-destructive"
                  >
                    <Trash2 className="h-4 w-4" aria-hidden="true" />
                    删除
                  </Button>
                </div>
              </article>
            ))}
          </div>
        )}
      </SectionCard>
    </UserShell>
  );
}
