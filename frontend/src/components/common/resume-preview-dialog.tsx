import { useEffect, useState } from 'react';
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog';
import { employeeResumesApi } from '@/api/employee/resumes';

interface ResumePreviewDialogProps {
  resumeId: number;
  fileName: string;
  open: boolean;
  onClose: () => void;
}

export function ResumePreviewDialog({ resumeId, fileName, open, onClose }: ResumePreviewDialogProps) {
  const [loading, setLoading] = useState(true);
  const [content, setContent] = useState<{ type: string; content: string } | null>(null);

  const fileType = fileName.split('.').pop()?.toLowerCase();

  useEffect(() => {
    if (!open) {
      setContent(null);
      setLoading(true);
      return;
    }

    let blobUrl: string | null = null;

    const loadContent = async () => {
      try {
        const res = await employeeResumesApi.getFile(resumeId);

        if (res.headers?.['content-type']?.includes('application/json') ||
            (typeof res.data === 'object' && (res.data as any).file_type === 'docx')) {
          setContent({ type: 'text', content: (res.data as any).content || '' });
        } else if (fileType === 'pdf') {
          blobUrl = URL.createObjectURL(new Blob([res.data], { type: 'application/pdf' }));
          setContent({ type: 'pdf', content: blobUrl });
        } else if (['png', 'jpg', 'jpeg', 'gif', 'bmp'].includes(fileType || '')) {
          const imageType = res.headers?.['content-type'] || 'image/png';
          blobUrl = URL.createObjectURL(new Blob([res.data], { type: imageType }));
          setContent({ type: 'image', content: blobUrl });
        } else {
          setContent({ type: 'error', content: 'Unsupported file type' });
        }
      } catch (error) {
        console.error('Failed to load preview:', error);
        setContent({ type: 'error', content: 'Failed to load preview' });
      } finally {
        setLoading(false);
      }
    };

    loadContent();

    return () => {
      if (blobUrl) {
        URL.revokeObjectURL(blobUrl);
      }
    };
  }, [open, resumeId, fileType]);

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="max-w-4xl h-[80vh] flex flex-col">
        <DialogTitle>{fileName}</DialogTitle>
        <div className="flex-1 overflow-y-auto">
          {loading ? (
            <div className="text-center py-12 text-muted-foreground">加载中...</div>
          ) : content?.type === 'text' ? (
            <pre className="whitespace-pre-wrap text-sm p-4">{content.content}</pre>
          ) : content?.type === 'pdf' ? (
            <iframe src={content.content} className="w-full h-full min-h-[500px]" />
          ) : content?.type === 'image' ? (
            <img src={content.content} alt={fileName} className="max-w-full mx-auto" />
          ) : (
            <div className="text-center py-12 text-muted-foreground">{content?.content || '无法预览'}</div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}