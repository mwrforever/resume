/**
 * Workflow 节点清单（与后端 backend/app/llm/graphs/workflows/step_labels.py 保持一致）。
 *
 * 用途：StepStrip 的「N / M 步」分母 = 该 workflow 的静态节点数。
 * step.update envelope 到达时按 step_id 匹配模板项替换状态；
 * 重入相同 step_id（驳回循环）→ 取该 step_id 最后一次出现的状态，长度恒定。
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
 * 规则：
 * - 模板项按拓扑顺序输出，runtime 命中的项替换 status / detail，未命中保持 pending；
 * - 重入相同 step_id（runtime 中多次出现）→ 取**最后一次**出现的状态作为该模板项的当前状态，
 *   保证"驳回循环"不增加分母也不重置已完成；
 * - 模板里没出现的 runtime step_id（异常分支或新节点未同步）→ 追加到末尾，分母 = 模板长度 + 异常项数；
 *   这是防御性兜底，正常情况下不应发生。
 *
 * @param workflow workflow_type；未在 WORKFLOW_STEP_TEMPLATES 中的值走 fallback（直接返回 runtimeSteps）
 * @param runtimeSteps runState.steps，按 step.update 到达顺序累积
 * @returns 合并后的步骤数组（长度 ≥ 模板长度）
 */
export function mergeStepsWithTemplate(
  workflow: WorkflowType,
  runtimeSteps: AgentStep[],
): AgentStep[] {
  const template = WORKFLOW_STEP_TEMPLATES[workflow];
  if (!template) return runtimeSteps;  // fallback：未知 workflow

  // runtime steps 按 step_id 取**最后一次**出现的状态
  const lastByStepId = new Map<string, AgentStep>();
  for (const s of runtimeSteps) {
    lastByStepId.set(s.step_id, s);
  }

  // 按模板顺序输出：命中 → 模板 step_id/title + runtime status/detail；未命中 → pending 占位。
  // title 始终以模板为准（前端是 title 权威源），runtime 仅贡献状态与详情。
  const merged: AgentStep[] = template.map(t => {
    const runtime = lastByStepId.get(t.step_id);
    if (runtime) {
      return {
        step_id: t.step_id,
        title: t.title,
        status: runtime.status,
        ...(runtime.detail !== undefined ? { detail: runtime.detail } : {}),
      };
    }
    return { step_id: t.step_id, title: t.title, status: 'pending' };
  });

  // 模板未覆盖的 runtime step（防御性追加，分母会变大）。
  // 用 lastByStepId 取该 step_id 最后一次出现的状态，与前面"重入取最后一次"规则一致。
  const templateIds = new Set(template.map(t => t.step_id));
  const appended = new Set<string>();
  for (const s of runtimeSteps) {
    if (templateIds.has(s.step_id) || appended.has(s.step_id)) continue;
    appended.add(s.step_id);
    const last = lastByStepId.get(s.step_id);
    if (last) merged.push(last);
  }

  return merged;
}
