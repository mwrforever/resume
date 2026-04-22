import { useEffect, useState } from 'react';
import { PageLayout } from '@/components/layout/page-layout';
import { EmployeeNav } from '@/components/layout/employee-nav';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { ResumePreviewDialog } from '@/components/common/resume-preview-dialog';
import { employeeResumesApi } from '@/api/employee/resumes';

interface Resume {
  id: number;
  file_name: string;
  user_id?: number;
  status: number;
  create_time: string;
}

export default function EmployeeResumes() {
  const [resumes, setResumes] = useState<Resume[]>([]);
  const [loading, setLoading] = useState(true);
  const [previewResume, setPreviewResume] = useState<{ id: number; fileName: string } | null>(null);

  useEffect(() => {
    const loadResumes = async () => {
      try {
        const res = await employeeResumesApi.list();
        setResumes(res.data.items || []);
      } catch (error) {
        console.error('Failed to load resumes:', error);
      } finally {
        setLoading(false);
      }
    };
    loadResumes();
  }, []);

  const getStatusBadge = (status: number) => {
    switch (status) {
      case 0: return <Badge variant="secondary">待处理</Badge>;
      case 2: return <Badge variant="default">评估完成</Badge>;
      case 3: return <Badge variant="destructive">处理失败</Badge>;
      default: return <Badge>未知</Badge>;
    }
  };

  return (
    <PageLayout title="简历库" subtitle="管理所有简历" action={<EmployeeNav />}>
      {loading ? (
        <div className="animate-pulse space-y-4">
          <div className="h-20 bg-muted rounded-xl" />
          <div className="h-20 bg-muted rounded-xl" />
        </div>
      ) : resumes.length === 0 ? (
        <Card>
          <CardContent className="py-12 text-center">
            <p className="text-muted-foreground">暂无简历</p>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-4">
          {resumes.map((resume) => (
            <Card key={resume.id}>
              <CardContent className="flex justify-between items-center py-4">
                <div>
                  <button
                    onClick={() => setPreviewResume({ id: resume.id, fileName: resume.file_name })}
                    className="font-medium hover:underline text-left"
                  >
                    {resume.file_name}
                  </button>
                  <div className="flex items-center gap-3 mt-1">
                    {getStatusBadge(resume.status)}
                    <span className="text-sm text-muted-foreground">
                      {resume.create_time?.split('T')[0]}
                    </span>
                  </div>
                </div>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setPreviewResume({ id: resume.id, fileName: resume.file_name })}
                >
                  预览
                </Button>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {previewResume && (
        <ResumePreviewDialog
          resumeId={previewResume.id}
          fileName={previewResume.fileName}
          open={!!previewResume}
          onClose={() => setPreviewResume(null)}
        />
      )}
    </PageLayout>
  );
}
