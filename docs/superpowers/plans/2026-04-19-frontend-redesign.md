# Frontend Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development

**Goal:** Redesign the resume platform frontend with a professional, distinctive aesthetic. Replace generic "AI slop" design with a refined, memorable visual identity.

**Architecture:** A comprehensive frontend redesign following a design system approach:
1. Establish cohesive design tokens (colors, typography, spacing)
2. Build reusable layout components (page layouts, navigation)
3. Improve all page components with polished UI
4. Add subtle motion for polish

**Tech Stack:** React 18, Tailwind CSS 3.4, React Router, Zustand, Recharts

---

## Task 1: Design System Foundation

**Files:**
- Modify: `frontend/src/index.css`
- Create: `frontend/src/components/layout/page-layout.tsx`
- Create: `frontend/src/components/layout/user-nav.tsx`
- Create: `frontend/src/components/layout/employee-nav.tsx`

### Step 1: Define design tokens in index.css

Replace current CSS with design system:

```css
@import url('https://fonts.googleapis.com/css2?family=Outfit:wght@300;400;500;600;700&family=Plus+Jakarta+Sans:wght@400;500;600;700&display=swap');

@tailwind base;
@tailwind components;
@tailwind utilities;

:root {
  /* Color Palette - Professional Blue & Slate */
  --background: #f8fafc;
  --foreground: #0f172a;
  --card: #ffffff;
  --card-foreground: #0f172a;
  --primary: #0f172a;
  --primary-foreground: #ffffff;
  --secondary: #f1f5f9;
  --secondary-foreground: #475569;
  --accent: #3b82f6;
  --accent-foreground: #ffffff;
  --muted: #f1f5f9;
  --muted-foreground: #64748b;
  --destructive: #ef4444;
  --border: #e2e8f0;
  --ring: #3b82f6;

  /* Typography */
  --font-display: 'Outfit', system-ui, sans-serif;
  --font-body: 'Plus Jakarta Sans', system-ui, sans-serif;

  /* Spacing & Radius */
  --radius: 0.75rem;
}

@layer base {
  body {
    @apply bg-background text-foreground antialiased;
    font-family: var(--font-body);
  }

  h1, h2, h3, h4, h5, h6 {
    font-family: var(--font-display);
    @apply tracking-tight;
  }
}
```

### Step 2: Create PageLayout component

```tsx
// frontend/src/components/layout/page-layout.tsx
import { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { cn } from '@/lib/utils';

interface PageLayoutProps {
  children: ReactNode;
  title: string;
  subtitle?: string;
  action?: ReactNode;
}

export function PageLayout({ children, title, subtitle, action }: PageLayoutProps) {
  return (
    <div className="min-h-screen bg-background">
      <header className="sticky top-0 z-50 w-full border-b border-border bg-card/80 backdrop-blur">
        <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
          <div className="flex h-16 items-center justify-between">
            <div>
              <h1 className="text-xl font-semibold">{title}</h1>
              {subtitle && <p className="text-sm text-muted-foreground">{subtitle}</p>}
            </div>
            {action}
          </div>
        </div>
      </header>
      <main className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8 py-8">
        {children}
      </main>
    </div>
  );
}
```

### Step 3: Create UserNav component

```tsx
// frontend/src/components/layout/user-nav.tsx
import { Link, useLocation } from 'react-router-dom';
import { cn } from '@/lib/utils';
import { useAuthStore } from '@/store/auth';

const navItems = [
  { href: '/user/jobs', label: '岗位' },
  { href: '/user/my-resumes', label: '我的简历' },
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
```

### Step 4: Create EmployeeNav component

```tsx
// frontend/src/components/layout/employee-nav.tsx
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
```

### Step 5: Update index.css

Run: `npx tailwindcss -i ./src/index.css -o ./src/index.css --watch` (or rebuild)

---

## Task 2: User Login Page Redesign

**Files:**
- Modify: `frontend/src/pages/user/login.tsx`

### Step 1: Rewrite login page with new design

