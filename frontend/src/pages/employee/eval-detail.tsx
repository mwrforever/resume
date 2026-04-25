import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { AdminLayout } from '@/components/layout/admin-layout';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card';
import { EvaluationRadarChart } from '@/components/common/radar-chart';
import { MatchBadge } from '@/components/common/match-badge';
import { employeeEvaluationsApi } from '@/api/employee/evaluations';

interface Evaluation {
  match_id: number;
  final_score: number;
  final_label: '优秀' | '良好' | '一般' | '未达标';
  advantage_comment: string;
  disadvantage_comment: string;
  dimensions: { dimension_name: string; score: number; advantage: string; disadvantage: string }[];
  skill_hits: { skill_id: number; skill_name: string; skill_type: number; is_hit: boolean; hit_context: string }[];
}

export default function EmployeeEvalDetail() {
  const { id } = useParams();
  const [evaluation, setEvaluation] = useState<Evaluation | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const loadEvaluation = async () => {
      try {
        const res = await employeeEvaluationsApi.getEvaluation(Number(id));
        setEvaluation(res.data);
      } catch (error) {
        console.error('Failed to load evaluation:', error);
      } finally {
        setLoading(false);
      }
    };
    loadEvaluation();
  }, [id]);

  if (loading) {
    return (
      <AdminLayout breadcrumbs={[{ label: '投递管理', href: '/employee/applications' }, { label: '评估详情' }]}>
        <div className="space-y-4 max-w-4xl">
          {[...Array(3)].map((_, i) => <div key={i} className="h-32 bg-white rounded-lg animate-pulse" />)}
        </div>
      </AdminLayout>
    );
  }
  if (!evaluation) {
    return (
      <AdminLayout breadcrumbs={[{ label: '投递管理', href: '/employee/applications' }, { label: '评估详情' }]}>
        <p className="text-[#94A3B8]">评估记录不存在</p>
      </AdminLayout>
    );
  }

  return (
    <AdminLayout
      breadcrumbs={[{ label: '投递管理', href: '/employee/applications' }, { label: '评估详情' }]}
      title="评估详情"
    >
      {/* Top summary card */}
      <Card className="mb-6">
        <CardContent className="p-6 flex items-center gap-6">
          <div>
            <p className="text-sm text-[#64748B] mb-1">综合匹配度</p>
            <p className="text-4xl font-bold tabular-nums text-[#1E293B]">{evaluation.final_score}</p>
            <p className="text-sm text-[#94A3B8]">/100</p>
          </div>
          <div className="flex-1 space-y-2">
            <MatchBadge label={evaluation.final_label} />
            <div className="w-full bg-[#F1F5F9] rounded-full h-2 mt-2">
              <div
                className="h-2 rounded-full bg-[#2563EB] transition-all"
                style={{ width: `${evaluation.final_score}%` }}
                role="progressbar"
                aria-valuenow={evaluation.final_score}
                aria-valuemin={0}
                aria-valuemax={100}
                aria-label={`匹配度 ${evaluation.final_score}%`}
              />
            </div>
          </div>
        </CardContent>
      </Card>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Left col: Radar chart + Comments */}
        <div className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle className="text-sm">多维度得分</CardTitle>
            </CardHeader>
            <CardContent>
              <EvaluationRadarChart
                data={evaluation.dimensions.map((d) => ({ dimension: d.dimension_name, score: d.score }))}
              />
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-sm">优缺点评价</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              {evaluation.advantage_comment && (
                <div className="p-3 bg-green-50 border border-green-200 rounded-lg">
                  <p className="text-xs font-semibold text-green-700 mb-1">优点</p>
                  <p className="text-sm text-[#1E293B]">{evaluation.advantage_comment}</p>
                </div>
              )}
              <div className="p-3 bg-[#FFF7ED] border border-orange-200 rounded-lg">
                <p className="text-xs font-semibold text-orange-700 mb-1">待提升</p>
                <p className="text-sm text-[#1E293B]">
                  {evaluation.disadvantage_comment || '这份简历挺符合岗位预期 🎉'}
                </p>
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Right col: Skill hits table */}
        <Card>
          <CardHeader>
            <CardTitle className="text-sm">技能命中详情</CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-[#E2E8F0] bg-[#F8FAFC]">
                  <th className="text-left px-4 py-3 font-medium text-[#64748B]">技能</th>
                  <th className="text-left px-4 py-3 font-medium text-[#64748B]">类型</th>
                  <th className="text-left px-4 py-3 font-medium text-[#64748B]">命中</th>
                </tr>
              </thead>
              <tbody>
                {evaluation.skill_hits.map((hit, idx) => (
                  <tr key={idx} className="border-b border-[#F1F5F9]">
                    <td className="px-4 py-2.5 text-[#1E293B]">{hit.skill_name ?? '—'}</td>
                    <td className="px-4 py-2.5 text-[#64748B]">
                      {hit.skill_type === 1 ? '必须满足' : hit.skill_type === 2 ? '优先匹配' : '普通技能'}
                    </td>
                    <td className="px-4 py-2.5">
                      {hit.is_hit
                        ? <span className="text-green-600 font-medium" aria-label="已命中">✓</span>
                        : <span className="text-[#94A3B8]" aria-label="未命中">✗</span>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </CardContent>
        </Card>
      </div>
    </AdminLayout>
  );
}
