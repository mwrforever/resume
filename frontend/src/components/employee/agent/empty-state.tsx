/**
 * EmptyState：空态引导页（Bento 重设计版 · 严格贴合两种工作模式）
 *
 * 按 workflow 分两组：简历问答（interview_questions）/ 简历评估（resume_evaluation）。
 * 点击问答卡 → onPickPrompt(prompt, workflow) 同时回填文案并联动切换 Composer 模式。
 * 严格遵守 design-taste-frontend-v1：无 emoji、单一 Sky 蓝强调、tinted 阴影。
 */

import {
  MessagesSquare, FileQuestion, ListChecks, Gauge,
  ClipboardCheck, Target, ShieldAlert, Sparkles,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import type { WorkflowType } from '@/types/agent';

export interface EmptyStateProps {
  onPickPrompt: (prompt: string, workflow?: WorkflowType) => void;
}

type PromptCard = {
  icon: LucideIcon;
  title: string;
  hint: string;
  prompt: string;
  /** 该问答所属的工作模式（点击时联动切换 Composer） */
  workflow: WorkflowType;
};

/** 简历问答模式常用问答（interview_questions：出题 / 深挖 / 调整） */
const QNA_PROMPTS: PromptCard[] = [
  {
    icon: FileQuestion,
    title: '生成面试题库',
    hint: '基于简历与岗位 JD，按维度结构化出题',
    workflow: 'interview_questions',
    prompt: '请基于附件简历，针对【后端工程师】岗位生成面试题，覆盖 编程基础、系统设计、项目经验、软技能 等维度，每维度给出对应难度与考察要点。',
  },
  {
    icon: ListChecks,
    title: '按维度深挖追问',
    hint: '针对某一维度补充更细的追问题',
    workflow: 'interview_questions',
    prompt: '请基于附件简历，针对【系统设计】维度再深挖 5 道由浅入深的追问题，并标注每道题期望候选人回答的关键点。',
  },
  {
    icon: Gauge,
    title: '调整题量与难度',
    hint: '按面试时长重新规划题量、难度分布',
    workflow: 'interview_questions',
    prompt: '请把当前面试题库调整为 45 分钟可完成的题量，难度分布按 简单 40% / 中等 40% / 困难 20% 重新配比，并说明取舍理由。',
  },
];

/** 简历评估模式常用问答（resume_evaluation：评分 / 匹配 / 风险） */
const EVAL_PROMPTS: PromptCard[] = [
  {
    icon: ClipboardCheck,
    title: '多维度评分',
    hint: '专业 / 经验 / 稳定性综合打分（0-100）',
    workflow: 'resume_evaluation',
    prompt: '请对附件简历进行多维度评估，给出 综合评分（0-100）、各维度得分、优势亮点、风险点、面试建议。',
  },
  {
    icon: Target,
    title: '岗位匹配度分析',
    hint: '对照目标岗位 JD 给出匹配度与差距',
    workflow: 'resume_evaluation',
    prompt: '请将附件简历与以下岗位 JD 做匹配度分析，输出：岗位匹配度（0-100）、匹配项、缺失项、补齐建议。\n\n[在此粘贴岗位 JD]',
  },
  {
    icon: ShieldAlert,
    title: '风险点与稳定性',
    hint: '识别跳槽频繁、经历断点等潜在风险',
    workflow: 'resume_evaluation',
    prompt: '请重点评估附件简历候选人的稳定性与潜在风险：跳槽频率、职业连贯性、经历断点、薪资/职级合理性，并给出风险等级与面试核实建议。',
  },
];

export function EmptyState({ onPickPrompt }: EmptyStateProps) {
  return (
    <div className="flex-1 overflow-y-auto bg-[#F8FAFC]">
      <div className="mx-auto max-w-[960px] px-6 pt-[10vh] pb-16">
        {/* 头部：徽标 + 标题（左对齐） */}
        <div className="flex flex-col items-start mb-10">
          <div className="relative w-16 h-16 flex items-center justify-center rounded-2xl
                          bg-gradient-to-br from-[#0EA5E9] to-[#0369A1]
                          shadow-[0_8px_24px_-8px_rgba(3,105,161,0.5)]
                          ring-1 ring-inset ring-white/25
                          mb-5
                          animate-[pulseSoft_3.5s_ease-in-out_infinite]">
            <Sparkles size={30} className="text-white fill-white/20" strokeWidth={2} />
            {/* 右上角在线指示点 */}
            <span className="absolute -top-1 -right-1 w-3 h-3 rounded-full bg-[#22C55E]
                             ring-2 ring-[#F8FAFC] animate-[dotBlink_2s_ease-in-out_infinite]" />
          </div>

          <h1 className="text-[28px] leading-tight font-bold text-[#020617] tracking-tight mb-2">
            我是你的招聘助手
          </h1>
          <p className="text-sm text-[#64748B] max-w-[520px] leading-relaxed">
            选择一种工作模式开始：左侧「简历问答」帮你结构化出题，右侧「简历评估」帮你给候选人打分。也可直接在下方输入需求。
          </p>
        </div>

        {/* 两种模式分栏：左问答 / 右评估 */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <ModeSection
            tag="简历问答"
            tagIcon={MessagesSquare}
            tagHint="结构化出题 · 追问深挖 · 题量调整"
            cards={QNA_PROMPTS}
            onPick={onPickPrompt}
          />
          <ModeSection
            tag="简历评估"
            tagIcon={ClipboardCheck}
            tagHint="多维度评分 · 岗位匹配 · 风险识别"
            cards={EVAL_PROMPTS}
            onPick={onPickPrompt}
          />
        </div>
      </div>
    </div>
  );
}

/** 单个模式区块：标签头 + 该模式下的问答卡列表 */
function ModeSection({
  tag, tagIcon: TagIcon, tagHint, cards, onPick,
}: {
  tag: string;
  tagIcon: LucideIcon;
  tagHint: string;
  cards: PromptCard[];
  onPick: (prompt: string, workflow?: WorkflowType) => void;
}) {
  return (
    <section>
      {/* 模式标签头 */}
      <div className="flex items-center gap-2.5 mb-3 px-1">
        <span className="flex items-center justify-center w-7 h-7 rounded-lg
                         bg-[#F0F9FF] text-[#0369A1] ring-1 ring-inset ring-[#0EA5E9]/15">
          <TagIcon size={15} strokeWidth={2.2} />
        </span>
        <div className="flex flex-col">
          <span className="text-sm font-bold text-[#020617] leading-tight">{tag}</span>
          <span className="text-[11px] text-[#94A3B8] leading-tight">{tagHint}</span>
        </div>
      </div>

      {/* 问答卡列表（竖排） */}
      <div className="grid grid-cols-1 gap-3">
        {cards.map((card, i) => (
          <PromptCardButton key={card.title} card={card} index={i} onPick={onPick} />
        ))}
      </div>
    </section>
  );
}

/** 单个问答卡：左图标 + 右标题/描述，hover 上浮 + spotlight 描边 */
function PromptCardButton({
  card, index, onPick,
}: { card: PromptCard; index: number; onPick: (p: string, w?: WorkflowType) => void }) {
  const Icon = card.icon;
  return (
    <button
      type="button"
      onClick={() => onPick(card.prompt, card.workflow)}
      style={{ animationDelay: `${index * 80}ms` }}
      className="group relative flex items-center gap-3.5 text-left p-4 rounded-xl
                 bg-white border border-[#E2E8F0]/80
                 shadow-[0_1px_2px_rgba(2,6,23,0.03)]
                 hover:border-[#0EA5E9]/60
                 hover:shadow-[0_1px_3px_rgba(2,6,23,0.05),0_10px_28px_-14px_rgba(3,105,161,0.20)]
                 hover:-translate-y-0.5
                 active:scale-[0.99]
                 transition-all duration-300 ease-[cubic-bezier(0.16,1,0.3,1)]
                 animate-[cardEnter_0.4s_cubic-bezier(0.16,1,0.3,1)_both]"
    >
      <span className="flex-shrink-0 w-10 h-10 flex items-center justify-center rounded-lg
                       bg-[#F0F9FF] text-[#0369A1]
                       group-hover:bg-[#0369A1] group-hover:text-white
                       transition-colors duration-300">
        <Icon size={18} strokeWidth={2} />
      </span>
      <div className="flex-1 min-w-0">
        <h3 className="text-sm font-semibold text-[#020617] mb-0.5">{card.title}</h3>
        <p className="text-xs text-[#64748B] leading-relaxed line-clamp-1">{card.hint}</p>
      </div>
      <span className="flex-shrink-0 text-[#CBD5E1] group-hover:text-[#0EA5E9] group-hover:translate-x-0.5 transition-all duration-300">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2">
          <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
        </svg>
      </span>
    </button>
  );
}
