import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card';
import { employeeAuthApi } from '@/api/employee/auth';
import { useAuthStore } from '@/store/auth';

export default function EmployeeLogin() {
  const navigate = useNavigate();
  const { setTokens, setUserInfo } = useAuthStore();
  const [loginType, setLoginType] = useState<'password' | 'code'>('password');
  const [identifier, setIdentifier] = useState('');
  const [password, setPassword] = useState('');
  const [code, setCode] = useState('');
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    try {
      const res = await employeeAuthApi.login({
        identifier,
        login_type: loginType,
        password: loginType === 'password' ? password : undefined,
        code: loginType === 'code' ? code : undefined,
      });
      setTokens(res.data.access_token, res.data.refresh_token);
      setUserInfo('employee', res.data.user_id);
      navigate('/employee/dashboard');
    } catch (error) {
      console.error('Login failed:', error);
      alert('登录失败，请检查账号密码');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-background">
      <Card className="w-full max-w-md">
        <CardHeader>
          <CardTitle>员工登录</CardTitle>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="flex gap-2 mb-4">
              <button
                type="button"
                onClick={() => setLoginType('password')}
                className={`px-4 py-2 rounded ${loginType === 'password' ? 'bg-primary text-white' : 'bg-gray-100'}`}
              >
                密码登录
              </button>
              <button
                type="button"
                onClick={() => setLoginType('code')}
                className={`px-4 py-2 rounded ${loginType === 'code' ? 'bg-primary text-white' : 'bg-gray-100'}`}
              >
                验证码登录
              </button>
            </div>

            <div>
              <Label htmlFor="identifier">员工号/邮箱</Label>
              <Input
                id="identifier"
                value={identifier}
                onChange={(e) => setIdentifier(e.target.value)}
                placeholder="请输入员工号或邮箱"
              />
            </div>

            {loginType === 'password' ? (
              <div>
                <Label htmlFor="password">密码</Label>
                <Input
                  id="password"
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                />
              </div>
            ) : (
              <div>
                <Label htmlFor="code">验证码</Label>
                <div className="flex gap-2">
                  <Input
                    id="code"
                    value={code}
                    onChange={(e) => setCode(e.target.value)}
                    placeholder="请输入验证码"
                  />
                  <Button type="button" variant="outline">获取验证码</Button>
                </div>
              </div>
            )}

            <Button type="submit" className="w-full" disabled={loading}>
              {loading ? '登录中...' : '登录'}
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
