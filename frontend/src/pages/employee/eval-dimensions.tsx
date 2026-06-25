import { useCallback, useEffect, useRef, useState } from 'react';
import { AdminLayout } from '@/components/layout/admin-layout';
import { ConfirmDialog } from '@/components/common/confirm-dialog';
import { MarkdownPreviewDialog } from '@/components/common/markdown-preview-dialog';
import { Pagination } from '@/components/common/pagination';
import { employeeEvalTemplatesApi } from '@/api/employee/eval-templates';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { useDebounce } from '@/hooks/use-debounce';
import { Bot, Eye, Layers3, Loader2, Pencil, Plus, RefreshCw, RotateCcw, Trash2, X } from 'lucide-react';
import type { IEvalDimension, IEvalDimensionAiSuggestion } from '@/types/employee';

const DEFAULT_PAGE_SIZE = 10;
const REFRESH_THROTTLE_MS = 1500;
const getResponseData = <T,>(res: any, fallback: T): T => res?.data?.data ?? res?.data ?? fallback;
type DialogMode = 'create' | 'edit' | 'view';

interface DimensionDialogProps {
  mode: DialogMode;
  dimension: IEvalDimension | null;
  onClose: () => void;
  onSuccess: () => void;
}

function DimensionDialog({ mode, dimension, onClose, onSuccess }: DimensionDialogProps) {
  const readonly = mode === 'view' || (dimension?.template_count ?? 0) > 0;
  const [dimensionName, setDimensionName] = useState(dimension?.dimension_name ?? '');
  const [description, setDescription] = useState(dimension?.description ?? '');
  const [promptTemplate, setPromptTemplate] = useState(dimension?.default_prompt_template ?? '');
  const [status, setStatus] = useState(String(dimension?.status ?? 1));
  const [sortOrder, setSortOrder] = useState(String(dimension?.sort_order ?? 0));
  const [aiOpen, setAiOpen] = useState(false);
  const [previewOpen, setPreviewOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (readonly) return;
    if (!dimensionName.trim()) return;
    setSaving(true);
    setError('');
    const payload = {
      dimension_name: dimensionName.trim(),
      description: description.trim() || undefined,
      default_prompt_template: promptTemplate.trim() || undefined,
      sort_order: Number(sortOrder) || 0,
      status: Number(status),
    };
    try {
      if (mode === 'create') await employeeEvalTemplatesApi.createDimension(payload);
      else if (dimension) await employeeEvalTemplatesApi.updateDimension(dimension.id, payload);
      onSuccess();
    } catch (err: any) {
      setError(err?.response?.data?.message || '保存失败，请重试');
      setSaving(false);
    }
  };

  const handleApplyAiSuggestion = (suggestion: IEvalDimensionAiSuggestion) => {
    setDimensionName(suggestion.dimension_name);
    setDescription(suggestion.description || '');
    setPromptTemplate(suggestion.default_prompt_template || '');
    setError('');
    setAiOpen(false);
  };

  return (
    <Dialog open onOpenChange={onClose} containerClassName="max-w-3xl">
      <DialogContent>
        <div className="mb-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <DialogTitle className="mb-0">{mode === 'create' ? '新增评估维度' : mode === 'edit' ? '编辑评估维度' : '查看评估维度'}</DialogTitle>
            {mode === 'create' && !readonly && <Button type="button" variant="outline" size="sm" onClick={() => setAiOpen(true)}><Bot size={14} className="mr-1.5" />AI 生成</Button>}
          </div>
          <button onClick={onClose} aria-label="关闭" className="text-[#94A3B8] hover:text-[#1E293B] focus-visible:outline-none"><X size={18} /></button>
        </div>
        {readonly && mode !== 'view' && <p className="mb-3 rounded-md bg-amber-50 px-3 py-2 text-sm text-amber-700">已有模板引用该维度，只能查看，不能修改。</p>}
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="dimension-name">维度名称 <span className="text-red-500">*</span></Label>
              <Input id="dimension-name" value={dimensionName} onChange={e => setDimensionName(e.target.value)} disabled={readonly} required />
            </div>
            <div className="space-y-1.5">
              <Label>状态</Label>
              <Select value={status} onValueChange={(value) => { if (!readonly) setStatus(value); }}>
                <SelectTrigger className={readonly ? 'pointer-events-none opacity-60' : undefined}><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="1">启用</SelectItem>
                  <SelectItem value="0">停用</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="dimension-desc">维度说明</Label>
            <Input id="dimension-desc" value={description} onChange={e => setDescription(e.target.value)} disabled={readonly} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="dimension-sort">排序</Label>
            <Input id="dimension-sort" type="number" value={sortOrder} onChange={e => setSortOrder(e.target.value)} disabled={readonly} />
          </div>
          <div className="space-y-1.5">
            <div className="flex items-center justify-between gap-2">
              <Label>默认评估提示词模板</Label>
              <Button type="button" variant="outline" size="sm" onClick={() => setPreviewOpen(true)}>
                <Eye size={14} className="mr-1" />查看提示词模板
              </Button>
            </div>
            <div className="rounded-md border border-dashed border-[#CBD5E1] bg-[#F8FAFC] px-3 py-2 text-xs text-[#64748B]">
              提示词模板不在当前区域直接展示
            </div>
          </div>
          {dimension && <p className="text-sm text-[#64748B]">引用模板数：{dimension.template_count ?? 0}</p>}
          {error && <p className="text-sm text-red-500">{error}</p>}
          <div className="flex justify-end gap-2 pt-1">
            <Button type="button" variant="outline" onClick={onClose} disabled={saving}>关闭</Button>
            {!readonly && <Button type="submit" disabled={saving || !dimensionName.trim()} className="bg-[#2563EB] hover:bg-[#1D4ED8] text-white">{saving ? <><Loader2 size={14} className="mr-1.5 animate-spin" />保存中…</> : '保存'}</Button>}
          </div>
        </form>
        {aiOpen && <AiSuggestDialog onClose={() => setAiOpen(false)} onApply={handleApplyAiSuggestion} />}
        <MarkdownPreviewDialog
          open={previewOpen}
          title="默认评估提示词模板"
          content={promptTemplate}
          editable={!readonly}
          onClose={() => setPreviewOpen(false)}
          onSave={setPromptTemplate}
        />
      </DialogContent>
    </Dialog>
  );
}

