import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { AdminLayout } from '@/components/layout/admin-layout';
import { employeeJobsApi } from '@/api/employee/jobs';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent } from '@/components/ui/card';
import { ArrowLeft, Loader2 } from 'lucide-react';
import type { IDimension, ISkill, ITag } from '@/types/employee';

const SKILL_TYPE_LABEL: Record<number, string> = { 1: '必须满足', 2: '优先匹配', 3: '普通技能' };
const TAG_TYPE_LABEL: Record<number, string> = { 1: '岗位特性', 2: '福利待遇', 3: '技能加分' };
const getResponseData = <T,>(res: any, fallback: T): T => res?.data?.data ?? res?.data ?? fallback;

interface JobPreviewData {
  id: number;
  name: string;
  description?: string;
  status: number;
  dept_name?: string;
  dept_code?: string;
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
            <CardContent className="p-6 space-y-3">
              <h3 className="text-sm font-semibold text-[#1E293B]">评估维度</h3>
              {(job.dimensions ?? []).length > 0 ? job.dimensions!.map(dim => (
                <div key={dim.id ?? dim.dimension_name} className="rounded-lg border border-[#E2E8F0] p-4">
                  <div className="flex items-center justify-between gap-3">
                    <span className="font-medium text-[#1E293B]">{dim.dimension_name}</span>
                    <span className="text-sm text-[#64748B]">权重 {Number(dim.weight).toFixed(2)}</span>
                  </div>
                  <p className="mt-2 whitespace-pre-wrap text-sm leading-6 text-[#64748B]">{dim.prompt_template}</p>
                </div>
              )) : <p className="text-sm text-[#94A3B8]">暂无评估维度</p>}
            </CardContent>
          </Card>

          <Card>
            <CardContent className="p-6 space-y-4">
              <div>
                <h3 className="mb-3 text-sm font-semibold text-[#1E293B]">技能要求</h3>
                <div className="flex flex-wrap gap-2">
                  {(job.skills ?? []).length > 0 ? job.skills!.map(skill => (
                    <span key={skill.id ?? skill.skill_name} className="rounded-full bg-[#F1F5F9] px-3 py-1 text-xs text-[#475569]">
                      {skill.skill_name} · {SKILL_TYPE_LABEL[skill.skill_type] ?? '普通技能'}
                    </span>
                  )) : <span className="text-sm text-[#94A3B8]">暂无技能要求</span>}
                </div>
              </div>
              <div>
                <h3 className="mb-3 text-sm font-semibold text-[#1E293B]">岗位标签</h3>
                <div className="flex flex-wrap gap-2">
                  {(job.tags ?? []).length > 0 ? job.tags!.map(tag => (
                    <span key={tag.id} className="rounded-full bg-blue-50 px-3 py-1 text-xs text-blue-700">
                      {tag.tag_name} · {TAG_TYPE_LABEL[tag.tag_type] ?? `类型${tag.tag_type}`}
                    </span>
                  )) : <span className="text-sm text-[#94A3B8]">暂无岗位标签</span>}
                </div>
              </div>
            </CardContent>
          </Card>
        </div>
      )}
    </AdminLayout>
  );
}
