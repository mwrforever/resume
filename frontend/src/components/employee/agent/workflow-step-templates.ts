/**
 * Workflow 节点清单（与后端 backend/app/llm/graphs/workflows/step_labels.py 保持一致）。
 *
 * 用途：StepStrip 的「N / M 步」分母 = 该 workflow 的静态节点数。
 * mergeStepsWithTemplate 恒按模板拓扑顺序输出，runtime 仅贡献节点的 status / detail。
 * 这样渲染顺序与 runtime 到达顺序解耦，避免「跳顶 / 已完成节点变 pending」类视觉抖动。
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
 * 新语义（模板顺序优先，与 agent-run-reducer.upsertStep 解耦）：
 * - 渲染顺序恒等于模板拓扑顺序，不再受 runtime 到达顺序影响
 * - 命中 runtime 的节点：保留模板 title 作为权威标题，status / detail 取自 runtime
 * - 未命中 runtime 的节点：status = 'pending' 占位
 * - 渲染顺序只由模板决定，状态只由 runtime 决定 —— 根治「跳顶 / 已完成变未完成」
 * - 兜底：runtime 出现但不在模板内的未知 step_id，按到达顺序追加末尾（异常分支可观测）
 *
 * @param workflow workflow_type；未在 WORKFLOW_STEP_TEMPLATES 中的值走 fallback（直接返回 runtimeSteps）
 * @param runtimeSteps runState.steps，由 reducer 保证同 step_id 去重
 * @returns 合并后的步骤数组（长度 = 模板长度；runtime 含未知 step_id 时会更长）
 */
export function mergeStepsWithTemplate(
  workflow: WorkflowType,
  runtimeSteps: AgentStep[],
): AgentStep[] {
  const template = WORKFLOW_STEP_TEMPLATES[workflow];
  if (!template) return runtimeSteps;  // fallback：未知 workflow

  // runtime 状态索引：step_id → 运行时步骤（提供 status / detail）
  const runtimeByStepId = new Map(runtimeSteps.map(s => [s.step_id, s]));

  // 按模板拓扑顺序产出：命中 runtime 用其 status/detail，否则 pending 占位。
  // 渲染顺序只由模板决定，状态只由 runtime 决定 —— 两者解耦，根治"跳顶 / 已完成变未完成"。
  const merged: AgentStep[] = template.map(t => {
    const r = runtimeByStepId.get(t.step_id);
    if (r) {
      return {
        step_id: t.step_id,
        title: t.title,
        status: r.status,
        ...(r.detail !== undefined ? { detail: r.detail } : {}),
      };
    }
    return { step_id: t.step_id, title: t.title, status: 'pending' };
  });

  // 兜底：runtime 出现但不在模板内的未知 step_id，按到达顺序追加末尾（异常分支可观测）
  for (const s of runtimeSteps) {
    if (!template.some(t => t.step_id === s.step_id)) merged.push(s);
  }

  return merged;
}
