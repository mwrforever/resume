import { useState, useEffect } from 'react';
import { Link, useLocation } from 'react-router-dom';
import {
  LayoutDashboard, Briefcase, FileText,
  Send, ChevronLeft, ChevronRight, Tags, UserRound, Users, ClipboardList, Layers3,
  Building2, Bot, Settings2,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { useAuthStore } from '@/store/auth';

type NavItem = {
  href: string;
  icon: typeof LayoutDashboard;
  label: string;
  /** 仅管理员可见（员工管理/用户管理需要访问控制） */
  adminOnly?: boolean;
};

type NavGroup = { label: string; items: NavItem[] };

const NAV_GROUPS: NavGroup[] = [
  {
    label: '工作台',
    items: [
      { href: '/employee/dashboard', icon: LayoutDashboard, label: '工作台' },
      { href: '/employee/agent', icon: Bot, label: 'Agent 工作台' },
      { href: '/employee/llm-configs', icon: Settings2, label: '模型配置' },
    ],
  },
  {
    label: '招聘业务',
    items: [
      { href: '/employee/jobs', icon: Briefcase, label: '岗位管理' },
      { href: '/employee/applications', icon: Send, label: '投递管理' },
      { href: '/employee/resumes', icon: FileText, label: '简历库' },
      { href: '/employee/evaluations', icon: ClipboardList, label: '评估管理' },
    ],
  },
  {
    label: '评估配置',
    items: [
      { href: '/employee/eval-templates', icon: ClipboardList, label: '模板管理' },
      { href: '/employee/eval-dimensions', icon: Layers3, label: '维度管理' },
      { href: '/employee/tags', icon: Tags, label: '标签管理' },
    ],
  },
  {
    label: '组织账号',
    items: [
      { href: '/employee/dept-management', icon: Building2, label: '部门管理' },
      // 仅管理员可见：访问控制由后端 ensure_admin 兜底，前端仅做菜单隐藏
      { href: '/employee/employee-management', icon: Users, label: '员工管理', adminOnly: true },
      { href: '/employee/user-management', icon: UserRound, label: '用户管理', adminOnly: true },
    ],
  },
];

export function Sidebar() {
  const location = useLocation();
  // 读取管理员标记：非管理员过滤掉 adminOnly 菜单（员工管理/用户管理）
  const isAdmin = useAuthStore((s) => s.isAdmin);
  const [collapsed, setCollapsed] = useState(() => {
    return localStorage.getItem('sidebar-collapsed') === 'true';
  });

  useEffect(() => {
    localStorage.setItem('sidebar-collapsed', String(collapsed));
  }, [collapsed]);

  return (
    <aside
      style={{ width: collapsed ? 64 : 240 }}
      className="flex-shrink-0 flex flex-col h-full overflow-hidden border-r border-white/10 bg-[linear-gradient(180deg,#082f49_0%,#0f172a_56%,#020617_100%)] transition-[width] duration-200 ease-in-out"
    >
      {/* Logo */}
      <div className="flex h-16 flex-shrink-0 items-center border-b border-white/10 px-4">
        <div className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-2xl bg-sky-400 text-xs font-bold text-slate-950 shadow-lg shadow-sky-500/20">
          <span>HR</span>
        </div>
        {!collapsed && (
          <span className="ml-3 truncate text-sm font-semibold text-white">招聘管理系统</span>
        )}
      </div>

      {/* Nav items */}
      <nav className="flex-1 space-y-3 overflow-y-auto px-2 py-4" aria-label="主导航">
        {NAV_GROUPS.map((group) => {
          // 过滤掉非管理员可见的 adminOnly 项；整组被过滤则不渲染该分组
          const items = group.items.filter((it) => !it.adminOnly || isAdmin);
          if (items.length === 0) return null;
          return (
          <div key={group.label} className="space-y-0.5">
            {!collapsed && <div className="px-3 pb-1 pt-2 text-xs font-semibold tracking-wide text-sky-100/60">{group.label}</div>}
            {items.map((item) => {
              const Icon = item.icon;
              const isActive = location.pathname.startsWith(item.href);

              // Agent 工作台 → 新 Tab 打开沉浸式工作台，不挂主后台 AdminLayout
              if (item.href === '/employee/agent') {
                return (
                  <button
                    key={item.href}
                    type="button"
                    onClick={() => window.open('/employee/agent', '_blank', 'noopener')}
                    aria-label={collapsed ? item.label : undefined}
                    title={collapsed ? item.label : undefined}
                    className={cn(
                      'flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-300',
                      'text-slate-300 hover:bg-white/10 hover:text-white'
                    )}
                  >
                    <Icon size={18} className="flex-shrink-0" aria-hidden="true" />
                    {!collapsed && (
                      <>
                        <span className="truncate flex-1 text-left">{item.label}</span>
                        {/* 外链图标：提示新 Tab 打开 */}
                        <svg className="w-3 h-3 text-slate-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                          <path strokeLinecap="round" strokeLinejoin="round" d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
                        </svg>
                      </>
                    )}
                  </button>
                );
              }

              return (
                <Link
                  key={item.href}
                  to={item.href}
                  aria-label={collapsed ? item.label : undefined}
                  title={collapsed ? item.label : undefined}
                  className={cn(
                    'flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-300',
                    isActive
                      ? 'bg-sky-400 text-slate-950 shadow-sm shadow-sky-500/20'
                      : 'text-slate-300 hover:bg-white/10 hover:text-white'
                  )}
                >
                  <Icon size={18} className="flex-shrink-0" aria-hidden="true" />
                  {!collapsed && <span className="truncate">{item.label}</span>}
                </Link>
              );
            })}
          </div>
          );
        })}
      </nav>

      {/* Collapse toggle */}
      <div className="flex-shrink-0 p-2 border-t border-white/10">
        <button
          onClick={() => setCollapsed(!collapsed)}
          aria-label={collapsed ? '展开菜单' : '折叠菜单'}
          className="flex w-full items-center justify-center gap-2 rounded-xl py-2 text-slate-300 hover:bg-white/10 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-300"
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
