import { Link, useLocation } from 'react-router-dom';
import { Briefcase, FileText, LogOut, Send } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useAuthStore } from '@/store/auth';

const navItems = [
  { href: '/user/jobs', label: '岗位', icon: Briefcase },
  { href: '/user/my-resumes', label: '简历', icon: FileText },
  { href: '/user/my-applications', label: '投递', icon: Send },
];

export function UserNav() {
  const location = useLocation();
  const { logout } = useAuthStore();

  return (
    <nav className="flex flex-wrap items-center gap-2" aria-label="用户导航">
      {navItems.map((item) => (
        <Link
          key={item.href}
          to={item.href}
          className={cn(
            'inline-flex items-center gap-2 rounded-full border border-transparent px-3 py-2 text-sm font-semibold text-slate-600 hover:border-sky-100 hover:bg-sky-50 hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
            location.pathname.startsWith(item.href)
              ? 'border-primary/20 bg-primary text-primary-foreground shadow-sm shadow-sky-900/10 hover:bg-primary hover:text-primary-foreground'
              : ''
          )}
        >
          <item.icon className="h-4 w-4" aria-hidden="true" />
          {item.label}
        </Link>
      ))}
      <button
        type="button"
        onClick={logout}
        className="inline-flex items-center gap-2 rounded-full px-3 py-2 text-sm font-semibold text-slate-500 hover:bg-red-50 hover:text-destructive focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        <LogOut className="h-4 w-4" aria-hidden="true" />
        退出
      </button>
    </nav>
  );
}
