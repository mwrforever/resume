/**
 * ToolUseBlock：工具调用状态块（维度/阶段）
 *
 * - running → 旋转 spinner + "运行中…"，思考区可展开看实时思考流
 * - success → 绿勾 + 维度名 + "生成 N 题"（从 output.count 取），可展开思考过程
 * - failed → 红 error
 * - cancelled → 橙禁止图标 + "已取消"（客户端中断时后端把未完成的 streaming block 标记为 cancelled）
 *
 * 思考内容归位规则：
 * - 各维度块自带 block.reasoning（后端落库），运行结束/历史消息均可展开查看。
 * - 展开详情 = 思考内容（ReasoningSection），不再是 JSON。
 * - 非思考模式（无 reasoning）时不显示任何展开/下拉区，只展示状态与题数。
 *
 * 单维度失败不阻塞其他，error 内联展示。
 */

import type { AgentBlock } from '@/types/agent';
import { ReasoningSection } from './reasoning-section';

interface ToolUseBlockProps {
  block: AgentBlock & { type: 'tool_use' };
}

export function ToolUseBlock({ block }: ToolUseBlockProps) {
  const { display_name, tool_name, status, error } = block;
  const isRunning = status === 'streaming';
  const isFailed = status === 'failed';
  const isCancelled = status === 'cancelled';
  // 后端 fanout 成功时 output = {"count": N}；阶段块无 output
  const questionCount = typeof block.output?.count === 'number' ? block.output.count : null;
  const hasReasoning = !!block.reasoning?.trim();

  return (
    <div className="flex flex-col gap-1">
      <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-[#F1F5F9]/80 text-sm w-fit ring-1 ring-inset ring-black/[0.03]">
        {isRunning ? (
          <svg className="w-3.5 h-3.5 text-[#0EA5E9] animate-spin" fill="none" viewBox="0 0 24 24">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
          </svg>
        ) : isFailed ? (
          <span className="w-3.5 h-3.5 inline-flex items-center justify-center rounded-full bg-[#FEE2E2]">
            <span className="text-[8px] text-[#DC2626] font-bold">!</span>
          </span>
        ) : isCancelled ? (
          <svg className="w-3.5 h-3.5 text-[#EA580C]" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
            <circle cx="12" cy="12" r="9" />
            <line x1="6.5" y1="17.5" x2="17.5" y2="6.5" strokeLinecap="round" />
          </svg>
        ) : (
          <svg className="w-3.5 h-3.5 text-[#16A34A]" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
          </svg>
        )}

        <span className="text-[#334155] font-medium text-xs">{display_name || tool_name}</span>

        {isRunning && <span className="text-[#94A3B8] text-xs">运行中…</span>}
        {isCancelled && <span className="text-[#EA580C] text-xs">· 已取消</span>}
        {/* 成功后展示生成题数 */}
        {!isRunning && !isFailed && !isCancelled && questionCount !== null && (
          <span className="text-[#16A34A] text-xs font-medium">· 生成 {questionCount} 题</span>
        )}
        {/* 失败时内联错误 */}
        {isFailed && error && <span className="text-[#DC2626] text-xs">{error}</span>}
      </div>

      {/* 思考过程：仅当有 reasoning 时显示（非思考模式无此区域，无任何下拉框）。
          运行中 streaming=true 自动展开+跟进；结束后默认折叠，随时可点击查看。 */}
      {hasReasoning && (
        <div className="ml-1">
          <ReasoningSection reasoning={block.reasoning!} streaming={isRunning} />
        </div>
      )}
    </div>
  );
}
