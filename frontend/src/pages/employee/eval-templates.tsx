import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AdminLayout } from '@/components/layout/admin-layout';
import { ConfirmDialog } from '@/components/common/confirm-dialog';
import { MarkdownPreviewDialog } from '@/components/common/markdown-preview-dialog';
import { Pagination } from '@/components/common/pagination';
import { employeeEvalTemplatesApi } from '@/api/employee/eval-templates';
import { employeeTagsApi } from '@/api/employee/tags';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { useDebounce } from '@/hooks/use-debounce';
import { Bot, Eye, FileText, Loader2, Pencil, Plus, RefreshCw, RotateCcw, Trash2, X } from 'lucide-react';
import type { IEvalDimension, IEvalTemplate, ITag } from '@/types/employee';

const DEFAULT_PAGE_SIZE = 10;
const REFRESH_THROTTLE_MS = 1500;
const SKILL_TYPE_OPTIONS = [
  { value: 1, label: '必须满足', cls: 'bg-red-100 text-red-700' },
  { value: 2, label: '优先匹配', cls: 'bg-yellow-100 text-yellow-700' },
  { value: 3, label: '普通技能', cls: 'bg-[#F1F5F9] text-[#64748B]' },
];
const TAG_TYPE_LABEL: Record<number, string> = { 1: '岗位特性', 2: '福利待遇', 3: '技能加分' };
const getResponseData = <T,>(res: any, fallback: T): T => res?.data?.data ?? res?.data ?? fallback;

type DialogMode = 'create' | 'edit' | 'view';

interface DimensionDraft {
  dimension_id?: number;
  dimension_name: string;
  weight: string;
  prompt_template: string;
  sort_order: number;
}

interface SkillDraft {
  skill_name: string;
  skill_type: string;
  match_label: string;
}

interface TemplateDialogProps {
  mode: DialogMode;
  template: IEvalTemplate | null;
  tags: ITag[];
  dimensionOptions: IEvalDimension[];
  onClose: () => void;
  onSuccess: () => void;
}

function normalizeTags(res: any): ITag[] {
  const data = getResponseData<ITag[] | { items: ITag[] }>(res, []);
  return Array.isArray(data) ? data : data.items ?? [];
}

