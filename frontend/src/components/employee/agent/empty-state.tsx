/**
 * EmptyState：空态引导页
 *
 * 标题 + 副标题 + 4 个常用任务快捷卡片。
 * 点击卡片 → 触发 onPickPrompt(prompt) 把文本回填到 Composer textarea。
 */

import { Bot, FileQuestion, FileSpreadsheet, Sparkles, Search } from 'lucide-react';

export interface EmptyStateProps {
  onPickPrompt: (prompt: string) => void;
}

const PROMPT_CARDS: Array<{
  icon: typeof Bot;
  title: string;
  hint: string;
  prompt: string;
}> = [
  {
    icon: FileQuestion,
    title: '生成面试题库',
    hint: '基于岗位 JD 和候选人简历生成结构化面试题',
    prompt: '请基于附件简历，针对【后端工程师】岗位生成 8 道面试题，覆盖 编程基础、系统设计、项目经验、软技能 四个维度。',
  },
  {
    icon: FileSpreadsheet,
    title: '简历多维评估',
    hint: '从专业、经验、稳定性多维度给候选人打分',
    prompt: '请对附件简历进行多维度评估，给出 综合评分（0-100）、优势亮点、风险点、面试建议 四部分内容。',
  },
  {
    icon: Sparkles,
    title: '岗位 JD 优化',
    hint: '帮你润色岗位描述，让吸引力翻倍',
    prompt: '请帮我优化以下岗位 JD，让它对候选人更有吸引力，并指出可能劝退候选人的不友好措辞：\n\n[在此粘贴 JD]',
  },
  {
    icon: Search,
    title: '候选人对比',
    hint: '同岗位多位候选人横向对比',
    prompt: '请帮我对比以下 N 位候选人，给出推荐排序、各自优劣势、面试时重点关注的问题。',
  },
];

export function EmptyState({ onPickPrompt }: EmptyStateProps) {
  return (
    <div className="flex-1 flex flex-col items-center text-center px-6 pt-[18vh]">
      <div className="w-20 h-20 flex items-center justify-center rounded-full
                      bg-gradient-to-br from-[#0369A1] to-[#0EA5E9]
                      shadow-lg shadow-sky-200 mb-6">
        <Bot size={36} className="text-white" />
      </div>

      <h1 className="text-2xl font-semibold text-[#020617] mb-2">
        Hi，我是你的招聘助手 ✨
      </h1>
      <p className="text-sm text-[#64748B] mb-10 max-w-[480px] leading-relaxed">
        把繁琐的简历筛选、面试出题交给我。挑一个常用任务开始 →
      </p>

      <div className="grid grid-cols-2 gap-3 w-full max-w-[640px]">
        {PROMPT_CARDS.map(card => {
          const Icon = card.icon;
          return (
            <button
              key={card.title}
              type="button"
              onClick={() => onPickPrompt(card.prompt)}
              className="group flex flex-col items-start gap-2 p-4 rounded-xl
                         border border-[#E2E8F0] bg-white text-left
                         hover:border-[#0EA5E9] hover:shadow-md hover:-translate-y-0.5
                         transition-all duration-220"
            >
              <div className="flex items-center gap-2">
                <span className="w-8 h-8 flex items-center justify-center rounded-lg bg-[#E0F2FE] text-[#0369A1]
                                 group-hover:bg-[#0369A1] group-hover:text-white transition-colors duration-220">
                  <Icon size={16} />
                </span>
                <span className="text-sm font-semibold text-[#020617]">{card.title}</span>
              </div>
              <span className="text-xs text-[#64748B] leading-relaxed line-clamp-2">{card.hint}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
