/**
 * AgentComposer：浮卡式输入区
 *
 * 跨模式确认：当存在消息且切换 workflow，弹确认 → 自动新建会话。
 * 上传反馈：uploading→success→idle 三态明显。
 * 思考模式：开启=深紫，关闭=灰，textarea placeholder 跟随状态。
 * 空态填充：通过 prefilledPrompt 接收 EmptyState 的提示。
 */

import { useEffect, useRef, useState } from 'react';
import { Paperclip, Send, Square, Sparkles, X, Check, Loader2, AlertCircle } from 'lucide-react';
import type { WorkflowType, WorkspaceSession } from '@/types/agent';
import { WORKFLOW_LABELS } from '@/types/agent';
import { employeeAgentApi } from '@/api/employee/agent';
import { AgentModelPicker } from './agent-model-picker';

export interface AgentComposerProps {
  session: WorkspaceSession;
  sending: boolean;
  hasMessages: boolean;
  prefilledPrompt: string | null;
  onPrefillConsumed: () => void;
  onSend: (input: {
    content: string;
    workflow_type: WorkflowType;
    context_refs?: Array<Record<string, unknown>>;
  }) => void;
  onAbort: () => void;
  onSessionUpdate: (next: WorkspaceSession) => void;
  onRequestNewSession: (workflow: WorkflowType) => Promise<void>;
}

const WORKFLOWS: WorkflowType[] = ['interview_questions', 'resume_evaluation'];

type UploadState =
  | { kind: 'idle' }
  | { kind: 'uploading'; fileName: string }
  | { kind: 'success'; resumeId: number; fileName: string; size: number }
  | { kind: 'error'; message: string };

