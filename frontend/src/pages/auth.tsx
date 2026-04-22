import { useState } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent } from '@/components/ui/card';
import { userAuthApi } from '@/api/user/auth';
import { employeeAuthApi } from '@/api/employee/auth';
import { useAuthStore } from '@/store/auth';

type AuthMode = 'login' | 'register';
type UserType = 'user' | 'employee';

export default function Auth() {
  const navigate = useNavigate();
  const location = useLocation();
  const { setTokens, setUserInfo } = useAuthStore();

  // Determine initial user type from URL path
  const initialType: UserType = location.pathname.includes('/employee/') ? 'employee' : 'user';
  const [userType, setUserType] = useState<UserType>(initialType);
  const [authMode, setAuthMode] = useState<AuthMode>('login');
  const [slideDirection, setSlideDirection] = useState<'left' | 'right' | null>(null);

  const [identifier, setIdentifier] = useState('');
  const [formData, setFormData] = useState({
    empNo: '',
    email: '',
    realName: '',
    password: '',
    confirmPassword: '',
    code: '',
  });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [codeSent, setCodeSent] = useState(false);
  const [countdown, setCountdown] = useState(0);

  // Handle user type switch with drawer animation
  const handleUserTypeSwitch = (newType: UserType) => {
    if (newType === userType) return;
    setSlideDirection(newType === 'employee' ? 'left' : 'right');
    setTimeout(() => {
      setUserType(newType);
      resetForm();
      setSlideDirection(null);
    }, 400);
  };

  // Handle auth mode switch (login <-> register) with drawer animation
  const handleAuthModeSwitch = (newMode: AuthMode) => {
    if (newMode === authMode) return;
    setSlideDirection(newMode === 'register' ? 'left' : 'right');
    setTimeout(() => {
      setAuthMode(newMode);
      resetForm();
      setSlideDirection(null);
    }, 400);
  };

  const resetForm = () => {
    setIdentifier('');
    setFormData({
      empNo: '',
      email: '',
      realName: '',
      password: '',
      confirmPassword: '',
      code: '',
    });
    setError('');
    setCodeSent(false);
    setCountdown(0);
  };

  const handleSendCode = async () => {
    const email = userType === 'user' ? formData.email : formData.email;
    if (!email) {
      setError('请先输入邮箱');
      return;
    }
    try {
      if (userType === 'user') {
        await userAuthApi.sendCode(email);
      } else {
        await employeeAuthApi.sendCode(email);
      }
      setCodeSent(true);
      setCountdown(60);
      setError('');
      const timer = setInterval(() => {
        setCountdown((prev) => {
          if (prev <= 1) {
            clearInterval(timer);
            setCodeSent(false);
            return 0;
          }
          return prev - 1;
        });
      }, 1000);
    } catch {
      setError('发送验证码失败');
    }
  };

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError('');
    try {
      let res;
      if (userType === 'user') {
        res = await userAuthApi.login({
          identifier,
          login_type: 'password',
          password: formData.password,
        });
        setTokens(res.access_token, res.refresh_token);
        setUserInfo('user', res.user_id);
        navigate('/user/jobs');
      } else {
        res = await employeeAuthApi.login({
          identifier,
          login_type: 'password',
          password: formData.password,
        });
        setTokens(res.access_token, res.refresh_token);
        setUserInfo('employee', res.user_id);
        navigate('/employee/dashboard');
      }
    } catch {
      setError('登录失败，请检查账号信息');
    } finally {
      setLoading(false);
    }
  };

  const handleRegister = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');

    if (formData.password !== formData.confirmPassword) {
      setError('两次密码输入不一致');
      return;
    }

    if (formData.password.length < 6) {
      setError('密码长度至少6位');
      return;
    }

    setLoading(true);
    try {
      let res;
      if (userType === 'user') {
        res = await userAuthApi.register({
          email: formData.email,
          password: formData.password,
          code: formData.code,
          real_name: formData.realName,
        });
        setTokens(res.data.access_token, res.data.refresh_token);
        setUserInfo('user', res.data.user_id);
        navigate('/user/jobs');
      } else {
        res = await employeeAuthApi.register({
          emp_no: formData.empNo,
          email: formData.email,
          password: formData.password,
          code: formData.code,
          real_name: formData.realName,
        });
        setTokens(res.data.access_token, res.data.refresh_token);
        setUserInfo('employee', res.data.user_id);
        navigate('/employee/dashboard');
      }
    } catch (err: any) {
      setError(err.response?.data?.detail || '注册失败，请检查信息');
    } finally {
      setLoading(false);
    }
  };

  // Left panel content based on user type and auth mode
  const getLeftPanelContent = () => {
    const isLogin = authMode === 'login';
    if (userType === 'user') {
      return isLogin ? {
        title: '欢迎回来',
        subtitle: '登录后可以寻找合适的工作机会',
        features: [
          { icon: 'M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z', text: 'AI智能评估，精准匹配' },
          { icon: 'M13 10V3L4 14h7v7l9-11h-7z', text: '高效处理，省时省力' },
        ]
      } : {
        title: '加入我们',
        subtitle: '创建账号，开启求职之旅',
        features: [
          { icon: 'M21 13.255A23.931 23.931 0 0112 15c-3.183 0-6.22-.62-9-1.745M16 6V4a2 2 0 00-2-2h-4a2 2 0 00-2 2v2m4 6h.01M5 20h14a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z', text: '海量职位，精准匹配' },
          { icon: 'M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z', text: '安全可信的服务' },
        ]
      };
    } else {
      return isLogin ? {
        title: '员工管理后台',
        subtitle: '招聘管理平台，仅限员工使用',
        features: [
          { icon: 'M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z', text: '批量评估，智能排序' },
          { icon: 'M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0z', text: '人才管理，尽在掌握' },
        ]
      } : {
        title: '加入团队',
        subtitle: '成为我们的员工，开始招聘管理之旅',
        features: [
          { icon: 'M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z', text: '高效管理招聘流程' },
          { icon: 'M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0z', text: '团队协作，共享资源' },
        ]
      };
    }
  };

  const content = getLeftPanelContent();

  return (
    <div className="min-h-screen flex">
      {/* Left - Branding */}
      <div className="hidden lg:flex lg:w-1/2 bg-primary text-primary-foreground p-12 flex-col justify-between relative overflow-hidden">
        {/* Top right corner - user type switch */}
        <div className="absolute top-6 right-6 z-10 flex gap-2">
          <button
            onClick={() => handleUserTypeSwitch('user')}
            className={`flex items-center gap-2 px-4 py-2 rounded-full text-sm font-medium transition-all duration-300 ${
              userType === 'user'
                ? 'bg-white text-primary'
                : 'bg-white/10 text-white/80 hover:bg-white/20'
            }`}
          >
            用户
          </button>
          <button
            onClick={() => handleUserTypeSwitch('employee')}
            className={`flex items-center gap-2 px-4 py-2 rounded-full text-sm font-medium transition-all duration-300 ${
              userType === 'employee'
                ? 'bg-white text-primary'
                : 'bg-white/10 text-white/80 hover:bg-white/20'
            }`}
          >
            员工
          </button>
        </div>

        {/* Content */}
        <div>
          <h1 className="text-5xl font-bold tracking-tight">{content.title}</h1>
          <p className="mt-6 text-lg text-primary-foreground/80 leading-relaxed">
            {content.subtitle}
          </p>
        </div>
        <div className="space-y-6">
          {content.features.map((feature, idx) => (
            <div key={idx} className="flex items-center gap-4">
              <div className="w-12 h-12 rounded-xl bg-primary-foreground/10 flex items-center justify-center">
                <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d={feature.icon} />
                </svg>
              </div>
              <span className="text-primary-foreground/90">{feature.text}</span>
            </div>
          ))}
        </div>
      </div>

      {/* Right - Form */}
      <div className="flex-1 flex items-center justify-center p-8 bg-background overflow-y-auto">
        <div className="w-full max-w-md py-8">
          {/* Mobile only - user type switch */}
          <div className="lg:hidden mb-6 flex gap-2">
            <button
              onClick={() => handleUserTypeSwitch('user')}
              className={`flex-1 py-2 rounded-lg text-sm font-medium transition-all ${
                userType === 'user'
                  ? 'bg-primary text-white'
                  : 'bg-secondary text-muted-foreground'
              }`}
            >
              用户
            </button>
            <button
              onClick={() => handleUserTypeSwitch('employee')}
              className={`flex-1 py-2 rounded-lg text-sm font-medium transition-all ${
                userType === 'employee'
                  ? 'bg-primary text-white'
                  : 'bg-secondary text-muted-foreground'
              }`}
            >
              员工
            </button>
          </div>

          {/* Title with auth mode switch */}
          <div className="mb-8">
            <h2 className="text-3xl font-bold tracking-tight">
              {authMode === 'login' ? '登录' : '注册'}
            </h2>
            <p className="mt-2 text-sm text-muted-foreground">
              {authMode === 'login'
                ? userType === 'user'
                  ? '登录后可以寻找合适的工作机会'
                  : '招聘管理平台，仅限员工使用'
                : userType === 'user'
                  ? '创建账号，开启求职之旅'
                  : '创建员工账号，开始招聘管理'
              }
            </p>
          </div>

          {/* Form Card with Animation */}
          <div
            className={`transition-all duration-400 ease-out ${
              slideDirection === 'left'
                ? 'opacity-0 -translate-x-full'
                : slideDirection === 'right'
                ? 'opacity-0 translate-x-full'
                : 'opacity-100 translate-x-0'
            }`}
            style={{ transitionDuration: '400ms' }}
          >
            <Card>
              <CardContent className="pt-6">
                {authMode === 'login' ? (
                  /* Login Form */
                  <form onSubmit={handleLogin} className="space-y-5">
                    <div className="space-y-2">
                      <Label htmlFor="identifier">
                        {userType === 'employee' ? '员工号 / 邮箱' : '邮箱'}
                      </Label>
                      <Input
                        id="identifier"
                        type="email"
                        value={identifier}
                        onChange={(e) => setIdentifier(e.target.value)}
                        placeholder={userType === 'employee' ? '员工号或邮箱' : 'your@email.com'}
                        required
                        className="h-12 text-base"
                      />
                    </div>

                    <div className="space-y-2">
                      <Label htmlFor="password">密码</Label>
                      <Input
                        id="password"
                        type="password"
                        value={formData.password}
                        onChange={(e) => setFormData({ ...formData, password: e.target.value })}
                        placeholder="请输入密码"
                        required
                        className="h-12 text-base"
                      />
                    </div>

                    {error && (
                      <p className="text-sm text-destructive">{error}</p>
                    )}

                    <Button type="submit" className="w-full h-12 text-base" disabled={loading}>
                      {loading ? '登录中...' : '登录'}
                    </Button>

                    {userType === 'user' && (
                      <p className="text-center text-sm text-muted-foreground">
                        还没有账号？
                        <button
                          type="button"
                          onClick={() => handleAuthModeSwitch('register')}
                          className="font-medium text-accent hover:underline ml-1"
                        >
                          立即注册
                        </button>
                      </p>
                    )}
                  </form>
                ) : (
                  /* Register Form */
                  <form onSubmit={handleRegister} className="space-y-5">
                    {userType === 'employee' && (
                      <div className="space-y-2">
                        <Label htmlFor="empNo">员工工号</Label>
                        <Input
                          id="empNo"
                          value={formData.empNo}
                          onChange={(e) => setFormData({ ...formData, empNo: e.target.value })}
                          placeholder="请输入员工工号"
                          required
                          className="h-12 text-base"
                        />
                      </div>
                    )}

                    <div className="space-y-2">
                      <Label htmlFor="realName">真实姓名</Label>
                      <Input
                        id="realName"
                        value={formData.realName}
                        onChange={(e) => setFormData({ ...formData, realName: e.target.value })}
                        placeholder="请输入真实姓名"
                        required
                        className="h-12 text-base"
                      />
                    </div>

                    <div className="space-y-2">
                      <Label htmlFor="email">邮箱</Label>
                      <Input
                        id="email"
                        type="email"
                        value={formData.email}
                        onChange={(e) => setFormData({ ...formData, email: e.target.value })}
                        placeholder="your@email.com"
                        required
                        className="h-12 text-base"
                      />
                    </div>

                    <div className="space-y-2">
                      <Label htmlFor="password">密码</Label>
                      <Input
                        id="password"
                        type="password"
                        value={formData.password}
                        onChange={(e) => setFormData({ ...formData, password: e.target.value })}
                        placeholder="至少6位密码"
                        required
                        className="h-12 text-base"
                      />
                    </div>

                    <div className="space-y-2">
                      <Label htmlFor="confirmPassword">确认密码</Label>
                      <Input
                        id="confirmPassword"
                        type="password"
                        value={formData.confirmPassword}
                        onChange={(e) => setFormData({ ...formData, confirmPassword: e.target.value })}
                        placeholder="再次输入密码"
                        required
                        className="h-12 text-base"
                      />
                    </div>

                    <div className="space-y-2">
                      <Label htmlFor="code">验证码</Label>
                      <div className="flex gap-2">
                        <Input
                          id="code"
                          value={formData.code}
                          onChange={(e) => setFormData({ ...formData, code: e.target.value })}
                          placeholder="请输入验证码"
                          required
                          className="h-12 text-base flex-1"
                        />
                        <Button
                          type="button"
                          variant="outline"
                          className="h-12 px-4"
                          onClick={handleSendCode}
                          disabled={codeSent || countdown > 0}
                        >
                          {countdown > 0 ? `${countdown}秒后重发` : codeSent ? '已发送' : '获取验证码'}
                        </Button>
                      </div>
                    </div>

                    {error && (
                      <p className="text-sm text-destructive">{error}</p>
                    )}

                    <Button type="submit" className="w-full h-12 text-base" disabled={loading}>
                      {loading ? '注册中...' : '注册'}
                    </Button>

                    <p className="text-center text-sm text-muted-foreground">
                      已有账号？
                      <button
                        type="button"
                        onClick={() => handleAuthModeSwitch('login')}
                        className="font-medium text-accent hover:underline ml-1"
                      >
                        立即登录
                      </button>
                    </p>
                  </form>
                )}
              </CardContent>
            </Card>
          </div>
        </div>
      </div>
    </div>
  );
}
