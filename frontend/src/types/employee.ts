// 工作台统计
export interface DashboardStats {
  job_count: number;
  resume_count: number;
  pending_eval_count: number;
  avg_match_score: number;
  recent_activities: Activity[];
}

export interface Activity {
  id: number;
  type: 'resume_upload' | 'application' | 'evaluation' | 'job_create';
  text: string;
  time: string;
}

// 匹配度分布
export interface MatchDistribution {
  total: number;
  excellent: { count: number; percentage: number };
  good: { count: number; percentage: number };
  average: { count: number; percentage: number };
  fail: { count: number; percentage: number };
}

// 简历评估状态
export interface ResumeWithEvaluation {
  resume_id: number;
  file_name: string;
  match_id?: number;
  final_score?: number;
  final_label?: string;
  status: 'pending' | 'processing' | 'completed' | 'failed';
}

// 评估详情
export interface EvaluationDetail {
  match_id: number;
  resume_id: number;
  job_id: number;
  final_score: number;
  final_label: '优秀' | '良好' | '一般' | '未达标';
  advantage_comment: string;
  disadvantage_comment: string;
  dimensions: DimensionScore[];
  skill_hits: SkillHit[];
}

export interface DimensionScore {
  dimension_id: number;
  dimension_name: string;
  score: number;
  advantage: string;
  disadvantage: string;
  is_completed: boolean;
  error_message?: string;
}

export interface SkillHit {
  skill_id: number;
  skill_name?: string;
  skill_type?: number;
  is_hit: boolean;
  hit_context: string;
  match_label?: string;
}

// 岗位
export interface Job {
  id: number;
  name: string;
  description?: string;
  dept_id: number;
  status: number;
  create_time: string;
}

export interface IDimension {
  id?: number;
  dimension_name: string;
  weight: number;
  prompt_template: string;
  sort_order?: number;
}

export interface ISkill {
  id?: number;
  skill_name: string;
  skill_type: number;  // 1=必须, 2=优先, 3=普通
  match_label?: string;
}

export interface ITag {
  id: number;
  tag_name: string;
  tag_type: number;
  color: string;
}

export interface IAiSuggestDimension {
  dimension_name: string;
  weight: number;
  prompt_template: string;
}

export interface IAiSuggestSkill {
  skill: string;
  type: number;
  reason: string;
}

export interface IAiSuggestResult {
  comprehensive_description: string;
  dimensions: IAiSuggestDimension[];
  skills: IAiSuggestSkill[];
}

// 投递记录
export interface Application {
  id: number;
  user_id: number;
  job_id: number;
  job_name: string;
  resume_id: number;
  status: number;
  status_name: string;
  create_time: string;
}
