/**
 * Workflow 节点清单（与后端 backend/app/llm/graphs/workflows/step_labels.py 保持一致）。
 *
 * 用途：StepStrip 的「N / M 步」分母 = 该 workflow 的静态节点数。
 * mergeStepsWithTemplate 按 runtime 到达顺序输出已到达节点，未到达的模板节点
 * 以 pending 追加到末尾（详见该函数 JSDoc）。runtime 去重 + 重入移末尾由
 * agent-run-reducer.upsertStep 保证，本文件信任该契约不再二次去重。
 *
 * **同步约束**：后端 step_labels.py 增删节点时必须同步本文件。
 */

import type { AgentStep, WorkflowType } from '@/types/agent';

/** 节点模板项：仅含静态信息（step_id + 标题），状态由运行时填入 */
export interface StepTemplate {
  step_id: string;
  title: string;
}

/**
 * Workflow → 节点清单（拓扑顺序）。
 *
 * - interview_questions 共 8 步；
 * - resume_evaluation 共 8 步。
 *
 * 节点 ID 与后端 step_labels.STEP_LABELS 的 key 完全一致。
 */
export const WORKFLOW_STEP_TEMPLATES: Record<WorkflowType, StepTemplate[]> = {
  interview_questions: [
    { step_id: 'load_resume',                 title: '读取简历' },
    { step_id: 'suggest_dimensions',          title: '分析维度' },
    { step_id: 'request_dimension_selection', title: '选择维度' },
    { step_id: 'build_question_plan',         title: '规划出题' },
    { step_id: 'request_plan_approval',       title: '确认计划' },
    { step_id: 'fanout_generate_questions',   title: '生成题目' },
    { step_id: 'reduce_questions',            title: '汇总整理' },
    { step_id: 'finalize_question_set',       title: '输出题库' },
  ],
  resume_evaluation: [
    { step_id: 'load_resume',                title: '读取简历' },
    { step_id: 'analyze_resume_profile',     title: '分析画像' },
    { step_id: 'load_job_candidates',        title: '加载岗位' },
    { step_id: 'request_job_selection',      title: '选择岗位' },
    { step_id: 'validate_job_full_name',     title: '校验岗位' },
    { step_id: 'run_evaluation_subgraph',    title: '多维评估' },
    { step_id: 'build_visualization_report', title: '组装报告' },
    { step_id: 'finalize_evaluation_report', title: '输出报告' },
  ],
};

/**
 * 把模板与运行时 step.update 序列合并为完整步骤数组。
 *
 * 新语义（与 agent-run-reducer.upsertStep 配合）：
 * - 输入的 runtimeSteps 已由 reducer 保证「同 step_id 不重复 + 重入移到末尾」
 * - 第一遍：按 runtime 顺序输出已到达的 step（保留模板 title 标准化）
 * - 第二遍：把模板里**未在 runtime 出现**的 step 按模板拓扑顺序追加到末尾，状态 pending
 * - 结果数组前 N 项 = runtime 已到达节点（按到达顺序），后 M 项 = 模板未到达节点（按模板顺序）
 *
 * 这让 StepStrip 的"当前活跃步骤" = runtime 末位节点（mergedSteps 中最后一个非 pending 项）。
 *
 * @param workflow workflow_type；未在 WORKFLOW_STEP_TEMPLATES 中的值走 fallback（直接返回 runtimeSteps）
 * @param runtimeSteps runState.steps，由 reducer 保证去重后按 runtime 顺序
 * @returns 合并后的步骤数组（长度 = 模板长度；runtime 含未知 step_id 时会更长）
 */
export function mergeStepsWithTemplate(
  workflow: WorkflowType,
  runtimeSteps: AgentStep[],
): AgentStep[] {
  const template = WORKFLOW_STEP_TEMPLATES[workflow];
  if (!template) return runtimeSteps;  // fallback：未知 workflow

  // 模板 title 索引：命中时保留模板权威 title
  const tmplTitleByStepId = new Map(template.map(t => [t.step_id, t.title]));
  const runtimeStepIds = new Set(runtimeSteps.map(s => s.step_id));

  const merged: AgentStep[] = [];

  // 第一遍：按 runtime 顺序输出，命中模板时取模板 title
  for (const s of runtimeSteps) {
    const tmplTitle = tmplTitleByStepId.get(s.step_id);
    merged.push({
      step_id: s.step_id,
      title: tmplTitle ?? s.title,
      status: s.status,
      ...(s.detail !== undefined ? { detail: s.detail } : {}),
    });
  }

  // 第二遍：模板里未出现在 runtime 的，按模板顺序追加 pending 占位
  for (const t of template) {
    if (!runtimeStepIds.has(t.step_id)) {
      merged.push({ step_id: t.step_id, title: t.title, status: 'pending' });
    }
  }

  return merged;
}
