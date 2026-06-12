/**
 * EmptyState：空态引导页
 *
 * 顶部 AI 图标 + 问候语 + workflow 快捷卡片。
 * 点击卡片切换 composer workflow + focus。
 */

import { Bot, FileQuestion, FileSpreadsheet } from 'lucide-react';
import type { WorkflowType } from '@/types/agent';

export interface EmptyStateProps {
  onStartWorkflow?: (workflow: WorkflowType) => void;
}

const QUICK_CARDS: Array<{
  workflow: WorkflowType;
  icon: typeof Bot;
  title: string;
  desc: string;
}> = [
  {
    workflow: 'interview_questions',
    icon: FileQuestion,
    title: '面试问题',
    desc: '基于 JD / 简历生成题库',
  },
  {
    workflow: 'resume_evaluation',
    icon: FileSpreadsheet,
    title: '简历评估',
    desc: '多维度打分，给出建议',
  },
];

export function EmptyState({ onStartWorkflow }: EmptyStateProps) {
  return (
    <div className="flex-1 flex flex-col items-center justify-center text-center px-6"
         style={{ marginTop: '20vh' }}>
      {/* 机器人图标 */}
      <div className="w-20 h-20 flex items-center justify-center rounded-full
                      bg-gradient-to-br from-[#0369A1] to-[#0EA5E9]
                      shadow-lg shadow-sky-200 mb-6">
        <Bot size={36} className="text-white" />
      </div>

      {/* 问候语 */}
      <h1 className="text-xl font-semibold text-[#020617] mb-2">
        你好，我能帮你做什么？
      </h1>
      <p className="text-sm text-[#64748B] mb-8">
        选择一个 Workflow 开始，或直接输入需求
      </p>

      {/* Workflow 快捷卡 */}
      <div className="flex gap-4">
        {QUICK_CARDS.map(card => {
          const Icon = card.icon;
          return (
            <button
              key={card.workflow}
              type="button"
              onClick={() => onStartWorkflow?.(card.workflow)}
              className="w-[220px] h-[120px] flex flex-col items-start justify-center gap-2
                         px-5 rounded-xl border border-[#E2E8F0] bg-white
                         hover:border-[#0EA5E9] hover:shadow-md
                         transition-all duration-220 text-left"
            >
              <div className="flex items-center gap-2">
                <Icon size={20} className="text-[#0369A1]" />
                <span className="text-sm font-semibold text-[#020617]">{card.title}</span>
              </div>
              <span className="text-xs text-[#64748B] leading-relaxed">{card.desc}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}