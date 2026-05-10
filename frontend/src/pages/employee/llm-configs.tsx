import { FormEvent, useCallback, useEffect, useMemo, useState } from 'react';
import { AlertCircle, Building2, CheckCircle2, FlaskConical, KeyRound, PlusCircle, RefreshCw, ServerCog, ShieldCheck, Trash2, UserRound } from 'lucide-react';
import { AdminLayout } from '@/components/layout/admin-layout';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { employeeLlmApi } from '@/api/employee/agent';
import { deptApi } from '@/api/employee/depts';
import { useAuthStore } from '@/store/auth';
import type { ILlmConfigItem, ILlmConfigPayload, ILlmModelOption } from '@/types/agent';
import type { IDeptItem } from '@/types/employee';

const createDefaultForm = (userId: string | null): ILlmConfigPayload => ({
  biz_type: 'employee',
  biz_id: Number(userId || 0),
  config_name: '',
  protocol: 'openai',
  base_url: '',
  api_key: '',
  model_name: '',
  fallback_model_name: '',
  extra_body: null,
  timeout_seconds: 120,
  max_retries: 2,
  status: 1,
});

const sourceLabel: Record<ILlmModelOption['source'], string> = {
  employee: '个人优先',
  dept: '部门共享',
  env: '系统默认',
};

const sourceBadgeVariant: Record<ILlmModelOption['source'], 'success' | 'warning' | 'secondary'> = {
  employee: 'success',
  dept: 'warning',
  env: 'secondary',
};

function formatDate(value?: string | null) {
  if (!value) return '未测试';
  return new Intl.DateTimeFormat('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' }).format(new Date(value));
}

