/**
 * agent-run-reducer：envelope → AgentRunState 状态转换。
 *
 * 流式与历史共用同一渲染管线，差异只在 source of truth：
 * - 流式：runState.current_blocks
 * - 历史：AgentMessage.content.blocks
 */

import type {
  AgentBlock,
  AgentEnvelope,
  AgentRunState,
  AgentStep,
  WorkflowType,
} from '@/types/agent';

/** 初始 run 状态 */
export const INITIAL_RUN_STATE: AgentRunState = {
  running: false,
  run_id: null,
  workflow_type: 'interview_questions',
  enable_thinking: false,
  steps: [],
  current_blocks: [],
  error: null,
};

/**
 * reducer：将一个 envelope 应用到 run state，返回新 state。
 *
 * @param state - 当前 run state
 * @param env - 收到的 envelope
 * @returns 新的 run state
 */
export function agentRunReducer(state: AgentRunState, env: AgentEnvelope): AgentRunState {
  switch (env.type) {
    case 'run.start': {
      const data = env.data;
      return {
        running: true,
        run_id: data.run_id,
        workflow_type: data.workflow_type as WorkflowType,
        enable_thinking: data.enable_thinking,
        steps: [],
        current_blocks: [],
        error: null,
      };
    }
    case 'run.finish':
      return { ...state, running: false };
    case 'run.error':
      return { ...state, running: false, error: { code: env.data.code, message: env.data.message } };
    case 'step.update':
      return { ...state, steps: upsertStep(state.steps, env.data) };
    case 'block.start':
      return { ...state, current_blocks: insertBlock(state.current_blocks, env.data) };
    case 'block.delta':
      return { ...state, current_blocks: applyDelta(state.current_blocks, env.data) };
    case 'block.stop':
      return { ...state, current_blocks: stopBlock(state.current_blocks, env.data.index) };
    case 'interaction.request':
      // 已通过 block.start(type=interaction) 渲染；本事件留作 step 记录用
      return state;
    case 'interaction.resolve':
      return { ...state, current_blocks: resolveInteraction(state.current_blocks, env.data) };
    default:
      // 未知 type 静默忽略
      return state;
  }
}

// ---------- 辅助函数 ----------

/** 更新或追加步骤 */
function upsertStep(steps: AgentStep[], data: AgentStep): AgentStep[] {
  const idx = steps.findIndex(s => s.step_id === data.step_id);
  if (idx === -1) return [...steps, data];
  const next = [...steps];
  next[idx] = { ...steps[idx], ...data };
  return next;
}

/** 按 index 插入 block（已存在则覆盖） */
function insertBlock(
  blocks: AgentBlock[], data: { index: number; block: Record<string, unknown> },
): AgentBlock[] {
  const merged = { ...(data.block as object), index: data.index } as AgentBlock;
  const existing = blocks.findIndex(b => b.index === data.index);
  if (existing === -1) return [...blocks, merged].sort((a, b) => a.index - b.index);
  const next = [...blocks];
  next[existing] = merged;
  return next;
}

/** 按 index 应用 delta */
function applyDelta(
  blocks: AgentBlock[], data: { index: number; delta: Record<string, unknown> },
): AgentBlock[] {
  const idx = blocks.findIndex(b => b.index === data.index);
  if (idx === -1) return blocks;
  const target = blocks[idx];
  const merged: AgentBlock = mergeBlockDelta(target, data.delta);
  const next = [...blocks];
  next[idx] = merged;
  return next;
}

/** 根据 block 类型合并 delta */
function mergeBlockDelta(block: AgentBlock, delta: Record<string, unknown>): AgentBlock {
  switch (block.type) {
    case 'text':
    case 'thinking': {
      const td = typeof delta.text_delta === 'string' ? delta.text_delta : '';
      return { ...block, text: block.text + td };
    }
    case 'tool_use': {
      return {
        ...block,
        ...(typeof delta.status === 'string' ? { status: delta.status as AgentBlock['status'] } : {}),
        ...(typeof delta.output === 'object' && delta.output ? { output: delta.output as Record<string, unknown> } : {}),
        ...(typeof delta.error === 'string' ? { error: delta.error } : {}),
      };
    }
    case 'interaction': {
      return {
        ...block,
        ...(typeof delta.status === 'string' ? { status: delta.status as AgentBlock['status'] } : {}),
        ...(typeof delta.values === 'object' && delta.values ? { values: delta.values as Record<string, unknown> } : {}),
      };
    }
    case 'interview_questions': {
      if (delta.question_set) return { ...block, question_set: delta.question_set as never };
      return block;
    }
    case 'evaluation_report': {
      if (delta.report) return { ...block, report: delta.report as never };
      return block;
    }
    default:
      return block;
  }
}

/** 标记 block 停止（streaming → success） */
function stopBlock(blocks: AgentBlock[], index: number): AgentBlock[] {
  const idx = blocks.findIndex(b => b.index === index);
  if (idx === -1) return blocks;
  const target = blocks[idx];
  if (target.status !== 'streaming') return blocks;
  const next = [...blocks];
  next[idx] = { ...target, status: 'success' as const };
  return next;
}

/** 提交 interaction：按 request_id 找到对应 block 并标记 submitted */
function resolveInteraction(
  blocks: AgentBlock[],
  data: { request_id: string; values: Record<string, unknown> },
): AgentBlock[] {
  const idx = blocks.findIndex(b => b.type === 'interaction' && b.request_id === data.request_id);
  if (idx === -1) return blocks;
  const target = blocks[idx];
  if (target.type !== 'interaction') return blocks;
  const next = [...blocks];
  next[idx] = { ...target, status: 'submitted', values: data.values };
  return next;
}
