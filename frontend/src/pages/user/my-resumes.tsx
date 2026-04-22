import { useEffect, useState } from 'react';
import { PageLayout } from '@/components/layout/page-layout';
import { UserNav } from '@/components/layout/user-nav';
import { userAuthApi } from '@/api/user/auth';
import { userResumesApi, resumePreviewApi } from '@/api/user/resumes';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { useAuthStore } from '@/store/auth';

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
  const [userInfo, setUserInfo] = useState<UserInfo | null>(null);
  const [resumes, setResumes] = useState<Resume[]>([]);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [showPreview, setShowPreview] = useState(false);

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

    setUploading(true);
    try {
      await userResumesApi.upload(file);
      await loadData();
    } catch (error) {
      console.error('Upload failed:', error);
    } finally {
      setUploading(false);
    }
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
    if (!resume.file_path) return;
    const url = resumePreviewApi.getUrl(resume.file_path);
    setPreviewUrl(url);
    setShowPreview(true);
  };

  if (loading) {
    return (
      <PageLayout title="个人信息" action={<UserNav />}>
        <div className="animate-pulse space-y-6">
          <div className="h-48 bg-muted rounded-xl" />
          <div className="h-64 bg-muted rounded-xl" />
        </div>
      </PageLayout>
    );
  }

  return (
    <PageLayout
      title="个人信息"
      subtitle="管理您的账户和简历"
      action={<UserNav />}
    >
      {showPreview && previewUrl && (
        <div className="fixed inset-0 z-50 bg-black/80 flex items-center justify-center p-4">
          <div className="bg-white rounded-lg w-full max-w-4xl h-[90vh] flex flex-col">
            <div className="flex items-center justify-between p-4 border-b">
              <h3 className="font-semibold">简历预览</h3>
              <button
                onClick={() => setShowPreview(false)}
                className="text-muted-foreground hover:text-foreground"
              >
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>
            <iframe src={previewUrl} className="flex-1 w-full" title="resume-preview" />
          </div>
        </div>
      )}

      {/* 个人信息卡片 */}
      <Card className="mb-6">
        <CardHeader>
          <CardTitle>基本信息</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <div className="space-y-4">
              <div>
                <label className="text-sm text-muted-foreground">姓名</label>
                <p className="text-lg font-medium">{userInfo?.real_name || '-'}</p>
              </div>
              <div>
                <label className="text-sm text-muted-foreground">邮箱</label>
                <p className="text-lg font-medium">{userInfo?.email || '-'}</p>
              </div>
            </div>
            <div className="space-y-4">
              <div>
                <label className="text-sm text-muted-foreground">注册时间</label>
                <p className="text-lg font-medium">
                  {userInfo?.create_time ? userInfo.create_time.split('T')[0] : '-'}
                </p>
              </div>
              <div>
                <label className="text-sm text-muted-foreground">用户ID</label>
                <p className="text-lg font-medium">{userInfo?.id || '-'}</p>
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* 简历管理卡片 */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <CardTitle>附件简历</CardTitle>
            <div>
              <input
                type="file"
                accept=".pdf,.doc,.docx"
                onChange={handleUpload}
                disabled={uploading}
                className="hidden"
                id="resume-upload"
              />
              <label htmlFor="resume-upload">
                <Button disabled={uploading} className="cursor-pointer">
                  {uploading ? '上传中...' : '上传简历'}
                </Button>
              </label>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          {resumes.length === 0 ? (
            <div className="text-center py-12 text-muted-foreground">
              <svg className="w-12 h-12 mx-auto mb-4 opacity-50" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
              </svg>
              <p>还没有上传过简历</p>
              <p className="text-sm mt-1">点击上方按钮上传简历</p>
            </div>
          ) : (
            <div className="space-y-3">
              {resumes.map((resume) => (
                <div
                  key={resume.id}
                  className="flex items-center justify-between p-4 rounded-lg border border-border bg-card hover:border-accent transition-colors"
                >
                  <div className="flex items-center gap-3 min-w-0">
                    <svg className="w-8 h-8 text-muted-foreground flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                    </svg>
                    <div className="min-w-0">
                      <p className="font-medium truncate">{resume.file_name}</p>
                      <p className="text-sm text-muted-foreground">
                        上传时间: {resume.create_time?.split('T')[0] || '-'}
                      </p>
                    </div>
                  </div>
                  <div className="flex items-center gap-2 ml-4">
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => handlePreview(resume)}
                      title="预览"
                    >
                      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
                      </svg>
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => handleDelete(resume.id)}
                      title="删除"
                      className="text-muted-foreground hover:text-destructive"
                    >
                      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                      </svg>
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </PageLayout>
  );
}
