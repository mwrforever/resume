import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { Bar, BarChart, CartesianGrid, Cell, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { AdminLayout } from '@/components/layout/admin-layout';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card';
import { EvaluationRadarChart } from '@/components/common/radar-chart';
import { MatchBadge } from '@/components/common/match-badge';
import { employeeEvaluationsApi } from '@/api/employee/evaluations';
import { Award, CheckCircle2, Sparkles, Target, TrendingUp, XCircle } from 'lucide-react';

interface Evaluation {
  match_id: number;
  final_score: number;
  final_label: '优秀' | '良好' | '一般' | '未达标';
  advantage_comment: string;
  disadvantage_comment: string;
  dimensions: { dimension_name: string; score: number; advantage: string; disadvantage: string }[];
  skill_hits: { skill_id: number; skill_name: string; skill_type: number; is_hit: boolean; hit_context: string; match_label?: string }[];
}

interface SkillChartItem {
  skillId: number;
  name: string;
  isHit: boolean;
  typeLabel: string;
  hitContext: string;
  matchLabel?: string;
  x: number;
  y: number;
  fontSize: number;
  ringLabel: string;
}

const labelStyles = {
  '优秀': {
    gradient: 'from-emerald-500 to-teal-500',
    ring: 'ring-emerald-100',
    text: 'text-emerald-700',
    bg: 'bg-emerald-50',
  },
  '良好': {
    gradient: 'from-blue-500 to-indigo-500',
    ring: 'ring-blue-100',
    text: 'text-blue-700',
    bg: 'bg-blue-50',
  },
  '一般': {
    gradient: 'from-amber-500 to-orange-500',
    ring: 'ring-amber-100',
    text: 'text-amber-700',
    bg: 'bg-amber-50',
  },
  '未达标': {
    gradient: 'from-rose-500 to-red-500',
    ring: 'ring-rose-100',
    text: 'text-rose-700',
    bg: 'bg-rose-50',
  },
};

function getDimensionColor(score: number) {
  if (score >= 85) return '#10B981';
  if (score >= 70) return '#2563EB';
  if (score >= 60) return '#F59E0B';
  return '#EF4444';
}

function getSkillTypeLabel(skillType: number) {
  if (skillType === 1) return '必须满足';
  if (skillType === 2) return '优先匹配';
  return '普通技能';
}

function getSkillRing(skillType: number) {
  if (skillType === 2) return { label: '优选技能', min: 0.08, max: 0.28, fontSize: 15 };
  if (skillType === 1) return { label: '必选技能', min: 0.36, max: 0.58, fontSize: 14 };
  return { label: '可选技能', min: 0.66, max: 0.9, fontSize: 13 };
}

function getHashSeed(text: string) {
  let hash = 0;
  for (let index = 0; index < text.length; index += 1) {
    hash = (hash * 31 + text.charCodeAt(index)) >>> 0;
  }
  return hash;
}

function getSeededRandom(seed: number) {
  const value = Math.sin(seed) * 10000;
  return value - Math.floor(value);
}

function buildSkillCloudItems(skills: Evaluation['skill_hits']): SkillChartItem[] {
  const placedItems: SkillChartItem[] = [];

  return skills.map((skill, index) => {
    const skillName = skill.skill_name || '未命名技能';
    const ring = getSkillRing(skill.skill_type);
    const baseSeed = getHashSeed(`${skill.skill_id}-${skillName}-${skill.skill_type}`);
    let x = 50;
    let y = 50;

    for (let attempt = 0; attempt < 10; attempt += 1) {
      const angle = getSeededRandom(baseSeed + attempt * 17) * Math.PI * 2;
      const radius = ring.min + getSeededRandom(baseSeed + attempt * 31 + index) * (ring.max - ring.min);
      const candidateX = 50 + Math.cos(angle) * radius * 45;
      const candidateY = 50 + Math.sin(angle) * radius * 38;
      const hasCollision = placedItems.some((item) => {
        const distanceX = item.x - candidateX;
        const distanceY = item.y - candidateY;
        const minDistance = item.ringLabel === ring.label ? 11 : 7;
        return Math.sqrt(distanceX * distanceX + distanceY * distanceY) < minDistance;
      });

      x = Math.min(90, Math.max(10, candidateX));
      y = Math.min(88, Math.max(12, candidateY));
      if (!hasCollision) break;
    }

    const item = {
      skillId: skill.skill_id,
      name: skillName,
      isHit: skill.is_hit,
      typeLabel: getSkillTypeLabel(skill.skill_type),
      hitContext: skill.hit_context,
      matchLabel: skill.match_label,
      x,
      y,
      fontSize: ring.fontSize + (skill.is_hit ? 1 : 0),
      ringLabel: ring.label,
    };
    placedItems.push(item);
    return item;
  });
}

function SkillCloudTooltip({ item }: { item: SkillChartItem }) {
  if (!item) return null;

  return (
    <div className="max-w-[360px] rounded-2xl border border-[#E2E8F0] bg-white p-4 text-sm shadow-xl shadow-slate-200/70">
      <div className="mb-3 flex items-start justify-between gap-3">
        <div>
          <p className="font-semibold text-[#1E293B]">{item.name}</p>
          <p className="mt-1 text-xs text-[#64748B]">{item.ringLabel} · {item.typeLabel}</p>
        </div>
        <span className={`shrink-0 rounded-full px-2.5 py-1 text-xs font-semibold ${item.isHit ? 'bg-emerald-50 text-emerald-700' : 'bg-slate-100 text-slate-500'}`}>
          {item.matchLabel || (item.isHit ? '已命中' : '未命中')}
        </span>
      </div>
      <p className="mb-2 text-xs font-semibold text-[#64748B]">简历原文片段</p>
      <p className="max-h-40 overflow-auto rounded-xl bg-[#F8FAFC] p-3 leading-6 text-[#334155]">
        {item.hitContext || '暂无可展示片段'}
      </p>
    </div>
  );
}

export default function EmployeeEvalDetail() {
  const { id } = useParams();
  const [evaluation, setEvaluation] = useState<Evaluation | null>(null);
  const [loading, setLoading] = useState(true);
  const [hoveredSkill, setHoveredSkill] = useState<SkillChartItem | null>(null);

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

  const labelStyle = labelStyles[evaluation.final_label];
  const dimensionChartData = evaluation.dimensions.map((dimension) => ({
    name: dimension.dimension_name,
    score: dimension.score,
  }));
  const hitCount = evaluation.skill_hits.filter((skill) => skill.is_hit).length;
  const skillCount = evaluation.skill_hits.length;
  const skillHitRate = skillCount > 0 ? Math.round((hitCount / skillCount) * 100) : 0;
  const skillCloudItems = buildSkillCloudItems(evaluation.skill_hits);
  const skillCloudHeight = Math.min(720, Math.max(430, 320 + skillCloudItems.length * 8));

  return (
    <AdminLayout
      breadcrumbs={[{ label: '投递管理', href: '/employee/applications' }, { label: '评估详情' }]}
      title="AI 评估报告"
    >
      {/* Top summary card */}
      <section className={`mb-6 overflow-hidden rounded-3xl bg-gradient-to-br ${labelStyle.gradient} p-[1px] shadow-sm`}>
        <div className="rounded-3xl bg-white">
          <div className="grid gap-6 p-6 lg:grid-cols-[280px_1fr]">
            <div className={`rounded-2xl ${labelStyle.bg} p-5 ring-1 ${labelStyle.ring}`}>
              <div className="mb-6 flex items-center justify-between">
                <div className="inline-flex items-center gap-2 rounded-full bg-white px-3 py-1 text-xs font-semibold text-[#475569] shadow-sm">
                  <Sparkles size={14} aria-hidden="true" />
                  AI 综合评分
                </div>
                <MatchBadge label={evaluation.final_label} />
              </div>
              <div className="flex items-end gap-2">
                <span className={`text-6xl font-black leading-none tabular-nums ${labelStyle.text}`}>
                  {evaluation.final_score}
                </span>
                <span className="pb-2 text-sm font-semibold text-[#94A3B8]">/100</span>
              </div>
              <div className="mt-5 h-3 overflow-hidden rounded-full bg-white">
                <div
                  className={`h-full rounded-full bg-gradient-to-r ${labelStyle.gradient} transition-all`}
                  style={{ width: `${evaluation.final_score}%` }}
                  role="progressbar"
                  aria-valuenow={evaluation.final_score}
                  aria-valuemin={0}
                  aria-valuemax={100}
                  aria-label={`匹配度 ${evaluation.final_score}%`}
                />
              </div>
            </div>

            <div className="grid gap-4 sm:grid-cols-3">
              <div className="rounded-2xl border border-[#E2E8F0] bg-[#F8FAFC] p-5">
                <div className="mb-4 flex h-10 w-10 items-center justify-center rounded-xl bg-blue-100 text-blue-600">
                  <Target size={20} aria-hidden="true" />
                </div>
                <p className="text-sm text-[#64748B]">评估维度</p>
                <p className="mt-1 text-3xl font-bold tabular-nums text-[#1E293B]">{evaluation.dimensions.length}</p>
              </div>
              <div className="rounded-2xl border border-[#E2E8F0] bg-[#F8FAFC] p-5">
                <div className="mb-4 flex h-10 w-10 items-center justify-center rounded-xl bg-emerald-100 text-emerald-600">
                  <CheckCircle2 size={20} aria-hidden="true" />
                </div>
                <p className="text-sm text-[#64748B]">技能命中</p>
                <p className="mt-1 text-3xl font-bold tabular-nums text-[#1E293B]">{hitCount}/{skillCount}</p>
              </div>
              <div className="rounded-2xl border border-[#E2E8F0] bg-[#F8FAFC] p-5">
                <div className="mb-4 flex h-10 w-10 items-center justify-center rounded-xl bg-violet-100 text-violet-600">
                  <TrendingUp size={20} aria-hidden="true" />
                </div>
                <p className="text-sm text-[#64748B]">命中率</p>
                <p className="mt-1 text-3xl font-bold tabular-nums text-[#1E293B]">{skillHitRate}%</p>
              </div>
            </div>
          </div>
        </div>
      </section>

      <div className="grid grid-cols-1 gap-6 xl:grid-cols-[1.1fr_0.9fr]">
        {/* Left col: Radar chart + Comments */}
        <div className="space-y-6">
          <Card className="overflow-hidden rounded-2xl border-[#E2E8F0] shadow-sm">
            <CardHeader className="border-b border-[#F1F5F9] bg-[#F8FAFC]">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <CardTitle className="text-base text-[#1E293B]">多维度能力画像</CardTitle>
                  <p className="mt-1 text-sm text-[#64748B]">结合雷达图与分项得分查看能力短板</p>
                </div>
                <Award className="text-blue-500" size={22} aria-hidden="true" />
              </div>
            </CardHeader>
            <CardContent className="p-5">
              <div className="grid gap-6 lg:grid-cols-2">
                <div className="rounded-2xl border border-[#E2E8F0] bg-white p-3">
                  <EvaluationRadarChart
                    data={evaluation.dimensions.map((d) => ({ dimension: d.dimension_name, score: d.score }))}
                  />
                </div>
                <div className="rounded-2xl border border-[#E2E8F0] bg-white p-3">
                  <ResponsiveContainer width="100%" height={300}>
                    <BarChart data={dimensionChartData} layout="vertical" margin={{ top: 8, right: 18, left: 8, bottom: 8 }}>
                      <CartesianGrid stroke="#E2E8F0" horizontal={false} />
                      <XAxis type="number" domain={[0, 100]} tickLine={false} axisLine={false} tick={{ fill: '#64748B', fontSize: 12 }} />
                      <YAxis dataKey="name" type="category" width={80} tickLine={false} axisLine={false} tick={{ fill: '#64748B', fontSize: 12 }} />
                      <Tooltip formatter={(value: number) => [`${value} 分`, '得分']} cursor={{ fill: '#F8FAFC' }} />
                      <Bar dataKey="score" radius={[0, 8, 8, 0]} barSize={14}>
                        {dimensionChartData.map((dimension) => (
                          <Cell key={dimension.name} fill={getDimensionColor(dimension.score)} />
                        ))}
                      </Bar>
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              </div>
            </CardContent>
          </Card>

          <Card className="overflow-hidden rounded-2xl border-[#E2E8F0] shadow-sm">
            <CardHeader className="border-b border-[#F1F5F9] bg-[#F8FAFC]">
              <CardTitle className="text-base text-[#1E293B]">AI 结论摘要</CardTitle>
            </CardHeader>
            <CardContent className="grid gap-4 p-5 md:grid-cols-2">
              {evaluation.advantage_comment && (
                <div className="rounded-2xl border border-emerald-200 bg-emerald-50 p-4">
                  <div className="mb-3 flex items-center gap-2 text-sm font-semibold text-emerald-700">
                    <CheckCircle2 size={16} aria-hidden="true" />
                    优势亮点
                  </div>
                  <p className="text-sm leading-6 text-[#1E293B]">{evaluation.advantage_comment}</p>
                </div>
              )}
              <div className="rounded-2xl border border-orange-200 bg-[#FFF7ED] p-4">
                <div className="mb-3 flex items-center gap-2 text-sm font-semibold text-orange-700">
                  <XCircle size={16} aria-hidden="true" />
                  风险与待提升
                </div>
                <p className="text-sm leading-6 text-[#1E293B]">
                  {evaluation.disadvantage_comment || '这份简历挺符合岗位预期 🎉'}
                </p>
              </div>
            </CardContent>
          </Card>
        </div>

        <Card className="overflow-hidden rounded-2xl border-[#E2E8F0] shadow-sm">
          <CardHeader className="border-b border-[#F1F5F9] bg-[#F8FAFC]">
            <div className="flex items-start justify-between gap-4">
              <div>
                <CardTitle className="text-base text-[#1E293B]">技能命中图谱</CardTitle>
                <p className="mt-1 text-sm text-[#64748B]">按类型分区随机分布，悬浮技能词可查看简历原文片段</p>
              </div>
              <div className="rounded-2xl bg-blue-50 px-4 py-2 text-right">
                <p className="text-xs text-blue-600">命中率</p>
                <p className="text-xl font-bold tabular-nums text-blue-700">{skillHitRate}%</p>
              </div>
            </div>
          </CardHeader>
          <CardContent className="p-5">
            {skillCloudItems.length === 0 ? (
              <div className="rounded-2xl border border-dashed border-[#CBD5E1] py-12 text-center text-sm text-[#94A3B8]">
                暂无技能命中数据
              </div>
            ) : (
              <>
                <div className="mb-4 flex flex-wrap gap-3 text-xs text-[#64748B]">
                  <span className="inline-flex items-center gap-1.5">
                    <span className="h-2.5 w-2.5 rounded-full bg-emerald-500" />
                    已命中
                  </span>
                  <span className="inline-flex items-center gap-1.5">
                    <span className="h-2.5 w-2.5 rounded-full bg-slate-300" />
                    未命中
                  </span>
                  <span className="inline-flex items-center gap-1.5">
                    <span className="h-2.5 w-2.5 rounded-full border border-blue-300 bg-blue-50" />
                    中心：优选技能
                  </span>
                  <span className="inline-flex items-center gap-1.5">
                    <span className="h-2.5 w-2.5 rounded-full border border-violet-300 bg-violet-50" />
                    中层：必选技能
                  </span>
                  <span className="inline-flex items-center gap-1.5">
                    <span className="h-2.5 w-2.5 rounded-full border border-slate-300 bg-slate-50" />
                    外围：可选技能
                  </span>
                </div>
                <div
                  className="relative overflow-hidden rounded-3xl border border-[#E2E8F0] bg-[radial-gradient(circle_at_center,#EFF6FF_0%,#F8FAFC_42%,#FFFFFF_100%)]"
                  style={{ height: skillCloudHeight }}
                >
                  <div className="absolute left-1/2 top-1/2 h-[28%] w-[34%] -translate-x-1/2 -translate-y-1/2 rounded-full border border-blue-200 bg-blue-50/50" />
                  <div className="absolute left-1/2 top-1/2 h-[58%] w-[68%] -translate-x-1/2 -translate-y-1/2 rounded-full border border-violet-200 bg-violet-50/30" />
                  <div className="absolute left-1/2 top-1/2 h-[88%] w-[94%] -translate-x-1/2 -translate-y-1/2 rounded-full border border-slate-200" />
                  {hoveredSkill && (
                    <div className="pointer-events-none absolute right-4 top-4 z-50 w-[min(360px,calc(100%-32px))]">
                      <SkillCloudTooltip item={hoveredSkill} />
                    </div>
                  )}
                  {skillCloudItems.map((skill) => (
                    <div
                      key={`${skill.skillId}-${skill.name}`}
                      className="group absolute z-10 -translate-x-1/2 -translate-y-1/2 hover:z-40 focus-within:z-40"
                      style={{ left: `${skill.x}%`, top: `${skill.y}%` }}
                    >
                      <button
                        type="button"
                        className={`rounded-full border px-3 py-1.5 font-semibold shadow-sm transition-all hover:z-20 hover:-translate-y-0.5 hover:scale-110 hover:shadow-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#2563EB] ${
                          skill.isHit
                            ? 'border-emerald-200 bg-emerald-50 text-emerald-700'
                            : 'border-slate-200 bg-white text-slate-400'
                        }`}
                        style={{ fontSize: skill.fontSize }}
                        aria-label={`${skill.name}，${skill.typeLabel}，${skill.isHit ? '已命中' : '未命中'}`}
                        onBlur={() => setHoveredSkill(null)}
                        onFocus={() => setHoveredSkill(skill)}
                        onMouseEnter={() => setHoveredSkill(skill)}
                        onMouseLeave={() => setHoveredSkill(null)}
                      >
                        {skill.name}
                      </button>
                    </div>
                  ))}
                </div>
              </>
            )}
          </CardContent>
        </Card>
      </div>

      <Card className="mt-6 overflow-hidden rounded-2xl border-[#E2E8F0] shadow-sm">
        <CardHeader className="border-b border-[#F1F5F9] bg-[#F8FAFC]">
          <CardTitle className="text-base text-[#1E293B]">维度明细</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-4 p-5 md:grid-cols-2">
          {evaluation.dimensions.map((dimension) => (
            <div key={dimension.dimension_name} className="rounded-2xl border border-[#E2E8F0] bg-white p-4">
              <div className="mb-3 flex items-center justify-between gap-3">
                <p className="font-semibold text-[#1E293B]">{dimension.dimension_name}</p>
                <span className="text-lg font-bold tabular-nums text-[#2563EB]">{dimension.score}</span>
              </div>
              <div className="mb-4 h-2 overflow-hidden rounded-full bg-[#F1F5F9]">
                <div
                  className="h-full rounded-full"
                  style={{ width: `${dimension.score}%`, backgroundColor: getDimensionColor(dimension.score) }}
                />
              </div>
              {dimension.advantage && (
                <p className="mb-2 text-sm leading-6 text-[#334155]">
                  <span className="font-semibold text-emerald-700">优势：</span>{dimension.advantage}
                </p>
              )}
              {dimension.disadvantage && (
                <p className="text-sm leading-6 text-[#334155]">
                  <span className="font-semibold text-orange-700">不足：</span>{dimension.disadvantage}
                </p>
              )}
            </div>
          ))}
        </CardContent>
      </Card>
    </AdminLayout>
  );
}
