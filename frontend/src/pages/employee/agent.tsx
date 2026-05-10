import { FormEvent, useCallback, useEffect, useMemo, useState } from 'react';
import { Activity, AlertCircle, Archive, Bot, Brain, CheckCircle2, Clock3, Cpu, Hash, MessageSquare, Plus, RefreshCw, Send, Sparkles, UserRound, Workflow } from 'lucide-react';
import { AdminLayout } from '@/components/layout/admin-layout';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { employeeAgentApi, employeeLlmApi } from '@/api/employee/agent';
import type { IAgentContextSnapshotItem, IAgentMemoryItem, IAgentMessageItem, IAgentRunItem, IAgentSessionItem, IAgentSessionWindowItem, ILlmModelOption } from '@/types/agent';

const runStatusLabel: Record<number, string> = {
  1: '执行中',
  2: '成功',
  3: '失败',
};

function blockText(block: Record<string, unknown>) {
  if (typeof block.text === 'string') return block.text;
  if (typeof block.html === 'string') return block.html;
  return JSON.stringify(block);
}

function formatTime(value?: string | null) {
  if (!value) return '暂无时间';
  return new Intl.DateTimeFormat('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' }).format(new Date(value));
}

export default function EmployeeAgent() {
  const [sessions, setSessions] = useState<IAgentSessionItem[]>([]);
  const [currentSession, setCurrentSession] = useState<IAgentSessionItem | null>(null);
  const [messages, setMessages] = useState<IAgentMessageItem[]>([]);
  const [runs, setRuns] = useState<IAgentRunItem[]>([]);
  const [memories, setMemories] = useState<IAgentMemoryItem[]>([]);
  const [snapshots, setSnapshots] = useState<IAgentContextSnapshotItem[]>([]);
  const [sessionWindow, setSessionWindow] = useState<IAgentSessionWindowItem | null>(null);
  const [models, setModels] = useState<ILlmModelOption[]>([]);
  const [newTitle, setNewTitle] = useState('招聘 Agent 会话');
  const [input, setInput] = useState('');
  const [sending, setSending] = useState(false);
  const [loadingSessionId, setLoadingSessionId] = useState<number | null>(null);
  const [errorMessage, setErrorMessage] = useState('');

  const latestRun = runs[0];
  const totalTokens = useMemo(() => runs.reduce((sum, run) => sum + (run.total_tokens || 0), 0), [runs]);

  const loadSessions = useCallback(async () => {
    const res = await employeeAgentApi.listSessions({ page: 1, page_size: 50 });
    setSessions(res.data?.items || []);
  }, []);

  const loadModels = useCallback(async () => {
    const res = await employeeLlmApi.listOptions();
    setModels(res.data || []);
  }, []);

  const openSession = useCallback(async (session: IAgentSessionItem) => {
    setLoadingSessionId(session.id);
    setErrorMessage('');
    try {
      setCurrentSession(session);
      const detail = await employeeAgentApi.getSession(session.id);
      setCurrentSession(detail.data.session);
      setMessages(detail.data.messages);
      setMemories(detail.data.memories || []);
      setSnapshots(detail.data.snapshots || []);
      setSessionWindow(detail.data.session_window || null);
      const runRes = await employeeAgentApi.listRuns(session.id);
      setRuns(runRes.data || []);
    } finally {
      setLoadingSessionId(null);
    }
  }, []);

  useEffect(() => {
    loadSessions();
    loadModels();
  }, [loadModels, loadSessions]);

  const createSession = async () => {
    if (!newTitle.trim()) return;
    const res = await employeeAgentApi.createSession({
      title: newTitle.trim(),
      selected_model_name: models[0]?.model_name || null,
    });
    await loadSessions();
    await openSession(res.data);
  };

  const selectModel = async (modelName: string) => {
    if (!currentSession) return;
    const res = await employeeAgentApi.selectModel(currentSession.id, modelName);
    setCurrentSession(res.data);
    await loadSessions();
  };

  const sendMessage = async (event: FormEvent) => {
    event.preventDefault();
    if (!currentSession || !input.trim()) return;
    setErrorMessage('');
    setSending(true);
    try {
      const res = await employeeAgentApi.sendMessage(currentSession.id, { content: input.trim(), context_refs: [] });
      setMessages((prev) => [...prev, res.data.user_message, res.data.agent_message]);
      setRuns((prev) => [res.data.run, ...prev]);
      setMemories(res.data.memories || []);
      setSessionWindow(res.data.session_window || null);
      if (res.data.snapshot) {
        setSnapshots((prev) => [res.data.snapshot as IAgentContextSnapshotItem, ...prev]);
      }
      setInput('');
      await loadSessions();
    } catch {
      setErrorMessage('消息发送失败，请检查模型配置或稍后重试。');
    } finally {
      setSending(false);
    }
  };

  return (
    <AdminLayout breadcrumbs={[{ label: 'Agent 平台' }, { label: 'Agent 工作台' }]} title="Agent 工作台">
      <div className="space-y-6">
        <section className="rounded-2xl border border-blue-100 bg-white p-6">
          <div className="flex flex-col gap-5 lg:flex-row lg:items-center lg:justify-between">
            <div className="max-w-2xl">
              <div className="inline-flex items-center gap-2 rounded-full border border-blue-200 bg-blue-50 px-3 py-1 text-xs font-semibold text-blue-700">
                <Workflow size={14} aria-hidden="true" />
                LangGraph Agent Runtime
              </div>
              <h1 className="mt-4 text-2xl font-bold text-slate-900">可编排 Agent 工作台</h1>
              <p className="mt-2 text-sm leading-6 text-slate-600">围绕会话、模型路由、消息与执行 Trace 组织工作流，便于观察每次模型调用的延迟、Token 与失败原因。</p>
            </div>
            <div className="grid grid-cols-3 gap-3">
              <div className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-3">
                <div className="text-xs font-medium text-slate-500">会话</div>
                <div className="mt-1 text-2xl font-bold text-slate-900">{sessions.length}</div>
              </div>
              <div className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-3">
                <div className="text-xs font-medium text-slate-500">模型</div>
                <div className="mt-1 text-2xl font-bold text-slate-900">{models.length}</div>
              </div>
              <div className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-3">
                <div className="text-xs font-medium text-slate-500">Tokens</div>
                <div className="mt-1 text-2xl font-bold text-slate-900">{totalTokens}</div>
              </div>
            </div>
          </div>
        </section>

        <div className="grid grid-cols-1 gap-6 xl:grid-cols-[300px_minmax(0,1fr)_340px]">
          <Card className="overflow-hidden">
            <CardHeader className="border-b border-slate-100">
              <div className="flex items-center justify-between gap-3">
                <CardTitle className="flex items-center gap-2">
                  <MessageSquare size={18} className="text-blue-600" aria-hidden="true" />
                  会话
                </CardTitle>
                <Button type="button" variant="ghost" size="sm" onClick={loadSessions} aria-label="刷新会话">
                  <RefreshCw size={15} aria-hidden="true" />
                </Button>
              </div>
            </CardHeader>
            <CardContent className="space-y-4 p-4">
              <div className="rounded-xl border border-slate-200 bg-slate-50 p-3">
                <Input value={newTitle} onChange={(event) => setNewTitle(event.target.value)} aria-label="新会话标题" />
                <Button type="button" className="mt-3 w-full" onClick={createSession} disabled={!newTitle.trim()}>
                  <Plus size={15} className="mr-1" aria-hidden="true" />
                  新建会话
                </Button>
              </div>
              <div className="max-h-[calc(100vh-420px)] space-y-2 overflow-y-auto pr-1">
                {sessions.map((session) => {
                  const selected = currentSession?.id === session.id;
                  return (
                    <button
                      key={session.id}
                      type="button"
                      onClick={() => openSession(session)}
                      className={`w-full cursor-pointer rounded-xl border p-3 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-600 ${selected ? 'border-blue-500 bg-blue-50' : 'border-slate-200 bg-white hover:border-blue-300 hover:bg-blue-50/40'}`}
                    >
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0">
                          <div className="truncate text-sm font-semibold text-slate-900">{session.title}</div>
                          <div className="mt-1 truncate text-xs text-slate-600">{session.selected_model_name || '系统默认模型'}</div>
                        </div>
                        {loadingSessionId === session.id && <Badge variant="secondary">加载</Badge>}
                      </div>
                      <div className="mt-2 flex items-center gap-1 text-xs text-slate-500">
                        <Clock3 size={13} aria-hidden="true" />
                        {formatTime(session.last_message_time || session.update_time)}
                      </div>
                    </button>
                  );
                })}
                {sessions.length === 0 && <div className="rounded-xl border border-dashed border-slate-300 p-4 text-sm text-slate-600">暂无会话，创建一个会话开始使用 Agent。</div>}
              </div>
            </CardContent>
          </Card>

          <Card className="flex min-h-[680px] flex-col overflow-hidden">
            <CardHeader className="border-b border-slate-100">
              <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
                <div>
                  <CardTitle className="flex items-center gap-2">
                    <Bot size={18} className="text-blue-600" aria-hidden="true" />
                    {currentSession?.title || '请选择或新建会话'}
                  </CardTitle>
                  <p className="mt-1 text-sm text-slate-600">{currentSession ? '消息会进入 LangGraph Runtime，并生成可追踪执行记录。' : '左侧选择会话后开始对话。'}</p>
                </div>
                {currentSession && (
                  <div className="w-full lg:w-72">
                    <Select value={currentSession.selected_model_name || ''} onValueChange={selectModel}>
                      <SelectTrigger><SelectValue placeholder="选择模型" /></SelectTrigger>
                      <SelectContent>
                        {models.map((model) => (
                          <SelectItem key={`${model.source}-${model.model_name}`} value={model.model_name}>{model.model_name}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                )}
              </div>
            </CardHeader>
            <CardContent className="flex min-h-0 flex-1 flex-col p-4">
              {errorMessage && (
                <div role="alert" className="mb-3 flex gap-2 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">
                  <AlertCircle size={16} className="mt-0.5 shrink-0" aria-hidden="true" />
                  <span>{errorMessage}</span>
                </div>
              )}
              <div className="min-h-0 flex-1 space-y-4 overflow-y-auto rounded-xl border border-slate-200 bg-slate-50 p-4">
                {messages.map((message) => {
                  const isUser = message.role === 'user';
                  return (
                    <div key={message.id} className={`flex ${isUser ? 'justify-end' : 'justify-start'}`}>
                      <div className={`max-w-[82%] rounded-2xl px-4 py-3 text-sm ${isUser ? 'bg-blue-600 text-white' : 'border border-slate-200 bg-white text-slate-900'}`}>
                        <div className="mb-2 flex items-center gap-2 text-xs font-semibold opacity-80">
                          {isUser ? <UserRound size={14} aria-hidden="true" /> : <Bot size={14} aria-hidden="true" />}
                          {isUser ? '你' : 'Agent'}
                          {message.model_name && <span>· {message.model_name}</span>}
                        </div>
                        <div className="space-y-2 whitespace-pre-wrap leading-6">
                          {(message.content.blocks || []).map((block, index) => <div key={index}>{blockText(block)}</div>)}
                        </div>
                        {message.token_count ? <div className="mt-2 text-xs opacity-70">tokens: {message.token_count}</div> : null}
                      </div>
                    </div>
                  );
                })}
                {currentSession && messages.length === 0 && (
                  <div className="flex h-full min-h-[260px] items-center justify-center">
                    <div className="max-w-sm text-center">
                      <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-2xl bg-blue-100 text-blue-700">
                        <Sparkles size={22} aria-hidden="true" />
                      </div>
                      <div className="mt-4 font-semibold text-slate-900">发送第一条消息开始执行</div>
                      <p className="mt-2 text-sm leading-6 text-slate-600">可以让 Agent 分析岗位、生成评估思路或整理候选人筛选策略。</p>
                    </div>
                  </div>
                )}
                {!currentSession && (
                  <div className="flex h-full min-h-[260px] items-center justify-center text-sm text-slate-600">请选择左侧会话或新建会话。</div>
                )}
              </div>
              <form className="mt-4 flex flex-col gap-3 lg:flex-row" onSubmit={sendMessage}>
                <Textarea value={input} onChange={(event) => setInput(event.target.value)} className="min-h-[76px] flex-1" placeholder="输入任务，例如：帮我分析这个岗位的候选人评估策略" disabled={!currentSession || sending} aria-label="Agent 消息输入" />
                <Button type="submit" className="lg:w-28" disabled={!currentSession || sending || !input.trim()}>
                  <Send size={15} className="mr-1" aria-hidden="true" />
                  {sending ? '发送中' : '发送'}
                </Button>
              </form>
            </CardContent>
          </Card>

          <Card className="overflow-hidden">
            <CardHeader className="border-b border-slate-100">
              <CardTitle className="flex items-center gap-2">
                <Activity size={18} className="text-blue-600" aria-hidden="true" />
                上下文与 Trace
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4 p-4">
              <div className="rounded-xl border border-blue-100 bg-blue-50 p-4">
                <div className="flex items-center gap-2 text-sm font-semibold text-blue-900">
                  <Hash size={15} aria-hidden="true" />
                  Prompt Prefix Cache
                </div>
                <div className="mt-2 break-all rounded-lg bg-white/70 p-2 font-mono text-xs text-blue-800">
                  {sessionWindow?.prompt_prefix_hash ? sessionWindow.prompt_prefix_hash.slice(0, 24) : '未生成'}
                </div>
                <div className="mt-2 flex items-center justify-between text-xs text-blue-700">
                  <span>Window Token: {sessionWindow?.token_count ?? 0}</span>
                </div>
              </div>
              <div className="rounded-xl border border-slate-200 bg-white p-4">
                <div className="mb-3 flex items-center justify-between">
                  <div className="flex items-center gap-2 text-sm font-semibold text-slate-900">
                    <Brain size={15} className="text-blue-600" aria-hidden="true" />
                    长期记忆
                  </div>
                  <Badge variant="outline">{memories.length}</Badge>
                </div>
                <div className="space-y-2">
                  {memories.slice(0, 3).map((memory) => (
                    <div key={memory.id} className="rounded-lg bg-slate-50 p-2 text-xs leading-5 text-slate-700">
                      <div className="mb-1 font-semibold text-slate-900">{memory.memory_type}</div>
                      {memory.content}
                    </div>
                  ))}
                  {memories.length === 0 && <div className="text-xs text-slate-500">暂无记忆。包含“记住/偏好/以后/习惯”的输入会沉淀为员工记忆。</div>}
                </div>
              </div>
              <div className="rounded-xl border border-slate-200 bg-white p-4">
                <div className="mb-3 flex items-center justify-between">
                  <div className="flex items-center gap-2 text-sm font-semibold text-slate-900">
                    <Archive size={15} className="text-blue-600" aria-hidden="true" />
                    Context Snapshot
                  </div>
                  <Badge variant="outline">{snapshots.length}</Badge>
                </div>
                {snapshots[0] ? (
                  <div className="rounded-lg bg-slate-50 p-2 text-xs leading-5 text-slate-700">
                    <div className="mb-1 font-semibold text-slate-900">v{snapshots[0].snapshot_version} · {snapshots[0].message_count} 条消息</div>
                    <div className="line-clamp-4 whitespace-pre-wrap">{snapshots[0].summary_text}</div>
                  </div>
                ) : (
                  <div className="text-xs text-slate-500">消息达到阈值后会自动压缩历史并生成快照。</div>
                )}
              </div>
              <div className="rounded-xl border border-slate-200 bg-slate-50 p-4">
                <div className="flex items-center justify-between text-sm">
                  <span className="text-slate-600">最近运行</span>
                  <Badge variant={latestRun?.status === 2 ? 'success' : latestRun?.status === 3 ? 'danger' : 'secondary'}>{latestRun ? runStatusLabel[latestRun.status] || '未知' : '暂无'}</Badge>
                </div>
                <div className="mt-3 grid grid-cols-2 gap-3">
                  <div>
                    <div className="text-xs text-slate-500">延迟</div>
                    <div className="mt-1 text-lg font-bold text-slate-900">{latestRun?.latency_ms ?? 0}ms</div>
                  </div>
                  <div>
                    <div className="text-xs text-slate-500">Token</div>
                    <div className="mt-1 text-lg font-bold text-slate-900">{latestRun?.total_tokens ?? 0}</div>
                  </div>
                </div>
              </div>
              <div className="max-h-[calc(100vh-430px)] space-y-3 overflow-y-auto pr-1">
                {runs.map((run) => (
                  <div key={run.id} className="rounded-xl border border-slate-200 bg-white p-4">
                    <div className="flex items-center justify-between gap-2">
                      <Badge variant={run.status === 2 ? 'success' : run.status === 3 ? 'danger' : 'secondary'}>{runStatusLabel[run.status] || run.run_type}</Badge>
                      <span className="text-xs text-slate-500">#{run.trace_id.slice(0, 8)}</span>
                    </div>
                    <div className="mt-3 flex items-center gap-2 text-sm font-semibold text-slate-900">
                      <Cpu size={15} aria-hidden="true" />
                      <span className="truncate">{run.model_name || '等待模型响应'}</span>
                    </div>
                    <div className="mt-3 grid grid-cols-3 gap-2 text-xs text-slate-600">
                      <div className="rounded-lg bg-slate-50 p-2">
                        <div>Prompt</div>
                        <div className="mt-1 font-semibold text-slate-900">{run.prompt_tokens}</div>
                      </div>
                      <div className="rounded-lg bg-slate-50 p-2">
                        <div>Completion</div>
                        <div className="mt-1 font-semibold text-slate-900">{run.completion_tokens}</div>
                      </div>
                      <div className="rounded-lg bg-slate-50 p-2">
                        <div>Latency</div>
                        <div className="mt-1 font-semibold text-slate-900">{run.latency_ms ?? 0}</div>
                      </div>
                    </div>
                    {run.error_message && (
                      <div className="mt-3 flex gap-2 rounded-lg border border-red-200 bg-red-50 p-2 text-xs text-red-700">
                        <AlertCircle size={14} className="shrink-0" aria-hidden="true" />
                        <span>{run.error_message}</span>
                      </div>
                    )}
                  </div>
                ))}
                {runs.length === 0 && (
                  <div className="rounded-xl border border-dashed border-slate-300 p-6 text-sm text-slate-600">
                    <CheckCircle2 size={18} className="mb-2 text-slate-500" aria-hidden="true" />
                    暂无执行记录，发送消息后将在这里查看 Trace。
                  </div>
                )}
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
    </AdminLayout>
  );
}
