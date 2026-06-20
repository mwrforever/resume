/**
 * ProgressTooltip：收起态步骤悬浮提示。
 *
 * 设计要点：
 * - Portal 到 body，使用 position:fixed，规避 aside 的 overflow:hidden（否则 tooltip
 *   会被进度栏裁掉）。
 * - 由 document 级 mouseover 监听驱动：读取鼠标最近 [data-step-title] 祖先上的
 *   data-step-title / data-step-status 属性，渲染对应 tooltip。
 * - 鼠标离开任何 step 元素 → 立即隐藏 tooltip（setTip(null)）。
 *
 * 与 ProgressTracker 协议：收起态的 CollapsedStepIcon 会渲染带 data-step-title 等
 * 属性的容器，本组件无需显式 props 即可联动。
 */
import { useEffect, useState } from 'react';

interface Tip {
  /** tooltip 定位 x（fixed 坐标） */
  x: number;
  /** tooltip 定位 y（fixed 坐标） */
  y: number;
  /** 步骤标题 */
  title: string;
  /** 步骤状态 */
  status: string;
}

/** 状态 → 中文文案映射 */
const STATUS_LABEL: Record<string, string> = {
  success: '已完成',
  running: '运行中',
  pending: '待执行',
  failed: '失败',
};

/** 收起态步骤 tooltip 单例（挂载在 ProgressTracker 根外） */
export function ProgressTooltipPortal() {
  const [tip, setTip] = useState<Tip | null>(null);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      const target = (e.target as HTMLElement)?.closest('[data-step-title]') as HTMLElement | null;
      if (!target) {
        setTip(null);
        return;
      }
      const r = target.getBoundingClientRect();
      setTip({
        x: r.left - 12,
        y: r.top + r.height / 2,
        title: target.dataset.stepTitle || '',
        status: target.dataset.stepStatus || '',
      });
    };
    document.addEventListener('mouseover', handler);
    return () => document.removeEventListener('mouseover', handler);
  }, []);

  if (!tip) return null;

  return (
    <div
      style={{
        position: 'fixed',
        left: tip.x,
        top: tip.y,
        transform: 'translate(-100%,-50%)',
      }}
      className="z-[200] flex items-center gap-1.5 bg-[#0F172A] text-white px-3 py-1.5 rounded-lg text-xs font-semibold
                 shadow-[0_8px_20px_-6px_rgba(15,23,42,0.45)] pointer-events-none whitespace-nowrap"
    >
      <span
        className={`w-1.5 h-1.5 rounded-full ${
          tip.status === 'success'
            ? 'bg-[#16A34A]'
            : tip.status === 'running'
              ? 'bg-[#0EA5E9]'
              : tip.status === 'failed'
                ? 'bg-[#DC2626]'
                : 'bg-[#94A3B8]'
        }`}
      />
      <span>{tip.title}</span>
      <span className="text-white/50 text-[10px]">{STATUS_LABEL[tip.status]}</span>
    </div>
  );
}
