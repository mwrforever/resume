/**
 * 进度栏数据源选择。
 *
 * 修复 Bug1：旧逻辑按 runState.running 硬切，任务结束瞬间 running=false 但
 * session.progress 尚未回写 → 进度全 pending 闪空。改为"取信息更完整的一方"：
 * runState.steps 非空就用它（覆盖结束后持久化回写前的空窗期），否则回看持久化进度。
 * 正常 END 后 reducer 会清空 runState.steps，此时 session.progress 通常已就绪。
 */

import type { AgentStep, WorkflowType } from '@/types/agent';

/** 选源入参 */
export interface ProgressSourceArgs {
  /** 运行态实时步骤（runState.steps） */
  runStateSteps: AgentStep[];
  /** 运行态 workflow（runState.workflow_type） */
  runStateWorkflow: WorkflowType;
  /** 后端回写的持久化进度（session.progress），可能为空 */
  sessionProgress?: { steps: AgentStep[]; workflow_type: WorkflowType } | null;
  /** 最近一条消息的 workflow（持久化也缺失时的回退） */
  lastMessageWorkflow?: WorkflowType;
}

/** 选源结果 */
export interface ProgressSourceResult {
  steps: AgentStep[];
  workflowType: WorkflowType;
}

/** 选择进度展示的数据源与 workflow 类型 */
export function selectProgressSource(args: ProgressSourceArgs): ProgressSourceResult {
  const { runStateSteps, runStateWorkflow, sessionProgress, lastMessageWorkflow } = args;
  // runState.steps 非空 → 优先实时数据（含结束后持久化未回写的空窗期）
  if (runStateSteps.length > 0) {
    return { steps: runStateSteps, workflowType: runStateWorkflow };
  }
  // 否则回看持久化进度
  if (sessionProgress) {
    return { steps: sessionProgress.steps, workflowType: sessionProgress.workflow_type };
  }
  // 皆空：空步骤 + 回退 workflow（由模板填 pending 占位）
  return { steps: [], workflowType: lastMessageWorkflow ?? 'interview_questions' };
}