```tsx
// frontend/src/pages/user/login.tsx
import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent } from '@/components/ui/card';
import { userAuthApi } from '@/api/user/auth';
import { useAuthStore } from '@/store/auth';

export default function UserLogin() {
  const navigate = useNavigate();
  const { setTokens, setUserInfo } = useAuthStore();
  const [loginType, setLoginType] = useState<'password' | 'code'>('password');
  const [identifier, setIdentifier] = useState('');
  const [password, setPassword] = useState('');
  const [code, setCode] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError('');
    try {
      const res = await userAuthApi.login({
        identifier,
        login_type: loginType,
        password: loginType === 'password' ? password : undefined,
        code: loginType === 'code' ? code : undefined,
      });
      setTokens(res.data.access_token, res.data.refresh_token);
      setUserInfo('user', res.data.user_id);
      navigate('/user/jobs');
    } catch (err) {
      setError('登录失败，请检查账号信息');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex">
      {/* Left - Branding */}
      <div className="hidden lg:flex lg:w-1/2 bg-primary text-primary-foreground p-12 flex-col justify-between">
        <div>
          <h1 className="text-4xl font-bold tracking-tight">简历筛选平台</h1>
          <p className="mt-4 text-lg text-primary-foreground/80">智能匹配，精准评估</p>
        </div>
        <div className="space-y-4">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-full bg-primary-foreground/10 flex items-center justify-center">
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
            </div>
            <span className="text-primary-foreground/90">AI智能评估，精准匹配</span>
          </div>
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-full bg-primary-foreground/10 flex items-center justify-center">
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
              </svg>
            </div>
            <span className="text-primary-foreground/90">高效处理，省时省力</span>
          </div>
        </div>
      </div>

      {/* Right - Form */}
      <div className="flex-1 flex items-center justify-center p-8">
        <div className="w-full max-w-md space-y-8">
          <div className="text-center lg:text-left">
            <h2 className="text-2xl font-bold tracking-tight">用户登录</h2>
            <p className="mt-2 text-sm text-muted-foreground">
              还没有账号？{' '}
              <Link to="/user/register" className="font-medium text-accent hover:underline">
                立即注册
              </Link>
            </p>
          </div>

          <Card>
            <CardContent className="pt-6">
              <form onSubmit={handleSubmit} className="space-y-6">
                {/* Login Type Toggle */}
                <div className="grid grid-cols-2 gap-2 p-1 bg-secondary rounded-lg">
                  {(['password', 'code'] as const).map((type) => (
                    <button
                      key={type}
                      type="button"
                      onClick={() => setLoginType(type)}
                      className={`py-2 text-sm font-medium rounded-md transition-all ${
                        loginType === type
                          ? 'bg-card shadow-sm text-foreground'
                          : 'text-muted-foreground hover:text-foreground'
                      }`}
                    >
                      {type === 'password' ? '密码登录' : '验证码登录'}
                    </button>
                  ))}
                </div>

                <div className="space-y-2">
                  <Label htmlFor="identifier">邮箱</Label>
                  <Input
                    id="identifier"
                    type="email"
                    value={identifier}
                    onChange={(e) => setIdentifier(e.target.value)}
                    placeholder="your@email.com"
                    required
                    className="h-11"
                  />
                </div>

                {loginType === 'password' ? (
                  <div className="space-y-2">
                    <Label htmlFor="password">密码</Label>
                    <Input
                      id="password"
                      type="password"
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      placeholder="请输入密码"
                      required
                      className="h-11"
                    />
                  </div>
                ) : (
                  <div className="space-y-2">
                    <Label htmlFor="code">验证码</Label>
                    <div className="flex gap-2">
                      <Input
                        id="code"
                        value={code}
                        onChange={(e) => setCode(e.target.value)}
                        placeholder="请输入验证码"
                        required
                        className="h-11 flex-1"
                      />
                      <Button type="button" variant="outline" className="h-11">
                        获取验证码
                      </Button>
                    </div>
                  </div>
                )}

                {error && (
                  <p className="text-sm text-destructive">{error}</p>
                )}

                <Button type="submit" className="w-full h-11" disabled={loading}>
                  {loading ? '登录中...' : '登录'}
                </Button>
              </form>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
```

---

## Task 3: User Jobs List Page Redesign

**Files:**
- Modify: `frontend/src/pages/user/jobs.tsx`

### Step 1: Rewrite with bento grid layout

