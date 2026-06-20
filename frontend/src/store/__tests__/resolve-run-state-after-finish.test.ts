/**
 * resolveRunStateAfterFinish 单测：步骤进度跨「中断段」累积 + 错误态保留。
 *
 * 回归 bug 1：图一面试出题工作流被 interaction（选维度 / 确认计划）拆成 3 个 run 段，
 * 此前每段 run.finish 收尾时无条件清空 steps，进度条永远停在 1/8。
 * 回归 bug 2：run.error 写入的错误态被收尾重置清空，红色错误提示一闪而过。
 * 修复语义：
 * - 错误终态（hasError）→ 保留 steps（含失败步）+ error，优先于中断段判定
 * - 中断段（next_task_id=null）→ 保留 steps，下一段继续累积
 * - 真正 END（next_task_id 非空）→ 清空 steps，下一轮从 0 起跑
 * - 客户端 abort（无 finish）→ 清空 steps
 */

import { describe, it, expect } from 'vitest';
import { resolveRunStateAfterFinish } from '../agent';
import { INITIAL_RUN_STATE } from '@/utils/agent-run-reducer';
import type { AgentRunState, AgentStep } from '@/types/agent';

/** 构造带若干已完成 step 的运行态（模拟某 run 段结束时的累积进度） */
function runStateWithSteps(stepIds: string[]): AgentRunState {
  const steps: AgentStep[] = stepIds.map((id) => ({
    step_id: id, title: id, status: 'success',
  }));
  return {
    ...INITIAL_RUN_STATE,
    running: true,
    workflow_type: 'interview_questions',
    steps,
    current_blocks: [{ type: 'text', index: 0, text: 'x', status: 'success' }],
  };
}

describe('resolveRunStateAfterFinish', () => {
  it('中断段（有 finish + next_task_id 为 null）→ 保留 steps 让进度跨段累积', () => {
    const prev = runStateWithSteps(['load_resume', 'suggest_dimensions']);
    const next = resolveRunStateAfterFinish(prev, { hasFinish: true, nextTaskId: null });
    // steps 保留，进度不归零
    expect(next.steps.map((s) => s.step_id)).toEqual(['load_resume', 'suggest_dimensions']);
    // 其余字段回到 INITIAL：running=false、current_blocks 清空
    expect(next.running).toBe(false);
    expect(next.current_blocks).toEqual([]);
    // workflow_type 始终保留
    expect(next.workflow_type).toBe('interview_questions');
  });

  it('真正 END（有 finish + next_task_id 非空）→ 清空 steps，下一轮从 0 起跑', () => {
    const prev = runStateWithSteps(['load_resume', 'suggest_dimensions', 'finalize_question_set']);
    const next = resolveRunStateAfterFinish(prev, { hasFinish: true, nextTaskId: 'task-abc' });
    expect(next.steps).toEqual([]);
    expect(next.running).toBe(false);
    expect(next.workflow_type).toBe('interview_questions');
  });

  it('客户端 abort（无 finish）→ 清空 steps', () => {
    const prev = runStateWithSteps(['load_resume']);
    const next = resolveRunStateAfterFinish(prev, { hasFinish: false, nextTaskId: null });
    expect(next.steps).toEqual([]);
  });

  it('多段累积场景：段1(2步) → 段2(再到4步) 不归零', () => {
    // 段1 结束（中断）：累积 load_resume + suggest_dimensions
    const seg1 = runStateWithSteps(['load_resume', 'suggest_dimensions']);
    const afterSeg1 = resolveRunStateAfterFinish(seg1, { hasFinish: true, nextTaskId: null });
    expect(afterSeg1.steps).toHaveLength(2);

    // 段2 在保留的 steps 基础上又跑了 2 个节点后再次中断
    const seg2: AgentRunState = {
      ...afterSeg1,
      steps: [
        ...afterSeg1.steps,
        { step_id: 'request_dimension_selection', title: 't', status: 'success' },
        { step_id: 'build_question_plan', title: 't', status: 'success' },
      ],
    };
    const afterSeg2 = resolveRunStateAfterFinish(seg2, { hasFinish: true, nextTaskId: null });
    expect(afterSeg2.steps).toHaveLength(4);
  });

  it('错误终态（hasError）→ 保留 steps（含失败步）+ error，running 置 false', () => {
    // 模拟 build_question_plan 节点失败：steps 末位是 failed，runState.error 已由 reducer 写入
    const prev: AgentRunState = {
      ...runStateWithSteps(['load_resume', 'suggest_dimensions']),
      steps: [
        { step_id: 'load_resume', title: '读取简历', status: 'success' },
        { step_id: 'build_question_plan', title: '规划出题', status: 'failed' },
      ],
      error: { code: 'graph_execution_failed', message: 'LLM 网关错误' },
    };
    const next = resolveRunStateAfterFinish(prev, {
      hasFinish: true, nextTaskId: null, hasError: true,
    });
    // 失败步保留可见
    expect(next.steps.map((s) => s.status)).toEqual(['success', 'failed']);
    // 错误对象保留（红色提示数据源不被清空）
    expect(next.error).toEqual({ code: 'graph_execution_failed', message: 'LLM 网关错误' });
    // 流程已停
    expect(next.running).toBe(false);
  });

  it('错误终态优先于中断段：next_task_id 为 null 也不当作中断段清空 error', () => {
    // graph 异常时 next_task_id 同样为 null，必须靠 hasError 区分，否则错误被误判为中断段
    const prev: AgentRunState = {
      ...runStateWithSteps(['load_resume']),
      error: { code: 'graph_execution_failed', message: 'boom' },
    };
    const next = resolveRunStateAfterFinish(prev, {
      hasFinish: true, nextTaskId: null, hasError: true,
    });
    expect(next.error).not.toBeNull();
    expect(next.steps).toHaveLength(1);
  });
});

