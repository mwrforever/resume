import { Bot } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import type { IAgentActionStreamItem } from '@/types/agent';
import { applicationStatusLabelMap, getActionStatusLabel, getActionStatusVariant } from './agent-ui-utils';

interface AgentActionCardProps {
  action: IAgentActionStreamItem;
  onConfirm: (action: IAgentActionStreamItem) => void;
  onReject: (action: IAgentActionStreamItem) => void;
}

export function AgentActionCard({ action, onConfirm, onReject }: AgentActionCardProps) {
  const application = action.preview_payload?.application as Record<string, unknown> | undefined;
  const targetStatus = action.preview_payload?.target_status;
  const targetStatusLabel = typeof targetStatus === 'number' ? applicationStatusLabelMap[targetStatus] || String(targetStatus) : '待确认';

  return (
    <div className="ml-0 max-w-3xl rounded-3xl border border-amber-200 bg-amber-50/90 p-4 text-sm shadow-sm shadow-amber-100/70 md:ml-12">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2 font-semibold text-slate-950"><Bot size={15} className="text-amber-600" aria-hidden="true" />需要你确认操作</div>
          <div className="mt-1 text-slate-600">{action.action_name}</div>
        </div>
        <Badge variant={getActionStatusVariant(action.status)}>{getActionStatusLabel(action.status)}</Badge>
      </div>
      <div className="mt-3 grid gap-2 rounded-2xl border border-white/80 bg-white/85 p-3 text-xs text-slate-600 md:grid-cols-2">
        <div><span className="font-semibold text-slate-800">投递ID：</span>{action.target_id || '-'}</div>
        <div><span className="font-semibold text-slate-800">目标状态：</span>{targetStatusLabel}</div>
        <div><span className="font-semibold text-slate-800">岗位：</span>{String(application?.job_name || '-')}</div>
        <div><span className="font-semibold text-slate-800">候选人：</span>{String(application?.user_name || '-')}</div>
      </div>
      {action.status === 1 && (
        <div className="mt-3 flex justify-end gap-2">
          <Button type="button" size="sm" variant="outline" onClick={() => onReject(action)}>拒绝</Button>
          <Button type="button" size="sm" onClick={() => onConfirm(action)}>确认执行</Button>
        </div>
      )}
    </div>
  );
}
