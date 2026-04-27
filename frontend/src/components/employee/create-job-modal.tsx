import { useEffect, useRef, useState } from 'react';
import { employeeJobsApi } from '@/api/employee/jobs';
import { AiTemplateDialog, ImportTemplateDialog, JobTemplatePreview } from '@/components/employee/job-template-tools';
import { MarkdownPreviewDialog } from '@/components/common/markdown-preview-dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { ChevronDown, FileText, Loader2, Sparkles, X } from 'lucide-react';
import type { IEvalTemplate, ITag } from '@/types/employee';

interface Dept { id: number; dept_name: string; dept_code?: string }

const getResponseData = <T,>(res: any, fallback: T): T => res?.data?.data ?? res?.data ?? fallback;

interface CreateJobModalProps {
  open: boolean;
  onClose: () => void;
  onSuccess: () => void;
}

export function CreateJobModal({ open, onClose, onSuccess }: CreateJobModalProps) {
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [deptId, setDeptId] = useState<number | null>(null);
  const [depts, setDepts] = useState<Dept[]>([]);
  const [deptOpen, setDeptOpen] = useState(false);
  const [selectedTemplate, setSelectedTemplate] = useState<IEvalTemplate | null>(null);
  const [allTags, setAllTags] = useState<ITag[]>([]);
  const [importOpen, setImportOpen] = useState(false);
  const [aiTemplateOpen, setAiTemplateOpen] = useState(false);
  const [previewPrompt, setPreviewPrompt] = useState<{ title: string; content: string } | null>(null);
  const [polishing, setPolishing] = useState(false);
  const [aiError, setAiError] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState('');
  const deptRef = useRef<HTMLDivElement>(null);
  const aiAbortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    if (!open) return;
    employeeJobsApi.listDepts().then(res => {
      const list = getResponseData<Dept[]>(res, []);
      setDepts(list);
      if (list.length > 0 && deptId === null) setDeptId(list[0].id);
    });
    employeeJobsApi.listAllTags().then(res => setAllTags(getResponseData<ITag[]>(res, [])));
  }, [open]);

  useEffect(() => {
    if (!open) {
      aiAbortRef.current?.abort();
      aiAbortRef.current = null;
      setName('');
      setDescription('');
      setDeptId(null);
      setSelectedTemplate(null);
      setImportOpen(false);
      setAiTemplateOpen(false);
      setPreviewPrompt(null);
      setAiError('');
      setFormError('');
      setPolishing(false);
      setSubmitting(false);
    }
  }, [open]);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (deptRef.current && !deptRef.current.contains(e.target as Node)) setDeptOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  const cancelPolish = () => {
    aiAbortRef.current?.abort();
    aiAbortRef.current = null;
    setPolishing(false);
  };

  const handlePolishDescription = async () => {
    if (!name.trim() || !description.trim()) return;
    aiAbortRef.current?.abort();
    const controller = new AbortController();
    aiAbortRef.current = controller;
    setPolishing(true);
    setAiError('');
    try {
      const res = await employeeJobsApi.aiSuggest({ name, description }, controller.signal);
      const data = getResponseData<{ comprehensive_description?: string } | null>(res, null);
      if (data?.comprehensive_description?.trim()) setDescription(data.comprehensive_description);
    } catch (err: any) {
      if (err?.code === 'ERR_CANCELED' || err?.name === 'CanceledError' || err?.name === 'AbortError') {
        setAiError('已中断 AI 润色');
        return;
      }
      setAiError(err?.response?.data?.message || 'AI 润色失败，请重试');
    } finally {
      if (aiAbortRef.current === controller) {
        aiAbortRef.current = null;
        setPolishing(false);
      }
    }
  };

  const applyTemplate = (template: IEvalTemplate) => {
    setSelectedTemplate(template);
    setImportOpen(false);
    setAiTemplateOpen(false);
    setFormError('');
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setFormError('');
    if (!name.trim()) return;
    if (!description.trim()) { setFormError('请填写岗位描述'); return; }
    if (!deptId) { setFormError('请选择部门'); return; }
    if (!selectedTemplate) { setFormError('请导入或生成评估模板'); return; }
    setSubmitting(true);
    try {
      await employeeJobsApi.create({
        name: name.trim(),
        description: description.trim(),
        dept_id: deptId,
        template_id: selectedTemplate.id,
      });
      onSuccess();
    } catch (err: any) {
      setFormError(err?.response?.data?.message || '创建失败，请重试');
      setSubmitting(false);
    }
  };

  if (!open) return null;
  const selectedDept = depts.find(dept => dept.id === deptId);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="flex max-h-[90vh] w-full max-w-3xl flex-col rounded-xl bg-white shadow-2xl">
        <div className="flex flex-shrink-0 items-center justify-between border-b border-[#E2E8F0] px-6 py-4">
          <h2 className="text-base font-semibold text-[#1E293B]">创建岗位（待发布）</h2>
          <button onClick={onClose} aria-label="关闭" className="text-[#94A3B8] transition-colors hover:text-[#1E293B] focus-visible:outline-none"><X size={18} /></button>
        </div>

        <div className="flex-1 space-y-5 overflow-y-auto px-6 py-5">
          <form id="create-job-form" onSubmit={handleSubmit} className="space-y-5">
            <div className="space-y-3">
              <p className="text-xs font-semibold uppercase tracking-wide text-[#64748B]">基本信息</p>
              <div className="space-y-1.5">
                <Label htmlFor="cjm-name">岗位名称 <span className="text-red-500">*</span></Label>
                <Input id="cjm-name" value={name} onChange={e => setName(e.target.value)} placeholder="例如：高级前端工程师" required autoComplete="off" className="h-9" />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="cjm-desc">岗位描述 <span className="text-red-500">*</span></Label>
                <Textarea id="cjm-desc" value={description} onChange={e => setDescription(e.target.value)} placeholder="请填写岗位职责、任职要求等描述，AI 可基于该内容进行润色或生成模板" required className="min-h-[100px] resize-none text-sm" />
              </div>
              <div className="space-y-1.5">
                <Label>所属部门 <span className="text-red-500">*</span></Label>
                <div className="relative" ref={deptRef}>
                  <button type="button" onClick={() => setDeptOpen(value => !value)} className="flex h-9 w-full items-center justify-between rounded-md border border-[#E2E8F0] bg-white px-3 text-sm transition-colors hover:border-[#2563EB] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#2563EB]">
                    <span className={selectedDept ? 'text-[#1E293B]' : 'text-[#94A3B8]'}>{selectedDept ? <>{selectedDept.dept_name}{selectedDept.dept_code && <span className="ml-1.5 text-xs text-[#94A3B8]">({selectedDept.dept_code})</span>}</> : '请选择部门'}</span>
                    <ChevronDown size={14} className={`text-[#94A3B8] transition-transform ${deptOpen ? 'rotate-180' : ''}`} />
                  </button>
                  {deptOpen && (
                    <div className="absolute left-0 right-0 top-10 z-10 max-h-44 overflow-y-auto rounded-md border border-[#E2E8F0] bg-white shadow-lg">
                      {depts.length === 0 ? <p className="px-3 py-2 text-sm text-[#94A3B8]">暂无部门数据</p> : depts.map(dept => (
                        <button key={dept.id} type="button" onClick={() => { setDeptId(dept.id); setDeptOpen(false); }} className={`w-full px-3 py-2 text-left text-sm transition-colors hover:bg-[#F8FAFC] ${deptId === dept.id ? 'bg-blue-50 font-medium text-[#2563EB]' : 'text-[#1E293B]'}`}>
                          {dept.dept_name}{dept.dept_code && <span className="ml-1.5 text-xs text-[#94A3B8]">({dept.dept_code})</span>}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              </div>
              <div className="flex flex-wrap gap-2">
                <Button type="button" variant="outline" onClick={handlePolishDescription} disabled={!name.trim() || !description.trim() || polishing} className="h-8 gap-2 text-xs">
                  {polishing ? <><Loader2 size={13} className="animate-spin" />AI 润色中…</> : <><Sparkles size={13} />岗位描述润色</>}
                </Button>
                {polishing && <Button type="button" variant="outline" onClick={cancelPolish} className="h-8 text-xs">中断</Button>}
                <Button type="button" variant="outline" onClick={() => setImportOpen(true)} className="h-8 gap-2 text-xs"><FileText size={13} />导入模板</Button>
                <Button type="button" variant="outline" onClick={() => setAiTemplateOpen(true)} disabled={!name.trim() || !description.trim()} className="h-8 gap-2 text-xs"><Sparkles size={13} />AI 模板生成</Button>
              </div>
              {aiError && <p className="text-xs text-red-500">{aiError}</p>}
            </div>

            <div className="space-y-2">
              <p className="text-xs font-semibold uppercase tracking-wide text-[#64748B]">评估模板 <span className="text-red-500">*</span></p>
              <JobTemplatePreview template={selectedTemplate} onPreviewPrompt={(title, content) => setPreviewPrompt({ title, content })} />
            </div>

            {formError && <p className="text-sm text-red-500" aria-live="polite">{formError}</p>}
          </form>
        </div>

        <div className="flex flex-shrink-0 items-center justify-end gap-3 border-t border-[#E2E8F0] px-6 py-4">
          <Button type="button" variant="outline" onClick={onClose} disabled={submitting}>取消</Button>
          <Button type="submit" form="create-job-form" disabled={submitting || !name.trim() || !description.trim() || !deptId || !selectedTemplate} className="bg-[#2563EB] text-white hover:bg-[#1D4ED8]">
            {submitting ? <><Loader2 size={13} className="mr-1.5 animate-spin" />创建中…</> : '创建岗位'}
          </Button>
        </div>
      </div>

      <ImportTemplateDialog open={importOpen} onClose={() => setImportOpen(false)} onApply={applyTemplate} />
      <AiTemplateDialog open={aiTemplateOpen} jobName={name} jobDescription={description} tags={allTags} onClose={() => setAiTemplateOpen(false)} onApply={applyTemplate} />
      <MarkdownPreviewDialog open={!!previewPrompt} title={previewPrompt?.title ?? '提示词预览'} content={previewPrompt?.content ?? ''} onClose={() => setPreviewPrompt(null)} />
    </div>
  );
}
