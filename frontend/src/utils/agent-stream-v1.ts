import type {
  IAgentStreamEnvelopeV1,
  IPlanReviewTreeRenderData,
  IPlanSubTask,
  TAgentStreamProtocolVersion,
  TUiComponentKey,
} from '@/types/agent';

/** 解析 SSE data 为 v1 信封；协议版本不匹配时返回 null */
export function parseAgentStreamEnvelopeV1(data: Record<string, unknown>): IAgentStreamEnvelopeV1 | null {
  const version = data.protocol_version;
  if (version !== '1.0') {
    return null;
  }
  if (typeof data.seq !== 'number' || typeof data.event_type !== 'string') {
    return null;
  }
  return data as unknown as IAgentStreamEnvelopeV1;
}

/** 从 ui.render 载荷中读取组件键 */
export function getUiComponentKey(payload: Record<string, unknown>): TUiComponentKey | null {
  const key = payload.component_key;
  if (key === 'PlanReviewTree' || key === 'PlanRepairHints' || key === 'ActionConfirmCard') {
    return key;
  }
  return null;
}

/** 解析 PlanReviewTree 的 data 字段 */
export function parsePlanReviewTreeData(raw: Record<string, unknown>): IPlanReviewTreeRenderData | null {
  const tasks = raw.tasks;
  if (!Array.isArray(tasks) || tasks.length === 0) {
    return null;
  }
  const normalizedTasks: IPlanSubTask[] = tasks
    .filter((item): item is Record<string, unknown> => typeof item === 'object' && item !== null)
    .map((item, index) => ({
      task_id: String(item.task_id || `task-${index + 1}`),
      domain: (item.domain as IPlanSubTask['domain']) || 'generic',
      title: String(item.title || `子任务 ${index + 1}`),
      instruction: String(item.instruction || ''),
      depends_on: Array.isArray(item.depends_on) ? item.depends_on.map(String) : [],
      status: typeof item.status === 'string' ? item.status : undefined,
      result_summary: typeof item.result_summary === 'string' ? item.result_summary : null,
    }));
  return {
    plan_id: typeof raw.plan_id === 'string' ? raw.plan_id : undefined,
    revision: typeof raw.revision === 'number' ? raw.revision : 1,
    max_revisions: typeof raw.max_revisions === 'number' ? raw.max_revisions : undefined,
    tasks: normalizedTasks,
    editable: raw.editable !== false,
  };
}

/** 从 plan.repair_suggestions 载荷提取建议列表 */
export function parseRepairSuggestions(payload: Record<string, unknown>): string[] {
  const suggestions = payload.suggestions;
  if (!Array.isArray(suggestions)) {
    return [];
  }
  return suggestions.map((item) => String(item)).filter((item) => item.trim().length > 0);
}

export const AGENT_STREAM_PROTOCOL_V1: TAgentStreamProtocolVersion = '1.0';
