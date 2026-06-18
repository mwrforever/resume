/**
 * AgentComposer：浮卡式输入区
 *
 * 跨模式确认：当存在消息且切换 workflow，弹确认 → 自动新建会话。
 * 上传反馈：uploading→success→idle 三态明显。
 * 思考模式：开启=深紫，关闭=灰，textarea placeholder 跟随状态。
 * 空态填充：通过 prefilledPrompt 接收 EmptyState 的提示。
 */

import { useEffect, useRef, useState } from 'react';
import { Paperclip, Send, Square, Sparkles, X, Loader2, AlertCircle } from 'lucide-react';
import type { WorkflowType, WorkspaceSession } from '@/types/agent';
import { WORKFLOW_LABELS } from '@/types/agent';
import { employeeAgentApi } from '@/api/employee/agent';
import { AgentModelPicker } from './agent-model-picker';
import { ResumeFileIcon } from './resume-file-icon';

export interface AgentComposerProps {
  session: WorkspaceSession;
  sending: boolean;
  /** 是否处于人机交互等待（pending interaction block）。
   *  此时流程已暂停等用户输入，输入框不显示"停止/进行中"，应可正常输入新指令。 */
  hasPendingInteraction: boolean;
  /** 最近一条消息的 workflow_type；用于回显当前会话已选模式（空会话回退默认值） */
  lastWorkflow: WorkflowType;
  /** 空态快捷问答回填：prompt 必填，workflow 可选（联动切换模式） */
  prefill: { prompt: string; workflow?: WorkflowType } | null;
  onPrefillConsumed: () => void;
  onSend: (input: {
    content: string;
    workflow_type: WorkflowType;
    context_refs?: Array<Record<string, unknown>>;
  }) => void;
  onAbort: () => void;
  /** 切换思考模式：空会话由 store 写全局默认+会话，中途会话仅写会话 */
  onToggleThinking: () => void;
  /** 选择模型：空会话由 store 写全局默认+会话，中途会话仅写会话 */
  onPickModel: (modelName: string | null) => void;
  /** 当前会话是否为空（无消息）：用于思考按钮/模型按钮 tooltip 区分作用域 */
  isEmptySession: boolean;
}

const WORKFLOWS: WorkflowType[] = ['interview_questions', 'resume_evaluation'];

type UploadState =
  | { kind: 'idle' }
  | { kind: 'uploading'; fileName: string }
  | { kind: 'success'; file_path: string; fileName: string }
  | { kind: 'error'; message: string };

