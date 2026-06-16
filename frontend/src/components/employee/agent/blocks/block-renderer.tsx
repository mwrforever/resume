/**
 * BlockRenderer：按 block.type 分发到对应渲染器。
 *
 * 流式与历史共用同一组件树；区别仅在 status 字段。
 * 思考内容（reasoning）由上层 attachReasoning 吸附到业务块，不再渲染独立 thinking 卡片。
 */

import { TextBlock } from './text-block';
import { ToolUseBlock } from './tool-use-block';
import { InteractionBlock } from './interaction-block';
import { InterviewQuestionsCard } from './interview-questions-card';
import { EvaluationReportCard } from './evaluation-report-card';
import type { BlockWithReasoning } from './group-blocks';

export interface BlockRendererProps {
  block: BlockWithReasoning;
  /** interaction 提交进行中：禁用提交按钮防重复点击 */
  submitting?: boolean;
  onSubmitInteraction?: (requestId: string, values: Record<string, unknown>) => void;
}

export function BlockRenderer({ block, submitting, onSubmitInteraction }: BlockRendererProps) {
  switch (block.type) {
    case 'text':
      return <TextBlock block={block} reasoning={block.reasoning} />;
    case 'thinking':
      // thinking 块已由 attachReasoning 吸附到业务块，此处不应再出现；防御性返回 null
      return null;
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
      return <InterviewQuestionsCard block={block} reasoning={block.reasoning} />;
    case 'evaluation_report':
      return <EvaluationReportCard block={block} reasoning={block.reasoning} />;
    default:
      return null;
  }
}
