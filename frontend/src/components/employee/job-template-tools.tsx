import { useEffect, useRef, useState } from 'react';
import { employeeEvalTemplatesApi } from '@/api/employee/eval-templates';
import { createTemplateFromDraft } from '@/utils/eval-template';
import { MarkdownPreviewDialog } from '@/components/common/markdown-preview-dialog';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog';
import { X, Eye, Loader2, Sparkles } from 'lucide-react';
import type { IEvalTemplate, IEvalTemplateDimension, IEvalTemplateSkill, IJobTemplateAiSuggestion, ITag } from '@/types/employee';

const SKILL_TYPE_LABEL: Record<number, string> = { 1: '必须满足', 2: '优先匹配', 3: '普通技能' };
const TAG_TYPE_LABEL: Record<number, string> = { 1: '岗位特性', 2: '福利待遇', 3: '技能加分' };
const getResponseData = <T,>(res: any, fallback: T): T => res?.data?.data ?? res?.data ?? fallback;

interface TemplatePreviewData {
  template_name: string;
  description?: string;
  dimensions: Array<Pick<IEvalTemplateDimension, 'dimension_name' | 'weight' | 'prompt_template'>>;
  skills: Array<Pick<IEvalTemplateSkill, 'skill_name' | 'skill_type' | 'match_label'>>;
  tags?: ITag[];
}

interface JobTemplatePreviewProps {
  template: TemplatePreviewData | null;
  onPreviewPrompt: (title: string, content: string, dimensionIndex?: number) => void;
}

