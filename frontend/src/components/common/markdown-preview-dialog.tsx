import { useEffect, useState } from 'react';
import ReactMarkdown from 'react-markdown';
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { X } from 'lucide-react';

interface MarkdownPreviewDialogProps {
  open: boolean;
  title?: string;
  content: string;
  editable?: boolean;
  onClose: () => void;
  onSave?: (content: string) => void;
}

export function MarkdownPreviewDialog({ open, title = 'Markdown 预览', content, editable = false, onClose, onSave }: MarkdownPreviewDialogProps) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(content);

  useEffect(() => {
    if (open) {
      setDraft(content);
      setEditing(false);
    }
  }, [content, open]);

  const handleSave = () => {
    onSave?.(draft);
    setEditing(false);
  };

  return (
    <Dialog open={open} onOpenChange={onClose} containerClassName="w-[90vw] max-w-4xl overflow-hidden">
      <DialogContent className="flex max-h-[88vh] flex-col overflow-hidden p-0">
        <div className="flex items-center justify-between border-b border-[#E2E8F0] px-6 py-4">
          <div className="flex items-center gap-3">
            <DialogTitle className="mb-0 text-base font-semibold text-[#1E293B]">{title}</DialogTitle>
            {editable && (
              <Button type="button" variant="outline" size="sm" onClick={() => setEditing(value => !value)}>
                {editing ? '只读预览' : '编辑'}
              </Button>
            )}
          </div>
          <div className="flex items-center gap-2">
            {editable && editing && <Button type="button" size="sm" onClick={handleSave}>应用</Button>}
            <button type="button" onClick={onClose} aria-label="关闭" className="text-[#94A3B8] hover:text-[#1E293B] focus-visible:outline-none">
              <X size={18} />
            </button>
          </div>
        </div>
        <div className="flex-1 overflow-y-auto bg-[#F8FAFC] p-6">
          {editing ? (
            <Textarea value={draft} onChange={event => setDraft(event.target.value)} className="min-h-[75vh] resize-none bg-white font-mono text-sm" />
          ) : draft.trim() ? (
            <div className="mx-auto max-w-3xl rounded-lg border border-[#E2E8F0] bg-white p-6 text-sm leading-7 text-[#334155] shadow-sm">
              <ReactMarkdown
                components={{
                  h1: ({ children }) => <h1 className="mb-4 border-b border-[#E2E8F0] pb-2 text-xl font-semibold text-[#0F172A]">{children}</h1>,
                  h2: ({ children }) => <h2 className="mb-3 mt-5 text-lg font-semibold text-[#1E293B]">{children}</h2>,
                  h3: ({ children }) => <h3 className="mb-2 mt-4 text-base font-semibold text-[#1E293B]">{children}</h3>,
                  p: ({ children }) => <p className="mb-3 whitespace-pre-wrap">{children}</p>,
                  ul: ({ children }) => <ul className="mb-3 list-disc space-y-1 pl-5">{children}</ul>,
                  ol: ({ children }) => <ol className="mb-3 list-decimal space-y-1 pl-5">{children}</ol>,
                  li: ({ children }) => <li>{children}</li>,
                  code: ({ children }) => <code className="rounded bg-[#F1F5F9] px-1 py-0.5 font-mono text-xs text-[#0F172A]">{children}</code>,
                  pre: ({ children }) => <pre className="mb-3 overflow-auto rounded-md bg-[#0F172A] p-3 text-xs leading-6 text-white">{children}</pre>,
                  blockquote: ({ children }) => <blockquote className="mb-3 border-l-4 border-[#CBD5E1] pl-3 text-[#64748B]">{children}</blockquote>,
                }}
              >
                {draft}
              </ReactMarkdown>
            </div>
          ) : (
            <div className="flex h-40 items-center justify-center rounded-lg border border-dashed border-[#CBD5E1] bg-white text-sm text-[#94A3B8]">
              暂无可预览的 Markdown 内容
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