export function AgentComposer({
  session, sending, hasPendingInteraction, lastWorkflow, prefill, onPrefillConsumed,
  onSend, onAbort, onToggleThinking, onPickModel, isEmptySession,
}: AgentComposerProps) {
  // sending=true 时（含人机交互等待）按钮显示红色"停止"可终止；
  // 但纯流式运行中（非交互等待）禁用输入框，避免并发触发第二条流。
  // 人机交互等待时流程已暂停，允许输入新指令（如补充需求/换思路）。
  const inputLocked = sending && !hasPendingInteraction;
  const [content, setContent] = useState('');
  // 初始模式取最近一条消息的 workflow_type；空会话回退默认 interview_questions。
  // WorkspaceInner 的 key={sessionId} 保证切会话时重挂载，useState 初值按会话回显正确模式，
  // 不会用上一个会话的模式覆盖当前会话（多会话模式隔离）。
  const [workflow, setWorkflow] = useState<WorkflowType>(lastWorkflow);
  const [upload, setUpload] = useState<UploadState>({ kind: 'idle' });
  const [focused, setFocused] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // 接收 EmptyState 的提示词（可携带 workflow，联动切换 Composer 模式）
  useEffect(() => {
    if (prefill !== null) {
      setContent(prefill.prompt);
      // 评估类问答携带 workflow_type → 切换到对应模式，保证发送时路由正确
      if (prefill.workflow) setWorkflow(prefill.workflow);
      onPrefillConsumed();
      // 等下一帧再 focus 以保证内容已渲染
      requestAnimationFrame(() => textareaRef.current?.focus());
    }
  }, [prefill, onPrefillConsumed]);

  // textarea 自适应高度
  useEffect(() => {
    const ta = textareaRef.current;
    if (!ta) return;
    ta.style.height = 'auto';
    ta.style.height = Math.min(ta.scrollHeight, 160) + 'px';
  }, [content]);

  const submit = () => {
    const trimmed = content.trim();
    // 纯运行中禁发；人机交互等待时允许发送（流程已暂停）
    if (!trimmed || inputLocked) return;
    const ctxRefs = upload.kind === 'success'
      ? [{ type: 'resume', file_path: upload.file_path, file_name: upload.fileName }]
      : undefined;
    onSend({ content: trimmed, workflow_type: workflow, context_refs: ctxRefs });
    setContent('');
    // 发送后清除附件展示，避免脏携带到下一条消息
    setUpload({ kind: 'idle' });
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
      e.preventDefault();
      submit();
    }
  };

  const toggleThinking = () => {
    // 空会话（无消息）切换 = 调整全局默认（且同步当前会话）；
    // 中途会话切换 = 仅调当前会话。区分逻辑在 store.toggleThinking 内，
    // composer 只负责触发；状态挂在 session 上，多会话并发不会串台。
    onToggleThinking();
  };

  const onPickFile = async (file: File) => {
    setUpload({ kind: 'uploading', fileName: file.name });
    try {
      const resp = await employeeAgentApi.uploadResume(file);
      const data = resp.data?.data ?? resp.data;
      if (data?.file_path) {
        setUpload({
          kind: 'success',
          file_path: data.file_path,
          fileName: data.file_name ?? file.name,
        });
      } else {
        setUpload({ kind: 'error', message: '上传失败：响应缺少 file_path' });
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : '上传失败';
      setUpload({ kind: 'error', message: msg });
    }
  };

  const handleWorkflowClick = (next: WorkflowType) => {
    if (next === workflow) return;
    // workflow 仅随本次发送的消息走，不绑定会话；直接切换模式标签即可，不强制新建会话
    setWorkflow(next);
  };

  const placeholderText = session.enable_thinking
    ? '深度思考模式已开启 · 输入消息…'
    : '输入消息…';

  return (
    <div className="sticky bottom-0 bg-gradient-to-t from-[#F8FAFC] via-[#F8FAFC]/95 to-transparent pt-4 pb-6 px-4">
      <div
        className={`mx-auto max-w-[880px] rounded-2xl bg-white border shadow-lg
                    transition-all duration-220 ease-[cubic-bezier(0.16,1,0.3,1)]
                    ${focused
                      ? 'ring-3 ring-[#0EA5E9]/20 border-[#0EA5E9] shadow-[0_1px_3px_rgba(2,6,23,0.05),0_16px_40px_-16px_rgba(3,105,161,0.22)]'
                      : 'border-[#E2E8F0] shadow-[0_1px_2px_rgba(2,6,23,0.04),0_8px_24px_-12px_rgba(2,6,23,0.10)]'}`}
      >
        {/* 顶栏 */}
        <div className="flex items-center justify-between px-4 pt-3 pb-2 border-b border-[#E2E8F0]">
          <div className="inline-flex rounded-full bg-[#F1F5F9] p-0.5 gap-0.5">
            {WORKFLOWS.map(wf => (
              <button
                key={wf}
                type="button"
                onClick={() => handleWorkflowClick(wf)}
                className={`relative px-3 h-7 rounded-full text-xs font-medium
                            transition-all duration-150 active:scale-[0.96] ${
                  workflow === wf
                    ? 'bg-white text-[#020617] shadow-sm ring-1 ring-black/[0.04]'
                    : 'text-[#64748B] hover:text-[#334155]'
                }`}
              >
                {WORKFLOW_LABELS[wf]}
              </button>
            ))}
          </div>
          <div className="flex items-center gap-2">
            {/* 模型选择：懒加载 /llm-model-options，走 store.selectModel（空会话写全局+会话） */}
            <AgentModelPicker
              session={session}
              onPickModel={onPickModel}
              isEmptySession={isEmptySession}
            />
            <button
              type="button"
              onClick={toggleThinking}
              aria-pressed={session.enable_thinking}
              title={
                isEmptySession
                  ? (session.enable_thinking ? '关闭思考模式（将设为新建会话的默认）' : '开启思考模式（将设为新建会话的默认，更慢但更深入）')
                  : (session.enable_thinking ? '关闭当前会话的思考模式' : '开启当前会话的思考模式（更慢但更深入）')
              }
              className={`flex items-center gap-1.5 h-7 px-3 rounded-full text-xs font-medium
                          transition-all duration-150 active:scale-[0.96] ${
                session.enable_thinking
                  ? 'bg-[#7C3AED] text-white shadow-sm shadow-purple-300/60'
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
                               active:scale-[0.97]
                               disabled:opacity-50 disabled:cursor-not-allowed
                               transition-colors">
              <Paperclip size={13} />
              <span className="hidden sm:inline">附简历</span>
            </button>
            <input ref={fileInputRef} type="file" accept=".pdf,.docx,.doc" className="hidden"
                   onChange={e => { const f = e.target.files?.[0]; if (f) void onPickFile(f); e.target.value = ''; }} />
          </div>

          <span className="hidden sm:block text-[11px] text-[#94A3B8]">Ctrl+Enter 发送</span>

          {/* 主操作按钮 morph：sending 时（含人机交互等待）红色"停止"可终止，否则蓝色"发送"。
              停止按钮始终可点；发送按钮仅在空内容时禁用。 */}
          <button
            type="button"
            onClick={sending ? onAbort : submit}
            disabled={!sending && !content.trim()}
            className={`h-9 px-5 rounded-lg text-xs font-semibold transition-all active:scale-[0.97]
                        inline-flex items-center gap-1.5 ${
              sending
                ? 'border border-[#DC2626] text-[#DC2626] hover:bg-[#FEE2E2] bg-white shadow-[0_2px_8px_-3px_rgba(220,38,38,0.35)]'
                : 'bg-gradient-to-b from-[#0EA5E9] to-[#0369A1] text-white ring-1 ring-inset ring-white/15 shadow-[0_4px_12px_-4px_rgba(3,105,161,0.5)] hover:shadow-[0_6px_16px_-4px_rgba(3,105,161,0.55)] disabled:opacity-40 disabled:cursor-not-allowed disabled:shadow-none'
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
        <ResumeFileIcon fileName={state.fileName} size={16} />
        <span className="truncate max-w-[260px]">已附上 · {state.fileName}</span>
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
