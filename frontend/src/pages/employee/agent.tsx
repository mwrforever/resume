import { FormEvent, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Activity, AlertCircle, BarChart3, Bot, Brain, ChevronLeft, ChevronRight, Clock3, Cpu, MessageSquare, Pencil, Plus, RefreshCw, Search, Send, Trash2, UserRound, X } from 'lucide-react';
import { ConfirmDialog } from '@/components/common/confirm-dialog';
import { Pagination } from '@/components/common/pagination';
import { AdminLayout } from '@/components/layout/admin-layout';
import { Badge, type BadgeProps } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { employeeAgentApi, employeeLlmApi } from '@/api/employee/agent';
import { useAuthStore } from '@/store/auth';
import type { IAgentActionStreamItem, IAgentMemoryItem, IAgentMessageItem, IAgentReply, IAgentRunItem, IAgentSessionItem, IAgentSessionWindowItem, IAgentToolStreamItem, ILlmModelOption } from '@/types/agent';

type WorkspaceSession = IAgentSessionItem & { isLocal?: boolean };
type PanelDialogType = 'metrics' | 'memories' | 'runs' | null;
type BadgeVariant = BadgeProps['variant'];

const DEFAULT_MODEL_VALUE = '__default__';
const runStatusLabel: Record<number, string> = { 1: '执行中', 2: '成功', 3: '失败' };
const actionStatusLabelMap: Record<number, string> = { 1: '待确认', 3: '已确认', 4: '已拒绝' };
const applicationStatusLabelMap: Record<number, string> = { 1: '待处理', 2: '已查看', 3: '面试中', 4: '已拒绝', 5: '已录用' };
const hiddenScrollClass = '[scrollbar-width:none] [&::-webkit-scrollbar]:hidden';
const featureButtons = [{ type: 'metrics' as const, icon: Activity, label: '指标' }, { type: 'memories' as const, icon: Brain, label: '记忆' }, { type: 'runs' as const, icon: Cpu, label: 'Trace' }];
const collapsedButtons = [{ type: 'metrics' as const, icon: BarChart3 }, { type: 'memories' as const, icon: Brain }, { type: 'runs' as const, icon: Cpu }];

function getRunStatusVariant(status: number): BadgeVariant {
  if (status === 2) return 'success';
  if (status === 3) return 'danger';
  return 'secondary';
}

function getActionStatusVariant(status: number): BadgeVariant {
  if (status === 1) return 'warning';
  if (status === 3) return 'success';
  return 'secondary';
}

function getActionStatusLabel(status: number) {
  return actionStatusLabelMap[status] || '已处理';
}

function getToolEventVariant(item: IAgentToolStreamItem): BadgeVariant {
  if (item.type === 'result' && item.success === false) return 'danger';
  return 'secondary';
}

function getToolEventLabel(type: IAgentToolStreamItem['type']) {
  return type === 'call' ? '调用' : '结果';
}

function blockText(block: Record<string, unknown>) {
  if (typeof block.text === 'string') return block.text;
  if (typeof block.html === 'string') return block.html;
  return JSON.stringify(block);
}

function formatTime(value?: string | null) {
  if (!value) return '未保存';
  return new Intl.DateTimeFormat('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' }).format(new Date(value));
}

function buildLocalTitle(content: string) {
  return content.replace(/\s+/g, ' ').trim().slice(0, 50) || '新会话';
}

interface SessionDialogProps {
  open: boolean;
  initialTitle: string;
  saving: boolean;
  onClose: () => void;
  onSubmit: (title: string) => void;
}

