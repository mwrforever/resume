import { FormEvent, useCallback, useEffect, useMemo, useState } from 'react';
import { AlertCircle, Building2, CheckCircle2, FlaskConical, KeyRound, Pencil, PlusCircle, RefreshCw, Search, ServerCog, ShieldCheck, Trash2, UserRound, X } from 'lucide-react';
import { ConfirmDialog } from '@/components/common/confirm-dialog';
import { AdminLayout } from '@/components/layout/admin-layout';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { employeeLlmApi } from '@/api/employee/agent';
import { deptApi } from '@/api/employee/depts';
import { useAuthStore } from '@/store/auth';
import type { ILlmConfigItem, ILlmConfigPayload } from '@/types/agent';
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

function formatDate(value?: string | null) {
  if (!value) return '未测试';
  return new Intl.DateTimeFormat('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' }).format(new Date(value));
}

function formFromConfig(config: ILlmConfigItem): ILlmConfigPayload {
  return {
    biz_type: config.biz_type,
    biz_id: config.biz_id,
    config_name: config.config_name,
    protocol: config.protocol,
    base_url: config.base_url,
    api_key: '',
    model_name: config.model_name,
    fallback_model_name: config.fallback_model_name || '',
    extra_body: config.extra_body || null,
    timeout_seconds: config.timeout_seconds,
    max_retries: config.max_retries,
    status: config.status,
  };
}

interface ConfigDialogProps {
  open: boolean;
  mode: 'create' | 'edit';
  config: ILlmConfigItem | null;
  userId: string | null;
  depts: IDeptItem[];
  saving: boolean;
  errorMessage: string;
  onClose: () => void;
  onSubmit: (form: ILlmConfigPayload, extraBodyText: string) => void;
}

interface ConfigCardProps {
  config: ILlmConfigItem;
  canManage: boolean;
  testing: boolean;
  onEdit: () => void;
  onTest: () => void;
  onDelete: () => void;
}

function ConfigCard({ config, canManage, testing, onEdit, onTest, onDelete }: ConfigCardProps) {
  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm shadow-slate-200/40">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-semibold text-slate-900">{config.config_name}</span>
            <Badge variant={config.status === 1 ? 'success' : 'secondary'}>{config.status === 1 ? '启用' : '停用'}</Badge>
            <Badge variant="outline">{config.biz_type === 'employee' ? '个人' : '部门'} #{config.biz_id}</Badge>
            {!canManage && <Badge variant="secondary">只读</Badge>}
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
        <div className="flex shrink-0 flex-wrap gap-2">
          {canManage ? (
            <>
              <Button type="button" variant="outline" size="sm" onClick={onEdit}><Pencil size={14} className="mr-1" aria-hidden="true" />编辑</Button>
              <Button type="button" variant="outline" size="sm" onClick={onTest} disabled={testing}><FlaskConical size={14} className="mr-1" aria-hidden="true" />{testing ? '测试中' : '测试'}</Button>
              <Button type="button" variant="danger" size="sm" onClick={onDelete}><Trash2 size={14} className="mr-1" aria-hidden="true" />删除</Button>
            </>
          ) : (
            <Badge variant="outline">无操作权限</Badge>
          )}
        </div>
      </div>
    </div>
  );
}

