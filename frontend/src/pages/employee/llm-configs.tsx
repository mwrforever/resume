import { FormEvent, useCallback, useEffect, useMemo, useState } from 'react';
import { AlertCircle, ChevronDown, FlaskConical, KeyRound, Pencil, PlusCircle, RefreshCw, Search, ServerCog, ShieldCheck, Trash2, X } from 'lucide-react';
import { ConfirmDialog } from '@/components/common/confirm-dialog';
import { Pagination } from '@/components/common/pagination';
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
import type { ILlmConfigItem, ILlmConfigPayload } from '@/types/agent';

// 表单默认值：必填项空缺待用户填，运行参数走业内默认值并藏在折叠区
const DEFAULT_FORM: ILlmConfigPayload = {
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
  enable_thinking: false,
  enable_tools: true,
  enable_prompt_cache: false,
  enable_memory: true,
  temperature: 0.7,
  top_p: 0.9,
  max_tokens: 2048,
  presence_penalty: 0,
  frequency_penalty: 0,
};

function formatDate(value?: string | null) {
  if (!value) return '未测试';
  return new Intl.DateTimeFormat('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' }).format(new Date(value));
}

function formFromConfig(config: ILlmConfigItem): ILlmConfigPayload {
  return {
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
    enable_thinking: config.enable_thinking,
    enable_tools: config.enable_tools,
    enable_prompt_cache: config.enable_prompt_cache,
    enable_memory: config.enable_memory,
    temperature: config.temperature,
    top_p: config.top_p,
    max_tokens: config.max_tokens,
    presence_penalty: config.presence_penalty,
    frequency_penalty: config.frequency_penalty,
  };
}

function getRequestErrorMessage(error: unknown, fallback: string) {
  if (error && typeof error === 'object' && 'response' in error) {
    const response = (error as { response?: { data?: { message?: string; detail?: string } } }).response;
    return response?.data?.message || response?.data?.detail || fallback;
  }
  return fallback;
}