```tsx
// frontend/src/pages/user/jobs.tsx
import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { PageLayout } from '@/components/layout/page-layout';
import { UserNav } from '@/components/layout/user-nav';
import { userJobsApi } from '@/api/user/jobs';
import { Button } from '@/components/ui/button';

interface Job {
  id: number;
  name: string;
  description: string;
  status: number;
  create_time: string;
}

export default function UserJobs() {
  const [jobs, setJobs] = useState<Job[]>([]);
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(1);

  const loadJobs = async (pageNum: number = 1) => {
    setLoading(true);
    try {
      const res = await userJobsApi.list({ page: pageNum, page_size: 12 });
      setJobs(res.data.items || []);
    } catch (error) {
      console.error('Failed to load jobs:', error);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadJobs(page);
  }, [page]);

  return (
    <PageLayout
      title="招聘岗位"
      subtitle="发现适合你的机会"
      action={<UserNav />}
    >
      {loading ? (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {[1, 2, 3, 4, 5, 6].map((i) => (
            <div key={i} className="h-48 bg-muted animate-pulse rounded-xl" />
          ))}
        </div>
      ) : jobs.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-24 text-center">
          <div className="w-16 h-16 bg-muted rounded-full flex items-center justify-center mb-4">
            <svg className="w-8 h-8 text-muted-foreground" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M21 13.255A23.931 23.931 0 0112 15c-3.183 0-6.22-.62-9-1.745M16 6V4a2 2 0 00-2-2h-4a2 2 0 00-2 2v2m4 6h.01M5 20h14a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
            </svg>
          </div>
          <h3 className="text-lg font-medium mb-2">暂无岗位</h3>
          <p className="text-muted-foreground">暂时没有在招的岗位，请稍后再来</p>
        </div>
      ) : (
        <>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {jobs.map((job, index) => (
              <Link
                key={job.id}
                to={`/user/jobs/${job.id}`}
                className="group block"
                style={{ animationDelay: `${index * 50}ms` }}
              >
                <div className="bg-card rounded-xl border border-border p-6 transition-all duration-200 hover:border-accent hover:shadow-lg hover:shadow-accent/5">
                  <div className="flex items-start justify-between mb-4">
                    <div className="space-y-1">
                      <h3 className="font-semibold text-lg group-hover:text-accent transition-colors">
                        {job.name}
                      </h3>
                      <p className="text-sm text-muted-foreground">
                        发布时间 {job.create_time?.split('T')[0]}
                      </p>
                    </div>
                    <span className="inline-flex items-center rounded-full bg-accent/10 px-2.5 py-0.5 text-xs font-medium text-accent">
                      招聘中
                    </span>
                  </div>
                  <p className="text-sm text-muted-foreground line-clamp-3 mb-4">
                    {job.description || '暂无岗位描述'}
                  </p>
                  <div className="flex items-center text-sm text-accent font-medium">
                    查看详情
                    <svg className="w-4 h-4 ml-1 group-hover:translate-x-1 transition-transform" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                    </svg>
                  </div>
                </div>
              </Link>
            ))}
          </div>

          {jobs.length > 0 && (
            <div className="flex items-center justify-center gap-4 mt-8">
              <Button
                variant="outline"
                onClick={() => setPage(p => Math.max(1, p - 1))}
                disabled={page === 1}
              >
                上一页
              </Button>
              <span className="text-sm text-muted-foreground">
                第 {page} 页
              </span>
              <Button
                variant="outline"
                onClick={() => setPage(p => p + 1)}
                disabled={jobs.length < 12}
              >
                下一页
              </Button>
            </div>
          )}
        </>
      )}
    </PageLayout>
  );
}
```

---

## Task 4: User Job Detail Page Redesign

**Files:**
- Modify: `frontend/src/pages/user/job-detail.tsx`

### Step 1: Rewrite with polished layout

