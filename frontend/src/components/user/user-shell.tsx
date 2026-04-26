import { ReactNode } from 'react';
import { UserNav } from '@/components/layout/user-nav';
import { cn } from '@/lib/utils';

interface UserShellProps {
  children: ReactNode;
  title: string;
  subtitle?: string;
  eyebrow?: string;
  action?: ReactNode;
  className?: string;
}

export function UserShell({ children, title, subtitle, eyebrow, action, className }: UserShellProps) {
  return (
    <div className="min-h-screen overflow-x-hidden bg-[radial-gradient(circle_at_top_left,rgba(59,130,246,0.12),transparent_32rem),linear-gradient(180deg,#ffffff_0%,var(--background)_18rem)]">
      <a href="#main-content" className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-[60] focus:rounded-md focus:bg-primary focus:px-4 focus:py-2 focus:text-sm focus:text-primary-foreground">
        跳转到主要内容
      </a>
      <header className="sticky top-0 z-50 border-b border-border/70 bg-white/85 backdrop-blur-xl supports-[backdrop-filter]:bg-white/70">
        <div className="mx-auto flex min-h-16 max-w-7xl flex-col gap-3 px-4 py-3 sm:px-6 lg:flex-row lg:items-center lg:justify-between lg:px-8">
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-primary text-sm font-bold text-primary-foreground shadow-sm" aria-hidden="true">
                R
              </div>
              <div className="min-w-0">
                <p className="text-sm font-semibold leading-5 text-foreground">Resume Match</p>
                <p className="text-xs text-muted-foreground">智能招聘投递平台</p>
              </div>
            </div>
          </div>
          <UserNav />
        </div>
      </header>
      <main id="main-content" className="mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-8">
        <section className="mb-8 rounded-3xl border border-white/70 bg-white/80 p-6 shadow-sm shadow-slate-200/70 backdrop-blur md:p-8">
          <div className="flex flex-col gap-5 lg:flex-row lg:items-end lg:justify-between">
            <div className="min-w-0 space-y-3">
              {eyebrow ? (
                <p className="text-sm font-semibold text-accent">{eyebrow}</p>
              ) : null}
              <div className="space-y-2">
                <h1 className="text-3xl font-bold tracking-tight text-pretty text-foreground md:text-4xl">{title}</h1>
                {subtitle ? <p className="max-w-2xl text-sm leading-6 text-muted-foreground md:text-base">{subtitle}</p> : null}
              </div>
            </div>
            {action ? <div className="shrink-0">{action}</div> : null}
          </div>
        </section>
        <div className={cn('pb-10', className)}>{children}</div>
      </main>
    </div>
  );
}
