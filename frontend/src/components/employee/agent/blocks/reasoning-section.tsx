/**
 * ReasoningSection：嵌入业务块内的思考过程折叠区（默认收起）。
 *
 * 替代原独立 ThinkingBlock。reasoning 为空时折叠头提示"模型未返回推理过程"。
 */

import { useState } from 'react';
import { ChevronRight, Sparkles } from 'lucide-react';

interface ReasoningSectionProps {
  /** 模型返回的推理内容（reasoning_content） */
  reasoning: string;
}

export function ReasoningSection({ reasoning }: ReasoningSectionProps) {
  const [expanded, setExpanded] = useState(false);
  const empty = !reasoning.trim();
  return (
    <div className="mt-2 rounded-md border border-[#E2E8F0] bg-[#F8FAFC]">
      <button
        type="button"
        onClick={() => setExpanded(v => !v)}
        className="w-full flex items-center gap-1.5 px-3 py-1.5 text-xs text-[#7C3AED]
                   hover:bg-[#F1F5F9] rounded-md transition-colors"
      >
        <ChevronRight size={12} className={`transition-transform ${expanded ? 'rotate-90' : ''}`} />
        <Sparkles size={12} />
        <span>{empty ? '模型未返回推理过程' : '思考过程'}</span>
      </button>
      {expanded && !empty && (
        <pre className="px-3 pb-2 text-xs text-[#475569] whitespace-pre-wrap break-words font-sans">
          {reasoning}
        </pre>
      )}
    </div>
  );
}
