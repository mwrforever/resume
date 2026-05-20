import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { AdminLayout } from '@/components/layout/admin-layout';
import { employeeJobsApi } from '@/api/employee/jobs';
import { employeeEvalTemplatesApi } from '@/api/employee/eval-templates';
import { JobTemplatePreview } from '@/components/employee/job-template-tools';
import { MarkdownPreviewDialog } from '@/components/common/markdown-preview-dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent } from '@/components/ui/card';
import { Textarea } from '@/components/ui/textarea';
import { Loader2 } from 'lucide-react';
import type { IEvalTemplate } from '@/types/employee';

const getResponseData = <T,>(res: any, fallback: T): T => res?.data?.data ?? res?.data ?? fallback;

export default function EmployeeJobEdit() {
  const { id } = useParams<{ id: string }>();
  const jobId = Number(id);
  const navigate = useNavigate();

  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [status, setStatus] = useState(1);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const [templateId, setTemplateId] = useState<number | null>(null);
  const [templates, setTemplates] = useState<IEvalTemplate[]>([]);
  const [previewPrompt, setPreviewPrompt] = useState<{ title: string; content: string } | null>(null);

  useEffect(() => {
    const load = async () => {
      try {
        const [jobRes, templateRes] = await Promise.all([
          employeeJobsApi.get(jobId),
          employeeEvalTemplatesApi.list({ page: 1, page_size: 100, status: 1 }),
        ]);
        const job = getResponseData<any>(jobRes, {});
        setName(job.name ?? '');
        setDescription(job.description ?? '');
        setStatus(job.status ?? 1);
        const currentTemplateId = job.template_id ?? null;
        setTemplateId(currentTemplateId);
        const templateData = getResponseData<{ items: IEvalTemplate[] }>(templateRes, { items: [] });
        let nextTemplates = templateData.items ?? [];
        if (currentTemplateId && !nextTemplates.some(item => item.id === currentTemplateId)) {
          const currentTemplateRes = await employeeEvalTemplatesApi.get(currentTemplateId);
          const currentTemplate = getResponseData<IEvalTemplate | null>(currentTemplateRes, null);
          if (currentTemplate) nextTemplates = [currentTemplate, ...nextTemplates];
        }
        setTemplates(nextTemplates);
      } catch {
        setError('加载失败，请刷新重试');
      } finally {
        setLoading(false);
      }
    };
    load();
  }, [jobId]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return;
    setSaving(true);
    try {
      await employeeJobsApi.update(jobId, { name, description, status, template_id: templateId });
      navigate('/employee/jobs');
    } catch {
      setError('保存失败，请重试');
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <AdminLayout breadcrumbs={[{ label: '岗位管理', href: '/employee/jobs' }, { label: '编辑岗位' }]}>
        <div className="max-w-3xl space-y-3">
          {[...Array(4)].map((_, i) => <div key={i} className="h-24 bg-white rounded-lg animate-pulse" />)}
        </div>
      </AdminLayout>
    );
  }

  const selectedTemplate = templates.find(item => item.id === templateId);

  return (
    <AdminLayout
      breadcrumbs={[{ label: '岗位管理', href: '/employee/jobs' }, { label: '编辑岗位' }]}
      title="编辑岗位"
    >
      <form onSubmit={handleSubmit} className="max-w-3xl space-y-6">

        {/* ── 基本信息 ── */}
        <Card>
          <CardContent className="p-6 space-y-4">
            <h3 className="text-sm font-semibold text-[#1E293B]">基本信息</h3>
            <div className="space-y-1.5">
              <Label htmlFor="edit-name">岗位名称 <span className="text-red-500">*</span></Label>
              <Input id="edit-name" value={name} onChange={e => setName(e.target.value)} required autoComplete="off" className="h-10" />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="edit-desc">岗位描述</Label>
              <Textarea id="edit-desc" value={description} onChange={e => setDescription(e.target.value)} className="min-h-[100px] resize-none" />
            </div>
            <div className="space-y-1.5">
              <Label>招聘状态</Label>
              <div className="flex gap-3">
                {[{ v: 1, label: '招聘中', cls: 'bg-green-100 text-green-700 border-green-300' }, { v: 0, label: '已下架', cls: 'bg-[#F1F5F9] text-[#64748B] border-[#CBD5E1]' }].map(opt => (
                  <button key={opt.v} type="button" onClick={() => setStatus(opt.v)}
                    aria-pressed={status === opt.v}
                    className={`px-4 py-2 rounded-lg text-sm font-medium border transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#2563EB] ${
                      status === opt.v ? opt.cls : 'bg-white text-[#64748B] border-[#E2E8F0] hover:bg-[#F8FAFC]'
                    }`}>{opt.label}</button>
                ))}
              </div>
            </div>
          </CardContent>
        </Card>

        {/* ── 评估模板 ── */}
        <Card>
          <CardContent className="p-6 space-y-3">
            <div className="space-y-1.5">
              <Label htmlFor="edit-template">评估模板</Label>
              <select
                id="edit-template"
                value={templateId ?? ''}
                onChange={e => setTemplateId(e.target.value ? Number(e.target.value) : null)}
                className="h-10 w-full rounded-md border border-[#E2E8F0] bg-white px-3 text-sm text-[#1E293B]"
              >
                <option value="">请选择评估模板</option>
                {templates.map(template => (
                  <option key={template.id} value={template.id}>{template.template_name}</option>
                ))}
              </select>
            </div>

            <JobTemplatePreview template={selectedTemplate ?? null} onPreviewPrompt={(title, content) => setPreviewPrompt({ title, content })} />
          </CardContent>
        </Card>

        {error && <p className="text-sm text-red-500" aria-live="polite">{error}</p>}
        <div className="flex gap-3">
          <Button type="button" variant="outline" onClick={() => navigate('/employee/jobs')} disabled={saving}>取消</Button>
          <Button type="submit" disabled={saving || !name.trim()} className="bg-[#2563EB] hover:bg-[#1D4ED8] text-white">
            {saving ? <><Loader2 size={15} className="animate-spin mr-1.5" />保存中…</> : '保存修改'}
          </Button>
        </div>
      </form>
      <MarkdownPreviewDialog open={!!previewPrompt} title={previewPrompt?.title ?? '提示词预览'} content={previewPrompt?.content ?? ''} onClose={() => setPreviewPrompt(null)} />
    </AdminLayout>
  );
}