export function JobTemplatePreview({ template, onPreviewPrompt }: JobTemplatePreviewProps) {
  if (!template) {
    return <p className="rounded-lg border border-dashed border-[#CBD5E1] bg-[#F8FAFC] px-4 py-6 text-center text-sm text-[#94A3B8]">尚未关联评估模板，请导入模板或使用 AI 生成模板</p>;
  }

  return (
    <div className="space-y-4 rounded-lg border border-[#E2E8F0] bg-white p-4">
      <div>
        <p className="text-xs text-[#64748B]">关联模板</p>
        <h3 className="mt-1 inline-block text-base font-semibold text-[#1E293B]" title={template.description || undefined}>{template.template_name}</h3>
        {template.description && <p className="mt-1 text-sm text-[#64748B]">{template.description}</p>}
      </div>

      <div className="space-y-2">
        <p className="text-xs font-semibold text-[#64748B]">评估维度</p>
        {template.dimensions.length === 0 ? <p className="text-sm text-[#94A3B8]">暂无维度</p> : template.dimensions.map((dimension, index) => (
          <div key={`${dimension.dimension_name}-${index}`} className="rounded-md bg-[#F8FAFC] p-3">
            <div className="flex items-center justify-between gap-2">
              <div>
                <span className="text-sm font-medium text-[#1E293B]">{dimension.dimension_name}</span>
                <span className="ml-2 text-xs text-[#64748B]">权重 {Number(dimension.weight || 0).toFixed(2)}</span>
              </div>
              <Button type="button" variant="outline" size="sm" onClick={() => onPreviewPrompt(`${dimension.dimension_name}提示词预览`, dimension.prompt_template, index)} disabled={!dimension.prompt_template?.trim()}>
                <Eye size={14} className="mr-1" />预览
              </Button>
            </div>
          </div>
        ))}
      </div>

      <div className="space-y-2">
        <p className="text-xs font-semibold text-[#64748B]">技能</p>
        {template.skills.length === 0 ? <p className="text-sm text-[#94A3B8]">暂无技能</p> : (
          <div className="flex flex-wrap gap-2">
            {template.skills.map((skill, index) => (
              <Badge key={`${skill.skill_name}-${index}`} className="border-[#E2E8F0] bg-[#F8FAFC] text-[#475569]">
                {skill.skill_name}<span className="ml-1 opacity-70">·{SKILL_TYPE_LABEL[skill.skill_type] ?? '普通技能'}</span>
              </Badge>
            ))}
          </div>
        )}
      </div>

      <div className="space-y-2">
        <p className="text-xs font-semibold text-[#64748B]">岗位标签</p>
        {!template.tags?.length ? <p className="text-sm text-[#94A3B8]">暂无标签</p> : (
          <div className="flex flex-wrap gap-2">
            {template.tags.map(tag => (
              <Badge key={tag.id} className="border-blue-200 bg-blue-50 text-blue-700">
                {tag.tag_name}<span className="ml-1 opacity-70">{TAG_TYPE_LABEL[tag.tag_type] ?? `类型${tag.tag_type}`}</span>
              </Badge>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

interface ImportTemplateDialogProps {
  open: boolean;
  onClose: () => void;
  onApply: (template: IEvalTemplate) => void;
}

export function ImportTemplateDialog({ open, onClose, onApply }: ImportTemplateDialogProps) {
  const [templates, setTemplates] = useState<IEvalTemplate[]>([]);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!open) return;
    setLoading(true);
    setError('');
    employeeEvalTemplatesApi.list({ page: 1, page_size: 100, status: 1 })
      .then(res => {
        const data = getResponseData<{ items: IEvalTemplate[] }>(res, { items: [] });
        setTemplates(data.items ?? []);
        setSelectedId(null);
      })
      .catch(() => setError('模板列表加载失败'))
      .finally(() => setLoading(false));
  }, [open]);

  if (!open) return null;
  const selectedTemplate = templates.find(template => template.id === selectedId) ?? null;

  return (
    <Dialog open={open} onOpenChange={onClose} containerClassName="max-w-3xl">
      <DialogContent className="max-h-[88vh] overflow-y-auto">
        <div className="mb-4 flex items-center justify-between">
          <DialogTitle className="mb-0">导入评估模板</DialogTitle>
          <button type="button" onClick={onClose} aria-label="关闭" className="text-[#94A3B8] hover:text-[#1E293B] focus-visible:outline-none"><X size={18} /></button>
        </div>
        {loading ? <p className="py-8 text-center text-sm text-[#94A3B8]">加载中…</p> : (
          <div className="space-y-3">
            {templates.length === 0 ? <p className="py-8 text-center text-sm text-[#94A3B8]">暂无可用模板</p> : templates.map(template => (
              <button key={template.id} type="button" onClick={() => setSelectedId(template.id)} className={`block w-full rounded-lg border p-4 text-left transition-colors ${selectedId === template.id ? 'border-[#2563EB] bg-blue-50' : 'border-[#E2E8F0] bg-white hover:bg-[#F8FAFC]'}`}>
                <div className="flex items-center justify-between gap-3">
                  <span className="font-medium text-[#1E293B]" title={template.description || undefined}>{template.template_name}</span>
                  <Badge className={selectedId === template.id ? 'border-blue-200 bg-blue-100 text-blue-700' : 'border-[#E2E8F0] bg-[#F8FAFC] text-[#64748B]'}>{selectedId === template.id ? '已选' : '未选'}</Badge>
                </div>
                {template.description && <p className="mt-1 text-sm text-[#64748B]">{template.description}</p>}
                <p className="mt-2 text-xs text-[#94A3B8]">维度 {template.dimensions?.length ?? 0} · 技能 {template.skills?.length ?? 0} · 标签 {template.tags?.length ?? 0}</p>
              </button>
            ))}
          </div>
        )}
        {error && <p className="mt-3 text-sm text-red-500">{error}</p>}
        <div className="mt-4 flex justify-end gap-2">
          <Button type="button" variant="outline" onClick={onClose}>取消</Button>
          <Button type="button" disabled={!selectedTemplate} onClick={() => { if (selectedTemplate) onApply(selectedTemplate); }} className="bg-[#2563EB] text-white hover:bg-[#1D4ED8]">应用模板</Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

interface AiTemplateDialogProps {
  open: boolean;
  jobName: string;
  jobDescription: string;
  tags: ITag[];
  onClose: () => void;
  onApply: (template: IEvalTemplate) => void;
}

export function AiTemplateDialog({ open, jobName, jobDescription, tags, onClose, onApply }: AiTemplateDialogProps) {
  const abortRef = useRef<AbortController | null>(null);
  const [suggestion, setSuggestion] = useState<IJobTemplateAiSuggestion | null>(null);
  const [selectedTagIds, setSelectedTagIds] = useState<number[]>([]);
  const [previewPrompt, setPreviewPrompt] = useState<{ title: string; content: string; dimensionIndex?: number } | null>(null);
  const [generating, setGenerating] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!open) return;
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    setSuggestion(null);
    setSelectedTagIds([]);
    setGenerating(true);
    setSaving(false);
    setError('');
    employeeEvalTemplatesApi.suggestJobTemplate({ job_name: jobName, job_description: jobDescription }, controller.signal)
      .then(res => {
        const data = getResponseData<IJobTemplateAiSuggestion | null>(res, null);
        if (!data?.template_name?.trim()) {
          setError('AI 未返回模板建议，请补充岗位信息后重试');
          return;
        }
        setSuggestion(data);
      })
      .catch((err: any) => {
        if (err?.code === 'ERR_CANCELED' || err?.name === 'CanceledError' || err?.name === 'AbortError') return;
        setError(err?.response?.data?.message || 'AI 模板生成失败，请重试');
      })
      .finally(() => {
        if (abortRef.current === controller) {
          abortRef.current = null;
          setGenerating(false);
        }
      });
    return () => controller.abort();
  }, [open, jobName, jobDescription]);

  const handleClose = () => {
    abortRef.current?.abort();
    abortRef.current = null;
    onClose();
  };

  const toggleTag = (tagId: number) => {
    setSelectedTagIds(prev => prev.includes(tagId) ? prev.filter(id => id !== tagId) : [...prev, tagId]);
  };

  const updatePreviewPrompt = (content: string) => {
    if (previewPrompt?.dimensionIndex === undefined) return;
    const dimensionIndex = previewPrompt.dimensionIndex;
    setSuggestion(prev => {
      if (!prev) return prev;
      return {
        ...prev,
        dimensions: prev.dimensions.map((dimension, index) => index === dimensionIndex ? { ...dimension, prompt_template: content } : dimension),
      };
    });
    setPreviewPrompt({ ...previewPrompt, content });
  };

  const handleApply = async () => {
    if (!suggestion) return;
    setSaving(true);
    setError('');
    try {
      const template = await createTemplateFromDraft({
        templateName: suggestion.template_name,
        description: suggestion.description,
        dimensions: suggestion.dimensions.map((dimension, index) => ({
          dimension_name: dimension.dimension_name,
          description: dimension.description,
          weight: dimension.weight,
          prompt_template: dimension.prompt_template,
          sort_order: index,
        })),
        skills: suggestion.skills,
        tagIds: selectedTagIds,
      });
      onApply(template);
    } catch (err: any) {
      setError(err?.response?.data?.message || err?.message || '保存模板失败，请重试');
      setSaving(false);
    }
  };

  if (!open) return null;
  const selectedTags = tags.filter(tag => selectedTagIds.includes(tag.id));

  return (
    <Dialog open={open} onOpenChange={handleClose} containerClassName="max-w-5xl overflow-hidden">
      <DialogContent className="max-h-[88vh] overflow-y-auto">
        <div className="mb-4 flex items-center justify-between">
          <DialogTitle className="mb-0">AI 生成岗位模板</DialogTitle>
          <button type="button" onClick={handleClose} aria-label="关闭" className="text-[#94A3B8] hover:text-[#1E293B] focus-visible:outline-none"><X size={18} /></button>
        </div>
        {generating && <p className="py-10 text-center text-sm text-[#94A3B8]"><Loader2 size={16} className="mr-2 inline animate-spin" />AI 生成中…</p>}
        {suggestion && (
          <div className="space-y-4">
            <JobTemplatePreview template={{ ...suggestion, tags: selectedTags }} onPreviewPrompt={(title, content, dimensionIndex) => setPreviewPrompt({ title, content, dimensionIndex })} />
            <section className="rounded-lg border border-[#E2E8F0] p-4">
              <h3 className="mb-3 text-sm font-semibold text-[#1E293B]">岗位标签</h3>
              {tags.length === 0 ? <p className="text-sm text-[#94A3B8]">暂无可用标签</p> : (
                <div className="flex flex-wrap gap-2">
                  {tags.map(tag => {
                    const active = selectedTagIds.includes(tag.id);
                    return (
                      <button key={tag.id} type="button" onClick={() => toggleTag(tag.id)} className={`rounded-full border px-3 py-1 text-xs transition-colors ${active ? 'border-[#2563EB] bg-blue-50 text-[#2563EB]' : 'border-[#E2E8F0] bg-white text-[#64748B] hover:bg-[#F8FAFC]'}`}>
                        {tag.tag_name}<span className="ml-1 opacity-60">{TAG_TYPE_LABEL[tag.tag_type] ?? `类型${tag.tag_type}`}</span>
                      </button>
                    );
                  })}
                </div>
              )}
            </section>
          </div>
        )}
        {error && <p className="mt-3 text-sm text-red-500">{error}</p>}
        <div className="mt-4 flex justify-end gap-2">
          <Button type="button" variant="outline" onClick={handleClose}>取消</Button>
          <Button type="button" disabled={!suggestion || saving} onClick={handleApply} className="bg-[#2563EB] text-white hover:bg-[#1D4ED8]">
            {saving ? <><Loader2 size={14} className="mr-1.5 animate-spin" />保存中…</> : <><Sparkles size={14} className="mr-1.5" />应用并保存模板</>}
          </Button>
        </div>
        <MarkdownPreviewDialog
          open={!!previewPrompt}
          title={previewPrompt?.title ?? '提示词预览'}
          content={previewPrompt?.content ?? ''}
          editable={previewPrompt?.dimensionIndex !== undefined}
          onClose={() => setPreviewPrompt(null)}
          onSave={updatePreviewPrompt}
        />
      </DialogContent>
    </Dialog>
  );
}
