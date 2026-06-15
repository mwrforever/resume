/**
 * BlockRenderer：按 block.type 分发到对应渲染器。
 *
 * 流式与历史共用同一组件树；区别仅在 status 字段。
 */

import type { AgentBlock } from '@/types/agent';
import { TextBlock } from './text-block';
import { ThinkingBlock } from './thinking-block';
import { ToolUseBlock } from './tool-use-block';
import { InteractionBlock } from './interaction-block';
import { InterviewQuestionsCard } from './interview-questions-card';
import { EvaluationReportCard } from './evaluation-report-card';

export interface BlockRendererProps {
  block: AgentBlock;
  /** interaction 提交进行中：禁用提交按钮防重复点击 */
  submitting?: boolean;
  onSubmitInteraction?: (requestId: string, values: Record<string, unknown>) => void;
}

export function BlockRenderer({ block, submitting, onSubmitInteraction }: BlockRendererProps) {
  switch (block.type) {
    case 'text':
      return <TextBlock block={block} />;
    case 'thinking':
      return <ThinkingBlock block={block} />;
    case 'tool_use':
      return <ToolUseBlock block={block} />;
    case 'interaction':
      return (
        <InteractionBlock
          block={block}
          submitting={submitting}
          onSubmit={onSubmitInteraction}
        />
      );
    case 'interview_questions':
      return <InterviewQuestionsCard block={block} />;
    case 'evaluation_report':
      return <EvaluationReportCard block={block} />;
    default:
      return null;
  }
}