```tsx
// frontend/src/pages/user/job-detail.tsx
import { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { PageLayout } from '@/components/layout/page-layout';
import { UserNav } from '@/components/layout/user-nav';
import { userJobsApi } from '@/api/user/jobs';
import { userResumesApi } from '@/api/user/resumes';
import { userApplicationsApi } from '@/api/user/applications';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';

interface Job {
  id: number;
  name: string;
  description: string;
}

interface Resume {
  id: number;
  file_name: string;
}

export default function UserJobDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [job, setJob] = useState<Job | null>(null);
  const [resumes, setResumes] = useState<Resume[]>([]);
  const [selectedResume, setSelectedResume] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [applying, setApplying] = useState(false);

  useEffect(() => {
    const loadData = async () => {
      try {
        const jobRes = await userJobsApi.get(Number(id));
        setJob(jobRes.data);
        const resumeRes = await userResumesApi.list();
        setResumes(resumeRes.data.items || []);
      } catch (error) {
        console.error('Failed to load data:', error);
      } finally {
        setLoading(false);
      }
    };
    loadData();
  }, [id]);

  const handleApply = async () => {
    if (!selectedResume) return;
    setApplying(true);
    try {
      await userApplicationsApi.apply({
        job_id: Number(id),
        resume_id: selectedResume
      });
      navigate('/user/my-applications');
    } catch (error) {
      console.error('Failed to apply:', error);
    } finally {
      setApplying(false);
    }
  };

  if (loading) {
    return (
      <PageLayout title="加载中..." action={<UserNav />}>
        <div className="animate-pulse space-y-6">
          <div className="h-8 w-64 bg-muted rounded" />
          <div className="h-32 bg-muted rounded-xl" />
          <div className="h-48 bg-muted rounded-xl" />
        </div>
      </PageLayout>
    );
  }

  if (!job) {
    return (
      <PageLayout title="岗位不存在" action={<UserNav />}>
        <div className="text-center py-24">
          <p className="text-muted-foreground">该岗位已下架或不存在</p>
        </div>
      </PageLayout>
    );
  }

  return (
    <PageLayout
      title={job.name}
      subtitle="岗位详情"
      action={<UserNav />}
    >
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
        <div className="lg:col-span-2 space-y-6">
          <Card>
            <CardContent className="pt-6">
              <h2 className="text-lg font-semibold mb-4">岗位描述</h2>
              <p className="text-muted-foreground whitespace-pre-wrap">
                {job.description || '暂无详细描述'}
              </p>
            </CardContent>
          </Card>
        </div>

        <div className="space-y-6">
          <Card>
            <CardContent className="pt-6">
              <h2 className="text-lg font-semibold mb-4">投递简历</h2>
              {resumes.length === 0 ? (
                <div className="text-center py-6">
                  <p className="text-sm text-muted-foreground mb-4">您还没有上传过简历</p>
                  <Button variant="outline" onClick={() => navigate('/user/my-resumes')}>
                    去上传
                  </Button>
                </div>
              ) : (
                <div className="space-y-3">
                  <p className="text-sm text-muted-foreground">选择要投递的简历：</p>
                  <div className="space-y-2">
                    {resumes.map((resume) => (
                      <button
                        key={resume.id}
                        onClick={() => setSelectedResume(resume.id)}
                        className={`w-full text-left p-3 rounded-lg border transition-all ${
                          selectedResume === resume.id
                            ? 'border-accent bg-accent/5'
                            : 'border-border hover:border-accent/50'
                        }`}
                      >
                        <p className="text-sm font-medium truncate">{resume.file_name}</p>
                      </button>
                    ))}
                  </div>
                  <Button
                    className="w-full"
                    disabled={!selectedResume || applying}
                    onClick={handleApply}
                  >
                    {applying ? '投递中...' : '确认投递'}
                  </Button>
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      </div>
    </PageLayout>
  );
}
```

---

## Task 5: Employee Dashboard Redesign

**Files:**
- Modify: `frontend/src/pages/employee/dashboard.tsx`

### Step 1: Rewrite with stats cards