function SessionDialog({ open, initialTitle, saving, onClose, onSubmit }: SessionDialogProps) {
  const [title, setTitle] = useState(initialTitle);

  useEffect(() => {
    if (open) setTitle(initialTitle);
  }, [initialTitle, open]);

  const handleSubmit = (event: FormEvent) => {
    event.preventDefault();
    if (!title.trim()) return;
    onSubmit(title.trim());
  };

  return (
    <Dialog open={open} onOpenChange={(value) => !value && onClose()} containerClassName="max-w-md rounded-2xl">
      <DialogContent>
        <div className="mb-4 flex items-center justify-between">
          <DialogTitle className="mb-0">重命名会话</DialogTitle>
          <button type="button" onClick={onClose} aria-label="关闭" className="rounded-lg p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"><X size={18} /></button>
        </div>
        <form className="space-y-4" onSubmit={handleSubmit}>
          <div className="space-y-1.5"><Label htmlFor="agent-session-title">会话名称</Label><Input id="agent-session-title" value={title} onChange={(event) => setTitle(event.target.value)} autoFocus required /></div>
          <div className="flex justify-end gap-2"><Button type="button" variant="outline" onClick={onClose} disabled={saving}>取消</Button><Button type="submit" disabled={saving || !title.trim()}>{saving ? '保存中...' : '保存'}</Button></div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

interface FeatureDialogProps {
  type: PanelDialogType;
  runs: IAgentRunItem[];
  memories: IAgentMemoryItem[];
  toolEvents: IAgentToolStreamItem[];
  totalTokens: number;
  latestRun?: IAgentRunItem;
  onClose: () => void;
}

function MetricCard({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
      <div className="text-xs text-slate-500">{label}</div>
      <div className="mt-1 text-xl font-bold text-slate-900">{value}</div>
    </div>
  );
}

function RunMetricItem({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="rounded-lg bg-slate-50 p-2">
      <div>{label}</div>
      <div className="mt-1 font-semibold text-slate-900">{value}</div>
    </div>
  );
}

function MetricsPanel({ runs, totalTokens, latestRun }: Pick<FeatureDialogProps, 'runs' | 'totalTokens' | 'latestRun'>) {
  return (
    <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
      <MetricCard label="Tokens" value={totalTokens} />
      <MetricCard label="最近延迟" value={`${latestRun?.latency_ms ?? 0}ms`} />
      <MetricCard label="运行次数" value={runs.length} />
    </div>
  );
}

function MemoriesPanel({ memories }: Pick<FeatureDialogProps, 'memories'>) {
  return (
    <div className="space-y-3">
      {memories.map((memory) => (
        <div key={memory.id} className="rounded-2xl border border-slate-200 bg-white p-4 text-sm leading-6 text-slate-700">
          <div className="mb-1 font-semibold text-slate-900">{memory.memory_type}</div>
          {memory.content}
        </div>
      ))}
      {memories.length === 0 && <div className="rounded-2xl border border-dashed border-sky-200 bg-sky-50/50 p-6 text-sm text-slate-600">暂无记忆。</div>}
    </div>
  );
}

function ToolEventsPanel({ toolEvents }: Pick<FeatureDialogProps, 'toolEvents'>) {
  if (toolEvents.length === 0) return null;

  return (
    <div className="rounded-2xl border border-sky-200 bg-sky-50/60 p-4">
      <div className="mb-3 text-sm font-semibold text-slate-900">实时工具事件</div>
      <div className="space-y-2">
        {toolEvents.map((item) => (
          <div key={item.id} className="rounded-xl border border-white/80 bg-white p-3 text-xs text-slate-600">
            <div className="mb-1 flex items-center justify-between gap-2">
              <span className="font-semibold text-slate-900">{item.display_name}</span>
              <Badge variant={getToolEventVariant(item)}>{getToolEventLabel(item.type)}</Badge>
            </div>
            <pre className="max-h-32 overflow-auto whitespace-pre-wrap break-all rounded-lg bg-slate-50 p-2">{JSON.stringify(item.payload, null, 2)}</pre>
            {item.error_message && <div className="mt-2 text-red-600">{item.error_message}</div>}
          </div>
        ))}
      </div>
    </div>
  );
}

function RunCard({ run }: { run: IAgentRunItem }) {
  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-4">
      <div className="flex items-center justify-between gap-2">
        <Badge variant={getRunStatusVariant(run.status)}>{runStatusLabel[run.status] || run.run_type}</Badge>
        <span className="text-xs text-slate-500">#{run.trace_id.slice(0, 8)}</span>
      </div>
      <div className="mt-3 text-sm font-semibold text-slate-900">{run.model_name || '配置文件默认模型'}</div>
      <div className="mt-3 grid grid-cols-3 gap-2 text-xs text-slate-600">
        <RunMetricItem label="Prompt" value={run.prompt_tokens} />
        <RunMetricItem label="Completion" value={run.completion_tokens} />
        <RunMetricItem label="Latency" value={run.latency_ms ?? 0} />
      </div>
      {run.error_message && <div className="mt-3 rounded-lg border border-red-200 bg-red-50 p-2 text-xs text-red-700">{run.error_message}</div>}
    </div>
  );
}

function RunsPanel({ runs, toolEvents }: Pick<FeatureDialogProps, 'runs' | 'toolEvents'>) {
  const isEmpty = runs.length === 0 && toolEvents.length === 0;

  return (
    <div className="space-y-3">
      <ToolEventsPanel toolEvents={toolEvents} />
      {runs.map((run) => <RunCard key={run.id} run={run} />)}
      {isEmpty && <div className="rounded-2xl border border-dashed border-sky-200 bg-sky-50/50 p-6 text-sm text-slate-600">暂无运行记录。</div>}
    </div>
  );
}

function FeatureDialog({ type, runs, memories, toolEvents, totalTokens, latestRun, onClose }: FeatureDialogProps) {
  const titleMap: Record<Exclude<PanelDialogType, null>, string> = { metrics: '运行指标', memories: '长期记忆', runs: 'Trace 记录' };

  return (
    <Dialog open={!!type} onOpenChange={(value) => !value && onClose()} containerClassName="max-w-3xl rounded-2xl">
      <DialogContent className={`max-h-[82vh] overflow-y-auto ${hiddenScrollClass}`}>
        <div className="mb-4 flex items-center justify-between">
          <DialogTitle className="mb-0">{type ? titleMap[type] : ''}</DialogTitle>
          <button type="button" onClick={onClose} aria-label="关闭" className="rounded-lg p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"><X size={18} /></button>
        </div>
        {type === 'metrics' && <MetricsPanel runs={runs} totalTokens={totalTokens} latestRun={latestRun} />}
        {type === 'memories' && <MemoriesPanel memories={memories} />}
        {type === 'runs' && <RunsPanel runs={runs} toolEvents={toolEvents} />}
      </DialogContent>
    </Dialog>
  );
}

interface AgentActionCardProps {
  action: IAgentActionStreamItem;
  onConfirm: (action: IAgentActionStreamItem) => void;
  onReject: (action: IAgentActionStreamItem) => void;
}

function AgentActionCard({ action, onConfirm, onReject }: AgentActionCardProps) {
  const application = action.preview_payload?.application as Record<string, unknown> | undefined;
  const targetStatus = action.preview_payload?.target_status;
  const targetStatusLabel = typeof targetStatus === 'number' ? applicationStatusLabelMap[targetStatus] || String(targetStatus) : '待确认';

  return (
    <div className="ml-11 max-w-3xl rounded-3xl border border-amber-200 bg-amber-50/80 p-4 text-sm shadow-sm shadow-amber-100/70">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2 font-semibold text-slate-900"><Bot size={15} className="text-amber-600" aria-hidden="true" />需要你确认操作</div>
          <div className="mt-1 text-slate-600">{action.action_name}</div>
        </div>
        <Badge variant={getActionStatusVariant(action.status)}>{getActionStatusLabel(action.status)}</Badge>
      </div>
      <div className="mt-3 grid gap-2 rounded-2xl border border-white/80 bg-white/80 p-3 text-xs text-slate-600 md:grid-cols-2">
        <div><span className="font-semibold text-slate-800">投递ID：</span>{action.target_id || '-'}</div>
        <div><span className="font-semibold text-slate-800">目标状态：</span>{targetStatusLabel}</div>
        <div><span className="font-semibold text-slate-800">岗位：</span>{String(application?.job_name || '-')}</div>
        <div><span className="font-semibold text-slate-800">候选人：</span>{String(application?.user_name || '-')}</div>
      </div>
      {action.status === 1 && <div className="mt-3 flex justify-end gap-2"><Button type="button" size="sm" variant="outline" onClick={() => onReject(action)}>拒绝</Button><Button type="button" size="sm" onClick={() => onConfirm(action)}>确认执行</Button></div>}
    </div>
  );
}

interface SessionSearchDialogProps {
  open: boolean;
  onClose: () => void;
  onOpenSession: (session: WorkspaceSession) => void;
}

function SessionSearchDialog({ open, onClose, onOpenSession }: SessionSearchDialogProps) {
  const [keyword, setKeyword] = useState('');
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);
  const [total, setTotal] = useState(0);
  const [items, setItems] = useState<WorkspaceSession[]>([]);
  const [loading, setLoading] = useState(false);

  const loadData = useCallback(async () => {
    if (!open) return;
    setLoading(true);
    try {
      const res = await employeeAgentApi.listSessions({ page, page_size: pageSize, keyword: keyword.trim() || undefined });
      setItems(res.data?.items || []);
      setTotal(res.data?.total || 0);
    } finally {
      setLoading(false);
    }
  }, [keyword, open, page, pageSize]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  const handleSearch = (event: FormEvent) => {
    event.preventDefault();
    setPage(1);
    loadData();
  };

  return (
    <Dialog open={open} onOpenChange={(value) => !value && onClose()} containerClassName="max-w-3xl rounded-2xl">
      <DialogContent className={`max-h-[82vh] overflow-y-auto ${hiddenScrollClass}`}>
        <div className="mb-4 flex items-center justify-between"><DialogTitle className="mb-0">搜索会话</DialogTitle><button type="button" onClick={onClose} aria-label="关闭" className="rounded-lg p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"><X size={18} /></button></div>
        <form className="mb-4 flex gap-2" onSubmit={handleSearch}><Input value={keyword} onChange={(event) => setKeyword(event.target.value)} placeholder="输入会话名称搜索" /><Button type="submit" disabled={loading}><Search size={15} className="mr-1.5" aria-hidden="true" />搜索</Button></form>
        <div className="space-y-2">{items.map((session) => <button key={session.id} type="button" onClick={() => { onOpenSession(session); onClose(); }} className="flex w-full items-center justify-between gap-3 rounded-2xl border border-slate-200 bg-white p-3 text-left hover:border-primary/30 hover:bg-sky-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"><div className="min-w-0"><div className="truncate text-sm font-semibold text-slate-900">{session.title}</div><div className="mt-1 text-xs text-slate-500">{formatTime(session.last_message_time || session.update_time)}</div></div><Badge variant="outline">打开</Badge></button>)}{!loading && items.length === 0 && <div className="rounded-2xl border border-dashed border-sky-200 bg-sky-50/50 p-6 text-sm text-slate-600">暂无匹配会话。</div>}</div>
        <Pagination page={page} pageSize={pageSize} total={total} onChange={setPage} onPageSizeChange={(size) => { setPageSize(size); setPage(1); }} />
      </DialogContent>
    </Dialog>
  );
}

export default function EmployeeAgent() {
  const userId = useAuthStore((state) => state.userId);
  const [sessions, setSessions] = useState<WorkspaceSession[]>([]);
  const [currentSession, setCurrentSession] = useState<WorkspaceSession | null>(null);
  const [messages, setMessages] = useState<IAgentMessageItem[]>([]);
  const [runs, setRuns] = useState<IAgentRunItem[]>([]);
  const [memories, setMemories] = useState<IAgentMemoryItem[]>([]);
  const [toolEvents, setToolEvents] = useState<IAgentToolStreamItem[]>([]);
  const [actions, setActions] = useState<IAgentActionStreamItem[]>([]);
  const [, setSessionWindow] = useState<IAgentSessionWindowItem | null>(null);
  const [models, setModels] = useState<ILlmModelOption[]>([]);
  const [selectedModelName, setSelectedModelName] = useState<string | null>(null);
  const [input, setInput] = useState('');
  const [sending, setSending] = useState(false);
  const [loadingSessionId, setLoadingSessionId] = useState<number | null>(null);
  const [errorMessage, setErrorMessage] = useState('');
  const [rightPanelOpen, setRightPanelOpen] = useState(true);
  const [renameTarget, setRenameTarget] = useState<WorkspaceSession | null>(null);
  const [savingSession, setSavingSession] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<WorkspaceSession | null>(null);
  const [deletingSession, setDeletingSession] = useState(false);
  const [panelDialog, setPanelDialog] = useState<PanelDialogType>(null);
  const [searchOpen, setSearchOpen] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement | null>(null);

  const latestRun = runs[0];
  const totalTokens = useMemo(() => runs.reduce((sum, run) => sum + (run.total_tokens || 0), 0), [runs]);
  const selectableModels = useMemo(() => models.filter((model) => model.source !== 'env'), [models]);

  useEffect(() => { messagesEndRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' }); }, [messages.length, actions.length, sending]);

  const loadSessions = useCallback(async () => {
    const res = await employeeAgentApi.listSessions({ page: 1, page_size: 100 });
    setSessions((prev) => [...prev.filter((session) => session.isLocal), ...(res.data?.items || [])]);
  }, []);

  const loadModels = useCallback(async () => {
    const res = await employeeLlmApi.listOptions();
    setModels(res.data || []);
  }, []);

  const clearConversation = () => { setMessages([]); setRuns([]); setMemories([]); setToolEvents([]); setActions([]); setSessionWindow(null); setInput(''); };

  const createLocalSession = (modelName: string | null = selectedModelName) => {
    const selectedModel = models.find((model) => model.model_name === modelName);
    const localSession: WorkspaceSession = { id: -Date.now(), session_key: `local-${Date.now()}`, employee_id: Number(userId || 0), title: '新会话', status: 1, selected_model_name: modelName, selected_model_source: selectedModel?.source || null, context_summary: null, last_message_time: null, version: 0, create_time: null, update_time: null, isLocal: true };
    setSessions((prev) => [localSession, ...prev]);
    setCurrentSession(localSession);
    setSelectedModelName(modelName);
    clearConversation();
    return localSession;
  };

  const replaceSession = (nextSession: WorkspaceSession, oldId?: number) => {
    setSessions((prev) => {
      const filtered = oldId ? prev.filter((session) => session.id !== oldId) : prev;
      const exists = filtered.some((session) => session.id === nextSession.id);
      return exists ? filtered.map((session) => session.id === nextSession.id ? nextSession : session) : [nextSession, ...filtered];
    });
    setCurrentSession(nextSession);
    setSelectedModelName(nextSession.selected_model_name || null);
  };

  const openSession = useCallback(async (session: WorkspaceSession) => {
    setErrorMessage('');
    setCurrentSession(session);
    setSelectedModelName(session.selected_model_name || null);
    if (session.isLocal) { clearConversation(); return; }
    setLoadingSessionId(session.id);
    try {
      const detail = await employeeAgentApi.getSession(session.id);
      setCurrentSession(detail.data.session);
      setSelectedModelName(detail.data.session.selected_model_name || null);
      setMessages(detail.data.messages);
      setMemories(detail.data.memories || []);
      setToolEvents([]);
      const actionRes = await employeeAgentApi.listActions(session.id);
      setActions(actionRes.data || []);
      setSessionWindow(detail.data.session_window || null);
      const runRes = await employeeAgentApi.listRuns(session.id);
      setRuns(runRes.data || []);
    } finally { setLoadingSessionId(null); }
  }, []);

  useEffect(() => { loadSessions(); loadModels(); }, [loadModels, loadSessions]);

  const saveSession = async (title: string) => {
    if (!renameTarget) return;
    setSavingSession(true);
    try {
      if (renameTarget.isLocal) replaceSession({ ...renameTarget, title }, renameTarget.id);
      else { const res = await employeeAgentApi.updateSession(renameTarget.id, { title }); replaceSession(res.data); await loadSessions(); }
      setRenameTarget(null);
    } finally { setSavingSession(false); }
  };

  const deleteSession = async () => {
    if (!deleteTarget) return;
    setDeletingSession(true);
    try {
      if (!deleteTarget.isLocal) { await employeeAgentApi.deleteSession(deleteTarget.id); await loadSessions(); }
      setSessions((prev) => prev.filter((session) => session.id !== deleteTarget.id));
      if (currentSession?.id === deleteTarget.id) { setCurrentSession(null); setSelectedModelName(null); clearConversation(); }
      setDeleteTarget(null);
    } finally { setDeletingSession(false); }
  };

  const selectModel = async (value: string) => {
    const modelName = value === DEFAULT_MODEL_VALUE ? null : value;
    setSelectedModelName(modelName);
    if (!currentSession) return;
    const selectedModel = models.find((model) => model.model_name === modelName);
    if (currentSession.isLocal) { replaceSession({ ...currentSession, selected_model_name: modelName, selected_model_source: selectedModel?.source || null }, currentSession.id); return; }
    const res = await employeeAgentApi.selectModel(currentSession.id, modelName);
    replaceSession(res.data);
    await loadSessions();
  };

  const sendMessage = async (event: FormEvent) => {
    event.preventDefault();
    if (!input.trim()) return;
    const content = input.trim();
    const activeSession = currentSession || createLocalSession(selectedModelName);
    const oldSessionId = activeSession.id;
    const streamingMessageId = -Date.now();
    setErrorMessage('');
    setSending(true);
    setToolEvents([]);
    setInput('');
    try {
      let persistedSession: WorkspaceSession = activeSession;
      if (activeSession.isLocal) {
        const createRes = await employeeAgentApi.createSession({ title: '新会话', selected_model_name: activeSession.selected_model_name || null });
        persistedSession = createRes.data;
        replaceSession(persistedSession, oldSessionId);
      }
      await employeeAgentApi.streamMessage(persistedSession.id, { content, context_refs: [] }, (streamEvent) => {
        if (streamEvent.event === 'user_message') {
          const userMessage = streamEvent.data.message as IAgentMessageItem;
          setMessages((prev) => prev.some((message) => message.id === userMessage.id) ? prev : [...prev, userMessage]);
        }
        if (streamEvent.event === 'run_started') {
          const run = streamEvent.data.run as IAgentRunItem;
          setRuns((prev) => [run, ...prev.filter((item) => item.id !== run.id)]);
        }
        if (streamEvent.event === 'tool_call') {
          const toolCall = streamEvent.data.tool_call as Record<string, unknown>;
          setToolEvents((prev) => [...prev, { id: `call-${Date.now()}-${prev.length}`, type: 'call', tool_name: String(toolCall.tool_name || ''), display_name: String(toolCall.display_name || '工具调用'), payload: (toolCall.input_payload as Record<string, unknown>) || {} }]);
        }
        if (streamEvent.event === 'tool_result') {
          const toolResult = streamEvent.data.tool_result as Record<string, unknown>;
          setToolEvents((prev) => [...prev, { id: `result-${Date.now()}-${prev.length}`, type: 'result', tool_name: String(toolResult.tool_name || ''), display_name: String(toolResult.display_name || '工具结果'), payload: (toolResult.output_payload as Record<string, unknown>) || {}, success: Boolean(toolResult.success), error_message: typeof toolResult.error_message === 'string' ? toolResult.error_message : null }]);
        }
        if (streamEvent.event === 'action_required') {
          const action = streamEvent.data.action as IAgentActionStreamItem;
          setActions((prev) => [action, ...prev.filter((item) => item.id !== action.id)]);
        }
        if (streamEvent.event === 'token') {
          const delta = typeof streamEvent.data.delta === 'string' ? streamEvent.data.delta : '';
          if (!delta) return;
          setMessages((prev) => {
            const existing = prev.find((message) => message.id === streamingMessageId);
            if (!existing) {
              return [...prev, { id: streamingMessageId, session_id: persistedSession.id, parent_message_id: null, role: 'agent', message_type: 'text', content: { context_refs: [], blocks: [{ type: 'text', text: delta }] }, model_name: null, token_count: null, sort_order: prev.length + 1, create_time: null }];
            }
            return prev.map((message) => message.id === streamingMessageId ? { ...message, content: { ...message.content, blocks: [{ type: 'text', text: `${blockText(message.content.blocks?.[0] || {})}${delta}` }] } } : message);
          });
        }
        if (streamEvent.event === 'final' || streamEvent.event === 'error') {
          const reply = streamEvent.data.reply as IAgentReply | undefined;
          if (!reply) return;
          const nextSession = reply.session || { ...persistedSession, title: buildLocalTitle(content), context_summary: buildLocalTitle(content) };
          replaceSession(nextSession, oldSessionId);
          setMessages((prev) => [...prev.filter((message) => message.id !== streamingMessageId && message.id !== reply.user_message.id && message.id !== reply.agent_message.id), reply.user_message, reply.agent_message]);
          setRuns((prev) => [reply.run, ...prev.filter((run) => run.id !== reply.run.id)]);
          setMemories(reply.memories || []);
          setSessionWindow(reply.session_window || null);
        }
      });
      await loadSessions();
    } catch {
      setInput(content);
      setErrorMessage('消息发送失败，请检查模型配置或稍后重试。');
    } finally { setSending(false); }
  };

  const confirmAgentAction = async (action: IAgentActionStreamItem) => {
    const res = await employeeAgentApi.confirmAction(action.id);
    setActions((prev) => prev.map((item) => item.id === action.id ? res.data : item));
  };

  const rejectAgentAction = async (action: IAgentActionStreamItem) => {
    const res = await employeeAgentApi.rejectAction(action.id, '用户在会话内容中拒绝');
    setActions((prev) => prev.map((item) => item.id === action.id ? res.data : item));
  };

  const actionsByMessageId = useMemo(() => {
    const agentReplyByParentId = new Map<number, number>();
    messages.forEach((message) => {
      if (message.role === 'agent' && typeof message.parent_message_id === 'number') {
        agentReplyByParentId.set(message.parent_message_id, message.id);
      }
    });
    const grouped = new Map<number, IAgentActionStreamItem[]>();
    actions.forEach((action) => {
      if (typeof action.message_id !== 'number') return;
      const displayMessageId = agentReplyByParentId.get(action.message_id) || action.message_id;
      grouped.set(displayMessageId, [...(grouped.get(displayMessageId) || []), action]);
    });
    grouped.forEach((items) => items.sort((left, right) => left.id - right.id));
    return grouped;
  }, [actions, messages]);

  const floatingActions = useMemo(() => actions.filter((action) => typeof action.message_id !== 'number').sort((left, right) => left.id - right.id), [actions]);

  return (
    <AdminLayout breadcrumbs={[{ label: 'Agent 平台' }, { label: 'Agent 工作台' }]} title="Agent 工作台">
      <div className="grid h-[calc(100vh-8.5rem)] min-h-0 grid-cols-1 gap-4 overflow-hidden xl:grid-cols-[280px_minmax(0,1fr)_auto]">
        <aside className="flex min-h-0 flex-col overflow-hidden rounded-[1.75rem] border border-white/80 bg-white/90 shadow-sm shadow-slate-200/70 backdrop-blur">
          <div className="flex items-center justify-between border-b border-slate-100 p-3"><div className="flex items-center gap-2 text-sm font-semibold text-slate-900"><MessageSquare size={17} className="text-primary" aria-hidden="true" />会话</div><div className="flex items-center gap-1"><button type="button" onClick={() => setSearchOpen(true)} aria-label="搜索会话" className="rounded-lg p-2 text-slate-500 hover:bg-sky-50 hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"><Search size={15} aria-hidden="true" /></button><button type="button" onClick={loadSessions} aria-label="刷新会话" className="rounded-lg p-2 text-slate-500 hover:bg-sky-50 hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"><RefreshCw size={15} aria-hidden="true" /></button><button type="button" onClick={() => createLocalSession()} aria-label="新建会话" className="rounded-lg p-2 text-slate-500 hover:bg-sky-50 hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"><Plus size={15} aria-hidden="true" /></button></div></div>
          <div className={`min-h-0 flex-1 space-y-2 overflow-y-auto p-3 ${hiddenScrollClass}`}>{sessions.map((session) => { const selected = currentSession?.id === session.id; return <div key={session.id} className={`group flex items-center gap-1 rounded-2xl border p-2 transition-[background-color,border-color,box-shadow] ${selected ? 'border-primary/40 bg-sky-50 shadow-sm shadow-sky-900/5' : 'border-transparent hover:border-slate-200 hover:bg-white hover:shadow-sm'}`}><button type="button" onClick={() => openSession(session)} className="min-w-0 flex-1 cursor-pointer rounded-xl px-2 py-1.5 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"><div className="flex min-w-0 items-center gap-2"><span className="truncate text-sm font-semibold text-slate-900">{session.title}</span>{session.isLocal && <Badge variant="secondary">未保存</Badge>}</div><div className="mt-1 flex min-w-0 items-center gap-1 text-xs text-slate-400"><Clock3 size={13} aria-hidden="true" /><span className="truncate">{formatTime(session.last_message_time || session.update_time)}</span></div></button><div className="flex shrink-0 items-center gap-1">{loadingSessionId === session.id ? <Badge variant="secondary">加载</Badge> : null}<button type="button" onClick={() => setRenameTarget(session)} className="rounded-lg p-1.5 text-slate-400 hover:bg-sky-50 hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" aria-label="重命名会话"><Pencil size={13} aria-hidden="true" /></button><button type="button" onClick={() => setDeleteTarget(session)} className="rounded-lg p-1.5 text-slate-400 hover:bg-red-50 hover:text-red-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-400" aria-label="删除会话"><Trash2 size={13} aria-hidden="true" /></button></div></div>; })}{sessions.length === 0 && <div className="rounded-2xl border border-dashed border-sky-200 bg-sky-50/50 p-4 text-sm text-slate-600">暂无会话，可直接输入消息发送，系统会自动创建会话。</div>}</div>
        </aside>
        <main className="flex min-h-0 flex-col overflow-hidden rounded-[1.75rem] border border-white/80 bg-white/95 shadow-sm shadow-slate-200/70 backdrop-blur">
          <div className="flex shrink-0 items-center justify-between gap-3 border-b border-slate-100 px-4 py-3"><div className="flex min-w-0 items-center gap-3"><div className="w-64 shrink-0"><Select value={selectedModelName || DEFAULT_MODEL_VALUE} onValueChange={selectModel}><SelectTrigger className="h-9 rounded-2xl"><SelectValue /></SelectTrigger><SelectContent><SelectItem value={DEFAULT_MODEL_VALUE}>配置文件默认模型</SelectItem>{selectableModels.map((model) => <SelectItem key={`${model.source}-${model.model_name}`} value={model.model_name}>{model.model_name}</SelectItem>)}</SelectContent></Select></div><div className="min-w-0"><h1 className="truncate text-base font-semibold text-slate-900">{currentSession?.title || '新会话'}</h1><p className="mt-0.5 truncate text-xs text-slate-500">未选会话时发送消息会自动创建并保存。</p></div></div><button type="button" onClick={() => setRightPanelOpen((value) => !value)} className="inline-flex items-center gap-1.5 rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm font-semibold text-slate-600 shadow-sm hover:border-primary/30 hover:bg-sky-50 hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">{rightPanelOpen ? <ChevronRight size={15} aria-hidden="true" /> : <ChevronLeft size={15} aria-hidden="true" />}功能栏</button></div>
          <div className={`min-h-0 flex-1 overflow-y-auto bg-[radial-gradient(circle_at_top_left,rgba(14,165,233,0.07),transparent_20rem),linear-gradient(180deg,#ffffff_0%,#f8fafc_100%)] px-4 py-6 ${hiddenScrollClass}`}>{errorMessage && <div role="alert" className="mx-auto mb-4 flex max-w-3xl gap-2 rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-700"><AlertCircle size={16} className="mt-0.5 shrink-0" aria-hidden="true" /><span>{errorMessage}</span></div>}<div className="mx-auto flex max-w-3xl flex-col gap-5">{messages.map((message) => {
              const isUser = message.role === 'user';
              return <div key={message.id} className="space-y-3"><div className={`flex gap-3 ${isUser ? 'justify-end' : 'justify-start'}`}>{!isUser && <div className="mt-1 flex h-8 w-8 shrink-0 items-center justify-center rounded-xl bg-sky-100 text-primary"><Bot size={16} aria-hidden="true" /></div>}<div className={`max-w-[86%] rounded-3xl px-4 py-3 text-sm leading-6 shadow-sm ${isUser ? 'bg-primary text-white shadow-sky-900/10' : 'border border-slate-200 bg-white text-slate-900 shadow-slate-200/70'}`}><div className="mb-2 flex items-center gap-2 text-xs font-semibold opacity-80">{isUser ? <UserRound size={14} aria-hidden="true" /> : <Bot size={14} aria-hidden="true" />}{isUser ? '你' : 'Agent'}{message.model_name && <span>· {message.model_name}</span>}</div><div className="space-y-2 whitespace-pre-wrap">{(message.content.blocks || []).map((block, index) => <div key={index}>{blockText(block)}</div>)}</div>{message.token_count ? <div className="mt-2 text-xs opacity-70">tokens: {message.token_count}</div> : null}</div>{isUser && <div className="mt-1 flex h-8 w-8 shrink-0 items-center justify-center rounded-xl bg-slate-900 text-white"><UserRound size={16} aria-hidden="true" /></div>}</div>{(actionsByMessageId.get(message.id) || []).map((action) => <AgentActionCard key={action.id} action={action} onConfirm={confirmAgentAction} onReject={rejectAgentAction} />)}</div>;
            })}{floatingActions.map((action) => <AgentActionCard key={action.id} action={action} onConfirm={confirmAgentAction} onReject={rejectAgentAction} />)}{sending && <div className="flex items-center gap-3 text-sm text-slate-500"><div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-xl bg-sky-100 text-primary"><Bot size={16} aria-hidden="true" /></div><div className="rounded-2xl border border-slate-200 bg-white px-4 py-3 shadow-sm shadow-slate-200/70">Agent 正在生成...</div></div>}{messages.length === 0 && <div className="flex min-h-[340px] items-center justify-center text-center"><div><div className="mx-auto flex h-12 w-12 items-center justify-center rounded-2xl bg-sky-100 text-primary"><Bot size={22} aria-hidden="true" /></div><div className="mt-4 text-lg font-semibold text-slate-900">开始一次招聘 Agent 对话</div><p className="mt-2 text-sm text-slate-600">未选择会话也可以直接发送，默认使用配置文件模型。</p></div></div>}<div ref={messagesEndRef} /></div></div>
          <form className="shrink-0 border-t border-slate-100 bg-white/95 p-4" onSubmit={sendMessage}><div className="mx-auto max-w-3xl rounded-3xl border border-slate-200 bg-white p-2 shadow-lg shadow-slate-200/70 focus-within:ring-2 focus-within:ring-ring"><div className="flex items-end gap-3"><Textarea value={input} onChange={(event) => setInput(event.target.value)} className="min-h-[52px] flex-1 resize-none border-0 shadow-none focus-visible:ring-0 focus-visible:ring-offset-0" placeholder="输入任务，例如：帮我分析这个岗位的候选人评估策略" disabled={sending} aria-label="Agent 消息输入" /><Button type="submit" className="mb-1 h-10 w-10 rounded-2xl p-0" disabled={sending || !input.trim()} aria-label="发送消息"><Send size={16} aria-hidden="true" /></Button></div></div></form>
        </main>
        <aside className={`relative min-h-0 overflow-hidden transition-[width] duration-200 ${rightPanelOpen ? 'w-full xl:w-[120px]' : 'w-14'}`}><div className="flex h-full min-h-0 flex-col overflow-hidden rounded-[1.75rem] border border-white/80 bg-white/90 shadow-sm shadow-slate-200/70 backdrop-blur">{rightPanelOpen ? <div className="grid flex-1 content-start gap-2 p-3">{featureButtons.map((item) => <button key={item.type} type="button" onClick={() => setPanelDialog(item.type)} className="flex flex-col items-center gap-1 rounded-2xl border border-slate-200 bg-white px-2 py-3 text-xs font-semibold text-slate-600 shadow-sm hover:border-primary/30 hover:bg-sky-50 hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"><item.icon size={18} aria-hidden="true" />{item.label}</button>)}</div> : <div className="flex flex-1 flex-col items-center gap-3 py-4 text-slate-400">{collapsedButtons.map((item) => <button key={item.type} type="button" onClick={() => setPanelDialog(item.type)} className="rounded-lg p-2 hover:bg-sky-50 hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"><item.icon size={18} aria-hidden="true" /></button>)}</div>}</div></aside>
      </div>
      <SessionDialog open={!!renameTarget} initialTitle={renameTarget?.title ?? ''} saving={savingSession} onClose={() => setRenameTarget(null)} onSubmit={saveSession} />
      <FeatureDialog type={panelDialog} runs={runs} memories={memories} toolEvents={toolEvents} totalTokens={totalTokens} latestRun={latestRun} onClose={() => setPanelDialog(null)} />
      <SessionSearchDialog open={searchOpen} onClose={() => setSearchOpen(false)} onOpenSession={openSession} />
      <ConfirmDialog open={!!deleteTarget} title="确认删除会话" description={`确定要删除「${deleteTarget?.title}」吗？删除后会话将不再展示。`} confirmLabel="删除" onConfirm={deleteSession} onCancel={() => setDeleteTarget(null)} loading={deletingSession} />
    </AdminLayout>
  );
}
