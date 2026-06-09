import { CheckCircle2, Clock3, XCircle } from 'lucide-react';
import type { IAgentRuntimeFeedItem } from '@/types/agent';

interface AgentRunCompactTimelineProps {
  items: IAgentRuntimeFeedItem[];
}

/**
 * 运行状态中文描述映射
 *
 * @param status 运行状态枚举值
 * @return 对应的中文状态文本
 */
function statusText(status: IAgentRuntimeFeedItem['status']) {
  if (status === 'success') return '已完成';
  if (status === 'failed') return '失败';
  if (status === 'pending') return '等待确认';
  return '执行中';
}

/**
 * 波浪动画指示器：三个小圆点依次上下波动，用于表示运行中状态
 */
function WaveIndicator() {
  return (
    <span className="flex items-center gap-0.5" aria-label="运行中">
      <span className="inline-block h-1.5 w-1.5 rounded-full bg-sky-500" style={{ animation: 'wave 1.2s ease-in-out infinite' }} />
      <span className="inline-block h-1.5 w-1.5 rounded-full bg-sky-500" style={{ animation: 'wave 1.2s ease-in-out 0.15s infinite' }} />
      <span className="inline-block h-1.5 w-1.5 rounded-full bg-sky-500" style={{ animation: 'wave 1.2s ease-in-out 0.3s infinite' }} />
    </span>
  );
}

/**
 * 根据运行状态渲染对应的状态图标
 *
 * @param status 当前步骤的运行状态
 * @return 对应的状态图标组件
 */
function StatusIcon({ status }: { status: IAgentRuntimeFeedItem['status'] }) {
  if (status === 'success') return <CheckCircle2 size={14} className="text-emerald-600" aria-hidden="true" />;
  if (status === 'failed') return <XCircle size={14} className="text-red-600" aria-hidden="true" />;
  if (status === 'pending') return <Clock3 size={14} className="text-amber-600" aria-hidden="true" />;
  return <WaveIndicator />;
}

/**
 * 运行过程精简时间线组件
 *
 * 所有步骤直接展示，无折叠功能。每个步骤仅显示标题和状态图标，
 * 卡片高度精简（py-1.5），运行中状态使用波浪动画替代旋转加载。
 *
 * @param items 按时间顺序排列的运行事件列表
 * @return 时间线区域，无事件时返回 null
 */
export function AgentRunCompactTimeline({ items }: AgentRunCompactTimelineProps) {
  /* 过滤掉 action 类型的事件，仅展示节点执行过程 */
  const visibleItems = items.filter((item) => item.type !== 'action');
  if (visibleItems.length === 0) return null;

  return (
    <>
      {/* 波浪动画 keyframes 定义，全局生效一次即可 */}
      <style>{`
        @keyframes wave {
          0%, 60%, 100% { transform: translateY(0); }
          30% { transform: translateY(-4px); }
        }
      `}</style>
      <section className="max-w-3xl space-y-1 md:ml-12">
        {visibleItems.map((item) => (
          <div
            key={item.id}
            className="flex items-center gap-2.5 rounded-2xl border border-slate-100 bg-white px-3 py-1.5 text-sm shadow-sm shadow-slate-100/50"
          >
            {/* 状态图标：成功/失败/等待/波浪动画 */}
            <span className="flex h-5 w-5 shrink-0 items-center justify-center">
              <StatusIcon status={item.status} />
            </span>
            {/* 步骤标题与状态文本 */}
            <span className="min-w-0 flex-1 truncate font-medium text-slate-800">{item.title}</span>
            <span className={`shrink-0 text-xs ${item.status === 'failed' ? 'font-medium text-red-600' : 'text-slate-400'}`}>
              {statusText(item.status)}
            </span>
          </div>
        ))}
      </section>
    </>
  );
}
