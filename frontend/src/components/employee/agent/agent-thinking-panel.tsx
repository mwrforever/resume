import { useState } from 'react';
import { Brain, ChevronDown, ChevronRight } from 'lucide-react';
import type { IAgentThinkingStreamItem } from '@/types/agent';

interface AgentThinkingPanelProps {
  item: IAgentThinkingStreamItem;
}

/**
 * 思考状态中文描述映射
 *
 * @param status 思考过程状态枚举值
 * @return 对应的中文状态文本
 */
function thinkingStatusText(status: IAgentThinkingStreamItem['status']) {
  if (status === 'completed') return '已完成';
  if (status === 'unavailable') return '不可用';
  if (status === 'started') return '已开始';
  return '生成中';
}

/**
 * 波浪动画指示器：三个小圆点依次上下波动，用于表示思考生成中状态
 */
function WaveIndicator() {
  return (
    <span className="inline-flex items-center gap-0.5" aria-label="思考中">
      <span className="inline-block h-1.5 w-1.5 rounded-full bg-sky-400" style={{ animation: 'wave 1.2s ease-in-out infinite' }} />
      <span className="inline-block h-1.5 w-1.5 rounded-full bg-sky-400" style={{ animation: 'wave 1.2s ease-in-out 0.15s infinite' }} />
      <span className="inline-block h-1.5 w-1.5 rounded-full bg-sky-400" style={{ animation: 'wave 1.2s ease-in-out 0.3s infinite' }} />
    </span>
  );
}

/**
 * 思考过程面板组件
 *
 * 默认收起，点击展开可查看 Agent 的思考内容。采用左侧竖线装饰、
 * 等宽字体展示内容，运行中使用波浪动画替代旋转加载。
 *
 * @param item 思考流事件数据，包含状态与思考文本内容
 * @return 思考面板区域
 */
export function AgentThinkingPanel({ item }: AgentThinkingPanelProps) {
  const [expanded, setExpanded] = useState(false);
  const statusText = thinkingStatusText(item.status);

  return (
    <>
      {/* 波浪动画 keyframes，全局生效一次即可 */}
      <style>{`
        @keyframes wave {
          0%, 60%, 100% { transform: translateY(0); }
          30% { transform: translateY(-4px); }
        }
      `}</style>
      <section className="max-w-3xl rounded-3xl border border-sky-100 bg-sky-50/70 text-sm text-slate-700 md:ml-12">
        {/* 可折叠头部区域 */}
        <button
          type="button"
          className="flex w-full items-center justify-between gap-3 rounded-3xl px-4 py-3 text-left font-semibold text-slate-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-500 focus-visible:ring-offset-2"
          aria-expanded={expanded}
          aria-label={expanded ? '收起思考过程' : '展开思考过程'}
          onClick={() => setExpanded((prev) => !prev)}
        >
          <span className="inline-flex items-center gap-2">
            {/* 运行中状态使用波浪动画，其他状态使用静态图标 */}
            {item.status === 'streaming' || item.status === 'started' ? (
              <WaveIndicator />
            ) : (
              <Brain size={15} className="text-sky-600" aria-hidden="true" />
            )}
            <span aria-live="polite">思考过程 · {statusText}</span>
          </span>
          {expanded ? <ChevronDown size={16} aria-hidden="true" /> : <ChevronRight size={16} aria-hidden="true" />}
        </button>

        {/* 思考内容区域：左侧竖线装饰 + 等宽字体 */}
        {expanded && (
          <div className="border-l-2 border-sky-300 px-4 pb-3">
            <pre className="max-h-48 overflow-y-auto whitespace-pre-wrap rounded-2xl bg-white/80 p-3 font-mono text-xs leading-5 text-slate-700 shadow-inner shadow-sky-100">
              {item.content || '暂无思考内容'}
            </pre>
          </div>
        )}
      </section>
    </>
  );
}
