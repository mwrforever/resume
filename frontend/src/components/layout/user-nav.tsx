import { Link, useLocation } from 'react-router-dom';
import { cn } from '@/lib/utils';
import { useAuthStore } from '@/store/auth';

const navItems = [
  { href: '/user/jobs', label: '岗位' },
  { href: '/user/my-resumes', label: '个人信息' },
  { href: '/user/my-applications', label: '我的投递' },
];

export function UserNav() {
  const location = useLocation();
  const { logout } = useAuthStore();

  return (
    <nav className="flex items-center gap-6">
      {navItems.map((item) => (
        <Link
          key={item.href}
          to={item.href}
          className={cn(
            'text-sm font-medium transition-colors hover:text-primary',
            location.pathname.startsWith(item.href)
              ? 'text-foreground'
              : 'text-muted-foreground'
          )}
        >
          {item.label}
        </Link>
      ))}
      <button
        onClick={logout}
        className="text-sm font-medium text-muted-foreground hover:text-destructive"
      >
        退出
      </button>
    </nav>
  );
}
