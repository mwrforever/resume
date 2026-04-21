import { useEffect, useState } from 'react';
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
      // API returns {code, message, data: {id, file_name, file_path}}
      const newResume: Resume = {
        id: res.data?.id ?? res.id,
        file_name: res.data?.file_name ?? res.file_name,
        file_path: res.data?.file_path ?? res.file_path ?? '',
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
      <DialogContent className="max-w-md">
        <DialogTitle>选择简历</DialogTitle>

        {loading ? (
          <div className="flex justify-center py-8">
            <div className="w-6 h-6 border-2 border-primary border-t-transparent rounded-full animate-spin" />
          </div>
        ) : (
          <>
            <div className="max-h-80 overflow-y-auto mb-4">
              {resumes.length === 0 ? (
                <p className="text-sm text-muted-foreground text-center py-4">暂无可用简历</p>
              ) : (
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b">
                      <th className="text-left py-2 px-2 font-medium text-muted-foreground w-8"></th>
                      <th className="text-left py-2 px-2 font-medium text-muted-foreground">文件名</th>
                      <th className="text-left py-2 px-2 font-medium text-muted-foreground">上传时间</th>
                    </tr>
                  </thead>
                  <tbody>
                    {resumes.map((resume) => (
                      <tr
                        key={resume.id}
                        onClick={() => setSelectedId(resume.id)}
                        className={`border-b cursor-pointer transition-colors ${
                          selectedId === resume.id ? 'bg-primary/5' : 'hover:bg-muted/50'
                        }`}
                      >
                        <td className="py-2 px-2">
                          <div className={`w-4 h-4 rounded border flex items-center justify-center ${
                            selectedId === resume.id ? 'border-primary bg-primary' : 'border-border'
                          }`}>
                            {selectedId === resume.id && (
                              <svg className="w-2.5 h-2.5 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" />
                              </svg>
                            )}
                          </div>
                        </td>
                        <td className="py-2 px-2 font-medium truncate max-w-[180px]">{resume.file_name}</td>
                        <td className="py-2 px-2 text-muted-foreground">
                          {resume.create_time ? new Date(resume.create_time).toLocaleDateString() : '-'}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>

            <div className="border-t pt-4 space-y-3">
              <label className="flex items-center justify-center w-full p-3 border-2 border-dashed border-border rounded-lg cursor-pointer hover:border-primary/50 transition-colors">
                <div className="flex items-center gap-2">
                  {uploading ? (
                    <div className="w-5 h-5 border-2 border-primary border-t-transparent rounded-full animate-spin" />
                  ) : (
                    <svg className="w-5 h-5 text-muted-foreground" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12" />
                    </svg>
                  )}
                  <span className="text-sm text-muted-foreground">
                    {uploading ? '上传中...' : '上传新简历'}
                  </span>
                </div>
                <input
                  type="file"
                  className="hidden"
                  accept=".pdf,.doc,.docx"
                  onChange={handleFileChange}
                  disabled={uploading}
                />
              </label>

              <Button
                className="w-full"
                disabled={!selectedId}
                onClick={handleConfirm}
              >
                确认
              </Button>
            </div>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}