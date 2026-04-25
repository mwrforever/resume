import { useEffect, useRef, useState } from 'react';
import { Document, Page, pdfjs } from 'react-pdf';
import mammoth from 'mammoth';
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog';
import { useAuthStore } from '@/store/auth';
import 'react-pdf/dist/Page/AnnotationLayer.css';
import 'react-pdf/dist/Page/TextLayer.css';

pdfjs.GlobalWorkerOptions.workerSrc = `//unpkg.com/pdfjs-dist@${pdfjs.version}/build/pdf.worker.min.js`;

interface ResumePreviewDialogProps {
  resumeId: number;
  fileName: string;
  open: boolean;
  onClose: () => void;
}

type PreviewContent =
  | { type: 'pdf'; url: string }
  | { type: 'docx'; blob: Blob }
  | { type: 'image'; url: string }
  | { type: 'error'; message: string };

export function ResumePreviewDialog({ resumeId, fileName, open, onClose }: ResumePreviewDialogProps) {
  const [loading, setLoading] = useState(true);
  const [content, setContent] = useState<PreviewContent | null>(null);
  const [numPages, setNumPages] = useState(0);
  const [pdfWidth, setPdfWidth] = useState(760);
  const docxContainerRef = useRef<HTMLDivElement>(null);
  const pdfContainerRef = useRef<HTMLDivElement>(null);

  const fileExt = fileName.split('.').pop()?.toLowerCase() ?? '';

  useEffect(() => {
    if (!open) {
      setContent(null);
      setLoading(true);
      setNumPages(0);
      return;
    }

    let blobUrl: string | null = null;

    const load = async () => {
      try {
        const token = useAuthStore.getState().accessToken;
        const resp = await fetch(`/api/v1/employee/resumes/${resumeId}/file`, {
          headers: token ? { Authorization: `Bearer ${token}` } : {},
        });
        if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
        const blob = await resp.blob();

        if (fileExt === 'pdf') {
          blobUrl = URL.createObjectURL(blob);
          setContent({ type: 'pdf', url: blobUrl });
        } else if (['docx', 'doc'].includes(fileExt)) {
          setContent({ type: 'docx', blob });
        } else if (['png', 'jpg', 'jpeg', 'gif', 'bmp', 'webp'].includes(fileExt)) {
          blobUrl = URL.createObjectURL(blob);
          setContent({ type: 'image', url: blobUrl });
        } else {
          setContent({ type: 'error', message: '不支持预览此文件类型' });
        }
      } catch (err) {
        console.error('Failed to load preview:', err);
        setContent({ type: 'error', message: '文件加载失败' });
      } finally {
        setLoading(false);
      }
    };

    load();

    return () => { if (blobUrl) URL.revokeObjectURL(blobUrl); };
  }, [open, resumeId, fileExt]);

  useEffect(() => {
    if (content?.type !== 'docx' || !docxContainerRef.current) return;
    const container = docxContainerRef.current;
    container.innerHTML = '';
    content.blob.arrayBuffer()
      .then(buffer => mammoth.convertToHtml({ arrayBuffer: buffer }))
      .then(result => {
        if (result.messages.length) console.warn('mammoth:', result.messages);
        container.innerHTML = result.value;
      })
      .catch(err => {
        console.error('DOCX render failed:', err);
        container.innerHTML = '<p style="color:#94a3b8;text-align:center;padding:2rem">文档渲染失败，请下载后查看</p>';
      });
  }, [content]);

  useEffect(() => {
    if (content?.type === 'pdf' && pdfContainerRef.current) {
      const w = pdfContainerRef.current.clientWidth - 32;
      if (w > 0) setPdfWidth(w);
    }
  }, [content]);

  return (
    <Dialog open={open} onOpenChange={onClose} containerClassName="w-[90vw] max-w-[1792px] mx-auto">
      <DialogContent className="h-[88vh] flex flex-col p-0 overflow-hidden gap-0">
        <div className="px-6 py-4 border-b border-[#E2E8F0] flex-shrink-0">
          <DialogTitle className="text-base font-semibold text-[#1E293B] truncate">{fileName}</DialogTitle>
        </div>

        <div className="flex-1 overflow-y-auto overflow-x-hidden bg-[#F5F7FA]">
          {loading && (
            <div className="flex items-center justify-center h-40 text-[#94A3B8]">加载中…</div>
          )}

          {!loading && content?.type === 'pdf' && (
            <div ref={pdfContainerRef} className="p-4">
              <Document
                file={content.url}
                onLoadSuccess={({ numPages: n }) => setNumPages(n)}
                loading={<div className="text-center py-8 text-[#94A3B8]">解析中…</div>}
                error={<div className="text-center py-8 text-red-500">PDF 加载失败</div>}
              >
                {Array.from({ length: numPages }, (_, i) => (
                  <div key={i + 1} className="mb-3 shadow rounded overflow-hidden">
                    <Page
                      pageNumber={i + 1}
                      width={pdfWidth}
                      renderAnnotationLayer
                      renderTextLayer
                    />
                  </div>
                ))}
              </Document>
            </div>
          )}

          {!loading && content?.type === 'docx' && (
            <div className="bg-white min-h-full p-8">
              <div
                ref={docxContainerRef}
                className="max-w-[860px] mx-auto docx-content"
                style={{ lineHeight: 1.8, fontSize: '14px', wordBreak: 'break-word' }}
              />
            </div>
          )}

          {!loading && content?.type === 'image' && (
            <div className="flex items-center justify-center p-6">
              <img src={content.url} alt={fileName} className="max-w-full rounded shadow" />
            </div>
          )}

          {!loading && content?.type === 'error' && (
            <div className="flex items-center justify-center h-40 text-[#94A3B8]">{content.message}</div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}