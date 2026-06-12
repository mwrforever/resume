import { ChangeEvent, FormEvent, KeyboardEvent, useRef } from 'react';
import { FileUp, Send, Square, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import type { TAgentWorkflowType } from '@/types/agent';

interface AgentComposerProps {
  input: string;
  sending: boolean;
  /** 规划审批待处理时禁用输入 */
  disabled?: boolean;
  resumeFile: File | null;
  workflowType: TAgentWorkflowType;
  onWorkflowChange: (workflowType: TAgentWorkflowType) => void;
  onInputChange: (value: string) => void;
  onResumeFileChange: (file: File | null) => void;
  onSubmit: (event: FormEvent) => void;
  /** 终止当前流式请求 */
  onStop?: () => void;
}

const ACCEPT_RESUME = '.pdf,.docx,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document';

/**
 * Agent 消息输入区：支持文本与文件附件（PDF/DOCX）。
 * Enter 快捷发送，Shift + Enter 保持换行。
 */
export function AgentComposer({
  input,
  sending,
  disabled = false,
  resumeFile,
  workflowType,
  onWorkflowChange,
  onInputChange,
  onResumeFileChange,
  onSubmit,
  onStop,
}: AgentComposerProps) {
  const formRef = useRef<HTMLFormElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const inputLocked = sending || disabled;
  const hasResume = Boolean(resumeFile);
  const canSend = input.trim().length > 0 && !inputLocked;
  const selectedClass = 'rounded-xl bg-white px-3 py-1.5 text-xs font-semibold text-sky-700 shadow-sm';
  const idleClass = 'rounded-xl px-3 py-1.5 text-xs font-semibold text-slate-500 hover:bg-white/70';

  const handleFilePick = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0] ?? null;
    onResumeFileChange(file);
    event.target.value = '';
  };

  /** Enter 提交表单，保留 Shift + Enter 的 textarea 原生换行行为。 */
  const handleInputKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key !== 'Enter' || event.shiftKey || event.nativeEvent.isComposing || !canSend) return;
    event.preventDefault();
    formRef.current?.requestSubmit();
  };

  return (
    <form ref={formRef} className="shrink-0 border-t border-slate-100 bg-white/95 px-4 py-4" onSubmit={onSubmit}>
      {hasResume ? (
        <ResumeAttachmentBar fileName={resumeFile?.name} onClear={() => onResumeFileChange(null)} />
      ) : null}
      <div className="mx-auto max-w-4xl rounded-[1.7rem] border border-slate-200 bg-white p-2 shadow-sm shadow-slate-200/60 transition-[border-color,box-shadow] duration-200 focus-within:border-sky-400 focus-within:shadow-md focus-within:shadow-sky-100">
        <div className="flex flex-wrap items-center gap-2 border-b border-slate-100 px-2 pb-2">
          <div className="flex items-center gap-1 rounded-2xl bg-slate-100 p-1" aria-label="Agent 工作流选择">
            <button
              type="button"
              className={workflowType === 'interview_questions' ? selectedClass : idleClass}
              onClick={() => onWorkflowChange('interview_questions')}
            >
              简历问答
            </button>
            <button
              type="button"
              className={workflowType === 'resume_evaluation' ? selectedClass : idleClass}
              onClick={() => onWorkflowChange('resume_evaluation')}
            >
              简历评估
            </button>
          </div>
          <input ref={fileInputRef} type="file" accept={ACCEPT_RESUME} className="hidden" onChange={handleFilePick} />
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="shrink-0"
            disabled={inputLocked}
            onClick={() => fileInputRef.current?.click()}
          >
            <FileUp size={14} className="mr-1" aria-hidden="true" />
            文件上传
          </Button>
        </div>
        <MessageInputRow
          input={input}
          inputLocked={inputLocked}
          canSend={canSend}
          sending={sending}
          onStop={onStop}
          onInputChange={onInputChange}
          onInputKeyDown={handleInputKeyDown}
        />
      </div>
    </form>
  );
}

/** 已选简历附件提示条 */
function ResumeAttachmentBar({
  fileName,
  onClear,
}: {
  fileName?: string;
  onClear: () => void;
}) {
  return (
    <div className="mx-auto mb-2 flex max-w-4xl flex-wrap items-center gap-2">
      <span className="inline-flex max-w-full items-center gap-2 rounded-full bg-sky-50 px-3 py-1 text-xs text-sky-800">
        <FileUp size={14} aria-hidden="true" />
        <span className="truncate">{fileName}</span>
        <button type="button" className="rounded-full p-0.5 hover:bg-sky-100" aria-label="移除文件" onClick={onClear}>
          <X size={12} />
        </button>
      </span>
      <span className="text-xs text-slate-500">发消息时将用工具解析文件并整理为 Markdown，再进入分析</span>
    </div>
  );
}

/** 消息输入与发送按钮行 */
function MessageInputRow({
  input,
  inputLocked,
  canSend,
  sending,
  onStop,
  onInputChange,
  onInputKeyDown,
}: {
  input: string;
  inputLocked: boolean;
  canSend: boolean;
  sending: boolean;
  onStop?: () => void;
  onInputChange: (value: string) => void;
  onInputKeyDown: (event: KeyboardEvent<HTMLTextAreaElement>) => void;
}) {
  return (
    <div className="flex items-end gap-3 px-1 pt-1">
      <Textarea
        value={input}
        onChange={(event) => onInputChange(event.target.value)}
        onKeyDown={onInputKeyDown}
        className="min-h-[56px] flex-1 resize-none !border-0 !bg-transparent !shadow-none focus-visible:!outline-none focus-visible:!ring-0 focus-visible:!ring-offset-0"
        placeholder="输入任务，例如：结合该文件给出分析建议与风险点"
        disabled={inputLocked}
        aria-label="Agent 消息输入"
      />
      {sending ? (
        <Button type="button" className="mb-1 h-11 w-11 rounded-2xl p-0 bg-red-500 hover:bg-red-600 text-white" onClick={onStop} aria-label="终止生成">
          <Square size={15} aria-hidden="true" />
        </Button>
      ) : (
        <Button type="submit" className="mb-1 h-11 w-11 rounded-2xl p-0" disabled={!canSend} aria-label="发送消息">
          <Send size={17} aria-hidden="true" />
        </Button>
      )}
    </div>
  );
}
