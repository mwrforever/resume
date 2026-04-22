import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { PageLayout } from '@/components/layout/page-layout';
import { UserNav } from '@/components/layout/user-nav';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { EvaluationRadarChart } from '@/components/common/radar-chart';
import { SkillTag } from '@/components/common/skill-tag';
import { MatchBadge } from '@/components/common/match-badge';
import { EvalPending } from '@/components/common/eval-pending';
import { userApplicationsApi } from '@/api/user/applications';
import { resumePreviewApi } from '@/api/user/resumes';

interface Evaluation {
  final_score: number;
  final_label: '优秀' | '良好' | '一般' | '未达标';
  advantage_comment: string;
  disadvantage_comment: string;
  dimensions: { dimension_name: string; score: number }[];
  skill_hits: {
    skill_name: string;
    skill_type: number;
    is_hit: boolean;
    match_label?: string;
    hit_context?: string;
  }[];
}

interface Application {
  id: number;
  job_id: number;
  resume_id: number;
  status: number;
  status_name: string;
  create_time: string;
  job_name?: string;
  resume_name?: string;
  resume_file_path?: string;
  evaluation?: Evaluation;
}

export default function UserApplicationDetail() {
  const { id } = useParams();
  const [application, setApplication] = useState<Application | null>(null);
  const [loading, setLoading] = useState(true);
  const [showPreview, setShowPreview] = useState(false);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);

  const loadApplication = async () => {
    try {
      const res = await userApplicationsApi.get(Number(id));
      setApplication(res.data);
    } catch (error) {
      console.error('Failed to load application:', error);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadApplication();
  }, [id]);

  const handlePreviewResume = () => {
    if (!application?.resume_file_path) return;
    const url = resumePreviewApi.getUrl(application.resume_file_path);
    setPreviewUrl(url);
    setShowPreview(true);
  };

  if (loading) {
    return (
      <PageLayout title="加载中..." action={<UserNav />}>
        <div className="animate-pulse space-y-4">
          <div className="h-32 bg-muted rounded-xl" />
        </div>
      </PageLayout>
    );
  }

  if (!application) {
    return (
      <PageLayout title="投递不存在" action={<UserNav />}>
        <Card>
          <CardContent className="py-12 text-center">
            <p className="text-muted-foreground">该投递记录不存在</p>
          </CardContent>
        </Card>
      </PageLayout>
    );
  }

  const isEvaluated = application?.status === 2 && application?.evaluation;

  return (
    <PageLayout
      title="投递详情"
      subtitle={`岗位: ${application.job_name || `ID: ${application.job_id}`}`}
      action={<UserNav />}
    >
      {showPreview && previewUrl && (
        <div className="fixed inset-0 z-50 bg-black/80 flex items-center justify-center p-4">
          <div className="bg-white rounded-lg w-full max-w-4xl h-[90vh] flex flex-col">
            <div className="flex items-center justify-between p-4 border-b">
              <h3 className="font-semibold">简历预览</h3>
              <button
                onClick={() => setShowPreview(false)}
                className="text-muted-foreground hover:text-foreground"
              >
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>
            <iframe src={previewUrl} className="flex-1 w-full" title="resume-preview" />
          </div>
        </div>
      )}

      <Card className="mb-6">
        <CardHeader>
          <CardTitle>基本信息</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-2 gap-4">
            <p><span className="font-medium">岗位:</span> {application.job_name || `ID: ${application.job_id}`}</p>
            <p><span className="font-medium">投递时间:</span> {application.create_time?.split('T')[0]}</p>
            <div className="flex items-center gap-2">
              <span className="font-medium">简历:</span>
              {application.resume_name ? (
                <button
                  onClick={handlePreviewResume}
                  className="text-accent hover:underline flex items-center gap-1"
                >
                  {application.resume_name}
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
                  </svg>
                </button>
              ) : (
                <span className="text-muted-foreground">-</span>
              )}
            </div>
            <p><span className="font-medium">状态:</span> {application.status_name}</p>
          </div>
        </CardContent>
      </Card>

      {!isEvaluated ? (
        <Card>
          <CardContent>
            <EvalPending onRefresh={loadApplication} />
          </CardContent>
        </Card>
      ) : (
        <>
          <Card className="mb-6">
            <CardHeader>
              <CardTitle>匹配度评估</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="flex items-center gap-4 mb-4">
                <span className="text-3xl font-bold">{application.evaluation!.final_score}</span>
                <span className="text-lg text-muted-foreground">/100</span>
                <MatchBadge label={application.evaluation!.final_label} />
              </div>
              <div className="w-full bg-muted rounded-full h-2">
                <div
                  className="bg-primary h-2 rounded-full"
                  style={{ width: `${application.evaluation!.final_score}%` }}
                />
              </div>
            </CardContent>
          </Card>

          <Card className="mb-6">
            <CardHeader>
              <CardTitle>多维度得分</CardTitle>
            </CardHeader>
            <CardContent>
              <EvaluationRadarChart data={application.evaluation!.dimensions.map(d => ({ dimension: d.dimension_name, score: d.score }))} />
            </CardContent>
          </Card>

          <Card className="mb-6">
            <CardHeader>
              <CardTitle>优缺点评价</CardTitle>
            </CardHeader>
            <CardContent>
              {application.evaluation!.advantage_comment && (
                <div className="mb-4">
                  <p className="font-medium text-green-600 mb-1">优点:</p>
                  <p className="text-foreground">{application.evaluation!.advantage_comment}</p>
                </div>
              )}
              <div>
                <p className="font-medium text-red-600 mb-1">缺点:</p>
                <p className="text-foreground">
                  {application.evaluation!.disadvantage_comment || "无明显缺点"}
                </p>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>技能匹配</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="flex flex-wrap gap-2">
                {application.evaluation!.skill_hits?.map((hit, idx) => (
                  <SkillTag
                    key={idx}
                    skill={hit.skill_name}
                    type={hit.skill_type === 1 ? '必须满足' : hit.skill_type === 2 ? '优先匹配' : '普通技能'}
                    isHit={hit.is_hit}
                    matchLabel={hit.match_label}
                    hitContext={hit.hit_context}
                  />
                ))}
              </div>
            </CardContent>
          </Card>
        </>
      )}
    </PageLayout>
  );
}
