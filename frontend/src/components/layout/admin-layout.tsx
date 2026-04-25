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
    <div className="flex h-screen overflow-hidden">
      <Sidebar />
      <div className="flex-1 flex flex-col overflow-hidden min-w-0">
        <AdminHeader breadcrumbs={breadcrumbs} />
        <main className="flex-1 overflow-y-auto bg-[#F5F7FA]">
          <div className="p-6">
            {(title || headerAction) && (
              <div className="flex items-center justify-between mb-6">
                {title && (
                  <h1 className="text-xl font-semibold text-[#1E293B]">{title}</h1>
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
