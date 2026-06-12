/**
 * AgentComposer：浮卡式输入区（重设计）
 *
 * 外层：sticky 底部 + 渐变蒙版
 * 内层：max-w-[880px] 白色浮卡，rounded-2xl shadow-lg
 * 顶栏：workflow pill 切换 + 思考模式 chip
 * textarea：auto-resize，无边框，由卡片统一样式
 * 底栏：附件按钮 + 快捷键提示 + 发送/停止
 */

import { useEffect, useRef, useState } from 'react';
import { Paperclip, Send, Square, Sparkles, X } from 'lucide-react';
import type { WorkflowType, WorkspaceSession } from '@/types/agent';
import { WORKFLOW_LABELS } from '@/types/agent';
import { employeeAgentApi } from '@/api/employee/agent';

export interface AgentComposerProps {
  session: WorkspaceSession;
  sending: boolean;
  onSend: (input: {
    content: string;
    workflow_type: WorkflowType;
    context_refs?: Array<Record<string, unknown>>;
  }) => void;
  onAbort: () => void;
  onSessionUpdate: (next: WorkspaceSession) => void;
}

const WORKFLOWS: WorkflowType[] = ['interview_questions', 'resume_evaluation'];

export function AgentComposer({ session, sending, onSend, onAbort, onSessionUpdate }: AgentComposerProps) {
  const [content, setContent] = useState('');
  const [workflow, setWorkflow] = useState<WorkflowType>('interview_questions');
  const [resumeChip, setResumeChip] = useState<{ resume_id: number; file_name: string; size?: number } | null>(null);
  const [focused, setFocused] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const cardRef = useRef<HTMLDivElement>(null);

  // textarea 自适应
  useEffect(() => {
    const ta = textareaRef.current;
    if (!ta) return;
    ta.style.height = 'auto';
    ta.style.height = Math.min(ta.scrollHeight, 160) + 'px';
  }, [content]);

  const submit = () => {
    const trimmed = content.trim();
    if (!trimmed || sending) return;
    onSend({
      content: trimmed,
      workflow_type: workflow,
      context_refs: resumeChip
        ? [{ type: 'resume', resume_id: resumeChip.resume_id, file_name: resumeChip.file_name }]
        : undefined,
    });
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
    const resp = await employeeAgentApi.uploadResume(session.id, file);
    const data = resp.data?.data ?? resp.data;
    if (data?.resume_id) {
      setResumeChip({ resume_id: data.resume_id, file_name: data.file_name ?? file.name, size: file.size });
    }
  };

  return (
    <div className="sticky bottom-0 bg-gradient-to-t from-[#F8FAFC] via-[#F8FAFC]/95 to-transparent pt-4 pb-6 px-4">
      <div
        ref={cardRef}
        className={`mx-auto max-w-[880px] rounded-2xl bg-white border shadow-lg
                    transition-shadow duration-220
                    ${focused ? 'ring-3 ring-[#0EA5E9]/25 border-[#0EA5E9]' : 'border-[#E2E8F0] shadow-black/10'}`}
      >
        {/* 顶栏：workflow 切换 + 思考模式 */}
        <div className="flex items-center justify-between px-4 pt-3 pb-2 border-b border-[#E2E8F0]">
          <div className="inline-flex rounded-full bg-[#F1F5F9] p-0.5 gap-0.5">
            {WORKFLOWS.map(wf => (
              <button
                key={wf}
                type="button"
                onClick={() => setWorkflow(wf)}
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
          <button
            type="button"
            onClick={() => void toggleThinking()}
            aria-pressed={session.enable_thinking}
            className={`flex items-center gap-1 h-7 px-3 rounded-full text-xs transition-all duration-150 ${
              session.enable_thinking
                ? 'bg-[#F3E8FF] text-[#7C3AED] border border-[#7C3AED]/20'
                : 'text-[#94A3B8] hover:bg-[#F1F5F9]'
            }`}
          >
            <Sparkles size={12} />
            {session.enable_thinking ? '思考·开' : '思考'}
          </button>
        </div>

        {/* 简历附件 chip */}
        {resumeChip && (
          <div className="px-4 pt-2">
            <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-lg bg-[#F8FAFC] text-xs text-[#64748B]">
              <Paperclip size={12} />
              <span>{resumeChip.file_name}</span>
              {resumeChip.size && <span className="text-[#94A3B8]">· {(resumeChip.size / 1024).toFixed(0)} KB</span>}
              <button type="button" onClick={() => setResumeChip(null)}
                      className="ml-1 hover:text-[#DC2626] transition-colors">
                <X size={12} />
              </button>
            </div>
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
            placeholder="输入消息…"
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
                    className="inline-flex items-center gap-1 h-8 px-2 rounded-md text-xs
                               text-[#64748B] hover:text-[#0369A1] hover:bg-[#F1F5F9] transition-colors">
              <Paperclip size={13} />
              <span className="hidden sm:inline">附简历</span>
            </button>
            <input ref={fileInputRef} type="file" accept=".pdf,.docx,.doc" className="hidden"
                   onChange={e => { const f = e.target.files?.[0]; if (f) void onPickFile(f); e.target.value = ''; }} />
          </div>

          <span className="hidden sm:block text-[11px] text-[#94A3B8]">Ctrl+Enter 发送</span>

          <div className="flex items-center gap-2">
            {sending && (
              <button type="button" onClick={onAbort}
                      className="h-9 px-4 rounded-lg border border-[#E2E8F0] text-xs text-[#64748B]
                                 hover:bg-[#F1F5F9] transition-colors inline-flex items-center gap-1.5">
                <Square size={12} />
                <span>停止</span>
              </button>
            )}
            <button
              type="button"
              onClick={submit}
              disabled={!content.trim() || sending}
              className="h-9 px-5 rounded-lg bg-[#0369A1] text-white text-xs font-medium
                         hover:bg-[#0EA5E9] disabled:opacity-40 disabled:cursor-not-allowed
                         transition-all active:scale-[0.97] inline-flex items-center gap-1.5"
            >
              <Send size={13} />
              <span>发送</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
