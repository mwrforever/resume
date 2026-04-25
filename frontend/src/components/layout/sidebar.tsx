import { useState, useEffect } from 'react';
import { Link, useLocation } from 'react-router-dom';
import {
  LayoutDashboard, Briefcase, FileText,
  Send, ChevronLeft, ChevronRight,
} from 'lucide-react';
import { cn } from '@/lib/utils';

const NAV_ITEMS = [
  { href: '/employee/dashboard', icon: LayoutDashboard, label: '工作台' },
  { href: '/employee/jobs', icon: Briefcase, label: '岗位管理' },
  { href: '/employee/resumes', icon: FileText, label: '简历库' },
  { href: '/employee/applications', icon: Send, label: '投递管理' },
];

export function Sidebar() {
  const location = useLocation();
  const [collapsed, setCollapsed] = useState(() => {
    return localStorage.getItem('sidebar-collapsed') === 'true';
  });

  useEffect(() => {
    localStorage.setItem('sidebar-collapsed', String(collapsed));
  }, [collapsed]);

  return (
    <aside
      style={{ width: collapsed ? 64 : 240 }}
      className="flex-shrink-0 flex flex-col h-full bg-[#1E293B] transition-[width] duration-200 ease-in-out overflow-hidden"
    >
      {/* Logo */}
      <div className="flex items-center h-14 px-4 border-b border-white/10 flex-shrink-0">
        <div className="w-8 h-8 rounded-lg bg-[#2563EB] flex items-center justify-center flex-shrink-0">
          <span className="text-white text-xs font-bold">HR</span>
        </div>
        {!collapsed && (
          <span className="ml-3 text-white font-semibold text-sm truncate">招聘管理系统</span>
        )}
      </div>

      {/* Nav items */}
      <nav className="flex-1 py-3 px-2 space-y-0.5" aria-label="主导航">
        {NAV_ITEMS.map((item) => {
          const Icon = item.icon;
          const isActive = location.pathname.startsWith(item.href);
          return (
            <Link
              key={item.href}
              to={item.href}
              aria-label={collapsed ? item.label : undefined}
              title={collapsed ? item.label : undefined}
              className={cn(
                'flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#2563EB]',
                isActive
                  ? 'bg-[#2563EB] text-white'
                  : 'text-[#94A3B8] hover:bg-white/10 hover:text-white'
              )}
            >
              <Icon size={18} className="flex-shrink-0" aria-hidden="true" />
              {!collapsed && <span className="truncate">{item.label}</span>}
            </Link>
          );
        })}
      </nav>

      {/* Collapse toggle */}
      <div className="flex-shrink-0 p-2 border-t border-white/10">
        <button
          onClick={() => setCollapsed(!collapsed)}
          aria-label={collapsed ? '展开菜单' : '折叠菜单'}
          className="w-full flex items-center justify-center gap-2 py-2 rounded-lg text-[#94A3B8] hover:bg-white/10 hover:text-white transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#2563EB]"
        >
          {collapsed
            ? <ChevronRight size={18} aria-hidden="true" />
            : <><ChevronLeft size={18} aria-hidden="true" /><span className="text-sm">折叠</span></>
          }
        </button>
      </div>
    </aside>
  );
}
