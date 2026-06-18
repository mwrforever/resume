/**
 * SessionSearchDialog：会话搜索弹窗（分页）。
 *
 * 替代侧栏内联搜索框：点击侧栏搜索图标 → 弹窗内搜索 + 分页结果列表。
 * - 输入框 300ms 防抖后调 listSessions({ page, page_size, keyword })
 * - 展示 total 与当前页 items，上/下页切换
 * - 点击结果项 → onSelect(id) 切换会话并关闭弹窗
 */

import { useEffect, useRef, useState } from 'react';
import { Search, ChevronLeft, ChevronRight, MessageSquare, Loader2 } from 'lucide-react';
import { Dialog, DialogContent } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { employeeAgentApi } from '@/api/employee/agent';
import type { WorkspaceSession } from '@/types/agent';

// 每页 6 条：与弹窗 max-h-[360px] 容器匹配（每行约 50px → 6 行 ≈ 300px），
// 保证常态下不出现内部滚动条；超出 6 条由分页控件翻页。
const PAGE_SIZE = 6;

export interface SessionSearchDialogProps {
  /** 是否打开 */
  open: boolean;
  /** 选中会话回调（切换 + 关闭） */
  onSelect: (id: number) => void;
  /** 关闭回调 */
  onClose: () => void;
  /** 当前激活会话 id（高亮命中项） */
  activeId: number | null;
}

export function SessionSearchDialog({ open, onSelect, onClose, activeId }: SessionSearchDialogProps) {
  const [keyword, setKeyword] = useState('');
  const [debounced, setDebounced] = useState('');
  const [page, setPage] = useState(1);
  const [items, setItems] = useState<WorkspaceSession[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  // 打开时聚焦输入框 + 重置状态
  useEffect(() => {
    if (open) {
      setKeyword('');
      setDebounced('');
      setPage(1);
      requestAnimationFrame(() => inputRef.current?.focus());
    }
  }, [open]);

  // 输入防抖 300ms
  useEffect(() => {
    const t = setTimeout(() => {
      setDebounced(keyword);
      setPage(1);
    }, 300);
    return () => clearTimeout(t);
  }, [keyword]);

  // 防抖值或页码变化 → 拉取结果
  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    const run = async () => {
      setLoading(true);
      try {
        const resp = await employeeAgentApi.listSessions({
          page, page_size: PAGE_SIZE, keyword: debounced || undefined,
        });
        if (cancelled) return;
        const data = resp.data?.data ?? resp.data;
        const list = (data?.items ?? []) as WorkspaceSession[];
        // 前端兜底降序
        list.sort((a, b) => (b.last_message_time ?? '').localeCompare(a.last_message_time ?? ''));
        setItems(list);
        setTotal(data?.total ?? 0);
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    void run();
    return () => { cancelled = true; };
  }, [open, debounced, page]);

  const handlePick = (id: number) => {
    onSelect(id);
    onClose();
  };

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()} containerClassName="max-w-xl">
      <DialogContent>
        {/* 搜索输入行（无 DialogTitle：搜索弹窗以输入框为焦点，标题冗余） */}
        <div className="relative -mt-1 mb-3">
          <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-[#94A3B8]" />
          <input
            ref={inputRef}
            value={keyword}
            onChange={(e) => setKeyword(e.target.value)}
            onKeyDown={(e) => e.key === 'Escape' && onClose()}
            placeholder="搜索会话标题…"
            className="w-full h-11 pl-10 pr-3 rounded-xl border border-[#CBD5E1] text-sm
                       text-[#020617] placeholder:text-[#94A3B8]
                       focus:outline-none focus:ring-2 focus:ring-[#0EA5E9] focus:border-transparent
                       transition-all"
          />
        </div>

        {/* 结果列表 */}
        <div className="max-h-[360px] min-h-[120px] overflow-y-auto -mx-1 px-1">
          {loading && (
            <div className="flex items-center justify-center gap-2 py-10 text-xs text-[#64748B]">
              <Loader2 size={14} className="animate-spin" /> 搜索中…
            </div>
          )}
          {!loading && items.length === 0 && (
            <div className="flex flex-col items-center justify-center py-12 text-center">
              <MessageSquare size={28} className="text-[#CBD5E1] mb-2" />
              <p className="text-sm text-[#64748B]">
                {debounced ? `未找到与「${debounced}」相关的会话` : '暂无会话'}
              </p>
            </div>
          )}
          {!loading && items.map((s) => {
            const isActive = s.id === activeId;
            return (
              <button
                key={s.id}
                type="button"
                onClick={() => handlePick(s.id)}
                className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-left text-sm
                            transition-colors duration-150
                            ${isActive
                              ? 'bg-[#F0F9FF] text-[#020617] font-semibold'
                              : 'text-[#334155] hover:bg-[#F1F5F9]'}`}
              >
                <MessageSquare size={15} className={`flex-shrink-0 ${isActive ? 'text-[#0369A1]' : 'text-[#94A3B8]'}`} />
                <span className="flex-1 truncate">{s.title || '未命名会话'}</span>
                {s.last_message_time && (
                  <span className="flex-shrink-0 text-[11px] text-[#94A3B8] font-mono">
                    {s.last_message_time.slice(0, 10)}
                  </span>
                )}
              </button>
            );
          })}
        </div>

        {/* 分页控件 */}
        {total > 0 && (
          <div className="flex items-center justify-between pt-3 mt-2 border-t border-[#E2E8F0]">
            <span className="text-xs text-[#94A3B8]">共 {total} 个会话</span>
            <div className="flex items-center gap-2">
              <Button
                variant="outline" size="sm"
                disabled={page <= 1}
                onClick={() => setPage((p) => Math.max(1, p - 1))}
              >
                <ChevronLeft size={14} /> 上一页
              </Button>
              <span className="text-xs text-[#64748B] font-mono min-w-[60px] text-center">
                {page} / {totalPages}
              </span>
              <Button
                variant="outline" size="sm"
                disabled={page >= totalPages}
                onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
              >
                下一页 <ChevronRight size={14} />
              </Button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
