import { X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog';
import type { IDeptItem } from '@/types/employee';

interface DepartmentMultiSelectProps {
  depts: IDeptItem[];
  selectedIds: number[];
  onChange: (ids: number[]) => void;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  placeholder?: string;
  className?: string;
}

export function DepartmentMultiSelect({
  depts,
  selectedIds,
  onChange,
  open,
  onOpenChange,
  placeholder = '按部门筛选',
  className = '',
}: DepartmentMultiSelectProps) {
  const selectedDepts = depts.filter((dept) => selectedIds.includes(dept.id));

  const toggleDept = (deptId: number) => {
    onChange(selectedIds.includes(deptId) ? selectedIds.filter((id) => id !== deptId) : [...selectedIds, deptId]);
  };

  const removeDept = (deptId: number) => {
    onChange(selectedIds.filter((id) => id !== deptId));
  };

  return (
    <div className={className}>
      <button
        type="button"
        onClick={() => onOpenChange(true)}
        className="min-h-9 w-full rounded-md border border-[#E2E8F0] bg-white px-3 py-1.5 text-left text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#2563EB]"
      >
        {selectedDepts.length === 0 ? (
          <span className="text-[#94A3B8] leading-6">{placeholder}</span>
        ) : (
          <span className="flex flex-wrap gap-1.5">
            {selectedDepts.map((dept) => (
              <span key={dept.id} className="inline-flex items-center gap-1 rounded bg-blue-50 px-2 py-0.5 text-xs text-[#2563EB]">
                {dept.dept_name}
                <span
                  role="button"
                  tabIndex={0}
                  onClick={(event) => {
                    event.stopPropagation();
                    removeDept(dept.id);
                  }}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter' || event.key === ' ') {
                      event.preventDefault();
                      event.stopPropagation();
                      removeDept(dept.id);
                    }
                  }}
                  className="rounded hover:bg-blue-100"
                  aria-label={`移除部门 ${dept.dept_name}`}
                >
                  <X size={12} aria-hidden="true" />
                </span>
              </span>
            ))}
          </span>
        )}
      </button>

      <Dialog open={open} onOpenChange={onOpenChange} containerClassName="max-w-xl">
        <DialogContent>
          <div className="mb-4 flex items-center justify-between">
            <DialogTitle className="mb-0">选择部门</DialogTitle>
            <button
              type="button"
              onClick={() => onOpenChange(false)}
              aria-label="关闭部门选择"
              className="text-[#94A3B8] hover:text-[#1E293B] focus-visible:outline-none"
            >
              <X size={18} aria-hidden="true" />
            </button>
          </div>
          <div className="max-h-80 overflow-auto rounded-lg border border-[#E2E8F0]">
            {depts.length === 0 ? (
              <p className="px-4 py-8 text-center text-sm text-[#94A3B8]">暂无部门</p>
            ) : (
              depts.map((dept) => {
                const checked = selectedIds.includes(dept.id);
                return (
                  <label key={dept.id} className="flex cursor-pointer items-center gap-3 border-b border-[#F1F5F9] px-4 py-3 text-sm hover:bg-[#F8FAFC] last:border-b-0">
                    <input
                      type="checkbox"
                      checked={checked}
                      onChange={() => toggleDept(dept.id)}
                      className="rounded border-[#CBD5E1] accent-[#2563EB]"
                    />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-[#1E293B]">{dept.dept_name}</span>
                      <span className="block truncate text-xs text-[#94A3B8]">{dept.dept_code}</span>
                    </span>
                  </label>
                );
              })
            )}
          </div>
          <div className="mt-5 flex justify-between gap-3">
            <Button type="button" variant="outline" onClick={() => onChange([])} disabled={selectedIds.length === 0}>
              清空
            </Button>
            <Button type="button" onClick={() => onOpenChange(false)} className="bg-[#2563EB] hover:bg-[#1D4ED8] text-white">
              确定
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
