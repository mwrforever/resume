import { Brain, Loader2 } from 'lucide-react';
import { AgentMarkdownContent } from './agent-markdown-content';

interface ThinkingRendererProps {
  content: string;
  status: 'running' | 'success' | 'failed';
}

export function ThinkingRenderer({ content, status }: ThinkingRendererProps) {
  return (
    <div
      className={`ml-0 max-w-3xl rounded-2xl border p-4 text-sm shadow-sm md:ml-12 transition-all duration-200 ${
        status === 'running'
          ? 'border-violet-200 bg-violet-50/80'
          : status === 'success'
          ? 'border-emerald-200 bg-emerald-50/80'
          : 'border-red-200 bg-red-50/80'
      }`}
    >
      <div className="mb-2 flex items-center gap-2 font-medium text-slate-700">
        <Brain size={15} className="text-violet-600" aria-hidden="true" />
        <span>
          {status === 'running' ? 'Agent 思考中' : status === 'success' ? 'Agent 思考完成' : 'Agent 思考失败'}
        </span>
        {status === 'running' && (
          <Loader2 size={14} className="motion-reduce:animate-none animate-spin duration-200 text-violet-600 ml-auto" aria-hidden="true" />
        )}
      </div>

      {/* 思考内容 */}
      {content ? (
        <div className="mt-2 text-xs text-slate-600 leading-relaxed">
          <AgentMarkdownContent content={content} />
        </div>
      ) : (
        <div className="mt-2 flex items-center gap-1">
          <span className="h-1.5 w-1.5 rounded-full bg-violet-400 motion-reduce:animate-none animate-pulse" />
          <span className="h-1.5 w-1.5 rounded-full bg-violet-400 motion-reduce:animate-none animate-pulse" style={{ animationDelay: '150ms' }} />
          <span className="h-1.5 w-1.5 rounded-full bg-violet-400 motion-reduce:animate-none animate-pulse" style={{ animationDelay: '300ms' }} />
        </div>
      )}
    </div>
  );
}