interface ConfigDialogProps {
  open: boolean;
  mode: 'create' | 'edit';
  config: ILlmConfigItem | null;
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

function ConfigDialog({ open, mode, config, saving, errorMessage, onClose, onSubmit }: ConfigDialogProps) {
  const [form, setForm] = useState<ILlmConfigPayload>(() => ({ ...DEFAULT_FORM }));
  const [extraBodyText, setExtraBodyText] = useState('');

  useEffect(() => {
    if (!open) return;
    const nextForm = mode === 'edit' && config ? formFromConfig(config) : { ...DEFAULT_FORM };
    setForm(nextForm);
    setExtraBodyText(nextForm.extra_body ? JSON.stringify(nextForm.extra_body, null, 2) : '');
  }, [config, mode, open]);

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
            <p className="mt-1 text-sm text-slate-500">所有员工共享同一份全局模型配置，仅管理员可维护。</p>
          </div>
          <button type="button" onClick={onClose} aria-label="关闭" className="rounded-lg p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
            <X size={18} />
          </button>
        </div>
        <form className="space-y-5 px-6 py-5" onSubmit={handleSubmit}>
          {errorMessage && <div role="alert" className="flex gap-2 rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-700"><AlertCircle size={16} className="mt-0.5 shrink-0" aria-hidden="true" /><span>{errorMessage}</span></div>}

          {/* 必填项：默认全部展开 */}
          <section className="space-y-3">
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">基础信息</p>
            <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
              <div className="space-y-1.5"><Label>配置名称 *</Label><Input value={form.config_name} onChange={(event) => setForm((prev) => ({ ...prev, config_name: event.target.value }))} placeholder="例如：Qwen Plus" required /></div>
              <div className="space-y-1.5"><Label>模型名 *</Label><Input value={form.model_name} onChange={(event) => setForm((prev) => ({ ...prev, model_name: event.target.value }))} placeholder="qwen-plus" required /></div>
            </div>
            <div className="space-y-1.5"><Label>Base URL *</Label><Input value={form.base_url} onChange={(event) => setForm((prev) => ({ ...prev, base_url: event.target.value }))} placeholder="https://dashscope.aliyuncs.com/compatible-mode/v1" required /></div>
            <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
              <div className="space-y-1.5"><Label>API Key {mode === 'create' && '*'}</Label><Input type="password" value={form.api_key} onChange={(event) => setForm((prev) => ({ ...prev, api_key: event.target.value }))} placeholder={mode === 'edit' ? '留空则不更新密钥' : '保存后将加密存储'} required={mode === 'create'} /></div>
              <div className="space-y-1.5"><Label>状态</Label><Select value={String(form.status)} onValueChange={(value) => setForm((prev) => ({ ...prev, status: Number(value) }))}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="1">启用</SelectItem><SelectItem value="0">停用</SelectItem></SelectContent></Select></div>
            </div>
          </section>

          {/* 高级参数：默认折叠；含 fallback、超时、重试、运行参数、扩展 JSON */}
          <details className="group rounded-xl border border-slate-200 bg-slate-50/40 open:bg-white">
            <summary className="flex cursor-pointer select-none items-center justify-between gap-2 px-4 py-3 text-sm font-medium text-slate-700">
              <span>高级参数（可选）</span>
              <ChevronDown size={16} className="text-slate-400 transition-transform group-open:rotate-180" aria-hidden="true" />
            </summary>
            <div className="space-y-3 border-t border-slate-200 px-4 py-4">
              <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
                <div className="space-y-1.5"><Label>兜底模型</Label><Input value={form.fallback_model_name || ''} onChange={(event) => setForm((prev) => ({ ...prev, fallback_model_name: event.target.value }))} placeholder="可选" /></div>
                <div className="space-y-1.5"><Label>超时秒数</Label><Input type="number" min={1} max={120} value={form.timeout_seconds} onChange={(event) => setForm((prev) => ({ ...prev, timeout_seconds: Number(event.target.value) }))} /></div>
                <div className="space-y-1.5"><Label>重试次数</Label><Input type="number" min={0} max={2} value={form.max_retries} onChange={(event) => setForm((prev) => ({ ...prev, max_retries: Number(event.target.value) }))} /></div>
              </div>
              <div className="grid grid-cols-1 gap-3 md:grid-cols-4">
                <div className="space-y-1.5"><Label>思考模式</Label><Select value={String(form.enable_thinking)} onValueChange={(value) => setForm((prev) => ({ ...prev, enable_thinking: value === 'true' }))}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="false">关闭</SelectItem><SelectItem value="true">开启</SelectItem></SelectContent></Select></div>
                <div className="space-y-1.5"><Label>工具调用</Label><Select value={String(form.enable_tools)} onValueChange={(value) => setForm((prev) => ({ ...prev, enable_tools: value === 'true' }))}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="true">开启</SelectItem><SelectItem value="false">关闭</SelectItem></SelectContent></Select></div>
                <div className="space-y-1.5"><Label>Prompt Cache</Label><Select value={String(form.enable_prompt_cache)} onValueChange={(value) => setForm((prev) => ({ ...prev, enable_prompt_cache: value === 'true' }))}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="false">关闭</SelectItem><SelectItem value="true">开启</SelectItem></SelectContent></Select></div>
                <div className="space-y-1.5"><Label>上下文记忆</Label><Select value={String(form.enable_memory)} onValueChange={(value) => setForm((prev) => ({ ...prev, enable_memory: value === 'true' }))}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="true">开启</SelectItem><SelectItem value="false">关闭</SelectItem></SelectContent></Select></div>
              </div>
              <div className="grid grid-cols-1 gap-3 md:grid-cols-5">
                <div className="space-y-1.5"><Label>Temperature</Label><Input type="number" min={0} max={2} step={0.01} value={form.temperature} onChange={(event) => setForm((prev) => ({ ...prev, temperature: Number(event.target.value) }))} /></div>
                <div className="space-y-1.5"><Label>Top P</Label><Input type="number" min={0} max={1} step={0.01} value={form.top_p} onChange={(event) => setForm((prev) => ({ ...prev, top_p: Number(event.target.value) }))} /></div>
                <div className="space-y-1.5"><Label>Max Tokens</Label><Input type="number" min={1} max={32000} value={form.max_tokens} onChange={(event) => setForm((prev) => ({ ...prev, max_tokens: Number(event.target.value) }))} /></div>
                <div className="space-y-1.5"><Label>Presence</Label><Input type="number" min={-2} max={2} step={0.01} value={form.presence_penalty} onChange={(event) => setForm((prev) => ({ ...prev, presence_penalty: Number(event.target.value) }))} /></div>
                <div className="space-y-1.5"><Label>Frequency</Label><Input type="number" min={-2} max={2} step={0.01} value={form.frequency_penalty} onChange={(event) => setForm((prev) => ({ ...prev, frequency_penalty: Number(event.target.value) }))} /></div>
              </div>
              <div className="space-y-1.5"><Label>扩展参数 JSON</Label><Textarea value={extraBodyText} onChange={(event) => setExtraBodyText(event.target.value)} className="min-h-[110px] font-mono text-xs" placeholder='{"enable_thinking": false}' /></div>
            </div>
          </details>

          <div className="flex justify-end gap-2 border-t border-slate-100 pt-4"><Button type="button" variant="outline" onClick={onClose} disabled={saving}>取消</Button><Button type="submit" disabled={saving}>{saving ? '保存中...' : mode === 'create' ? '保存配置' : '保存修改'}</Button></div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export default function EmployeeLlmConfigs() {
  const [configs, setConfigs] = useState<ILlmConfigItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [testingId, setTestingId] = useState<number | null>(null);
  const [errorMessage, setErrorMessage] = useState('');
  const [dialogState, setDialogState] = useState<{ mode: 'create' | 'edit'; config: ILlmConfigItem | null } | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<ILlmConfigItem | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [keyword, setKeyword] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);
  const [total, setTotal] = useState(0);

  const filteredConfigs = useMemo(() => configs, [configs]);

  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      const params: { page: number; page_size: number; keyword?: string; status?: number } = { page, page_size: pageSize };
      if (keyword.trim()) params.keyword = keyword.trim();
      if (statusFilter !== 'all') params.status = Number(statusFilter);
      const configRes = await employeeLlmApi.listConfigs(params);
      setConfigs(configRes.data?.items || []);
      setTotal(configRes.data?.total || 0);
    } finally {
      setLoading(false);
    }
  }, [keyword, page, pageSize, statusFilter]);

  useEffect(() => { loadData(); }, [loadData]);

  const closeDialog = () => { setDialogState(null); setErrorMessage(''); };

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
      setErrorMessage(error instanceof SyntaxError ? '扩展参数 JSON 格式不正确，请检查后重试。' : getRequestErrorMessage(error, '保存失败，请检查模型配置后重试。'));
    } finally {
      setSaving(false);
    }
  };

  const testConfig = async (id: number) => {
    setTestingId(id);
    setErrorMessage('');
    try { await employeeLlmApi.testConfig(id); await loadData(); } catch (error) { setErrorMessage(getRequestErrorMessage(error, '测试失败，请检查模型配置后重试。')); } finally { setTestingId(null); }
  };

  const handleDelete = async () => {
    if (!deleteTarget) return;
    setDeleting(true);
    setErrorMessage('');
    try { await employeeLlmApi.deleteConfig(deleteTarget.id); setDeleteTarget(null); await loadData(); } catch (error) { setErrorMessage(getRequestErrorMessage(error, '删除失败，请稍后重试。')); } finally { setDeleting(false); }
  };

  return (
    <AdminLayout breadcrumbs={[{ label: 'Agent 平台' }, { label: '模型配置' }]} title="模型配置" headerAction={<div className="flex items-center gap-2"><Button type="button" variant="outline" onClick={loadData} disabled={loading} className="bg-white"><RefreshCw size={15} className="mr-1.5" aria-hidden="true" />刷新</Button><Button type="button" onClick={() => setDialogState({ mode: 'create', config: null })}><PlusCircle size={15} className="mr-1.5" aria-hidden="true" />新增配置</Button></div>}>
      <div className="space-y-4">
        <Card className="border-white/80 bg-white/90 backdrop-blur">
          <CardHeader className="border-b border-slate-100 bg-white/70">
            <CardTitle className="flex items-center gap-2"><ShieldCheck size={18} className="text-primary" aria-hidden="true" />全局模型配置</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-1 gap-3 lg:grid-cols-[minmax(0,1fr)_160px]">
              <div className="relative"><Search size={16} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" aria-hidden="true" /><Input value={keyword} onChange={(event) => { setKeyword(event.target.value); setPage(1); }} className="pl-9" placeholder="搜索配置名称、模型名或 Base URL" /></div>
              <Select value={statusFilter} onValueChange={(value) => { setStatusFilter(value); setPage(1); }}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="all">全部状态</SelectItem><SelectItem value="1">启用</SelectItem><SelectItem value="0">停用</SelectItem></SelectContent></Select>
            </div>
            <div className="space-y-3">
              {filteredConfigs.map((config) => (
                <ConfigCard
                  key={config.id}
                  config={config}
                  canManage={Boolean(config.can_manage)}
                  testing={testingId === config.id}
                  onEdit={() => setDialogState({ mode: 'edit', config })}
                  onTest={() => testConfig(config.id)}
                  onDelete={() => setDeleteTarget(config)}
                />
              ))}
              {!loading && filteredConfigs.length === 0 && <div className="rounded-2xl border border-dashed border-sky-200 bg-sky-50/50 p-6 text-sm text-slate-600">暂无符合条件的模型配置。</div>}
            </div>
            <Pagination page={page} pageSize={pageSize} total={total} onChange={setPage} onPageSizeChange={(size) => { setPageSize(size); setPage(1); }} />
          </CardContent>
        </Card>
      </div>
      <ConfigDialog open={!!dialogState} mode={dialogState?.mode ?? 'create'} config={dialogState?.config ?? null} saving={saving} errorMessage={errorMessage} onClose={closeDialog} onSubmit={saveConfig} />
      <ConfirmDialog open={!!deleteTarget} title="确认删除模型配置" description={`确定要删除「${deleteTarget?.config_name}」吗？删除操作将使用软删除。`} confirmLabel="删除" onConfirm={handleDelete} onCancel={() => setDeleteTarget(null)} loading={deleting} />
    </AdminLayout>
  );
}
