import { Bot, Brain, Settings2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import type { ILlmModelOption } from '@/types/agent';
import { cn } from '@/lib/utils';
import { DEFAULT_MODEL_VALUE } from './agent-ui-utils';
import type { WorkspaceSession } from './agent-session-sidebar';

interface AgentWorkspaceHeaderProps {
  currentSession: WorkspaceSession | null;
  selectedModelName: string | null;
  selectableModels: ILlmModelOption[];
  enableThinking: boolean;
  immersiveMode: boolean;
  onSelectModel: (value: string) => void;
  onThinkingChange: (value: boolean) => void;
  onToggleImmersiveMode: () => void;
  onOpenPreferences: () => void;
}

export function AgentWorkspaceHeader({ currentSession, selectedModelName, selectableModels, enableThinking, immersiveMode, onSelectModel, onThinkingChange, onToggleImmersiveMode, onOpenPreferences }: AgentWorkspaceHeaderProps) {
  return (
    <div className="flex shrink-0 flex-col gap-3 border-b border-slate-100 bg-white/95 px-4 py-3 md:flex-row md:items-center md:justify-between">
      <div className="flex min-w-0 items-center gap-3">
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl bg-slate-950 text-sky-200"><Bot size={19} aria-hidden="true" /></div>
        <div className="min-w-0">
          <h1 className="truncate text-base font-semibold text-slate-950">{currentSession?.title || '新会话'}</h1>
          <p className="mt-0.5 truncate text-xs text-slate-500">GPT 式招聘 Agent 工作台，支持流式回复、工具调用和人工确认。</p>
        </div>
      </div>
      <div className="flex shrink-0 flex-col gap-2 sm:flex-row sm:items-center">
        <Button type="button" variant="outline" onClick={onToggleImmersiveMode} className="rounded-2xl" aria-label={immersiveMode ? '切回原工作台模式' : '进入沉浸式 Agent 模式'} title="Ctrl+B">
          {immersiveMode ? '后台模式' : '沉浸模式'}
        </Button>
        <div className="w-full sm:w-64">
          <Select value={selectedModelName || DEFAULT_MODEL_VALUE} onValueChange={onSelectModel}>
            <SelectTrigger className="h-10 rounded-2xl"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value={DEFAULT_MODEL_VALUE}>配置文件默认模型</SelectItem>
              {selectableModels.map((model) => <SelectItem key={`${model.source}-${model.model_name}`} value={model.model_name}>{model.model_name}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
        <Button type="button" variant="outline" onClick={() => onThinkingChange(!enableThinking)} aria-label={enableThinking ? '关闭思考模式' : '开启思考模式'} className={cn('rounded-2xl', enableThinking && 'border-sky-300 bg-sky-50 text-primary')}>
          <Brain size={16} className="mr-1.5" aria-hidden="true" />思考{enableThinking ? '开启' : '关闭'}
        </Button>
        <Button type="button" variant="outline" onClick={onOpenPreferences} className="rounded-2xl" aria-label="打开偏好设置">
          <Settings2 size={16} className="mr-1.5" aria-hidden="true" />设置
        </Button>
      </div>
    </div>
  );
}