```tsx
// frontend/src/pages/employee/dashboard.tsx
import { PageLayout } from '@/components/layout/page-layout';
import { EmployeeNav } from '@/components/layout/employee-nav';
import { Card, CardContent } from '@/components/ui/card';

const stats = [
  { label: '在招岗位', value: '12', change: '+2 本月' },
  { label: '简历总数', value: '156', change: '+23 本周' },
  { label: '待评估', value: '8', change: '-3 已完成' },
  { label: '匹配率', value: '76%', change: '+5%' },
];

const recentActivities = [
  { id: 1, text: '张三投递了 前端工程师 岗位', time: '10分钟前' },
  { id: 2, text: '李四完成了 AI评估', time: '30分钟前' },
  { id: 3, text: '王五上传了新简历', time: '1小时前' },
  { id: 4, text: '系统完成了 5 份简历评估', time: '2小时前' },
];

export default function EmployeeDashboard() {
  return (
    <PageLayout title="工作台" subtitle="欢迎回来" action={<EmployeeNav />}>
      {/* Stats Grid */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6 mb-8">
        {stats.map((stat, index) => (
          <Card key={index}>
            <CardContent className="pt-6">
              <p className="text-sm text-muted-foreground mb-1">{stat.label}</p>
              <div className="flex items-basline gap-2">
                <span className="text-3xl font-bold">{stat.value}</span>
                <span className="text-xs text-muted-foreground">{stat.change}</span>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
        {/* Recent Activity */}
        <Card>
          <CardContent className="pt-6">
            <h2 className="text-lg font-semibold mb-4">最近动态</h2>
            <div className="space-y-4">
              {recentActivities.map((activity) => (
                <div key={activity.id} className="flex items-start gap-3">
                  <div className="w-2 h-2 rounded-full bg-accent mt-2" />
                  <div className="flex-1">
                    <p className="text-sm">{activity.text}</p>
                    <p className="text-xs text-muted-foreground">{activity.time}</p>
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>

        {/* Quick Actions */}
        <Card>
          <CardContent className="pt-6">
            <h2 className="text-lg font-semibold mb-4">快捷操作</h2>
            <div className="grid grid-cols-2 gap-3">
              <button className="p-4 rounded-lg border border-border hover:border-accent hover:bg-accent/5 transition-all text-left">
                <p className="font-medium">发布岗位</p>
                <p className="text-xs text-muted-foreground">创建新职位</p>
              </button>
              <button className="p-4 rounded-lg border border-border hover:border-accent hover:bg-accent/5 transition-all text-left">
                <p className="font-medium">批量评估</p>
                <p className="text-xs text-muted-foreground">AI评分</p>
              </button>
              <button className="p-4 rounded-lg border border-border hover:border-accent hover:bg-accent/5 transition-all text-left">
                <p className="font-medium">简历库</p>
                <p className="text-xs text-muted-foreground">浏览全部</p>
              </button>
              <button className="p-4 rounded-lg border border-border hover:border-accent hover:bg-accent/5 transition-all text-left">
                <p className="font-medium">岗位管理</p>
                <p className="text-xs text-muted-foreground">编辑职位</p>
              </button>
            </div>
          </CardContent>
        </Card>
      </div>
    </PageLayout>
  );
}
```

---

## Task 6: Employee Evaluations Page - Implement Full Functionality

**Files:**
- Modify: `frontend/src/pages/employee/evaluations.tsx`
- Modify: `frontend/src/api/employee/evaluations.ts`

### Step 1: Update API client

```ts
// frontend/src/api/employee/evaluations.ts
import { apiClient } from './index';

export const employeeEvaluationsApi = {
  batchEvaluate: (data: { resume_ids: number[]; job_id: number }) =>
    apiClient.post('/employee/evaluations/batch', data),

  getEvaluation: (matchId: number) =>
    apiClient.get(`/employee/evaluations/${matchId}`),

  getSkillHits: (matchId: number) =>
    apiClient.get(`/employee/evaluations/${matchId}/skill-hits`),
};
```

### Step 2: Rewrite evaluations page

