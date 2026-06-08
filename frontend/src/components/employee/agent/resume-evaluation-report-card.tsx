import { AlertTriangle, BarChart3, BriefcaseBusiness, CheckCircle2, FileText, Timer } from 'lucide-react';

interface ResumeEvaluationReport {
  final_score?: number;
  final_label?: string;
  decision?: string;
  summary?: string;
  match_overview?: Record<string, unknown>;
  resume_structure?: Record<string, unknown>;
  experience_timeline?: Array<Record<string, unknown>>;
  skill_dimensions?: Array<Record<string, unknown>>;
  job_gaps?: Array<Record<string, unknown>>;
}

interface ResumeEvaluationReportCardProps {
  report: ResumeEvaluationReport;
}

/**
 * 渲染简历评估报告业务卡片。
 *
 * @param props 组件属性，包含结构化评估报告。
 * @return React.ReactElement 简历评估报告卡片。
 */
export function ResumeEvaluationReportCard({ report }: ResumeEvaluationReportCardProps) {
  const finalScore = Number(report.final_score || 0);
  const matchOverview = report.match_overview || {};
  const resumeStructure = report.resume_structure || {};
  const experienceTimeline = Array.isArray(report.experience_timeline) ? report.experience_timeline : [];
  const skillDimensions = Array.isArray(report.skill_dimensions) ? report.skill_dimensions : [];
  const jobGaps = Array.isArray(report.job_gaps) ? report.job_gaps : [];

  return (
    <section className="rounded-3xl border border-sky-100 bg-white p-5 shadow-sm shadow-sky-100/70" aria-label="简历评估报告">
      <div className="flex flex-col gap-4 border-b border-slate-100 pb-4 md:flex-row md:items-center md:justify-between">
        <div>
          <div className="flex items-center gap-2 text-xs font-semibold text-sky-700">
            <FileText size={15} aria-hidden="true" />
            简历评估报告
          </div>
          <h3 className="mt-1 text-lg font-semibold text-slate-950">{report.final_label || '待复核'}</h3>
          {report.summary && <p className="mt-2 text-sm leading-6 text-slate-600">{report.summary}</p>}
        </div>
        <div className="rounded-3xl bg-sky-50 px-5 py-4 text-center">
          <div className="text-3xl font-bold text-sky-700">{finalScore}</div>
          <div className="mt-1 text-xs font-semibold text-slate-500">{report.final_label || '待复核'}</div>
        </div>
      </div>

      <div className="mt-5 grid gap-4 md:grid-cols-2">
        <ReportSection icon={<BarChart3 size={16} aria-hidden="true" />} title="匹配概览">
          <KeyValueList value={matchOverview} />
        </ReportSection>
        <ReportSection icon={<BriefcaseBusiness size={16} aria-hidden="true" />} title="HR 决策">
          <div className="rounded-2xl bg-emerald-50 px-3 py-2 text-sm font-semibold text-emerald-700">{report.decision || '建议人工复核'}</div>
        </ReportSection>
        <ReportSection icon={<CheckCircle2 size={16} aria-hidden="true" />} title="简历结构">
          <KeyValueList value={resumeStructure} />
        </ReportSection>
        <ReportSection icon={<Timer size={16} aria-hidden="true" />} title="经历时间线">
          <RecordList records={experienceTimeline} emptyText="暂无时间线数据" />
        </ReportSection>
        <ReportSection icon={<BarChart3 size={16} aria-hidden="true" />} title="技能维度">
          <SkillDimensionList records={skillDimensions} />
        </ReportSection>
        <ReportSection icon={<AlertTriangle size={16} aria-hidden="true" />} title="岗位差距">
          <RecordList records={jobGaps} emptyText="暂无明显岗位差距" />
        </ReportSection>
      </div>
    </section>
  );
}

/**
 * 渲染报告分区。
 *
 * @param props 分区标题、图标和子内容。
 * @return React.ReactElement 分区卡片。
 */
function ReportSection({ icon, title, children }: { icon: React.ReactNode; title: string; children: React.ReactNode }) {
  return (
    <div className="rounded-2xl border border-slate-100 bg-slate-50/70 p-4">
      <div className="mb-3 flex items-center gap-2 text-sm font-semibold text-slate-900">
        <span className="text-sky-600">{icon}</span>
        {title}
      </div>
      {children}
    </div>
  );
}

/**
 * 渲染对象字段列表。
 *
 * @param props 待展示对象。
 * @return React.ReactElement 对象字段内容。
 */
function KeyValueList({ value }: { value: Record<string, unknown> }) {
  const entries = Object.entries(value);
  if (entries.length === 0) return <div className="text-sm text-slate-500">暂无数据</div>;

  return (
    <div className="space-y-2 text-sm text-slate-600">
      {entries.map(([key, entryValue]) => (
        <div key={key}>
          <span className="font-semibold text-slate-800">{key}：</span>
          <span>{formatValue(entryValue)}</span>
        </div>
      ))}
    </div>
  );
}

/**
 * 渲染记录列表。
 *
 * @param props 记录数组和空态文案。
 * @return React.ReactElement 记录列表。
 */
function RecordList({ records, emptyText }: { records: Array<Record<string, unknown>>; emptyText: string }) {
  if (records.length === 0) return <div className="text-sm text-slate-500">{emptyText}</div>;

  return (
    <div className="space-y-2 text-sm text-slate-600">
      {records.map((record, index) => (
        <div key={`${formatValue(record)}-${index}`} className="rounded-xl bg-white px-3 py-2">
          {Object.entries(record).map(([key, value]) => (
            <div key={key}>
              <span className="font-semibold text-slate-800">{key}：</span>
              <span>{formatValue(value)}</span>
            </div>
          ))}
        </div>
      ))}
    </div>
  );
}

/**
 * 渲染技能维度条。
 *
 * @param props 技能维度记录数组。
 * @return React.ReactElement 技能维度列表。
 */
function SkillDimensionList({ records }: { records: Array<Record<string, unknown>> }) {
  if (records.length === 0) return <div className="text-sm text-slate-500">暂无技能维度数据</div>;

  return (
    <div className="space-y-3">
      {records.map((record, index) => {
        const score = Math.max(0, Math.min(100, Number(record.score || 0)));
        return (
          <div key={`${String(record.name || 'skill')}-${index}`} className="rounded-xl bg-white px-3 py-2">
            <div className="flex items-center justify-between gap-3 text-sm">
              <span className="font-semibold text-slate-900">{String(record.name || record.dimension || '技能维度')}</span>
              <span className="font-semibold text-sky-700">{score}</span>
            </div>
            <div className="mt-2 h-2 rounded-full bg-slate-100">
              <div className="h-2 rounded-full bg-sky-500" style={{ width: `${score}%` }} />
            </div>
            {typeof record.evidence === 'string' && <div className="mt-2 text-xs text-slate-500">{record.evidence}</div>}
          </div>
        );
      })}
    </div>
  );
}

/**
 * 格式化报告字段值。
 *
 * @param value 原始字段值。
 * @return string 可展示文本。
 */
function formatValue(value: unknown): string {
  if (Array.isArray(value)) return value.map((item) => formatValue(item)).join('、');
  if (value && typeof value === 'object') return Object.entries(value).map(([key, entryValue]) => `${key}: ${formatValue(entryValue)}`).join('；');
  if (value === null || value === undefined || value === '') return '暂无';
  return String(value);
}
