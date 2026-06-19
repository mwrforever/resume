/**
 * InterruptBar：中断提示条
 *
 * 用途：刷新页面或后端错误打断流式 run 后，被截断的 agent 消息底部展示
 * 单行 pill：橙色感叹号 + 「本次任务已中断」+ 重试图标按钮。
 *
 * 触发条件由调用方判定（最后一条 agent 消息含 status='streaming' 的 block）。
 * 重试 = 用最后一条 user 消息内容重新调 sendMessage（由父组件处理）。
 *
 * 视觉沿用项目 sky/orange 体系，不引入新 token。
 */

import { Loader2, RotateCw } from 'lucide-react';

export interface InterruptBarProps {
  /** 重试触发回调：父组件用最后一条 user 消息内容重新发送 */
  onRetry: () => void;
  /** 重试是否进行中（true 时按钮禁用 + 图标转 spinner） */
  retrying?: boolean;
}

export function InterruptBar({ onRetry, retrying = false }: InterruptBarProps) {
  return (
    <div
      role="status"
      aria-label="本次任务已中断"
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
      <span>本次任务已中断</span>
      <button
        type="button"
        onClick={onRetry}
        disabled={retrying}
        title={retrying ? '重试中…' : '重试'}
        aria-label={retrying ? '重试中' : '重试'}
        className="inline-flex w-6 h-6 rounded-full ml-1
                   text-[#EA580C]
                   hover:bg-[#EA580C]/12
                   disabled:opacity-60 disabled:cursor-not-allowed
                   items-center justify-center
                   transition-colors"
      >
        {retrying ? (
          <Loader2 size={14} className="animate-spin" />
        ) : (
          <RotateCw size={14} />
        )}
      </button>
    </div>
  );
}