```tsx
// frontend/src/pages/employee/evaluations.tsx
import { useEffect, useState } from 'react';
import { PageLayout } from '@/components/layout/page-layout';
import { EmployeeNav } from '@/components/layout/employee-nav';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { employeeEvaluationsApi } from '@/api/employee/evaluations';
import { employeeJobsApi } from '@/api/employee/jobs';
import { employeeResumesApi } from '@/api/employee/resumes';

export default function EmployeeEvaluations() {
  const [jobId, setJobId] = useState<number | ''>('');
  const [selectedResumeIds, setSelectedResumeIds] = useState<number[]>([]);
  const [resumes, setResumes] = useState<any[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [success, setSuccess] = useState(false);

  useEffect(() => {
    loadResumes();
  }, []);

  const loadResumes = async () => {
    try {
      const res = await employeeResumesApi.list();
      setResumes(res.data.items || []);
    } catch (error) {
      console.error('Failed to load resumes:', error);
    }
  };

  const toggleResume = (id: number) => {
    setSelectedResumeIds(prev =>
      prev.includes(id) ? prev.filter(i => i !== id) : [...prev, id]
    );
  };

  const handleBatchEvaluate = async () => {
    if (!jobId || selectedResumeIds.length === 0) return;
    setSubmitting(true);
    try {
      await employeeEvaluationsApi.batchEvaluate({
        resume_ids: selectedResumeIds,
        job_id: jobId as number
      });
      setSuccess(true);
      setSelectedResumeIds([]);
      setTimeout(() => setSuccess(false), 3000);
    } catch (error) {
      console.error('Failed to submit:', error);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <PageLayout title="AI评估" subtitle="批量评估简历匹配度" action={<EmployeeNav />}>
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
        <div className="lg:col-span-2 space-y-6">
          {/* Job Selection */}
          <Card>
            <CardHeader>
              <CardTitle>选择目标岗位</CardTitle>
            </CardHeader>
            <CardContent>
              <Input
                type="number"
                placeholder="输入岗位ID"
                value={jobId}
                onChange={(e) => setJobId(e.target.value ? Number(e.target.value) : '')}
                className="max-w-xs"
              />
            </CardContent>
          </Card>

          {/* Resume Selection */}
          <Card>
            <CardHeader>
              <CardTitle>选择简历 ({selectedResumeIds.length} 份)</CardTitle>
            </CardHeader>
            <CardContent>
              {resumes.length === 0 ? (
                <p className="text-muted-foreground">暂无简历</p>
              ) : (
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  {resumes.map((resume) => (
                    <button
                      key={resume.id}
                      onClick={() => toggleResume(resume.id)}
                      className={`p-4 rounded-lg border text-left transition-all ${
                        selectedResumeIds.includes(resume.id)
                          ? 'border-accent bg-accent/5'
                          : 'border-border hover:border-accent/50'
                      }`}
                    >
                      <p className="font-medium truncate">{resume.file_name}</p>
                      <p className="text-xs text-muted-foreground mt-1">
                        ID: {resume.id}
                      </p>
                    </button>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </div>

        {/* Action Panel */}
        <div className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle>开始评估</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="text-center py-6">
                <div className="text-4xl font-bold text-accent mb-2">
                  {selectedResumeIds.length}
                </div>
                <p className="text-sm text-muted-foreground">份简历待评估</p>
              </div>

              {success && (
                <div className="p-3 rounded-lg bg-green-500/10 text-green-600 text-sm text-center">
                  评估任务已提交
                </div>
              )}

              <Button
                className="w-full"
                disabled={!jobId || selectedResumeIds.length === 0 || submitting}
                onClick={handleBatchEvaluate}
              >
                {submitting ? '提交中...' : '开始AI评估'}
              </Button>

              <p className="text-xs text-muted-foreground text-center">
                评估结果将在评估完成后显示
              </p>
            </CardContent>
          </Card>
        </div>
      </div>
    </PageLayout>
  );
}
```

### Step 3: Verify API client exists

Check if `frontend/src/api/employee/jobs.ts` and `frontend/src/api/employee/resumes.ts` exist and have list methods. If not, create stubs.

---

## Task 7: Shared Components - Empty States

**Files:**
- Create: `frontend/src/components/common/empty-state.tsx`

### Step 1: Create EmptyState component

```tsx
// frontend/src/components/common/empty-state.tsx
import { ReactNode } from 'react';
import { Button } from '@/components/ui/button';

interface EmptyStateProps {
  icon?: ReactNode;
  title: string;
  description?: string;
  action?: {
    label: string;
    onClick: () => void;
  };
}

export function EmptyState({ icon, title, description, action }: EmptyStateProps) {
  return (
    <div className="flex flex-col items-center justify-center py-16 text-center">
      {icon && (
        <div className="w-16 h-16 bg-muted rounded-full flex items-center justify-center mb-4">
          {icon}
        </div>
      )}
      <h3 className="text-lg font-medium mb-2">{title}</h3>
      {description && (
        <p className="text-sm text-muted-foreground mb-4 max-w-sm">{description}</p>
      )}
      {action && (
        <Button onClick={action.onClick}>{action.label}</Button>
      )}
    </div>
  );
}
```

---

## Task 8: Final Verification

### Step 1: Build verification

Run: `cd frontend && npm run build`

Expected: Successful build with no TypeScript errors

### Step 2: Dev server check

Run: `npm run dev`

Expected: Frontend loads at localhost:3000

---

## File Summary

| File | Action |
|------|--------|
| `frontend/src/index.css` | Modify - Design tokens, fonts |
| `frontend/src/components/layout/page-layout.tsx` | Create |
| `frontend/src/components/layout/user-nav.tsx` | Create |
| `frontend/src/components/layout/employee-nav.tsx` | Create |
| `frontend/src/components/common/empty-state.tsx` | Create |
| `frontend/src/pages/user/login.tsx` | Modify |
| `frontend/src/pages/user/jobs.tsx` | Modify |
| `frontend/src/pages/user/job-detail.tsx` | Modify |
| `frontend/src/pages/employee/dashboard.tsx` | Modify |
| `frontend/src/pages/employee/evaluations.tsx` | Modify |
| `frontend/src/api/employee/evaluations.ts` | Modify |
| `frontend/src/api/employee/jobs.ts` | Check/Create |
| `frontend/src/api/employee/resumes.ts` | Check/Create |
