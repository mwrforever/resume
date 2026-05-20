import { Loader2, CheckCircle2, XCircle, Wrench } from 'lucide-react';
import type { IAgentToolStreamItem } from '@/types/agent';

interface ToolExecutionCardProps {
  tool: IAgentToolStreamItem;
}

export function ToolExecutionCard({ tool }: ToolExecutionCardProps) {
  const isRunning = tool.type === 'call';
  const isSuccess = tool.success === true;
  const isFailed = tool.success === false;

  return (
    <div
      className={`ml-0 max-w-3xl rounded-2xl border p-3 text-sm shadow-sm md:ml-12 transition-all duration-200 ${
        isRunning
          ? 'border-sky-200 bg-sky-50/80'
          : isSuccess
          ? 'border-emerald-200 bg-emerald-50/80'
          : isFailed
          ? 'border-red-200 bg-red-50/80'
          : 'border-slate-200 bg-white'
      }`}
      data-tool-card={tool.tool_name}
    >
      <div className="flex items-start gap-3">
        {/* 状态图标 */}
        <div
          className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-xl ${
            isRunning
              ? 'bg-sky-100 text-sky-600'
              : isSuccess
              ? 'bg-emerald-100 text-emerald-600'
              : isFailed
              ? 'bg-red-100 text-red-600'
              : 'bg-slate-100 text-slate-600'
          }`}
        >
          {isRunning && <Loader2 size={16} className="motion-reduce:animate-none animate-spin duration-200" aria-hidden="true" />}
          {isSuccess && <CheckCircle2 size={16} aria-hidden="true" />}
          {isFailed && <XCircle size={16} aria-hidden="true" />}
        </div>

        {/* 工具名称和状态 */}
        <div className="min-w-0 flex-1">
          <div className="flex items-center justify-between">
            <span className="font-medium text-slate-900 truncate">{tool.display_name}</span>
            <span
              className={`ml-2 shrink-0 text-xs ${
                isRunning
                  ? 'text-sky-600'
                  : isSuccess
                  ? 'text-emerald-600'
                  : isFailed
                  ? 'text-red-600'
                  : 'text-slate-500'
              }`}
            >
              {isRunning ? '执行中...' : isSuccess ? '执行成功' : isFailed ? '执行失败' : '等待中'}
            </span>
          </div>

          {/* 输入参数 */}
          {tool.payload && Object.keys(tool.payload).length > 0 && (
            <div className="mt-1.5 text-xs text-slate-500">
              <span className="font-medium">输入：</span>
              <code className="ml-1 rounded bg-slate-100 px-1 py-0.5">
                {JSON.stringify(tool.payload).slice(0, 100)}
                {JSON.stringify(tool.payload).length > 100 ? '...' : ''}
              </code>
            </div>
          )}

          {/* 错误信息 */}
          {isFailed && tool.error_message && (
            <div className="mt-1.5 text-xs text-red-600">
              <span className="font-medium">错误：</span>
              {tool.error_message}
            </div>
          )}

          {/* 脉冲动画（执行中） */}
          {isRunning && (
            <div className="mt-2 flex items-center gap-1">
              <span className="h-1.5 w-1.5 rounded-full bg-sky-400 motion-reduce:animate-none animate-pulse" />
              <span className="h-1.5 w-1.5 rounded-full bg-sky-400 motion-reduce:animate-none animate-pulse" style={{ animationDelay: '150ms' }} />
              <span className="h-1.5 w-1.5 rounded-full bg-sky-400 motion-reduce:animate-none animate-pulse" style={{ animationDelay: '300ms' }} />
            </div>
          )}
        </div>
      </div>
    </div>
  );
}