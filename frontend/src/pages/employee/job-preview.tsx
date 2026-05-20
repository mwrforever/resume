import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { AdminLayout } from '@/components/layout/admin-layout';
import { employeeJobsApi } from '@/api/employee/jobs';
import { JobTemplatePreview } from '@/components/employee/job-template-tools';
import { MarkdownPreviewDialog } from '@/components/common/markdown-preview-dialog';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent } from '@/components/ui/card';
import { ArrowLeft, Loader2 } from 'lucide-react';
import type { IDimension, ISkill, ITag } from '@/types/employee';

const getResponseData = <T,>(res: any, fallback: T): T => res?.data?.data ?? res?.data ?? fallback;

interface JobPreviewData {
  id: number;
  name: string;
  description?: string;
  status: number;
  dept_name?: string;
  dept_code?: string;
  template_name?: string;
  create_time?: string;
  resume_count?: number;
  dimensions?: IDimension[];
  skills?: ISkill[];
  tags?: ITag[];
}

export default function EmployeeJobPreview() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const jobId = Number(id);
  const [job, setJob] = useState<JobPreviewData | null>(null);
  const [loading, setLoading] = useState(true);
  const [previewPrompt, setPreviewPrompt] = useState<{ title: string; content: string } | null>(null);

  useEffect(() => {
    const load = async () => {
      try {
        const res = await employeeJobsApi.get(jobId);
        setJob(getResponseData<JobPreviewData | null>(res, null));
      } finally {
        setLoading(false);
      }
    };
    load();
  }, [jobId]);

  const statusBadge = job?.status === 1
    ? <Badge className="bg-green-100 text-green-700 border-green-200">招聘中</Badge>
    : job?.status === 2
      ? <Badge className="bg-amber-100 text-amber-700 border-amber-200">待发布</Badge>
      : <Badge className="bg-[#F1F5F9] text-[#64748B] border-[#E2E8F0]">已下架</Badge>;

  return (
    <AdminLayout
      breadcrumbs={[{ label: '岗位管理', href: '/employee/jobs' }, { label: '岗位预览' }]}
      title="岗位预览"
      headerAction={
        <Button variant="outline" onClick={() => navigate('/employee/jobs')}>
          <ArrowLeft size={16} className="mr-1.5" aria-hidden="true" />
          返回列表
        </Button>
      }
    >
      {loading ? (
        <div className="flex items-center justify-center py-16 text-[#94A3B8]">
          <Loader2 size={20} className="animate-spin mr-2" />加载中…
        </div>
      ) : !job ? (
        <Card><CardContent className="p-8 text-center text-[#94A3B8]">岗位不存在</CardContent></Card>
      ) : (
        <div className="max-w-4xl space-y-5">
          <Card>
            <CardContent className="p-6 space-y-4">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <h2 className="text-2xl font-semibold text-[#1E293B]">{job.name}</h2>
                  <p className="mt-2 text-sm text-[#64748B]">
                    {job.dept_name ? `${job.dept_name}${job.dept_code ? `（${job.dept_code}）` : ''}` : '未设置部门'}
                  </p>
                </div>
                {statusBadge}
              </div>
              <div className="grid grid-cols-1 gap-3 text-sm text-[#64748B] sm:grid-cols-2">
                <div>简历数：{job.resume_count ?? 0}</div>
                <div>发布时间：{job.create_time ? new Intl.DateTimeFormat('zh-CN').format(new Date(job.create_time)) : '-'}</div>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardContent className="p-6">
              <h3 className="mb-3 text-sm font-semibold text-[#1E293B]">岗位描述</h3>
              <p className="whitespace-pre-wrap leading-7 text-[#475569]">{job.description || '暂无岗位描述'}</p>
            </CardContent>
          </Card>

          <Card>
            <CardContent className="p-6">
              <JobTemplatePreview
                template={{
                  template_name: job.template_name || `${job.name}评估模板`,
                  dimensions: job.dimensions ?? [],
                  skills: job.skills ?? [],
                  tags: job.tags ?? [],
                }}
                onPreviewPrompt={(title, content) => setPreviewPrompt({ title, content })}
              />
            </CardContent>
          </Card>
          <MarkdownPreviewDialog open={!!previewPrompt} title={previewPrompt?.title ?? '提示词预览'} content={previewPrompt?.content ?? ''} onClose={() => setPreviewPrompt(null)} />
        </div>
      )}
    </AdminLayout>
  );
}
