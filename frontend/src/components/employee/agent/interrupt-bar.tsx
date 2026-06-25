/**
 * InterruptBar：中断态提示条。
 *
 * 用户主动点击「暂停」、或刷新/断网打断流式 run 后展示。
 * 单行 pill：橙色感叹号 + 「任务已中断」+ RefreshCw 图标 + 「重试」按钮。
 *
 * 触发条件由调用方（AgentMessageList）判定：
 *   !error && (runState.aborted || (!running && !sending && last.content.interrupted))
 *
 * 按钮行为 = onResume（续接 LangGraph checkpoint，A2 决策不变）。
 * 点击后 store 立即清 aborted，本条瞬间消失，天然防重入，无需 disabled 态。
 *
 * 视觉沿用项目 sky/orange 体系，不引入新 token。
 */
import { RefreshCw } from 'lucide-react';

export interface InterruptBarProps {
  /** 续接 checkpoint 回调（调 store.resumeRun） */
  onResume: () => void;
}

export function InterruptBar({ onResume }: InterruptBarProps) {
  return (
    <div
      role="status"
      aria-label="任务已中断"
      className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full
                 bg-[#FFF7ED] border border-[#FB923C]/40
                 text-[12.5px] text-[#9A3412] font-medium mt-3"
    >
      {/* 橙色感叹号 chip */}
      <span
        aria-hidden="true"
        className="inline-flex w-4 h-4 rounded-full bg-[#FED7AA]
                   text-[#EA580C] text-[11px] font-bold
                   items-center justify-center"
      >
        !
      </span>
      <span>任务已中断</span>
      <button
        type="button"
        onClick={onResume}
        title="重试"
        aria-label="重试"
        className="inline-flex items-center gap-1 h-6 px-2 rounded-full ml-1 text-[12px]
                   text-[#EA580C]
                   hover:bg-[#EA580C]/10
                   transition-colors"
      >
        <RefreshCw size={12} />
        <span>重试</span>
      </button>
    </div>
  );
}
