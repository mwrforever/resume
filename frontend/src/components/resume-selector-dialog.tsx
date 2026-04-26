import { useEffect, useState } from 'react';
import { CheckCircle2, FileText, Upload } from 'lucide-react';
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { userResumesApi } from '@/api/user/resumes';

interface Resume {
  id: number;
  file_name: string;
  file_path: string;
  create_time?: string;
}

interface ResumeSelectorDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSelect: (resume: Resume) => void;
}

export function ResumeSelectorDialog({ open, onOpenChange, onSelect }: ResumeSelectorDialogProps) {
  const [resumes, setResumes] = useState<Resume[]>([]);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [selectedId, setSelectedId] = useState<number | null>(null);

  useEffect(() => {
    if (open) {
      loadResumes();
    }
  }, [open]);

  const loadResumes = async () => {
    setLoading(true);
    try {
      const res = await userResumesApi.list();
      setResumes(res.data.items || []);
    } catch (error) {
      console.error('Failed to load resumes:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setUploading(true);
    try {
      const res = await userResumesApi.upload(file);
      const payload = res as unknown as { data?: Partial<Resume> } & Partial<Resume>;
      const resumeData = payload.data ?? payload;
      // API returns {code, message, data: {id, file_name, file_path}}
      const newResume: Resume = {
        id: resumeData.id ?? 0,
        file_name: resumeData.file_name ?? file.name,
        file_path: resumeData.file_path ?? '',
      };
      setResumes(prev => [newResume, ...prev]);
      setSelectedId(newResume.id);
    } catch (error: any) {
      console.error('Failed to upload resume:', error);
      console.error('Error detail:', error.response?.data);
    } finally {
      setUploading(false);
    }
  };

  const handleConfirm = () => {
    if (!selectedId) return;
    const resume = resumes.find(r => r.id === selectedId);
    if (resume) {
      onSelect(resume);
      onOpenChange(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-xl">
        <DialogTitle className="mb-1">选择简历</DialogTitle>
        <p className="mb-5 text-sm text-muted-foreground">选择一份已上传简历，或上传新简历后继续投递。</p>

        {loading ? (
          <div className="flex justify-center py-12" aria-label="正在加载简历列表">
            <div className="h-6 w-6 animate-spin rounded-full border-2 border-primary border-t-transparent" />
          </div>
        ) : (
          <>
            <div className="mb-4 max-h-80 space-y-3 overflow-y-auto pr-1">
              {resumes.length === 0 ? (
                <div className="rounded-2xl border border-dashed border-border bg-muted/40 px-4 py-8 text-center">
                  <FileText className="mx-auto h-8 w-8 text-accent" aria-hidden="true" />
                  <p className="mt-3 text-sm font-medium text-foreground">暂无可用简历</p>
                  <p className="mt-1 text-xs text-muted-foreground">请先上传 PDF 或 DOCX 文件。</p>
                </div>
              ) : (
                resumes.map((resume) => {
                  const selected = selectedId === resume.id;

                  return (
                    <label
                      key={resume.id}
                      className={`flex cursor-pointer items-center gap-3 rounded-2xl border p-4 transition-[border-color,box-shadow,background-color] focus-within:ring-2 focus-within:ring-ring ${
                        selected ? 'border-accent bg-accent/5 shadow-sm' : 'border-border bg-white hover:border-accent/50 hover:bg-muted/30'
                      }`}
                    >
                      <input
                        type="radio"
                        name="resume-selector"
                        value={resume.id}
                        checked={selected}
                        onChange={() => setSelectedId(resume.id)}
                        className="sr-only"
                      />
                      <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-accent/10 text-accent" aria-hidden="true">
                        <FileText className="h-5 w-5" />
                      </div>
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-semibold text-foreground">{resume.file_name}</p>
                        <p className="mt-1 text-xs text-muted-foreground">
                          上传时间：{resume.create_time ? new Intl.DateTimeFormat('zh-CN').format(new Date(resume.create_time)) : '-'}
                        </p>
                      </div>
                      {selected ? <CheckCircle2 className="h-5 w-5 shrink-0 text-accent" aria-hidden="true" /> : null}
                    </label>
                  );
                })
              )}
            </div>

            <div className="space-y-3 border-t pt-4">
              <label className="flex w-full cursor-pointer items-center justify-center rounded-2xl border-2 border-dashed border-border p-3 transition-colors hover:border-accent/60 focus-within:ring-2 focus-within:ring-ring">
                <div className="flex items-center gap-2">
                  {uploading ? (
                    <div className="h-5 w-5 animate-spin rounded-full border-2 border-primary border-t-transparent" />
                  ) : (
                    <Upload className="h-5 w-5 text-muted-foreground" aria-hidden="true" />
                  )}
                  <span className="text-sm text-muted-foreground">
                    {uploading ? '上传中…' : '上传新简历'}
                  </span>
                </div>
                <input
                  type="file"
                  className="sr-only"
                  accept=".pdf,.docx"
                  onChange={handleFileChange}
                  disabled={uploading}
                />
              </label>

              <Button
                className="w-full"
                disabled={!selectedId}
                onClick={handleConfirm}
              >
                确认选择
              </Button>
            </div>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}