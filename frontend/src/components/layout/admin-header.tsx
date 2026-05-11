import { Link } from 'react-router-dom';
import { LogOut, User } from 'lucide-react';
import { useAuthStore } from '@/store/auth';

export interface BreadcrumbItem {
  label: string;
  href?: string;
}

interface AdminHeaderProps {
  breadcrumbs?: BreadcrumbItem[];
}

export function AdminHeader({ breadcrumbs = [] }: AdminHeaderProps) {
  const { userId, logout } = useAuthStore();

  return (
    <header className="sticky top-0 z-40 flex h-16 flex-shrink-0 items-center justify-between border-b border-slate-200/80 bg-white/90 px-6 shadow-sm shadow-slate-200/50 backdrop-blur-xl">
      {/* Breadcrumb */}
      <nav aria-label="面包屑导航">
        <ol className="flex items-center gap-1.5 text-sm">
          {breadcrumbs.map((item, idx) => (
            <li key={idx} className="flex items-center gap-1.5">
              {idx > 0 && (
                <span className="text-slate-300" aria-hidden="true">/</span>
              )}
              {item.href && idx < breadcrumbs.length - 1 ? (
                <Link
                  to={item.href}
                  className="rounded text-slate-500 hover:text-slate-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  {item.label}
                </Link>
              ) : (
                <span
                  className={
                    idx === breadcrumbs.length - 1
                      ? 'text-slate-900 font-semibold'
                      : 'text-slate-500'
                  }
                >
                  {item.label}
                </span>
              )}
            </li>
          ))}
        </ol>
      </nav>

      {/* User area */}
      <div className="flex items-center gap-2">
        <div className="flex items-center gap-2 rounded-full border border-slate-200 bg-slate-50 px-3 py-1.5 text-sm text-slate-600">
          <User size={15} aria-hidden="true" />
          <span>{userId || '员工'}</span>
        </div>
        <button
          onClick={logout}
          aria-label="退出登录"
          className="flex items-center gap-1.5 rounded-full px-3 py-1.5 text-sm text-slate-500 hover:bg-red-50 hover:text-red-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-400"
        >
          <LogOut size={15} aria-hidden="true" />
          <span>退出</span>
        </button>
      </div>
    </header>
  );
}
