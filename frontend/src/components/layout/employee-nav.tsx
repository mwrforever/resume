import { Link, useLocation } from 'react-router-dom';
import { cn } from '@/lib/utils';
import { useAuthStore } from '@/store/auth';

const navItems = [
  { href: '/employee/dashboard', label: '概览' },
  { href: '/employee/jobs', label: '岗位管理' },
  { href: '/employee/resumes', label: '简历库' },
  { href: '/employee/evaluations', label: '评估' },
];

export function EmployeeNav() {
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
