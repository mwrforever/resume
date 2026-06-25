/**
 * ReasoningSection：嵌入业务块内的思考过程折叠区。
 *
 * 设计要点：
 * - 默认折叠，点击标题展开；思考内容始终保留（运行结束/历史消息均可查看）。
 * - 与正文区分：紫色调（思考）vs 黑色（正文），左侧 2px 紫色 accent 条。
 * - "动画滚动"效果：展开时内容按段落逐段 reasoningReveal 渐入（delay 递增），
 *   营造内容从下方涌现的视觉，**不使用真实滚动条**（高度自适应撑开）。
 * - 流式运行中（streaming=true）：标题显示脉冲"思考中…"，自动展开滚动跟进。
 * - reasoning 为空时折叠头提示"模型未返回推理过程"，不可展开。
 */

import { useEffect, useRef, useState } from 'react';
import { ChevronRight, Sparkles } from 'lucide-react';

interface ReasoningSectionProps {
  /** 模型返回的推理内容（reasoning_content） */
  reasoning: string;
  /** 是否处于流式运行中（运行时自动展开 + 滚动跟进，结束后保持展开状态） */
  streaming?: boolean;
}

export function ReasoningSection({ reasoning, streaming }: ReasoningSectionProps) {
  // 默认始终收起（含运行中）；仅用户手动点击才展开。
  const [expanded, setExpanded] = useState(false);
  const bodyRef = useRef<HTMLDivElement>(null);
  const empty = !reasoning.trim();

  // 展开后运行中滚动跟进到底部（用户未展开则不跟进，尊重默认收起）
  useEffect(() => {
    if (streaming && expanded && bodyRef.current) {
      bodyRef.current.scrollTop = bodyRef.current.scrollHeight;
    }
  }, [reasoning, streaming, expanded]);

  const toggle = () => setExpanded(v => !v);

  // 按段落拆分，逐段渐入动画（营造滚动涌现感，非真实滚动条）
  const paragraphs = empty ? [] : reasoning.split(/\n+/).filter(p => p.trim());

  return (
    <div className="mt-1.5 rounded-xl overflow-hidden border border-[#EDE9FE]/80
                    bg-gradient-to-b from-[#FAF5FF] to-[#F8FAFC]
                    shadow-[0_1px_3px_rgba(124,58,237,0.06)]">
      {/* 折叠头 */}
      <button
        type="button"
        onClick={toggle}
        disabled={empty}
        className="w-full flex items-center gap-1.5 px-3 py-1.5 text-xs text-[#7C3AED]
                   hover:bg-[#F3E8FF]/60 transition-colors disabled:cursor-default"
      >
        <ChevronRight size={12} className={`transition-transform duration-200 ${expanded ? 'rotate-90' : ''}`} />
        <Sparkles size={12} className={streaming ? 'animate-pulse' : ''} />
        <span className="font-medium">
          {empty ? '模型未返回推理过程'
            : streaming ? '思考中…'
            : '思考过程'}
        </span>
        {!empty && (
          <span className="text-[#A78BFA] text-[11px] ml-auto">
            {expanded ? '收起' : `${paragraphs.length} 段`}
          </span>
        )}
      </button>

      {/* 展开内容：逐段渐入，无滚动条（高度自适应） */}
      {expanded && !empty && (
        <div
          ref={bodyRef}
          className="relative px-3 pb-2.5 pt-0.5 max-h-[320px] overflow-y-auto
                     [scrollbar-width:none] [-ms-overflow-style:none]
                     [&::-webkit-scrollbar]:hidden"
        >
          {/* 左侧紫色 accent 条（与正文区分） */}
          <div className="absolute left-0 top-0 bottom-0 w-[2px] bg-[#C4B5FD]" />
          <div className="pl-2.5 space-y-1.5">
            {paragraphs.map((p, i) => (
              <p
                key={i}
                className="text-xs leading-relaxed text-[#5B21B6] whitespace-pre-wrap break-words"
                style={{
                  animation: 'reasoningReveal 0.4s ease both',
                  animationDelay: `${Math.min(i * 60, 600)}ms`,
                }}
              >
                {p}
              </p>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
