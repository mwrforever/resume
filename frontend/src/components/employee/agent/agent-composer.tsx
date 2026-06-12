/**
 * AgentComposer：底部输入区。
 *
 * - 顶栏：workflow 分段切换 + 简历附件 chip
 * - 中部：textarea 自动伸缩，max 200px
 * - 底栏：思考开关 + 发送（Ctrl+Enter）
 */

import { useEffect, useRef, useState } from 'react';
import { Paperclip, Send, Sparkles, X } from 'lucide-react';
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
  const [resumeChip, setResumeChip] = useState<{ resume_id: number; file_name: string } | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // textarea 自适应高度
  useEffect(() => {
    const ta = textareaRef.current;
    if (!ta) return;
    ta.style.height = 'auto';
    ta.style.height = Math.min(ta.scrollHeight, 200) + 'px';
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

  /** 切换思考模式 */
  const toggleThinking = async () => {
    const next = !session.enable_thinking;
    await employeeAgentApi.setThinking(session.id, next);
    onSessionUpdate({ ...session, enable_thinking: next });
  };

  /** 选择简历附件 */
  const onPickFile = async (file: File) => {
    const resp = await employeeAgentApi.uploadResume(session.id, file);
    const data = resp.data?.data ?? resp.data;
    if (data?.resume_id) {
      setResumeChip({ resume_id: data.resume_id, file_name: data.file_name ?? file.name });
    }
  };

  return (
    <div className="sticky bottom-0 border-t border-gray-200 bg-white">
      <div className="mx-auto max-w-[760px] px-4 py-3">
        {/* 顶栏：workflow 切换 + 附件 */}
        <div className="flex items-center gap-2 mb-2">
          <WorkflowSwitcher value={workflow} onChange={setWorkflow} />
          <button type="button" onClick={() => fileInputRef.current?.click()}
                  aria-label="附加简历"
                  className="ml-auto flex items-center gap-1 text-xs text-gray-500 hover:text-blue-600 transition-colors">
            <Paperclip size={12} /> 附简历
          </button>
          <input ref={fileInputRef} type="file" accept=".pdf,.docx,.doc" className="hidden"
                 onChange={e => { const f = e.target.files?.[0]; if (f) void onPickFile(f); e.target.value = ''; }} />
        </div>

        {/* 简历附件 chip */}
        {resumeChip && (
          <div className="mb-2 inline-flex items-center gap-2 px-2 py-1 rounded bg-gray-100 text-xs text-gray-600">
            <Paperclip size={11} /> {resumeChip.file_name}
            <button type="button" onClick={() => setResumeChip(null)} aria-label="移除简历附件"
                    className="hover:text-red-500">
              <X size={12} />
            </button>
          </div>
        )}

        {/* textarea */}
        <textarea
          ref={textareaRef} value={content} onChange={e => setContent(e.target.value)} onKeyDown={onKeyDown}
          rows={1}
          placeholder="输入消息…(Ctrl+Enter 发送)"
          className="w-full resize-none rounded border border-gray-300 px-3 py-2 text-sm leading-relaxed focus:outline-none focus:ring-2 focus:ring-blue-200 transition-shadow"
        />

        {/* 底栏：思考开关 + 发送 */}
        <div className="mt-2 flex items-center justify-between">
          <button type="button" onClick={() => void toggleThinking()}
                  aria-pressed={session.enable_thinking}
                  className={`flex items-center gap-1 h-8 px-3 rounded-full text-xs transition-all ${
                    session.enable_thinking
                      ? 'bg-purple-50 text-purple-700 border border-purple-200'
                      : 'text-gray-500 hover:bg-gray-100'
                  }`}>
            <Sparkles size={12} />
            思考模式 {session.enable_thinking ? '已开' : '关闭'}
          </button>

          <div className="flex gap-2">
            {sending && (
              <button type="button" onClick={onAbort}
                      className="h-9 px-3 rounded border border-gray-300 text-xs text-gray-500 hover:bg-gray-100 transition-colors">
                取消
              </button>
            )}
            <button type="button" onClick={submit} disabled={!content.trim() || sending}
                    className="h-9 px-4 rounded bg-blue-600 text-white text-xs font-medium hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition-all active:scale-[0.97]">
              <span className="inline-flex items-center gap-1">
                <Send size={13} /> 发送
              </span>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

/** Workflow 分段按钮 */
function WorkflowSwitcher({ value, onChange }: { value: WorkflowType; onChange: (v: WorkflowType) => void }) {
  return (
    <div className="relative inline-flex rounded-full bg-gray-100 p-0.5 text-xs">
      {WORKFLOWS.map(wf => (
        <button key={wf} type="button" onClick={() => onChange(wf)}
                className={`relative z-10 px-3 h-7 rounded-full transition-colors ${
                  value === wf ? 'text-white' : 'text-gray-500 hover:text-gray-800'
                }`}>
          {WORKFLOW_LABELS[wf]}
          {value === wf && (
            <span className="absolute inset-0 -z-10 rounded-full bg-blue-600" aria-hidden="true" />
          )}
        </button>
      ))}
    </div>
  );
}