function ConfigDialog({ open, mode, config, userId, depts, saving, errorMessage, onClose, onSubmit }: ConfigDialogProps) {
  const [form, setForm] = useState<ILlmConfigPayload>(() => createDefaultForm(userId));
  const [extraBodyText, setExtraBodyText] = useState('');

  useEffect(() => {
    if (!open) return;
    const nextForm = mode === 'edit' && config ? formFromConfig(config) : createDefaultForm(userId);
    setForm(nextForm);
    setExtraBodyText(nextForm.extra_body ? JSON.stringify(nextForm.extra_body, null, 2) : '');
  }, [config, mode, open, userId]);

  useEffect(() => {
    if (form.biz_type === 'employee') {
      setForm((prev) => ({ ...prev, biz_id: Number(userId || 0) }));
    }
  }, [form.biz_type, userId]);

  const handleSubmit = (event: FormEvent) => {
    event.preventDefault();
    onSubmit(form, extraBodyText);
  };

  return (
    <Dialog open={open} onOpenChange={(value) => !value && onClose()} containerClassName="max-w-3xl overflow-hidden rounded-2xl">
      <DialogContent className="max-h-[88vh] overflow-y-auto p-0 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        <div className="flex items-center justify-between border-b border-slate-100 bg-slate-50/80 px-6 py-4">
          <div>
            <DialogTitle className="mb-0">{mode === 'create' ? '新增模型配置' : '编辑模型配置'}</DialogTitle>
            <p className="mt-1 text-sm text-slate-500">以表单方式维护个人或部门模型路由配置。</p>
          </div>
          <button type="button" onClick={onClose} aria-label="关闭" className="rounded-lg p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
            <X size={18} />
          </button>
        </div>
        <form className="space-y-5 px-6 py-5" onSubmit={handleSubmit}>
          {errorMessage && <div role="alert" className="flex gap-2 rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-700"><AlertCircle size={16} className="mt-0.5 shrink-0" aria-hidden="true" /><span>{errorMessage}</span></div>}
          <section className="space-y-3">
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">归属范围</p>
            <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
              <div className="space-y-1.5">
                <Label>业务类型</Label>
                <Select value={form.biz_type} onValueChange={(value) => setForm((prev) => ({ ...prev, biz_type: value as 'employee' | 'dept', biz_id: value === 'employee' ? Number(userId || 0) : 0 }))}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="employee"><UserRound size={14} aria-hidden="true" />员工</SelectItem>
                    <SelectItem value="dept"><Building2 size={14} aria-hidden="true" />部门</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label>业务主体</Label>
                {form.biz_type === 'dept' ? <Select value={String(form.biz_id || '')} onValueChange={(value) => setForm((prev) => ({ ...prev, biz_id: Number(value) }))}><SelectTrigger><SelectValue placeholder="选择部门" /></SelectTrigger><SelectContent>{depts.map((dept) => <SelectItem key={dept.id} value={String(dept.id)}>{dept.dept_name}</SelectItem>)}</SelectContent></Select> : <Input value={form.biz_id} readOnly aria-label="员工 ID" />}
              </div>
            </div>
          </section>
          <section className="space-y-3">
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">模型连接</p>
            <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
              <div className="space-y-1.5"><Label>配置名称</Label><Input value={form.config_name} onChange={(event) => setForm((prev) => ({ ...prev, config_name: event.target.value }))} placeholder="例如：个人 Qwen Plus" required /></div>
              <div className="space-y-1.5"><Label>模型名</Label><Input value={form.model_name} onChange={(event) => setForm((prev) => ({ ...prev, model_name: event.target.value }))} placeholder="qwen-plus" required /></div>
            </div>
            <div className="space-y-1.5"><Label>Base URL</Label><Input value={form.base_url} onChange={(event) => setForm((prev) => ({ ...prev, base_url: event.target.value }))} placeholder="https://dashscope.aliyuncs.com/compatible-mode/v1" required /></div>
            <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
              <div className="space-y-1.5"><Label>API Key</Label><Input type="password" value={form.api_key} onChange={(event) => setForm((prev) => ({ ...prev, api_key: event.target.value }))} placeholder={mode === 'edit' ? '留空则不更新密钥' : '保存后将加密存储'} required={mode === 'create'} /></div>
              <div className="space-y-1.5"><Label>兜底模型</Label><Input value={form.fallback_model_name || ''} onChange={(event) => setForm((prev) => ({ ...prev, fallback_model_name: event.target.value }))} placeholder="可选" /></div>
            </div>
          </section>
          <section className="space-y-3">
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">运行参数</p>
            <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
              <div className="space-y-1.5"><Label>状态</Label><Select value={String(form.status)} onValueChange={(value) => setForm((prev) => ({ ...prev, status: Number(value) }))}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="1">启用</SelectItem><SelectItem value="0">停用</SelectItem></SelectContent></Select></div>
              <div className="space-y-1.5"><Label>超时秒数</Label><Input type="number" min={1} max={120} value={form.timeout_seconds} onChange={(event) => setForm((prev) => ({ ...prev, timeout_seconds: Number(event.target.value) }))} /></div>
              <div className="space-y-1.5"><Label>重试次数</Label><Input type="number" min={0} max={2} value={form.max_retries} onChange={(event) => setForm((prev) => ({ ...prev, max_retries: Number(event.target.value) }))} /></div>
            </div>
            <div className="space-y-1.5"><Label>扩展参数 JSON</Label><Textarea value={extraBodyText} onChange={(event) => setExtraBodyText(event.target.value)} className="min-h-[110px] font-mono text-xs" placeholder='{"enable_thinking": false}' /></div>
          </section>
          <div className="rounded-xl border border-sky-100 bg-sky-50 p-3 text-xs leading-5 text-sky-800"><CheckCircle2 size={14} className="mr-1 inline" aria-hidden="true" />删除操作会使用软删除；修改和删除仅允许配置拥有者或管理员执行。</div>
          <div className="flex justify-end gap-2 border-t border-slate-100 pt-4"><Button type="button" variant="outline" onClick={onClose} disabled={saving}>取消</Button><Button type="submit" disabled={saving || (form.biz_type === 'dept' && !form.biz_id)}>{saving ? '保存中...' : mode === 'create' ? '保存配置' : '保存修改'}</Button></div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export default function EmployeeLlmConfigs() {
  const userId = useAuthStore((state) => state.userId);
  const [configs, setConfigs] = useState<ILlmConfigItem[]>([]);
  const [depts, setDepts] = useState<IDeptItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [testingId, setTestingId] = useState<number | null>(null);
  const [errorMessage, setErrorMessage] = useState('');
  const [dialogState, setDialogState] = useState<{ mode: 'create' | 'edit'; config: ILlmConfigItem | null } | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<ILlmConfigItem | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [keyword, setKeyword] = useState('');
  const [scopeFilter, setScopeFilter] = useState('all');
  const [statusFilter, setStatusFilter] = useState('all');

  const filteredConfigs = useMemo(() => configs.filter((config) => {
    const text = `${config.config_name} ${config.model_name} ${config.base_url}`.toLowerCase();
    const matchKeyword = !keyword.trim() || text.includes(keyword.trim().toLowerCase());
    const matchScope = scopeFilter === 'all' || config.biz_type === scopeFilter;
    const matchStatus = statusFilter === 'all' || String(config.status) === statusFilter;
    return matchKeyword && matchScope && matchStatus;
  }), [configs, keyword, scopeFilter, statusFilter]);

  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      const [configRes, deptRes] = await Promise.all([employeeLlmApi.listConfigs(), deptApi.listDepts()]);
      setConfigs(configRes.data || []);
      setDepts(deptRes.data || []);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { loadData(); }, [loadData]);

  const closeDialog = () => { setDialogState(null); setErrorMessage(''); };
  const canManageConfig = (config: ILlmConfigItem) => Boolean(config.can_manage) || (config.biz_type === 'employee' && config.biz_id === Number(userId || 0));

  const saveConfig = async (form: ILlmConfigPayload, extraBodyText: string) => {
    if (!dialogState) return;
    setErrorMessage('');
    setSaving(true);
    try {
      const payload = { ...form, extra_body: extraBodyText.trim() ? JSON.parse(extraBodyText) : null, fallback_model_name: form.fallback_model_name || null };
      if (dialogState.mode === 'create') {
        await employeeLlmApi.createConfig(payload);
      } else if (dialogState.config) {
        const { api_key, ...updatePayload } = payload;
        await employeeLlmApi.updateConfig(dialogState.config.id, { ...updatePayload, ...(api_key ? { api_key } : {}) });
      }
      closeDialog();
      await loadData();
    } catch (error) {
      setErrorMessage(error instanceof SyntaxError ? '扩展参数 JSON 格式不正确，请检查后重试。' : '保存失败，请检查模型配置后重试。');
    } finally {
      setSaving(false);
    }
  };

  const testConfig = async (id: number) => {
    setTestingId(id);
    try { await employeeLlmApi.testConfig(id); await loadData(); } finally { setTestingId(null); }
  };

  const handleDelete = async () => {
    if (!deleteTarget) return;
    setDeleting(true);
    try { await employeeLlmApi.deleteConfig(deleteTarget.id); setDeleteTarget(null); await loadData(); } finally { setDeleting(false); }
  };

  return (
    <AdminLayout breadcrumbs={[{ label: 'Agent 平台' }, { label: '模型配置' }]} title="模型配置" headerAction={<div className="flex items-center gap-2"><Button type="button" variant="outline" onClick={loadData} disabled={loading} className="bg-white"><RefreshCw size={15} className="mr-1.5" aria-hidden="true" />刷新</Button><Button type="button" onClick={() => setDialogState({ mode: 'create', config: null })}><PlusCircle size={15} className="mr-1.5" aria-hidden="true" />新增配置</Button></div>}>
      <div className="space-y-4">
        <Card className="border-white/80 bg-white/90 backdrop-blur">
          <CardHeader className="border-b border-slate-100 bg-white/70">
            <CardTitle className="flex items-center gap-2"><ShieldCheck size={18} className="text-primary" aria-hidden="true" />所有可用配置</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-1 gap-3 lg:grid-cols-[minmax(0,1fr)_180px_160px]">
              <div className="relative"><Search size={16} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" aria-hidden="true" /><Input value={keyword} onChange={(event) => setKeyword(event.target.value)} className="pl-9" placeholder="搜索配置名称、模型名或 Base URL" /></div>
              <Select value={scopeFilter} onValueChange={setScopeFilter}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="all">全部归属</SelectItem><SelectItem value="employee">个人配置</SelectItem><SelectItem value="dept">部门配置</SelectItem></SelectContent></Select>
              <Select value={statusFilter} onValueChange={setStatusFilter}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="all">全部状态</SelectItem><SelectItem value="1">启用</SelectItem><SelectItem value="0">停用</SelectItem></SelectContent></Select>
            </div>
            <div className="space-y-3">
              {filteredConfigs.map((config) => {
                const canManage = canManageConfig(config);
                return (
                  <ConfigCard
                    key={config.id}
                    config={config}
                    canManage={canManage}
                    testing={testingId === config.id}
                    onEdit={() => setDialogState({ mode: 'edit', config })}
                    onTest={() => testConfig(config.id)}
                    onDelete={() => setDeleteTarget(config)}
                  />
                );
              })}
              {!loading && filteredConfigs.length === 0 && <div className="rounded-2xl border border-dashed border-sky-200 bg-sky-50/50 p-6 text-sm text-slate-600">暂无符合条件的模型配置。</div>}
            </div>
          </CardContent>
        </Card>
      </div>
      <ConfigDialog open={!!dialogState} mode={dialogState?.mode ?? 'create'} config={dialogState?.config ?? null} userId={userId} depts={depts} saving={saving} errorMessage={errorMessage} onClose={closeDialog} onSubmit={saveConfig} />
      <ConfirmDialog open={!!deleteTarget} title="确认删除模型配置" description={`确定要删除「${deleteTarget?.config_name}」吗？删除操作将使用软删除。`} confirmLabel="删除" onConfirm={handleDelete} onCancel={() => setDeleteTarget(null)} loading={deleting} />
    </AdminLayout>
  );
}