function TemplateDialog({ mode, template, tags, dimensionOptions, onClose, onSuccess }: TemplateDialogProps) {
  const readonly = mode === 'view' || (template?.published_job_count ?? 0) > 0;
  const [templateName, setTemplateName] = useState(template?.template_name ?? '');
  const [description, setDescription] = useState(template?.description ?? '');
  const [status, setStatus] = useState(String(template?.status ?? 1));
  const [dimensions, setDimensions] = useState<DimensionDraft[]>(
    template?.dimensions?.map((item, index) => ({
      dimension_id: item.dimension_id,
      dimension_name: item.dimension_name,
      weight: String(item.weight),
      prompt_template: item.prompt_template ?? '',
      sort_order: item.sort_order ?? index,
    })) ?? []
  );
  const [dimensionPickerOpen, setDimensionPickerOpen] = useState(false);
  const [dimensionSearch, setDimensionSearch] = useState('');
  const [skills, setSkills] = useState<SkillDraft[]>(
    template?.skills?.map(item => ({
      skill_name: item.skill_name,
      skill_type: String(item.skill_type),
      match_label: item.match_label ?? '',
    })) ?? []
  );
  const [selectedTagIds, setSelectedTagIds] = useState<number[]>(template?.tags?.map(tag => tag.id) ?? []);
  const [previewPrompt, setPreviewPrompt] = useState<{ index: number; title: string; content: string } | null>(null);
  const skillAiAbortRef = useRef<AbortController | null>(null);
  const [skillSuggesting, setSkillSuggesting] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const totalWeight = useMemo(() => dimensions.reduce((sum, item) => sum + (Number(item.weight) || 0), 0), [dimensions]);
  const weightOk = dimensions.length > 0 && Math.abs(totalWeight - 1) <= 0.01;

  const updateDimension = (index: number, patch: Partial<DimensionDraft>) => {
    setDimensions(prev => prev.map((item, idx) => idx === index ? { ...item, ...patch } : item));
  };

  const filteredDimensionOptions = useMemo(() => {
    const keyword = dimensionSearch.trim().toLowerCase();
    if (!keyword) return dimensionOptions;
    return dimensionOptions.filter(item => item.dimension_name.toLowerCase().includes(keyword));
  }, [dimensionOptions, dimensionSearch]);

  const toggleDimension = (dimension: IEvalDimension) => {
    if (readonly) return;
    setDimensions(prev => {
      if (prev.some(item => item.dimension_id === dimension.id)) {
        return prev.filter(item => item.dimension_id !== dimension.id);
      }
      return [
        ...prev,
        {
          dimension_id: dimension.id,
          dimension_name: dimension.dimension_name,
          weight: '0',
          prompt_template: dimension.default_prompt_template || '',
          sort_order: prev.length,
        },
      ];
    });
  };

  const updateSkill = (index: number, patch: Partial<SkillDraft>) => {
    setSkills(prev => prev.map((item, idx) => idx === index ? { ...item, ...patch } : item));
  };

  const cancelSkillSuggest = () => {
    skillAiAbortRef.current?.abort();
    skillAiAbortRef.current = null;
    setSkillSuggesting(false);
  };

  const handleSuggestSkills = async () => {
    if (readonly) return;
    const validDimensions = dimensions.filter(item => item.dimension_name.trim());
    if (validDimensions.length === 0) {
      setError('请先选择评估维度');
      return;
    }
    skillAiAbortRef.current?.abort();
    const controller = new AbortController();
    skillAiAbortRef.current = controller;
    setSkillSuggesting(true);
    setError('');
    try {
      const res = await employeeEvalTemplatesApi.suggestTemplateSkills({
        dimensions: validDimensions.map(item => ({
          dimension_name: item.dimension_name,
          weight: Number(item.weight) || 0,
          prompt_template: item.prompt_template || '',
        })),
      }, controller.signal);
      const data = getResponseData<{ skills: Array<{ skill_name: string; skill_type: number; match_label?: string }> } | null>(res, null);
      const nextSkills = data?.skills?.filter(item => item.skill_name?.trim()) ?? [];
      if (nextSkills.length === 0) {
        setError('AI 未返回技能建议，请调整维度后重试');
        return;
      }
      setSkills(nextSkills.map(item => ({
        skill_name: item.skill_name,
        skill_type: String(item.skill_type || 3),
        match_label: item.match_label ?? '',
      })));
    } catch (err: any) {
      if (err?.code === 'ERR_CANCELED' || err?.name === 'CanceledError' || err?.name === 'AbortError') {
        setError('已中断 AI 生成');
        return;
      }
      setError(err?.response?.data?.message || 'AI 生成技能失败，请重试');
    } finally {
      if (skillAiAbortRef.current === controller) {
        skillAiAbortRef.current = null;
        setSkillSuggesting(false);
      }
    }
  };

  const equalizeWeights = () => {
    if (readonly || dimensions.length === 0) return;
    const weight = Number((1 / dimensions.length).toFixed(2));
    const lastWeight = Number((1 - weight * (dimensions.length - 1)).toFixed(2));
    setDimensions(prev => prev.map((item, index) => ({ ...item, weight: String(index === prev.length - 1 ? lastWeight : weight) })));
  };

  const toggleTag = (tagId: number) => {
    if (readonly) return;
    setSelectedTagIds(prev => prev.includes(tagId) ? prev.filter(id => id !== tagId) : [...prev, tagId]);
  };

  const handleClose = () => {
    skillAiAbortRef.current?.abort();
    skillAiAbortRef.current = null;
    onClose();
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (readonly) return;
    if (!templateName.trim()) return;
    if (dimensions.some(item => !item.dimension_id)) { setError('请选择评估维度'); return; }
    if (!weightOk) { setError(`评估维度权重合计必须为 1.00，当前为 ${totalWeight.toFixed(2)}`); return; }
    setSaving(true);
    setError('');
    try {
      const payload = {
        template_name: templateName.trim(),
        description: description.trim() || undefined,
        status: Number(status),
        dimensions: dimensions.map((item, index) => ({
          dimension_id: item.dimension_id as number,
          weight: Number(item.weight),
          prompt_template: item.prompt_template,
          sort_order: index,
        })),
        skills: skills
          .filter(item => item.skill_name.trim())
          .map(item => ({
            skill_name: item.skill_name.trim(),
            skill_type: Number(item.skill_type),
            match_label: item.match_label.trim() || undefined,
            is_ai_generated: 0,
          })),
        tag_ids: selectedTagIds,
      };
      if (mode === 'create') await employeeEvalTemplatesApi.create(payload);
      else if (template) await employeeEvalTemplatesApi.update(template.id, payload);
      onSuccess();
    } catch (err: any) {
      setError(err?.response?.data?.message || err?.message || '保存失败，请重试');
      setSaving(false);
    }
  };

  return (
    <Dialog open onOpenChange={handleClose} containerClassName="max-h-[90vh] max-w-5xl overflow-hidden">
      <DialogContent className="max-h-[90vh] overflow-y-auto">
        <div className="mb-4 flex items-center justify-between">
          <DialogTitle className="mb-0">{mode === 'create' ? '新增评估模板' : mode === 'edit' ? '编辑评估模板' : '查看评估模板'}</DialogTitle>
          <button onClick={handleClose} aria-label="关闭" className="text-[#94A3B8] hover:text-[#1E293B] focus-visible:outline-none">
            <X size={18} />
          </button>
        </div>
        {readonly && mode !== 'view' && <p className="mb-3 rounded-md bg-amber-50 px-3 py-2 text-sm text-amber-700">已有招聘中岗位绑定该模板，只能查看，不能修改。</p>}
        <form onSubmit={handleSubmit} className="space-y-5">
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="template-name">模板名称 <span className="text-red-500">*</span></Label>
              <Input id="template-name" value={templateName} onChange={e => setTemplateName(e.target.value)} disabled={readonly} required />
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
            <Label htmlFor="template-description">模板说明</Label>
            <Textarea id="template-description" value={description} onChange={e => setDescription(e.target.value)} disabled={readonly} className="min-h-[72px] resize-none" />
          </div>

          <section className="rounded-lg border border-[#E2E8F0] p-4">
            <div className="mb-3 flex items-center justify-between gap-3">
              <div>
                <h3 className="text-sm font-semibold text-[#1E293B]">评估维度</h3>
                <p className={`mt-1 text-xs ${weightOk ? 'text-[#64748B]' : 'text-red-500'}`}>权重合计：{totalWeight.toFixed(2)}</p>
              </div>
              {!readonly && (
                <div className="flex gap-2">
                  <Button type="button" variant="outline" size="sm" onClick={equalizeWeights}>均分权重</Button>
                  <Button type="button" variant="outline" size="sm" onClick={() => setDimensionPickerOpen(true)}>
                    <Plus size={14} className="mr-1" />选择维度
                  </Button>
                </div>
              )}
            </div>
            <button
              type="button"
              onFocus={() => { if (!readonly) setDimensionPickerOpen(true); }}
              onClick={() => { if (!readonly) setDimensionPickerOpen(true); }}
              disabled={readonly}
              className="mb-3 flex min-h-10 w-full flex-wrap items-center gap-2 rounded-md border border-[#E2E8F0] bg-white px-3 py-2 text-left text-sm disabled:cursor-default disabled:bg-[#F8FAFC]"
            >
              {dimensions.length > 0 ? dimensions.map(item => (
                <span key={item.dimension_id ?? item.dimension_name} className="inline-flex items-center rounded-full bg-blue-50 px-2.5 py-1 text-xs text-blue-700">
                  {item.dimension_name}
                </span>
              )) : <span className="text-[#94A3B8]">聚焦或点击选择评估维度</span>}
            </button>
            <div className="space-y-3">
              {dimensions.map((item, index) => (
                <div key={`${item.dimension_id ?? 'new'}-${index}`} className="rounded-md bg-[#F8FAFC] p-3">
                  <div className="grid grid-cols-1 gap-3 md:grid-cols-[1fr_110px_auto]">
                    <div className="flex items-center rounded-md border border-[#E2E8F0] bg-white px-3 text-sm font-medium text-[#1E293B]">{item.dimension_name}</div>
                    <Input type="number" min="0" max="1" step="0.01" value={item.weight} onChange={e => updateDimension(index, { weight: e.target.value })} disabled={readonly} placeholder="权重" />
                    {!readonly && <Button type="button" variant="outline" onClick={() => setDimensions(prev => prev.filter((_, idx) => idx !== index))} disabled={dimensions.length <= 1}>删除</Button>}
                  </div>
                  <div className="mt-2 flex items-center justify-between gap-2 rounded-md border border-dashed border-[#CBD5E1] bg-white px-3 py-2">
                    <span className="text-xs text-[#64748B]">提示词模板不在当前区域直接展示</span>
                    <Button type="button" variant="outline" size="sm" onClick={() => setPreviewPrompt({ index, title: `${item.dimension_name}提示词模板`, content: item.prompt_template })}>
                      <Eye size={14} className="mr-1" />查看提示词模板
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          </section>

          {dimensionPickerOpen && (
            <Dialog open onOpenChange={(open) => !open && setDimensionPickerOpen(false)} containerClassName="max-w-2xl">
              <DialogContent>
                <div className="mb-4 flex items-center justify-between">
                  <DialogTitle className="mb-0">选择评估维度</DialogTitle>
                  <button type="button" onClick={() => setDimensionPickerOpen(false)} aria-label="关闭" className="text-[#94A3B8] hover:text-[#1E293B] focus-visible:outline-none"><X size={18} /></button>
                </div>
                <Input value={dimensionSearch} onChange={e => setDimensionSearch(e.target.value)} placeholder="搜索维度名称…" className="mb-3" />
                <div className="max-h-80 space-y-2 overflow-auto">
                  {filteredDimensionOptions.length === 0 ? <p className="py-8 text-center text-sm text-[#94A3B8]">暂无可选维度，请先到维度管理中维护</p> : filteredDimensionOptions.map(option => {
                    const checked = dimensions.some(item => item.dimension_id === option.id);
                    return (
                      <button key={option.id} type="button" onClick={() => toggleDimension(option)} className={`block w-full rounded-lg border p-3 text-left transition-colors ${checked ? 'border-[#2563EB] bg-blue-50' : 'border-[#E2E8F0] bg-white hover:bg-[#F8FAFC]'}`}>
                        <div className="flex items-center justify-between gap-3">
                          <span className="font-medium text-[#1E293B]">{option.dimension_name}</span>
                          <Badge className={checked ? 'bg-blue-100 text-blue-700 border-blue-200' : 'bg-[#F1F5F9] text-[#64748B] border-[#E2E8F0]'}>{checked ? '已选' : '未选'}</Badge>
                        </div>
                        {option.description && <p className="mt-1 text-xs text-[#64748B]">{option.description}</p>}
                      </button>
                    );
                  })}
                </div>
                <div className="mt-4 flex justify-end">
                  <Button type="button" onClick={() => setDimensionPickerOpen(false)} className="bg-[#2563EB] hover:bg-[#1D4ED8] text-white">完成</Button>
                </div>
              </DialogContent>
            </Dialog>
          )}

          <section className="rounded-lg border border-[#E2E8F0] p-4">
            <div className="mb-3 flex items-center justify-between gap-3">
              <h3 className="text-sm font-semibold text-[#1E293B]">技能要求</h3>
              {!readonly && (
                <div className="flex gap-2">
                  <Button type="button" variant="outline" size="sm" onClick={handleSuggestSkills} disabled={skillSuggesting || dimensions.length === 0}>
                    {skillSuggesting ? <><Loader2 size={14} className="mr-1 animate-spin" />生成中…</> : <><Bot size={14} className="mr-1" />AI 生成</>}
                  </Button>
                  {skillSuggesting && <Button type="button" variant="outline" size="sm" onClick={cancelSkillSuggest}>中断</Button>}
                  <Button type="button" variant="outline" size="sm" onClick={() => setSkills(prev => [...prev, { skill_name: '', skill_type: '3', match_label: '' }])}><Plus size={14} className="mr-1" />添加技能</Button>
                </div>
              )}
            </div>
            {skills.length === 0 ? <p className="text-sm text-[#94A3B8]">暂无技能要求</p> : (
              <div className="space-y-2">
                {skills.map((item, index) => (
                  <div key={index} className="grid grid-cols-1 gap-2 rounded-md bg-[#F8FAFC] p-3 md:grid-cols-[1fr_130px_1fr_auto]">
                    <Input value={item.skill_name} onChange={e => updateSkill(index, { skill_name: e.target.value })} disabled={readonly} placeholder="技能名称" />
                    <Select value={item.skill_type} onValueChange={(value) => { if (!readonly) updateSkill(index, { skill_type: value }); }}>
                      <SelectTrigger className={readonly ? 'pointer-events-none opacity-60' : undefined}><SelectValue /></SelectTrigger>
                      <SelectContent>
                        {SKILL_TYPE_OPTIONS.map(option => <SelectItem key={option.value} value={String(option.value)}>{option.label}</SelectItem>)}
                      </SelectContent>
                    </Select>
                    <Input value={item.match_label} onChange={e => updateSkill(index, { match_label: e.target.value })} disabled={readonly} placeholder="命中标签，可选" />
                    {!readonly && <Button type="button" variant="outline" onClick={() => setSkills(prev => prev.filter((_, idx) => idx !== index))}>删除</Button>}
                  </div>
                ))}
              </div>
            )}
          </section>

          <section className="rounded-lg border border-[#E2E8F0] p-4">
            <h3 className="mb-3 text-sm font-semibold text-[#1E293B]">关联标签</h3>
            {tags.length === 0 ? <p className="text-sm text-[#94A3B8]">暂无可用标签</p> : (
              <div className="flex flex-wrap gap-2">
                {tags.map(tag => {
                  const active = selectedTagIds.includes(tag.id);
                  return (
                    <button key={tag.id} type="button" onClick={() => toggleTag(tag.id)} disabled={readonly} className={`rounded-full border px-3 py-1 text-xs transition-colors ${active ? 'border-[#2563EB] bg-blue-50 text-[#2563EB]' : 'border-[#E2E8F0] bg-white text-[#64748B] hover:bg-[#F8FAFC]'} disabled:cursor-not-allowed disabled:opacity-70`}>
                      {tag.tag_name}<span className="ml-1 opacity-60">{TAG_TYPE_LABEL[tag.tag_type] ?? `类型${tag.tag_type}`}</span>
                    </button>
                  );
                })}
              </div>
            )}
          </section>

          {error && <p className="text-sm text-red-500">{error}</p>}
          <div className="flex justify-end gap-2 pt-1">
            <Button type="button" variant="outline" onClick={handleClose} disabled={saving}>关闭</Button>
            {!readonly && (
              <Button type="submit" disabled={saving || !templateName.trim() || !weightOk} className="bg-[#2563EB] hover:bg-[#1D4ED8] text-white">
                {saving ? <><Loader2 size={14} className="mr-1.5 animate-spin" />保存中…</> : '保存'}
              </Button>
            )}
          </div>
        </form>
        <MarkdownPreviewDialog
          open={!!previewPrompt}
          title={previewPrompt?.title ?? '提示词模板'}
          content={previewPrompt?.content ?? ''}
          editable={!readonly && previewPrompt?.index !== undefined}
          onClose={() => setPreviewPrompt(null)}
          onSave={(content) => {
            if (previewPrompt?.index !== undefined) {
              updateDimension(previewPrompt.index, { prompt_template: content });
              setPreviewPrompt({ ...previewPrompt, content });
            }
          }}
        />
      </DialogContent>
    </Dialog>
  );
}

export default function EmployeeEvalTemplates() {
  const [templates, setTemplates] = useState<IEvalTemplate[]>([]);
  const [tags, setTags] = useState<ITag[]>([]);
  const [dimensionOptions, setDimensionOptions] = useState<IEvalDimension[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(DEFAULT_PAGE_SIZE);
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState('');
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const lastRefreshAtRef = useRef(0);
  const [dialogState, setDialogState] = useState<{ mode: DialogMode; template: IEvalTemplate | null } | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<IEvalTemplate | null>(null);
  const [deleting, setDeleting] = useState(false);
  const debouncedSearch = useDebounce(search, 350);

  const loadTemplates = useCallback(async () => {
    setLoading(true);
    try {
      const params: Record<string, string | number> = { page, page_size: pageSize };
      if (debouncedSearch) params.search = debouncedSearch;
      if (status) params.status = Number(status);
      const res = await employeeEvalTemplatesApi.list(params);
      const data = getResponseData<{ total: number; items: IEvalTemplate[] }>(res, { total: 0, items: [] });
      setTemplates(data.items ?? []);
      setTotal(data.total ?? 0);
    } finally {
      setLoading(false);
    }
  }, [debouncedSearch, page, pageSize, status]);

  const loadTags = useCallback(async () => {
    const res = await employeeTagsApi.list();
    setTags(normalizeTags(res));
  }, []);

  const loadDimensionOptions = useCallback(async () => {
    const res = await employeeEvalTemplatesApi.listDimensions({ page: 1, page_size: 100, status: 1 });
    const data = getResponseData<{ items: IEvalDimension[] }>(res, { items: [] });
    setDimensionOptions(data.items ?? []);
  }, []);

  useEffect(() => { loadTemplates(); }, [loadTemplates]);
  useEffect(() => { loadTags(); }, [loadTags]);
  useEffect(() => { loadDimensionOptions(); }, [loadDimensionOptions]);
  useEffect(() => { setPage(1); }, [debouncedSearch, status]);

  const handleDelete = async () => {
    if (!deleteTarget) return;
    setDeleting(true);
    try {
      await employeeEvalTemplatesApi.delete(deleteTarget.id);
      setDeleteTarget(null);
      await loadTemplates();
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
      await loadTemplates();
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
      breadcrumbs={[{ label: '评估模板' }]}
      title="评估模板"
      headerAction={
        <div className="flex items-center gap-3">
          <Button variant="outline" onClick={handleRefresh} disabled={refreshing || loading} className="bg-white">
            <RefreshCw size={16} className={`mr-1.5 ${refreshing ? 'animate-spin' : ''}`} />刷新
          </Button>
          <Button onClick={() => setDialogState({ mode: 'create', template: null })} className="bg-[#2563EB] hover:bg-[#1D4ED8] text-white">
            <Plus size={16} className="mr-1.5" aria-hidden="true" />新增模板
          </Button>
        </div>
      }
    >
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <Input value={search} onChange={e => setSearch(e.target.value)} placeholder="搜索模板名称…" className="w-56 bg-white" />
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
              <th className="px-4 py-3 text-left font-medium text-[#64748B]">模板名称</th>
              <th className="px-4 py-3 text-left font-medium text-[#64748B]">状态</th>
              <th className="px-4 py-3 text-left font-medium text-[#64748B]">维度</th>
              <th className="px-4 py-3 text-left font-medium text-[#64748B]">技能</th>
              <th className="px-4 py-3 text-left font-medium text-[#64748B]">标签</th>
              <th className="px-4 py-3 text-left font-medium text-[#64748B]">绑定岗位</th>
              <th className="px-4 py-3 text-right font-medium text-[#64748B]">操作</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              [...Array(4)].map((_, index) => (
                <tr key={index} className="border-b border-[#F1F5F9]">
                  {[...Array(7)].map((__, cellIndex) => <td key={cellIndex} className="px-4 py-3"><div className="h-4 animate-pulse rounded bg-[#F1F5F9]" /></td>)}
                </tr>
              ))
            ) : templates.length === 0 ? (
              <tr><td colSpan={7} className="px-4 py-16 text-center text-[#94A3B8]">暂无评估模板</td></tr>
            ) : templates.map(template => {
              const editLocked = (template.published_job_count ?? 0) > 0;
              const deleteLocked = (template.job_count ?? 0) > 0;
              return (
                <tr key={template.id} className="border-b border-[#F1F5F9] transition-colors hover:bg-[#F8FAFC]">
                  <td className="px-4 py-3">
                    <div className="font-medium text-[#1E293B]"><FileText size={14} className="mr-1.5 inline text-[#94A3B8]" />{template.template_name}</div>
                    {template.description && <div className="mt-1 max-w-xs truncate text-xs text-[#94A3B8]">{template.description}</div>}
                  </td>
                  <td className="px-4 py-3">{template.status === 1 ? <Badge className="bg-green-100 text-green-700 border-green-200">启用</Badge> : <Badge className="bg-[#F1F5F9] text-[#64748B] border-[#E2E8F0]">停用</Badge>}</td>
                  <td className="px-4 py-3 text-[#64748B] tabular-nums">{template.dimensions?.length ?? 0}</td>
                  <td className="px-4 py-3 text-[#64748B] tabular-nums">{template.skills?.length ?? 0}</td>
                  <td className="px-4 py-3 text-[#64748B] tabular-nums">{template.tags?.length ?? 0}</td>
                  <td className="px-4 py-3 text-[#64748B] tabular-nums">{template.job_count ?? 0}<span className="ml-1 text-xs text-[#94A3B8]">招聘中 {template.published_job_count ?? 0}</span></td>
                  <td className="px-4 py-3">
                    <div className="flex items-center justify-end gap-2">
                      <button onClick={() => setDialogState({ mode: 'view', template })} className="inline-flex items-center gap-1 rounded px-2 py-1 text-xs text-[#64748B] hover:bg-[#F1F5F9] hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#2563EB]">
                        <Eye size={13} aria-hidden="true" />查看
                      </button>
                      <button onClick={() => setDialogState({ mode: 'edit', template })} disabled={editLocked} title={editLocked ? '已有招聘中岗位绑定该模板，不允许修改' : undefined} className="inline-flex items-center gap-1 rounded px-2 py-1 text-xs text-[#2563EB] hover:bg-blue-50 hover:underline disabled:cursor-not-allowed disabled:text-[#94A3B8] disabled:hover:bg-transparent disabled:hover:no-underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#2563EB]">
                        <Pencil size={13} aria-hidden="true" />编辑
                      </button>
                      <button onClick={() => setDeleteTarget(template)} disabled={deleteLocked} title={deleteLocked ? '已有岗位绑定该模板，不允许删除' : undefined} className="inline-flex items-center gap-1 rounded px-2 py-1 text-xs text-red-500 hover:bg-red-50 hover:underline disabled:cursor-not-allowed disabled:text-[#94A3B8] disabled:hover:bg-transparent disabled:hover:no-underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-400">
                        <Trash2 size={13} aria-hidden="true" />删除
                      </button>
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <Pagination page={page} pageSize={pageSize} total={total} onChange={setPage} onPageSizeChange={(size) => { setPageSize(size); setPage(1); }} />

      {dialogState && <TemplateDialog mode={dialogState.mode} template={dialogState.template} tags={tags} dimensionOptions={dimensionOptions} onClose={() => setDialogState(null)} onSuccess={() => { setDialogState(null); loadTemplates(); loadDimensionOptions(); }} />}
      <ConfirmDialog open={!!deleteTarget} title="确认删除评估模板" description={`确定要删除「${deleteTarget?.template_name}」吗？`} confirmLabel="删除" onConfirm={handleDelete} onCancel={() => setDeleteTarget(null)} loading={deleting} />
    </AdminLayout>
  );
}
