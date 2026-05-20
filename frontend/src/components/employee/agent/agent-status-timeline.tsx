// frontend/src/components/employee/agent/agent-status-timeline.tsx
import { CheckCircle2, Loader2, Circle } from 'lucide-react';

interface AgentStatusTimelineProps {
  activeNodes: Array<{ id: string; status: 'running' | 'success' | 'failed' | 'pending'; title: string }>;
}

const NODE_ORDER = ['analyst', 'planner', 'supervisor', 'legacy_executor', 'reporter'];
const NODE_LABELS: Record<string, string> = {
  analyst: '理解分析',
  planner: '规划生成',
  supervisor: '任务调度',
  legacy_executor: '执行任务',
  reporter: '结果汇报',
};

/** 状态对应的颜色样式 */
const STATUS_STYLES = {
  success: {
    container: 'border-emerald-500 bg-emerald-50',
    connector: 'bg-emerald-400',
  },
  running: {
    container: 'border-sky-500 bg-sky-50',
    connector: 'bg-slate-200 border-dashed',
  },
  failed: {
    container: 'border-red-500 bg-red-50',
    connector: 'bg-slate-200 border-dashed',
  },
  pending: {
    container: 'border-slate-300 bg-slate-50',
    connector: 'bg-slate-200 border-dashed',
  },
} as const;

export function AgentStatusTimeline({ activeNodes }: AgentStatusTimelineProps) {
  // 预构建节点 Map，将 id 前缀解析后存入 Map，实现 O(1) 查找
  const nodeMap = new Map<string, typeof activeNodes[0]>();
  for (const node of activeNodes) {
    // activeNodes 中的 id 格式为 "node-{nodeId}"，需剥离前缀
    const key = node.id.replace(/^node-/, '');
    nodeMap.set(key, node);
  }

  return (
    <div className="ml-0 max-w-3xl rounded-3xl border border-sky-200 bg-sky-50/80 p-4 text-sm shadow-sm shadow-sky-100/70 md:ml-12">
      <div className="mb-3 flex items-center gap-2 font-semibold text-slate-950">
        <Loader2 size={15} className="motion-reduce:animate-none animate-spin duration-200 text-sky-600" aria-hidden="true" />
        Agent 执行进度
      </div>
      <div className="flex items-center justify-center gap-0">
        {NODE_ORDER.map((nodeId, index) => {
          const node = nodeMap.get(nodeId);
          const status = node?.status || 'pending';
          const title = NODE_LABELS[nodeId] || nodeId;
          const styles = STATUS_STYLES[status];

          return (
            <div key={nodeId} className="flex items-center">
              <div className="flex flex-col items-center">
                <div
                  className={`flex h-10 w-10 items-center justify-center rounded-full border-2 ${styles.container}`}
                >
                  {status === 'success' && <CheckCircle2 size={20} className="text-emerald-600" aria-hidden="true" />}
                  {status === 'running' && <Loader2 size={18} className="motion-reduce:animate-none animate-spin duration-200 text-sky-600" aria-hidden="true" />}
                  {status === 'failed' && <Circle size={18} className="text-red-600 fill-red-100" aria-hidden="true" />}
                  {status === 'pending' && <Circle size={18} className="text-slate-400" aria-hidden="true" />}
                </div>
                <span className="mt-2 text-xs text-slate-600">{title}</span>
              </div>
              {index < NODE_ORDER.length - 1 && (
                <div
                  className={`h-0.5 w-8 ${styles.connector}`}
                  aria-hidden="true"
                />
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}