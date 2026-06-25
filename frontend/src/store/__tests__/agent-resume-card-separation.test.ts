/**
 * Q1 修复单测：连续中断/续接时每段 run 各自成卡（与刷新后一致）。
 *
 * Bug：上一段 run 中断后 current_blocks 残留（preserveLocal），续接时 reducer 的
 * run.start(resume=true) 会保留这些块 → 新段块与旧段块在 pseudoStreamingMessage
 * 累积合并成同一张卡（刷新 reload 后才分开）。
 * 修复：resumeRun 在续接起步时把残留 current_blocks 固化为独立 agent 消息并清空，
 * 使续接期间（reload 前）就已各自成卡。
 *
 * 本例在续接 SSE 阻塞期间观察状态（finally 未执行），断言旧段已被剥离成独立消息。
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { useAgentStore } from '../agent';

// 用 controller 把 resume 的 SSE 挂起，使 resumeRun 停在流式阶段（finally 未跑）
let releaseStream: () => void = () => {};
vi.mock('@/api/employee/agent', () => ({
  employeeAgentApi: {
    resumeSession: vi.fn(() => {
      return (async function* () {
        await new Promise<void>(resolve => { releaseStream = resolve; });
        // 释放后产出续接段的首块（新段），再结束
        yield { type: 'run.start', data: { run_id: 'run_new', workflow_type: 'interview_questions', enable_thinking: false, resume: true } };
      })();
    }),
    getSession: vi.fn(async () => ({ data: { data: { session: { id: 1 }, messages: [] } } })),
  },
}));

function seedAbortedCurrentBlocks() {
  useAgentStore.setState({
    activeId: 1,
    runs: {
      1: {
        session: { id: 1, enable_thinking: false, selected_model_name: null } as never,
        messages: [{ id: 5, workflow_type: 'interview_questions', role: 'user', content: { blocks: [] } } as never],
        runState: {
          workflow_type: 'interview_questions', aborted: true, run_id: 'run_old',
          current_blocks: [
            { type: 'tool_use', index: 1, tool_name: 'generate_questions', display_name: '生成【算法】题目', status: 'cancelled' },
            { type: 'tool_use', index: 2, tool_name: 'generate_questions', display_name: '生成【工程】题目', status: 'cancelled' },
          ],
          steps: [], error: null, running: false, enable_thinking: false,
        } as never,
        sending: false, loaded: true,
      },
    },
  });
}

describe('Q1 resumeRun 卡片分隔', () => {
  beforeEach(() => { releaseStream = () => {}; seedAbortedCurrentBlocks(); });

  it('续接起步即把残留 current_blocks 剥离为独立 agent 消息并清空，避免与续接段合并', async () => {
    // 不 await：resumeRun 在续接 SSE 阻塞期间挂起，finally 未执行
    const p = useAgentStore.getState().resumeRun(1) as Promise<void>;
    // 让 resumeRun 同步部分（含断点快照 setState）落地
    await Promise.resolve();
    const entry = useAgentStore.getState().runs[1];

    // 核心断言：续接期间 current_blocks 已清空（新段不再与旧段累积合并）
    expect(entry.runState.current_blocks.length).toBe(0);
    // 旧段已固化为独立 agent 消息（reload 前即各自成卡）
    const snapshotted = entry.messages.filter(m => m.role === 'agent');
    expect(snapshotted.length).toBe(1);
    expect(snapshotted[0].content.blocks.length).toBe(2);

    // 释放挂起的流，让 resumeRun 走完 finally 避免泄漏
    releaseStream();
    await p;
  });
});