interface AiSuggestDialogProps {
  onClose: () => void;
  onApply: (suggestion: IEvalDimensionAiSuggestion) => void;
}

function AiSuggestDialog({ onClose, onApply }: AiSuggestDialogProps) {
  const abortRef = useRef<AbortController | null>(null);
  const [jobName, setJobName] = useState('');
  const [jobDescription, setJobDescription] = useState('');
  const [suggesting, setSuggesting] = useState(false);
  const [error, setError] = useState('');

  const cancelSuggest = () => {
    abortRef.current?.abort();
    abortRef.current = null;
    setSuggesting(false);
  };

  const handleClose = () => {
    abortRef.current?.abort();
    abortRef.current = null;
    onClose();
  };

  const handleSuggest = async () => {
    if (!jobName.trim()) return;
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    setSuggesting(true);
    setError('');
    try {
      const res = await employeeEvalTemplatesApi.suggestDimension({ job_name: jobName, job_description: jobDescription }, controller.signal);
      const data = getResponseData<IEvalDimensionAiSuggestion | null>(res, null);
      if (!data?.dimension_name?.trim()) {
        setError('AI 未返回维度建议，请补充岗位信息后重试');
        return;
      }
      onApply(data);
    } catch (err: any) {
      if (err?.code === 'ERR_CANCELED' || err?.name === 'CanceledError' || err?.name === 'AbortError') {
        setError('已中断 AI 生成');
        return;
      }
      setError(err?.response?.data?.message || 'AI 生成失败，请重试');
    } finally {
      if (abortRef.current === controller) {
        abortRef.current = null;
        setSuggesting(false);
      }
    }
  };

  return (
    <Dialog open onOpenChange={handleClose} containerClassName="max-w-2xl">
      <DialogContent>
        <div className="mb-4 flex items-center justify-between">
          <DialogTitle className="mb-0">AI 生成维度</DialogTitle>
          <button onClick={handleClose} aria-label="关闭" className="text-[#94A3B8] hover:text-[#1E293B] focus-visible:outline-none"><X size={18} /></button>
        </div>
        <div className="space-y-4">
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="ai-job-name">岗位名称 <span className="text-red-500">*</span></Label>
              <Input id="ai-job-name" value={jobName} onChange={e => setJobName(e.target.value)} placeholder="如：Java 后端工程师" />
            </div>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="ai-job-desc">岗位描述</Label>
            <Textarea id="ai-job-desc" value={jobDescription} onChange={e => setJobDescription(e.target.value)} className="min-h-[90px] resize-none" />
          </div>
          {error && <p className="text-sm text-red-500">{error}</p>}
          <div className="flex justify-end gap-2 pt-1">
            <Button type="button" variant="outline" onClick={handleClose} disabled={suggesting}>关闭</Button>
            {suggesting && <Button type="button" variant="outline" onClick={cancelSuggest}>中断</Button>}
            <Button type="button" onClick={handleSuggest} disabled={suggesting || !jobName.trim()} className="bg-[#2563EB] hover:bg-[#1D4ED8] text-white">
              {suggesting ? <><Loader2 size={14} className="mr-1.5 animate-spin" />生成中…</> : <><Bot size={14} className="mr-1.5" />确认生成</>}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

export default function EmployeeEvalDimensions() {
  const [dimensions, setDimensions] = useState<IEvalDimension[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(DEFAULT_PAGE_SIZE);
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState('');
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const lastRefreshAtRef = useRef(0);
  const [dialogState, setDialogState] = useState<{ mode: DialogMode; dimension: IEvalDimension | null } | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<IEvalDimension | null>(null);
  const [deleting, setDeleting] = useState(false);
  const debouncedSearch = useDebounce(search, 350);

  const loadDimensions = useCallback(async () => {
    setLoading(true);
    try {
      const params: Record<string, string | number> = { page, page_size: pageSize };
      if (debouncedSearch) params.search = debouncedSearch;
      if (status) params.status = Number(status);
      const res = await employeeEvalTemplatesApi.listDimensions(params);
      const data = getResponseData<{ total: number; items: IEvalDimension[] }>(res, { total: 0, items: [] });
      setDimensions(data.items ?? []);
      setTotal(data.total ?? 0);
    } finally {
      setLoading(false);
    }
  }, [debouncedSearch, page, pageSize, status]);

  useEffect(() => { loadDimensions(); }, [loadDimensions]);
  useEffect(() => { setPage(1); }, [debouncedSearch, status]);

  const handleDelete = async () => {
    if (!deleteTarget) return;
    setDeleting(true);
    try {
      await employeeEvalTemplatesApi.deleteDimension(deleteTarget.id);
      setDeleteTarget(null);
      await loadDimensions();
    } finally {
      setDeleting(false);
    }
  };

  const handleRefresh = async () => {
    const now = Date.now();
    if (refreshing || now - lastRefreshAtRef.current < REFRESH_THROTTLE_MS) return;
    lastRefreshAtRef.current = now;
    setRefreshing(true);
    try {
      await loadDimensions();
    } finally {
      setRefreshing(false);
    }
  };

  const handleResetFilters = () => {
    setSearch('');
    setStatus('');
    setPage(1);
  };

  const hasActiveFilters = search || status;

  return (
    <AdminLayout
      breadcrumbs={[{ label: '维度管理' }]}
      title="维度管理"
      headerAction={
        <div className="flex items-center gap-3">
          <Button variant="outline" onClick={handleRefresh} disabled={refreshing || loading} className="bg-white">
            <RefreshCw size={16} className={`mr-1.5 ${refreshing ? 'animate-spin' : ''}`} />刷新
          </Button>
          <Button onClick={() => setDialogState({ mode: 'create', dimension: null })} className="bg-[#2563EB] hover:bg-[#1D4ED8] text-white"><Plus size={16} className="mr-1.5" />新增维度</Button>
        </div>
      }
    >
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <Input value={search} onChange={e => setSearch(e.target.value)} placeholder="搜索维度名称…" className="w-56 bg-white" />
        <Select value={status} onValueChange={setStatus}>
          <SelectTrigger className="w-32 bg-white"><SelectValue placeholder="全部状态" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="">全部状态</SelectItem>
            <SelectItem value="1">启用</SelectItem>
            <SelectItem value="0">停用</SelectItem>
          </SelectContent>
        </Select>
        <Button variant="outline" onClick={handleResetFilters} disabled={!hasActiveFilters} className="bg-white text-[#64748B]">
          <RotateCcw size={14} className="mr-1" />重置
        </Button>
      </div>

      <div className="overflow-hidden rounded-lg border border-[#E2E8F0] bg-white">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-[#E2E8F0] bg-[#F8FAFC]">
              <th className="px-4 py-3 text-left font-medium text-[#64748B]">维度名称</th>
              <th className="px-4 py-3 text-left font-medium text-[#64748B]">说明</th>
              <th className="px-4 py-3 text-left font-medium text-[#64748B]">状态</th>
              <th className="px-4 py-3 text-left font-medium text-[#64748B]">排序</th>
              <th className="px-4 py-3 text-left font-medium text-[#64748B]">引用模板</th>
              <th className="px-4 py-3 text-right font-medium text-[#64748B]">操作</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              [...Array(4)].map((_, index) => (
                <tr key={index} className="border-b border-[#F1F5F9]">
                  {[...Array(6)].map((__, cellIndex) => <td key={cellIndex} className="px-4 py-3"><div className="h-4 animate-pulse rounded bg-[#F1F5F9]" /></td>)}
                </tr>
              ))
            ) : dimensions.length === 0 ? (
              <tr><td colSpan={6} className="px-4 py-16 text-center text-[#94A3B8]">暂无评估维度</td></tr>
            ) : dimensions.map(dimension => {
              const locked = (dimension.template_count ?? 0) > 0;
              return (
                <tr key={dimension.id} className="border-b border-[#F1F5F9] transition-colors hover:bg-[#F8FAFC]">
                  <td className="px-4 py-3 font-medium text-[#1E293B]"><Layers3 size={14} className="mr-1.5 inline text-[#94A3B8]" />{dimension.dimension_name}</td>
                  <td className="px-4 py-3 text-[#64748B]"><span className="line-clamp-1 max-w-xs">{dimension.description || '-'}</span></td>
                  <td className="px-4 py-3">{dimension.status === 1 ? <Badge className="bg-green-100 text-green-700 border-green-200">启用</Badge> : <Badge className="bg-[#F1F5F9] text-[#64748B] border-[#E2E8F0]">停用</Badge>}</td>
                  <td className="px-4 py-3 text-[#64748B] tabular-nums">{dimension.sort_order ?? 0}</td>
                  <td className="px-4 py-3 text-[#64748B] tabular-nums">{dimension.template_count ?? 0}</td>
                  <td className="px-4 py-3">
                    <div className="flex items-center justify-end gap-2">
                      <button onClick={() => setDialogState({ mode: 'view', dimension })} className="inline-flex items-center gap-1 rounded px-2 py-1 text-xs text-[#64748B] hover:bg-[#F1F5F9] hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#2563EB]"><Eye size={13} />查看</button>
                      <button onClick={() => setDialogState({ mode: 'edit', dimension })} disabled={locked} title={locked ? '已有模板引用该维度，不允许修改' : undefined} className="inline-flex items-center gap-1 rounded px-2 py-1 text-xs text-[#2563EB] hover:bg-blue-50 hover:underline disabled:cursor-not-allowed disabled:text-[#94A3B8] disabled:hover:bg-transparent disabled:hover:no-underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#2563EB]"><Pencil size={13} />编辑</button>
                      <button onClick={() => setDeleteTarget(dimension)} disabled={locked} title={locked ? '已有模板引用该维度，不允许删除' : undefined} className="inline-flex items-center gap-1 rounded px-2 py-1 text-xs text-red-500 hover:bg-red-50 hover:underline disabled:cursor-not-allowed disabled:text-[#94A3B8] disabled:hover:bg-transparent disabled:hover:no-underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-400"><Trash2 size={13} />删除</button>
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <Pagination page={page} pageSize={pageSize} total={total} onChange={setPage} onPageSizeChange={(size) => { setPageSize(size); setPage(1); }} />

      {dialogState && <DimensionDialog mode={dialogState.mode} dimension={dialogState.dimension} onClose={() => setDialogState(null)} onSuccess={() => { setDialogState(null); loadDimensions(); }} />}
      <ConfirmDialog open={!!deleteTarget} title="确认删除评估维度" description={`确定要删除「${deleteTarget?.dimension_name}」吗？`} confirmLabel="删除" onConfirm={handleDelete} onCancel={() => setDeleteTarget(null)} loading={deleting} />
    </AdminLayout>
  );
}
