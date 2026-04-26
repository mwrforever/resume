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
            'inline-flex items-center gap-2 rounded-full px-3 py-2 text-sm font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
            location.pathname.startsWith(item.href)
              ? 'bg-primary text-primary-foreground shadow-sm hover:bg-primary hover:text-primary-foreground'
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
        className="inline-flex items-center gap-2 rounded-full px-3 py-2 text-sm font-medium text-muted-foreground transition-colors hover:bg-red-50 hover:text-destructive focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        <LogOut className="h-4 w-4" aria-hidden="true" />
        退出
      </button>
    </nav>
  );
}