export default function EmployeeLlmConfigs() {
  const userId = useAuthStore((state) => state.userId);
  const [configs, setConfigs] = useState<ILlmConfigItem[]>([]);
  const [options, setOptions] = useState<ILlmModelOption[]>([]);
  const [depts, setDepts] = useState<IDeptItem[]>([]);
  const [form, setForm] = useState<ILlmConfigPayload>(() => createDefaultForm(userId));
  const [extraBodyText, setExtraBodyText] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [testingId, setTestingId] = useState<number | null>(null);
  const [errorMessage, setErrorMessage] = useState('');

  const activeConfigCount = useMemo(() => configs.filter((config) => config.status === 1).length, [configs]);
  const employeeOptionCount = useMemo(() => options.filter((option) => option.source === 'employee').length, [options]);

  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      const [configRes, optionRes, deptRes] = await Promise.all([
        employeeLlmApi.listConfigs(),
        employeeLlmApi.listOptions(),
        deptApi.listDepts(),
      ]);
      setConfigs(configRes.data || []);
      setOptions(optionRes.data || []);
      setDepts(deptRes.data || []);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadData();
  }, [loadData]);

  useEffect(() => {
    if (form.biz_type === 'employee') {
      setForm((prev) => ({ ...prev, biz_id: Number(userId || 0) }));
    }
  }, [form.biz_type, userId]);

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault();
    setErrorMessage('');
    setSaving(true);
    try {
      const payload = {
        ...form,
        extra_body: extraBodyText.trim() ? JSON.parse(extraBodyText) : null,
        fallback_model_name: form.fallback_model_name || null,
      };
      await employeeLlmApi.createConfig(payload);
      setForm(createDefaultForm(userId));
      setExtraBodyText('');
      await loadData();
    } catch (error) {
      if (error instanceof SyntaxError) {
        setErrorMessage('扩展参数 JSON 格式不正确，请检查后重试。');
      } else {
        setErrorMessage('保存失败，请检查模型配置后重试。');
      }
    } finally {
      setSaving(false);
    }
  };

  const testConfig = async (id: number) => {
    setTestingId(id);
    try {
      await employeeLlmApi.testConfig(id);
      await loadData();
    } finally {
      setTestingId(null);
    }
  };

  const deleteConfig = async (id: number) => {
    await employeeLlmApi.deleteConfig(id);
    await loadData();
  };

  return (
    <AdminLayout breadcrumbs={[{ label: 'Agent 平台' }, { label: '模型配置' }]} title="模型配置">
      <div className="space-y-6">
        <section className="rounded-2xl border border-blue-100 bg-white p-6">
          <div className="flex flex-col gap-5 lg:flex-row lg:items-center lg:justify-between">
            <div className="max-w-2xl">
              <div className="inline-flex items-center gap-2 rounded-full border border-blue-200 bg-blue-50 px-3 py-1 text-xs font-semibold text-blue-700">
                <ServerCog size={14} aria-hidden="true" />
                Router + Gateway 模型接入
              </div>
              <h1 className="mt-4 text-2xl font-bold text-slate-900">统一管理 Agent 可用模型</h1>
              <p className="mt-2 text-sm leading-6 text-slate-600">按个人、部门、系统默认三级来源聚合模型。密钥加密存储，运行时由后端路由器选择可用配置。</p>
            </div>
            <div className="grid grid-cols-3 gap-3">
              <div className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-3">
                <div className="text-xs font-medium text-slate-500">可用模型</div>
                <div className="mt-1 text-2xl font-bold text-slate-900">{options.length}</div>
              </div>
              <div className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-3">
                <div className="text-xs font-medium text-slate-500">启用配置</div>
                <div className="mt-1 text-2xl font-bold text-slate-900">{activeConfigCount}</div>
              </div>
              <div className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-3">
                <div className="text-xs font-medium text-slate-500">个人优先</div>
                <div className="mt-1 text-2xl font-bold text-slate-900">{employeeOptionCount}</div>
              </div>
            </div>
          </div>
        </section>

        <div className="grid grid-cols-1 gap-6 xl:grid-cols-[1fr_430px]">
          <div className="space-y-6">
            <Card>
              <CardHeader className="flex flex-row items-center justify-between gap-3">
                <div>
                  <CardTitle>可用模型路由</CardTitle>
                  <p className="mt-1 text-sm text-slate-600">同名模型按个人、部门、系统默认优先级自动去重。</p>
                </div>
                <Button type="button" variant="outline" size="sm" onClick={loadData} disabled={loading}>
                  <RefreshCw size={14} className="mr-1" aria-hidden="true" />
                  刷新
                </Button>
              </CardHeader>
              <CardContent className="grid grid-cols-1 gap-3 md:grid-cols-2">
                {options.map((option) => (
                  <div key={`${option.source}-${option.model_name}`} className="rounded-xl border border-slate-200 bg-white p-4 transition-colors hover:border-blue-300 hover:bg-blue-50/40">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <div className="truncate text-sm font-semibold text-slate-900">{option.model_name}</div>
                        <div className="mt-1 truncate text-sm text-slate-600">{option.config_name}</div>
                      </div>
                      <Badge variant={sourceBadgeVariant[option.source]}>{sourceLabel[option.source]}</Badge>
                    </div>
                    <div className="mt-3 flex items-center gap-2 text-xs text-slate-500">
                      <ShieldCheck size={14} aria-hidden="true" />
                      <span className="truncate">{option.base_url}</span>
                    </div>
                  </div>
                ))}
                {!loading && options.length === 0 && (
                  <div className="rounded-xl border border-dashed border-slate-300 p-6 text-sm text-slate-600">暂无可用模型，请先新增配置或检查系统默认环境变量。</div>
                )}
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>配置清单</CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                {configs.map((config) => (
                  <div key={config.id} className="rounded-xl border border-slate-200 bg-white p-4">
                    <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="font-semibold text-slate-900">{config.config_name}</span>
                          <Badge variant={config.status === 1 ? 'success' : 'secondary'}>{config.status === 1 ? '启用' : '停用'}</Badge>
                          <Badge variant="outline">{config.biz_type === 'employee' ? '员工' : '部门'} #{config.biz_id}</Badge>
                          {config.last_test_status === 1 && <Badge variant="success">测试通过</Badge>}
                          {config.last_test_status === 0 && <Badge variant="danger">测试失败</Badge>}
                        </div>
                        <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-slate-600">
                          <span className="inline-flex items-center gap-1"><ServerCog size={14} aria-hidden="true" />{config.model_name}</span>
                          <span className="inline-flex items-center gap-1"><KeyRound size={14} aria-hidden="true" />{config.api_key_mask}</span>
                          <span>超时 {config.timeout_seconds}s · 重试 {config.max_retries}</span>
                        </div>
                        <div className="mt-2 truncate text-xs text-slate-500">{config.base_url}</div>
                        <div className="mt-2 text-xs text-slate-500">最近测试：{formatDate(config.last_test_at)}{config.last_test_message ? ` · ${config.last_test_message}` : ''}</div>
                      </div>
                      <div className="flex shrink-0 gap-2">
                        <Button type="button" variant="outline" size="sm" onClick={() => testConfig(config.id)} disabled={testingId === config.id}>
                          <FlaskConical size={14} className="mr-1" aria-hidden="true" />
                          {testingId === config.id ? '测试中' : '测试'}
                        </Button>
                        <Button type="button" variant="danger" size="sm" onClick={() => deleteConfig(config.id)}>
                          <Trash2 size={14} className="mr-1" aria-hidden="true" />
                          删除
                        </Button>
                      </div>
                    </div>
                  </div>
                ))}
                {!loading && configs.length === 0 && (
                  <div className="rounded-xl border border-dashed border-slate-300 p-6 text-sm text-slate-600">暂无模型配置。右侧新增个人或部门模型后，Agent 工作台即可选择使用。</div>
                )}
              </CardContent>
            </Card>
          </div>

          <Card className="h-fit">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <PlusCircle size={18} className="text-blue-600" aria-hidden="true" />
                新增配置
              </CardTitle>
            </CardHeader>
            <CardContent>
              {errorMessage && (
                <div role="alert" className="mb-4 flex gap-2 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">
                  <AlertCircle size={16} className="mt-0.5 shrink-0" aria-hidden="true" />
                  <span>{errorMessage}</span>
                </div>
              )}
              <form className="space-y-4" onSubmit={handleSubmit}>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <Label>业务类型</Label>
                    <Select value={form.biz_type} onValueChange={(value) => setForm((prev) => ({ ...prev, biz_type: value as 'employee' | 'dept', biz_id: value === 'employee' ? Number(userId || 0) : 0 }))}>
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="employee"><UserRound size={14} aria-hidden="true" />员工</SelectItem>
                        <SelectItem value="dept"><Building2 size={14} aria-hidden="true" />部门</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div>
                    <Label>业务主体</Label>
                    {form.biz_type === 'dept' ? (
                      <Select value={String(form.biz_id || '')} onValueChange={(value) => setForm((prev) => ({ ...prev, biz_id: Number(value) }))}>
                        <SelectTrigger><SelectValue placeholder="选择部门" /></SelectTrigger>
                        <SelectContent>
                          {depts.map((dept) => <SelectItem key={dept.id} value={String(dept.id)}>{dept.dept_name}</SelectItem>)}
                        </SelectContent>
                      </Select>
                    ) : (
                      <Input value={form.biz_id} readOnly aria-label="员工 ID" />
                    )}
                  </div>
                </div>
                <div>
                  <Label>配置名称</Label>
                  <Input value={form.config_name} onChange={(event) => setForm((prev) => ({ ...prev, config_name: event.target.value }))} placeholder="例如：个人 Qwen Plus" required />
                </div>
                <div>
                  <Label>Base URL</Label>
                  <Input value={form.base_url} onChange={(event) => setForm((prev) => ({ ...prev, base_url: event.target.value }))} placeholder="https://dashscope.aliyuncs.com/compatible-mode/v1" required />
                </div>
                <div>
                  <Label>API Key</Label>
                  <Input type="password" value={form.api_key} onChange={(event) => setForm((prev) => ({ ...prev, api_key: event.target.value }))} placeholder="保存后将加密存储" required />
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <Label>模型名</Label>
                    <Input value={form.model_name} onChange={(event) => setForm((prev) => ({ ...prev, model_name: event.target.value }))} placeholder="qwen-plus" required />
                  </div>
                  <div>
                    <Label>兜底模型</Label>
                    <Input value={form.fallback_model_name || ''} onChange={(event) => setForm((prev) => ({ ...prev, fallback_model_name: event.target.value }))} placeholder="可选" />
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <Label>超时秒数</Label>
                    <Input type="number" min={1} max={600} value={form.timeout_seconds} onChange={(event) => setForm((prev) => ({ ...prev, timeout_seconds: Number(event.target.value) }))} />
                  </div>
                  <div>
                    <Label>重试次数</Label>
                    <Input type="number" min={0} max={5} value={form.max_retries} onChange={(event) => setForm((prev) => ({ ...prev, max_retries: Number(event.target.value) }))} />
                  </div>
                </div>
                <div>
                  <Label>扩展参数 JSON</Label>
                  <Textarea value={extraBodyText} onChange={(event) => setExtraBodyText(event.target.value)} className="min-h-[92px] font-mono text-xs" placeholder='{"enable_thinking": false}' />
                </div>
                <div className="rounded-lg border border-blue-100 bg-blue-50 p-3 text-xs leading-5 text-blue-800">
                  <CheckCircle2 size={14} className="mr-1 inline" aria-hidden="true" />
                  配置保存后会清理模型选项缓存，并在 Agent 工作台自动可选。
                </div>
                <Button type="submit" className="w-full" disabled={saving || (form.biz_type === 'dept' && !form.biz_id)}>
                  {saving ? '保存中...' : '保存配置'}
                </Button>
              </form>
            </CardContent>
          </Card>
        </div>
      </div>
    </AdminLayout>
  );
}
