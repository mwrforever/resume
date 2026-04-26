import { ReactNode } from 'react';
import { FileText, Search, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

interface EmptyStateProps {
  title: string;
  description: string;
  icon?: ReactNode;
  action?: ReactNode;
}

interface ResumePreviewModalProps {
  open: boolean;
  url: string | null;
  onClose: () => void;
}

interface SectionCardProps {
  children: ReactNode;
  title?: string;
  description?: string;
  action?: ReactNode;
  className?: string;
}

export function EmptyState({ title, description, icon, action }: EmptyStateProps) {
  return (
    <div className="flex min-h-[18rem] flex-col items-center justify-center rounded-3xl border border-dashed border-border bg-white/70 px-6 py-12 text-center shadow-sm">
      <div className="mb-5 flex h-16 w-16 items-center justify-center rounded-2xl bg-accent/10 text-accent" aria-hidden="true">
        {icon ?? <Search className="h-8 w-8" />}
      </div>
      <h2 className="text-xl font-semibold text-foreground">{title}</h2>
      <p className="mt-2 max-w-md text-sm leading-6 text-muted-foreground">{description}</p>
      {action ? <div className="mt-6">{action}</div> : null}
    </div>
  );
}

export function SectionCard({ children, title, description, action, className }: SectionCardProps) {
  return (
    <section className={cn('rounded-3xl border border-border/80 bg-white shadow-sm shadow-slate-200/60', className)}>
      {(title || description || action) ? (
        <div className="flex flex-col gap-3 border-b border-border/70 px-6 py-5 sm:flex-row sm:items-center sm:justify-between">
          <div className="min-w-0">
            {title ? <h2 className="text-lg font-semibold text-foreground">{title}</h2> : null}
            {description ? <p className="mt-1 text-sm text-muted-foreground">{description}</p> : null}
          </div>
          {action ? <div className="shrink-0">{action}</div> : null}
        </div>
      ) : null}
      <div className="p-6">{children}</div>
    </section>
  );
}

export function SkillPill({ children, tone = 'default' }: { children: ReactNode; tone?: 'default' | 'accent' | 'success' }) {
  return (
    <span
      className={cn(
        'inline-flex max-w-full items-center rounded-full border px-3 py-1 text-xs font-medium',
        tone === 'accent' && 'border-accent/20 bg-accent/10 text-accent',
        tone === 'success' && 'border-emerald-200 bg-emerald-50 text-emerald-700',
        tone === 'default' && 'border-border bg-muted/70 text-muted-foreground'
      )}
    >
      <span className="truncate">{children}</span>
    </span>
  );
}

export function StatusPill({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <span className={cn('inline-flex items-center rounded-full px-2.5 py-1 text-xs font-semibold tabular-nums', className)}>
      {children}
    </span>
  );
}

export function ResumePreviewModal({ open, url, onClose }: ResumePreviewModalProps) {
  if (!open || !url) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/80 p-3 backdrop-blur-sm sm:p-6" role="dialog" aria-modal="true" aria-labelledby="resume-preview-title">
      <div className="flex h-[90vh] w-full max-w-5xl flex-col overflow-hidden rounded-3xl bg-white shadow-2xl">
        <div className="flex items-center justify-between border-b border-border px-5 py-4">
          <div className="flex min-w-0 items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-accent/10 text-accent" aria-hidden="true">
              <FileText className="h-5 w-5" />
            </div>
            <div className="min-w-0">
              <h2 id="resume-preview-title" className="font-semibold text-foreground">简历预览</h2>
              <p className="text-xs text-muted-foreground">查看当前选择的附件简历</p>
            </div>
          </div>
          <Button variant="ghost" size="sm" onClick={onClose} aria-label="关闭简历预览">
            <X className="h-4 w-4" aria-hidden="true" />
          </Button>
        </div>
        <iframe src={url} className="min-h-0 flex-1 bg-muted" title="简历预览" />
      </div>
    </div>
  );
}

export function PageSkeleton({ rows = 3 }: { rows?: number }) {
  return (
    <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3" aria-label="正在加载">
      {Array.from({ length: rows }).map((_, index) => (
        <div key={index} className="h-48 animate-pulse rounded-3xl bg-white/80 shadow-sm" />
      ))}
    </div>
  );
}
