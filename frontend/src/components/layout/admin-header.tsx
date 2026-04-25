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
    <header className="h-14 flex-shrink-0 bg-white border-b border-[#E2E8F0] sticky top-0 z-40 flex items-center px-6 justify-between">
      {/* Breadcrumb */}
      <nav aria-label="面包屑导航">
        <ol className="flex items-center gap-1.5 text-sm">
          {breadcrumbs.map((item, idx) => (
            <li key={idx} className="flex items-center gap-1.5">
              {idx > 0 && (
                <span className="text-[#CBD5E1]" aria-hidden="true">/</span>
              )}
              {item.href && idx < breadcrumbs.length - 1 ? (
                <Link
                  to={item.href}
                  className="text-[#64748B] hover:text-[#1E293B] transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[#2563EB] rounded"
                >
                  {item.label}
                </Link>
              ) : (
                <span
                  className={
                    idx === breadcrumbs.length - 1
                      ? 'text-[#1E293B] font-medium'
                      : 'text-[#64748B]'
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
        <div className="flex items-center gap-1.5 text-sm text-[#475569] px-2">
          <User size={15} aria-hidden="true" />
          <span>{userId || '员工'}</span>
        </div>
        <button
          onClick={logout}
          aria-label="退出登录"
          className="flex items-center gap-1.5 text-sm text-[#64748B] hover:text-red-500 transition-colors px-3 py-1.5 rounded-md hover:bg-red-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-400"
        >
          <LogOut size={15} aria-hidden="true" />
          <span>退出</span>
        </button>
      </div>
    </header>
  );
}
