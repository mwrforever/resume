/**
 * InterruptBar：中断/错误提示条
 *
 * 两种形态：
 * - 中断态（isError 缺省或 false，且提供 onResume）：
 *     页面刷新 / 客户端断开打断流式 run 后，被截断的 agent 消息底部展示
 *     单行 pill：橙色感叹号 + 「本次任务已中断」+「恢复」按钮（调 onResume 续接 checkpoint）。
 * - 错误态（isError=true）：
 *     后端返回 run.finish error 后展示，文案改为「运行出错了」，按钮「重试」调 onRetry 重发。
 *
 * 触发条件由调用方判定（最后一条 agent 消息含 status='streaming' 的 block）。
 *
 * 视觉沿用项目 sky/orange 体系，不引入新 token。
 */

export interface InterruptBarProps {
  /** 重试触发回调（错误态用：放弃当前 task 重发） */
  onRetry: () => void;
  /** 恢复触发回调（中断态用：续接 LangGraph checkpoint，非重发）。提供时显示"恢复"按钮 */
  onResume?: () => void;
  /** 是否错误态（true=重试语义；false/缺省=中断态恢复语义） */
  isError?: boolean;
  /** 重试是否进行中（错误态按钮禁用） */
  retrying?: boolean;
  /** 恢复是否进行中（中断态按钮禁用） */
  resuming?: boolean;
}

export function InterruptBar({
  onRetry,
  onResume,
  isError = false,
  retrying = false,
  resuming = false,
}: InterruptBarProps) {
  // 是否走"恢复"分支：非错误态且提供了 onResume 回调
  const isResumeMode = !isError && !!onResume;
  const label = isResumeMode ? '本次任务已中断' : '运行出错了';
  const handleClick = isResumeMode ? onResume : onRetry;
  const busy = isResumeMode ? resuming : retrying;
  const title = isResumeMode ? (resuming ? '恢复中…' : '恢复运行') : (retrying ? '重试中…' : '重试');
  const buttonText = isResumeMode ? (resuming ? '恢复中…' : '恢复') : (retrying ? '重试中…' : '重试');

  return (
    <div
      role="status"
      aria-label={label}
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
      <span>{label}</span>
      <button
        type="button"
        onClick={handleClick}
        disabled={busy}
        title={title}
        aria-label={title}
        className="inline-flex items-center gap-1 h-6 px-2 rounded-full ml-1 text-[12px]
                   text-[#EA580C]
                   hover:bg-[#EA580C]/10
                   disabled:opacity-60 disabled:cursor-not-allowed
                   transition-colors"
      >
        {buttonText}
      </button>
    </div>
  );
}
