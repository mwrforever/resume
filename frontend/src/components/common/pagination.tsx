import { ChevronLeft, ChevronRight } from 'lucide-react';
import { useThrottleCallback } from '@/hooks/use-debounce';

const PAGE_SIZE_OPTIONS = [10, 20, 50];

interface PaginationProps {
  page: number;
  pageSize: number;
  total: number;
  onChange: (page: number) => void;
  onPageSizeChange?: (size: number) => void;
}

export function Pagination({ page, pageSize, total, onChange, onPageSizeChange }: PaginationProps) {
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const start = total === 0 ? 0 : (page - 1) * pageSize + 1;
  const end = Math.min(page * pageSize, total);
  const throttledChange = useThrottleCallback((nextPage: number) => {
    if (nextPage === page || nextPage < 1 || nextPage > totalPages) return;
    onChange(nextPage);
  });
  const throttledPageSizeChange = useThrottleCallback((size: number) => {
    if (size === pageSize) return;
    onPageSizeChange?.(size);
  });

  const getPages = (): (number | '...')[] => {
    if (totalPages <= 7) return Array.from({ length: totalPages }, (_, i) => i + 1);
    const pages: (number | '...')[] = [1];
    if (page > 3) pages.push('...');
    for (let i = Math.max(2, page - 1); i <= Math.min(totalPages - 1, page + 1); i++) {
      pages.push(i);
    }
    if (page < totalPages - 2) pages.push('...');
    pages.push(totalPages);
    return pages;
  };

  return (
    <div className="flex items-center justify-between px-1 py-3 text-sm text-[#64748B]">
      <div className="flex items-center gap-3">
        <span className="tabular-nums">
          {total === 0 ? '暂无数据' : `共 ${total} 条，第 ${start}–${end} 条`}
        </span>
        {onPageSizeChange && (
          <div className="flex items-center gap-1.5">
            <span className="text-xs text-[#94A3B8]">每页</span>
            <select
              value={pageSize}
              onChange={(e) => throttledPageSizeChange(Number(e.target.value))}
              aria-label="每页条数"
              className="h-7 px-1.5 rounded border border-[#E2E8F0] bg-white text-xs text-[#1E293B] focus:outline-none focus:ring-2 focus:ring-[#2563EB] cursor-pointer"
            >
              {PAGE_SIZE_OPTIONS.map((s) => (
                <option key={s} value={s}>{s} 条</option>
              ))}
            </select>
          </div>
        )}
      </div>

      <div className="flex items-center gap-1">
        <button
          onClick={() => throttledChange(page - 1)}
          disabled={page <= 1}
          aria-label="上一页"
          className="inline-flex items-center justify-center w-8 h-8 rounded border border-[#E2E8F0] bg-white text-[#1E293B] disabled:opacity-40 disabled:cursor-not-allowed hover:bg-[#F8FAFC] transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#2563EB]"
        >
          <ChevronLeft size={15} aria-hidden="true" />
        </button>

        {getPages().map((p, i) =>
          p === '...' ? (
            <span key={`ellipsis-${i}`} className="w-8 h-8 flex items-center justify-center text-[#94A3B8] select-none">
              …
            </span>
          ) : (
            <button
              key={p}
              onClick={() => throttledChange(p as number)}
              aria-current={p === page ? 'page' : undefined}
              className={`inline-flex items-center justify-center w-8 h-8 rounded border text-sm tabular-nums transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#2563EB] ${
                p === page
                  ? 'border-[#2563EB] bg-[#2563EB] text-white font-medium'
                  : 'border-[#E2E8F0] bg-white text-[#1E293B] hover:bg-[#F8FAFC]'
              }`}
            >
              {p}
            </button>
          )
        )}

        <button
          onClick={() => throttledChange(page + 1)}
          disabled={page >= totalPages}
          aria-label="下一页"
          className="inline-flex items-center justify-center w-8 h-8 rounded border border-[#E2E8F0] bg-white text-[#1E293B] disabled:opacity-40 disabled:cursor-not-allowed hover:bg-[#F8FAFC] transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#2563EB]"
        >
          <ChevronRight size={15} aria-hidden="true" />
        </button>
      </div>
    </div>
  );
}
