import { describe, it, expect, expectTypeOf } from 'vitest';
import type { InteractionType, WorkspaceSession } from '../agent';

// 模块级编译期断言：'resume_upload' 不在联合里即 TS2322，整个文件无法编译
const __assertInteractionTypeMember: InteractionType = 'resume_upload';

describe('agent types', () => {
  it('InteractionType 含 resume_upload', () => {
    // 运行期占位，保持 vitest 至少 1 个断言
    expectTypeOf<InteractionType>().toMatchTypeOf<'resume_upload' | 'dimension_selection' | 'plan_approval' | 'job_selection'>();
    // 引用模块级断言，防止 lint 当成 dead code
    expect(__assertInteractionTypeMember).toBe('resume_upload');
  });
  it('WorkspaceSession 有可选 progress', () => {
    const s = {} as WorkspaceSession;
    s.progress = { workflow_type: 'interview_questions', steps: [] };
    expectTypeOf(s.progress).toMatchTypeOf<{ workflow_type: string; steps: unknown[] } | undefined>();
  });
});
