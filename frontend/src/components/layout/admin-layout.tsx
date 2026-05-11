import { ReactNode } from 'react';
import { Sidebar } from './sidebar';
import { AdminHeader, BreadcrumbItem } from './admin-header';

interface AdminLayoutProps {
  children: ReactNode;
  breadcrumbs?: BreadcrumbItem[];
  title?: string;
  headerAction?: ReactNode;
}

export function AdminLayout({ children, breadcrumbs = [], title, headerAction }: AdminLayoutProps) {
  return (
    <div className="flex h-screen overflow-hidden bg-slate-950">
      <Sidebar />
      <div className="flex-1 flex flex-col overflow-hidden min-w-0">
        <AdminHeader breadcrumbs={breadcrumbs} />
        <main className="flex-1 overflow-y-auto bg-[radial-gradient(circle_at_top_right,rgba(14,165,233,0.16),transparent_28rem),linear-gradient(180deg,#f8fafc_0%,#f0f9ff_100%)]">
          <div className="p-6 lg:p-8">
            {(title || headerAction) && (
              <div className="mb-6 flex flex-col gap-4 rounded-3xl border border-white/70 bg-white/85 p-5 shadow-sm shadow-slate-200/70 backdrop-blur lg:flex-row lg:items-center lg:justify-between">
                {title && (
                  <div>
                    <p className="text-xs font-semibold uppercase tracking-[0.2em] text-sky-600">Workspace</p>
                    <h1 className="mt-1 text-2xl font-semibold text-slate-900">{title}</h1>
                  </div>
                )}
                {headerAction && <div className="flex items-center gap-3">{headerAction}</div>}
              </div>
            )}
            {children}
          </div>
        </main>
      </div>
    </div>
  );
}