export function AgentComposer({
  session, sending, hasMessages, prefilledPrompt, onPrefillConsumed,
  onSend, onAbort, onSessionUpdate, onRequestNewSession,
}: AgentComposerProps) {
  const [content, setContent] = useState('');
  const [workflow, setWorkflow] = useState<WorkflowType>('interview_questions');
  const [upload, setUpload] = useState<UploadState>({ kind: 'idle' });
  const [focused, setFocused] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // 接收 EmptyState 的提示词
  useEffect(() => {
    if (prefilledPrompt !== null) {
      setContent(prefilledPrompt);
      onPrefillConsumed();
      // 等下一帧再 focus 以保证内容已渲染
      requestAnimationFrame(() => textareaRef.current?.focus());
    }
  }, [prefilledPrompt, onPrefillConsumed]);

  // textarea 自适应高度
  useEffect(() => {
    const ta = textareaRef.current;
    if (!ta) return;
    ta.style.height = 'auto';
    ta.style.height = Math.min(ta.scrollHeight, 160) + 'px';
  }, [content]);

  const submit = () => {
    const trimmed = content.trim();
    if (!trimmed || sending) return;
    const ctxRefs = upload.kind === 'success'
      ? [{ type: 'resume', resume_id: upload.resumeId, file_name: upload.fileName }]
      : undefined;
    onSend({ content: trimmed, workflow_type: workflow, context_refs: ctxRefs });
    setContent('');
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
      e.preventDefault();
      submit();
    }
  };

  const toggleThinking = async () => {
    const next = !session.enable_thinking;
    await employeeAgentApi.setThinking(session.id, next);
    onSessionUpdate({ ...session, enable_thinking: next });
  };

  const onPickFile = async (file: File) => {
    setUpload({ kind: 'uploading', fileName: file.name });
    try {
      const resp = await employeeAgentApi.uploadResume(session.id, file);
      const data = resp.data?.data ?? resp.data;
      if (data?.resume_id) {
        setUpload({
          kind: 'success',
          resumeId: data.resume_id,
          fileName: data.file_name ?? file.name,
          size: file.size,
        });
      } else {
        setUpload({ kind: 'error', message: '上传失败：响应缺少 resume_id' });
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : '上传失败';
      setUpload({ kind: 'error', message: msg });
    }
  };

  const handleWorkflowClick = async (next: WorkflowType) => {
    if (next === workflow) return;
    if (hasMessages) {
      const ok = window.confirm(
        '切换到不同模式将创建一个新会话来保持上下文整洁，是否继续？',
      );
      if (!ok) return;
      await onRequestNewSession(next);
      setWorkflow(next);
    } else {
      setWorkflow(next);
    }
  };

  const placeholderText = session.enable_thinking
    ? '深度思考模式已开启 · 输入消息…'
    : '输入消息…';

  return (
    <div className="sticky bottom-0 bg-gradient-to-t from-[#F8FAFC] via-[#F8FAFC]/95 to-transparent pt-4 pb-6 px-4">
      <div
        className={`mx-auto max-w-[880px] rounded-2xl bg-white border shadow-lg
                    transition-shadow duration-220
                    ${focused ? 'ring-3 ring-[#0EA5E9]/25 border-[#0EA5E9]' : 'border-[#E2E8F0] shadow-black/10'}`}
      >
        {/* 顶栏 */}
        <div className="flex items-center justify-between px-4 pt-3 pb-2 border-b border-[#E2E8F0]">
          <div className="inline-flex rounded-full bg-[#F1F5F9] p-0.5 gap-0.5">
            {WORKFLOWS.map(wf => (
              <button
                key={wf}
                type="button"
                onClick={() => void handleWorkflowClick(wf)}
                className={`relative px-3 h-7 rounded-full text-xs font-medium transition-all duration-150 ${
                  workflow === wf
                    ? 'bg-white text-[#020617] shadow-sm'
                    : 'text-[#64748B] hover:text-[#334155]'
                }`}
              >
                {WORKFLOW_LABELS[wf]}
              </button>
            ))}
          </div>
          <div className="flex items-center gap-2">
            {/* 模型选择：懒加载 /llm-model-options，更换后立即同步会话状态 */}
            <AgentModelPicker session={session} onSessionUpdate={onSessionUpdate} />
            <button
              type="button"
              onClick={() => void toggleThinking()}
              aria-pressed={session.enable_thinking}
              title={session.enable_thinking ? '点击关闭思考模式' : '点击开启思考模式（更慢但更深入）'}
              className={`flex items-center gap-1.5 h-7 px-3 rounded-full text-xs font-medium
                          transition-all duration-150 ${
                session.enable_thinking
                  ? 'bg-[#7C3AED] text-white shadow-sm shadow-purple-300'
                  : 'bg-[#F1F5F9] text-[#94A3B8] hover:bg-[#E8ECF1] hover:text-[#64748B]'
              }`}
            >
              <Sparkles size={12} className={session.enable_thinking ? 'fill-white' : ''} />
              <span>{session.enable_thinking ? '深度思考·开' : '深度思考·关'}</span>
            </button>
          </div>
        </div>

        {/* 上传反馈 chip */}
        {upload.kind !== 'idle' && (
          <div className="px-4 pt-2">
            <UploadChip state={upload} onClear={() => setUpload({ kind: 'idle' })} />
          </div>
        )}

        {/* textarea */}
        <div className="px-4 py-2">
          <textarea
            ref={textareaRef}
            value={content}
            onChange={e => setContent(e.target.value)}
            onKeyDown={onKeyDown}
            onFocus={() => setFocused(true)}
            onBlur={() => setFocused(false)}
            rows={1}
            placeholder={placeholderText}
            className="w-full resize-none border-none outline-none text-sm leading-relaxed
                       text-[#020617] placeholder:text-[#94A3B8]
                       min-h-[48px] max-h-[160px]
                       bg-transparent"
          />
        </div>

        {/* 底栏 */}
        <div className="flex items-center justify-between px-4 pb-3 pt-1">
          <div>
            <button type="button" onClick={() => fileInputRef.current?.click()}
                    disabled={upload.kind === 'uploading'}
                    className="inline-flex items-center gap-1 h-8 px-2 rounded-md text-xs
                               text-[#64748B] hover:text-[#0369A1] hover:bg-[#F1F5F9]
                               disabled:opacity-50 disabled:cursor-not-allowed
                               transition-colors">
              <Paperclip size={13} />
              <span className="hidden sm:inline">附简历</span>
            </button>
            <input ref={fileInputRef} type="file" accept=".pdf,.docx,.doc" className="hidden"
                   onChange={e => { const f = e.target.files?.[0]; if (f) void onPickFile(f); e.target.value = ''; }} />
          </div>

          <span className="hidden sm:block text-[11px] text-[#94A3B8]">Ctrl+Enter 发送</span>

          {/* 主操作按钮 morph：运行中变红色"停止"，否则蓝色"发送" */}
          <button
            type="button"
            onClick={sending ? onAbort : submit}
            disabled={!sending && !content.trim()}
            className={`h-9 px-5 rounded-lg text-xs font-medium transition-all active:scale-[0.97]
                        inline-flex items-center gap-1.5 ${
              sending
                ? 'border border-[#DC2626] text-[#DC2626] hover:bg-[#FEE2E2] bg-white'
                : 'bg-[#0369A1] text-white hover:bg-[#0EA5E9] disabled:opacity-40 disabled:cursor-not-allowed'
            }`}
          >
            {sending ? <Square size={13} className="fill-current" /> : <Send size={13} />}
            <span>{sending ? '停止' : '发送'}</span>
          </button>
        </div>
      </div>
    </div>
  );
}

/** 上传反馈 chip — 三态视觉强对比 */
function UploadChip({
  state,
  onClear,
}: {
  state: UploadState;
  onClear: () => void;
}) {
  if (state.kind === 'uploading') {
    return (
      <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-lg
                      bg-[#FEF3C7] text-[#92400E] text-xs">
        <Loader2 size={12} className="animate-spin" />
        <span className="truncate max-w-[280px]">上传中… {state.fileName}</span>
      </div>
    );
  }
  if (state.kind === 'success') {
    return (
      <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-lg
                      bg-[#E0F2FE] text-[#0369A1] text-xs font-medium border border-[#0EA5E9]/20">
        <Check size={12} className="text-[#16A34A]" />
        <span className="truncate max-w-[260px]">已附上 · {state.fileName}</span>
        <span className="text-[#64748B] font-normal">{(state.size / 1024).toFixed(0)} KB</span>
        <button type="button" onClick={onClear}
                className="ml-1 hover:text-[#DC2626] transition-colors" title="移除附件">
          <X size={12} />
        </button>
      </div>
    );
  }
  if (state.kind === 'error') {
    return (
      <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-lg
                      bg-[#FEE2E2] text-[#DC2626] text-xs">
        <AlertCircle size={12} />
        <span className="truncate max-w-[300px]">{state.message}</span>
        <button type="button" onClick={onClear}
                className="ml-1 hover:underline" title="清除">
          <X size={12} />
        </button>
      </div>
    );
  }
  return null;
}
