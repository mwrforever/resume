import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
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

  if (loading) return <div className="text-center py-12">加载中...</div>;
  if (!evaluation) return <div className="text-center py-12">评估不存在</div>;

  return (
    <div className="container mx-auto py-8">
      <Card className="mb-6">
        <CardHeader>
          <CardTitle>评估详情</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex items-center gap-4 mb-4">
            <span className="text-3xl font-bold">{evaluation.final_score}</span>
            <span className="text-lg text-secondary">/100</span>
            <MatchBadge label={evaluation.final_label} />
          </div>
          <div className="w-full bg-gray-200 rounded-full h-2">
            <div
              className="bg-primary h-2 rounded-full"
              style={{ width: `${evaluation.final_score}%` }}
            />
          </div>
        </CardContent>
      </Card>

      <Card className="mb-6">
        <CardHeader>
          <CardTitle>多维度得分</CardTitle>
        </CardHeader>
        <CardContent>
          <EvaluationRadarChart data={evaluation.dimensions.map(d => ({ dimension: d.dimension_name, score: d.score }))} />
        </CardContent>
      </Card>

      <Card className="mb-6">
        <CardHeader>
          <CardTitle>优缺点评价</CardTitle>
        </CardHeader>
        <CardContent>
          {evaluation.advantage_comment && (
            <div className="mb-4">
              <p className="font-medium text-success mb-1">优点:</p>
              <p className="text-gray-700">{evaluation.advantage_comment}</p>
            </div>
          )}
          <div>
            <p className="font-medium text-danger mb-1">缺点:</p>
            <p className="text-gray-700">
              {evaluation.disadvantage_comment || "这份好像挺符合岗位预期"}
            </p>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>技能命中详情</CardTitle>
        </CardHeader>
        <CardContent>
          <table className="w-full">
            <thead>
              <tr className="text-left text-sm text-secondary">
                <th className="pb-2">技能</th>
                <th className="pb-2">类型</th>
                <th className="pb-2">命中</th>
                <th className="pb-2">片段</th>
              </tr>
            </thead>
            <tbody>
              {evaluation.skill_hits.map((hit, idx) => (
                <tr key={idx} className="border-t">
                  <td className="py-2">{hit.skill_name}</td>
                  <td className="py-2">
                    {hit.skill_type === 1 ? '必须满足' : hit.skill_type === 2 ? '优先匹配' : '普通技能'}
                  </td>
                  <td className="py-2">{hit.is_hit ? '✓' : '✗'}</td>
                  <td className="py-2">
                    {hit.hit_context ? (
                      <button className="text-primary hover:underline">点击查看</button>
                    ) : '-'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </CardContent>
      </Card>
    </div>
  );
}
