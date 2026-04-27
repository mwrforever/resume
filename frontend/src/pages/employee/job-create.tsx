import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { AdminLayout } from '@/components/layout/admin-layout';
import { employeeJobsApi } from '@/api/employee/jobs';
import { AiTemplateDialog, ImportTemplateDialog, JobTemplatePreview } from '@/components/employee/job-template-tools';
import { MarkdownPreviewDialog } from '@/components/common/markdown-preview-dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent } from '@/components/ui/card';
import { Textarea } from '@/components/ui/textarea';
import { FileText, Loader2, Sparkles } from 'lucide-react';
import type { IEvalTemplate, ITag } from '@/types/employee';

const getResponseData = <T,>(res: any, fallback: T): T => res?.data?.data ?? res?.data ?? fallback;

export default function EmployeeJobCreate() {
  const navigate = useNavigate();
  const aiAbortRef = useRef<AbortController | null>(null);
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [deptId, setDeptId] = useState(1);
  const [selectedTemplate, setSelectedTemplate] = useState<IEvalTemplate | null>(null);
  const [allTags, setAllTags] = useState<ITag[]>([]);
  const [importOpen, setImportOpen] = useState(false);
  const [aiTemplateOpen, setAiTemplateOpen] = useState(false);
  const [previewPrompt, setPreviewPrompt] = useState<{ title: string; content: string } | null>(null);
  const [polishing, setPolishing] = useState(false);
  const [aiError, setAiError] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState('');

  useEffect(() => {
    employeeJobsApi.listAllTags().then(res => setAllTags(getResponseData<ITag[]>(res, [])));
    return () => {
      aiAbortRef.current?.abort();
      aiAbortRef.current = null;
    };
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
      if (data?.comprehensive_description?.trim()) {
        setDescription(data.comprehensive_description);
      }
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
    if (!selectedTemplate) { setFormError('请导入或生成评估模板'); return; }
    setSubmitting(true);
    try {
      await employeeJobsApi.create({
        name: name.trim(),
        description: description.trim(),
        dept_id: deptId,
        template_id: selectedTemplate.id,
      });
      navigate('/employee/jobs');
    } catch (err: any) {
      setFormError(err?.response?.data?.message || '创建失败，请重试');
      setSubmitting(false);
    }
  };

  return (
    <AdminLayout
      breadcrumbs={[{ label: '岗位管理', href: '/employee/jobs' }, { label: '创建岗位' }]}
      title="创建岗位（待发布）"
    >
      <form onSubmit={handleSubmit} className="max-w-3xl space-y-6">
        <Card>
          <CardContent className="space-y-4 p-6">
            <h3 className="text-sm font-semibold text-[#1E293B]">基本信息</h3>
            <div className="space-y-1.5">
              <Label htmlFor="job-name">岗位名称 <span className="text-red-500">*</span></Label>
              <Input id="job-name" value={name} onChange={e => setName(e.target.value)} placeholder="例如：高级前端工程师" required autoComplete="off" className="h-10" />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="job-desc">岗位描述 <span className="text-red-500">*</span></Label>
              <Textarea id="job-desc" value={description} onChange={e => setDescription(e.target.value)} placeholder="请填写岗位职责、任职要求等描述，AI 可基于该内容进行润色或生成模板" required className="min-h-[120px] resize-none" />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="dept-id">部门 ID</Label>
              <Input id="dept-id" type="number" value={deptId} onChange={e => setDeptId(parseInt(e.target.value) || 1)} className="h-10 w-28" />
            </div>
            <div className="flex flex-wrap gap-2">
              <Button type="button" variant="outline" onClick={handlePolishDescription} disabled={!name.trim() || !description.trim() || polishing} className="gap-2">
                {polishing ? <><Loader2 size={14} className="animate-spin" />AI 润色中…</> : <><Sparkles size={14} />岗位描述润色</>}
              </Button>
              {polishing && <Button type="button" variant="outline" onClick={cancelPolish}>中断</Button>}
              <Button type="button" variant="outline" onClick={() => setImportOpen(true)} className="gap-2">
                <FileText size={14} />导入模板
              </Button>
              <Button type="button" variant="outline" onClick={() => setAiTemplateOpen(true)} disabled={!name.trim() || !description.trim()} className="gap-2">
                <Sparkles size={14} />AI 模板生成
              </Button>
            </div>
            {aiError && <p className="text-xs text-red-500">{aiError}</p>}
          </CardContent>
        </Card>

        <Card>
          <CardContent className="space-y-3 p-6">
            <h3 className="text-sm font-semibold text-[#1E293B]">评估模板 <span className="text-red-500">*</span></h3>
            <JobTemplatePreview template={selectedTemplate} onPreviewPrompt={(title, content) => setPreviewPrompt({ title, content })} />
          </CardContent>
        </Card>

        {formError && <p className="text-sm text-red-500" aria-live="polite">{formError}</p>}
        <div className="flex gap-3">
          <Button type="button" variant="outline" onClick={() => navigate('/employee/jobs')} disabled={submitting}>取消</Button>
          <Button type="submit" disabled={submitting || !name.trim() || !description.trim() || !selectedTemplate} className="bg-[#2563EB] text-white hover:bg-[#1D4ED8]">
            {submitting ? <><Loader2 size={14} className="mr-1.5 animate-spin" />创建中…</> : '创建岗位'}
          </Button>
        </div>
      </form>

      <ImportTemplateDialog open={importOpen} onClose={() => setImportOpen(false)} onApply={applyTemplate} />
      <AiTemplateDialog open={aiTemplateOpen} jobName={name} jobDescription={description} tags={allTags} onClose={() => setAiTemplateOpen(false)} onApply={applyTemplate} />
      <MarkdownPreviewDialog open={!!previewPrompt} title={previewPrompt?.title ?? '提示词预览'} content={previewPrompt?.content ?? ''} onClose={() => setPreviewPrompt(null)} />
    </AdminLayout>
  );
}
