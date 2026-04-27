import { useCallback, useEffect, useState } from 'react';
import { AdminLayout } from '@/components/layout/admin-layout';
import { ConfirmDialog } from '@/components/common/confirm-dialog';
import { Pagination } from '@/components/common/pagination';
import { employeeTagsApi } from '@/api/employee/tags';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Eye, Loader2, Pencil, Plus, Tags as TagsIcon, Trash2, X } from 'lucide-react';
import { useDebounce } from '@/hooks/use-debounce';
import type { ITag } from '@/types/employee';

const TAG_TYPE_LABEL: Record<number, string> = { 1: '岗位特性', 2: '福利待遇', 3: '技能加分' };
const TAG_COLOR_OPTIONS = [
  { value: 'default', label: '默认', className: 'border-[#CBD5E1] bg-[#F8FAFC] text-[#475569]' },
  { value: 'blue', label: '蓝色', className: 'border-blue-200 bg-blue-50 text-blue-700' },
  { value: 'green', label: '绿色', className: 'border-green-200 bg-green-50 text-green-700' },
  { value: 'amber', label: '琥珀色', className: 'border-amber-200 bg-amber-50 text-amber-700' },
  { value: 'red', label: '红色', className: 'border-red-200 bg-red-50 text-red-700' },
  { value: 'purple', label: '紫色', className: 'border-purple-200 bg-purple-50 text-purple-700' },
];
const DEFAULT_PAGE_SIZE = 10;
const getResponseData = <T,>(res: any, fallback: T): T => res?.data?.data ?? res?.data ?? fallback;

function TagColorBadge({ color }: { color: string }) {
  const option = TAG_COLOR_OPTIONS.find(item => item.value === color) ?? TAG_COLOR_OPTIONS[0];
  return (
    <span className={`inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-medium ${option.className}`}>
      {option.label}
    </span>
  );
}

interface TagDialogProps {
  mode: 'create' | 'edit' | 'view';
  tag: ITag | null;
  onClose: () => void;
  onSuccess: () => void;
}

function TagDialog({ mode, tag, onClose, onSuccess }: TagDialogProps) {
  const readonly = mode === 'view' || (tag?.job_count ?? 0) > 0;
  const [tagName, setTagName] = useState(tag?.tag_name ?? '');
  const [tagType, setTagType] = useState(String(tag?.tag_type ?? 1));
  const [status, setStatus] = useState(String(tag?.status ?? 1));
  const [sortOrder, setSortOrder] = useState(String(tag?.sort_order ?? 0));
  const [color, setColor] = useState(tag?.color ?? 'default');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (readonly) return;
    if (!tagName.trim()) return;
    setSaving(true);
    setError('');
    const payload = {
      tag_name: tagName.trim(),
      tag_type: Number(tagType),
      status: Number(status),
      sort_order: Number(sortOrder) || 0,
      color: color.trim() || 'default',
    };
    try {
      if (mode === 'create') await employeeTagsApi.create(payload);
      else if (tag) await employeeTagsApi.update(tag.id, payload);
      onSuccess();
    } catch (err: any) {
      setError(err?.response?.data?.message || '保存失败，请重试');
      setSaving(false);
    }
  };

  return (
    <Dialog open onOpenChange={onClose} containerClassName="max-w-lg">
      <DialogContent>
        <div className="mb-4 flex items-center justify-between">
          <DialogTitle className="mb-0">{mode === 'create' ? '新增标签' : mode === 'edit' ? '编辑标签' : '查看标签'}</DialogTitle>
          <button onClick={onClose} aria-label="关闭" className="text-[#94A3B8] hover:text-[#1E293B] focus-visible:outline-none">
            <X size={18} />
          </button>
        </div>
        {(tag?.job_count ?? 0) > 0 && mode !== 'view' && (
          <p className="mb-3 rounded-md bg-amber-50 px-3 py-2 text-sm text-amber-700">已有岗位关联该标签，只能查看，不能修改。</p>
        )}
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="tag-name">标签名称 <span className="text-red-500">*</span></Label>
            <Input id="tag-name" value={tagName} onChange={e => setTagName(e.target.value)} disabled={readonly} required />
          </div>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label>标签分类</Label>
              <Select value={tagType} onValueChange={(value) => { if (!readonly) setTagType(value); }}>
                <SelectTrigger className={readonly ? 'pointer-events-none opacity-60' : undefined}><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="1">岗位特性</SelectItem>
                  <SelectItem value="2">福利待遇</SelectItem>
                  <SelectItem value="3">技能加分</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>状态</Label>
              <Select value={status} onValueChange={(value) => { if (!readonly) setStatus(value); }}>
                <SelectTrigger className={readonly ? 'pointer-events-none opacity-60' : undefined}><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="1">正常</SelectItem>
                  <SelectItem value="0">停用</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="tag-sort">排序</Label>
              <Input id="tag-sort" type="number" value={sortOrder} onChange={e => setSortOrder(e.target.value)} disabled={readonly} />
            </div>
            <div className="space-y-1.5">
              <Label>颜色</Label>
              <Select value={color} onValueChange={(value) => { if (!readonly) setColor(value); }}>
                <SelectTrigger className={readonly ? 'pointer-events-none opacity-60' : undefined}><TagColorBadge color={color} /></SelectTrigger>
                <SelectContent>
                  {TAG_COLOR_OPTIONS.map(option => (
                    <SelectItem key={option.value} value={option.value}>
                      <TagColorBadge color={option.value} />
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          {tag && <p className="text-sm text-[#64748B]">关联岗位数：{tag.job_count ?? 0}</p>}
          {error && <p className="text-sm text-red-500">{error}</p>}
          <div className="flex justify-end gap-2 pt-1">
            <Button type="button" variant="outline" onClick={onClose} disabled={saving}>关闭</Button>
            {!readonly && (
              <Button type="submit" disabled={saving || !tagName.trim()} className="bg-[#2563EB] hover:bg-[#1D4ED8] text-white">
                {saving ? <><Loader2 size={14} className="mr-1.5 animate-spin" />保存中…</> : '保存'}
              </Button>
            )}
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export default function EmployeeTags() {
  const [tags, setTags] = useState<ITag[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(DEFAULT_PAGE_SIZE);
  const [search, setSearch] = useState('');
  const [tagType, setTagType] = useState('');
  const [status, setStatus] = useState('');
  const [loading, setLoading] = useState(true);
  const [dialogState, setDialogState] = useState<{ mode: 'create' | 'edit' | 'view'; tag: ITag | null } | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<ITag | null>(null);
  const [deleting, setDeleting] = useState(false);
  const debouncedSearch = useDebounce(search, 350);

  const loadTags = useCallback(async () => {
    setLoading(true);
    try {
      const params: Record<string, string | number> = { page, page_size: pageSize };
      if (debouncedSearch) params.search = debouncedSearch;
      if (tagType) params.tag_type = Number(tagType);
      if (status) params.status = Number(status);
      const res = await employeeTagsApi.list(params);
      const data = getResponseData<{ total: number; items: ITag[] }>(res, { total: 0, items: [] });
      setTags(data.items ?? []);
      setTotal(data.total ?? 0);
    } finally {
      setLoading(false);
    }
  }, [debouncedSearch, page, pageSize, status, tagType]);

  useEffect(() => { loadTags(); }, [loadTags]);
  useEffect(() => { setPage(1); }, [debouncedSearch, tagType, status]);

  const handleDelete = async () => {
    if (!deleteTarget) return;
    setDeleting(true);
    try {
      await employeeTagsApi.delete(deleteTarget.id);
      setDeleteTarget(null);
      await loadTags();
    } finally {
      setDeleting(false);
    }
  };

  return (
    <AdminLayout
      breadcrumbs={[{ label: '标签管理' }]}
      title="标签管理"
      headerAction={
        <Button onClick={() => setDialogState({ mode: 'create', tag: null })} className="bg-[#2563EB] hover:bg-[#1D4ED8] text-white">
          <Plus size={16} className="mr-1.5" aria-hidden="true" />新增标签
        </Button>
      }
    >
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <Input value={search} onChange={e => setSearch(e.target.value)} placeholder="搜索标签名称…" className="w-56 bg-white" />
        <Select value={tagType} onValueChange={setTagType}>
          <SelectTrigger className="w-36 bg-white"><SelectValue placeholder="全部分类" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="">全部分类</SelectItem>
            <SelectItem value="1">岗位特性</SelectItem>
            <SelectItem value="2">福利待遇</SelectItem>
            <SelectItem value="3">技能加分</SelectItem>
          </SelectContent>
        </Select>
        <Select value={status} onValueChange={setStatus}>
          <SelectTrigger className="w-32 bg-white"><SelectValue placeholder="全部状态" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="">全部状态</SelectItem>
            <SelectItem value="1">正常</SelectItem>
            <SelectItem value="0">停用</SelectItem>
          </SelectContent>
        </Select>
      </div>

      <div className="overflow-hidden rounded-lg border border-[#E2E8F0] bg-white">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-[#E2E8F0] bg-[#F8FAFC]">
              <th className="px-4 py-3 text-left font-medium text-[#64748B]">标签名称</th>
              <th className="px-4 py-3 text-left font-medium text-[#64748B]">分类</th>
              <th className="px-4 py-3 text-left font-medium text-[#64748B]">状态</th>
              <th className="px-4 py-3 text-left font-medium text-[#64748B]">颜色</th>
              <th className="px-4 py-3 text-left font-medium text-[#64748B]">排序</th>
              <th className="px-4 py-3 text-left font-medium text-[#64748B]">关联岗位</th>
              <th className="px-4 py-3 text-right font-medium text-[#64748B]">操作</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              [...Array(4)].map((_, i) => (
                <tr key={i} className="border-b border-[#F1F5F9]">
                  {[...Array(7)].map((__, j) => <td key={j} className="px-4 py-3"><div className="h-4 animate-pulse rounded bg-[#F1F5F9]" /></td>)}
                </tr>
              ))
            ) : tags.length === 0 ? (
              <tr><td colSpan={7} className="px-4 py-16 text-center text-[#94A3B8]">暂无标签</td></tr>
            ) : tags.map(tag => {
              const locked = (tag.job_count ?? 0) > 0;
              return (
                <tr key={tag.id} className="border-b border-[#F1F5F9] transition-colors hover:bg-[#F8FAFC]">
                  <td className="px-4 py-3 font-medium text-[#1E293B]"><TagsIcon size={14} className="mr-1.5 inline text-[#94A3B8]" />{tag.tag_name}</td>
                  <td className="px-4 py-3 text-[#64748B]">{TAG_TYPE_LABEL[tag.tag_type] ?? `类型${tag.tag_type}`}</td>
                  <td className="px-4 py-3">{tag.status === 1 ? <Badge className="bg-green-100 text-green-700 border-green-200">正常</Badge> : <Badge className="bg-[#F1F5F9] text-[#64748B] border-[#E2E8F0]">停用</Badge>}</td>
                  <td className="px-4 py-3"><TagColorBadge color={tag.color} /></td>
                  <td className="px-4 py-3 text-[#64748B] tabular-nums">{tag.sort_order ?? 0}</td>
                  <td className="px-4 py-3 text-[#64748B] tabular-nums">{tag.job_count ?? 0}</td>
                  <td className="px-4 py-3">
                    <div className="flex items-center justify-end gap-2">
                      <button onClick={() => setDialogState({ mode: 'view', tag })} className="inline-flex items-center gap-1 rounded px-2 py-1 text-xs text-[#64748B] hover:bg-[#F1F5F9] hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#2563EB]">
                        <Eye size={13} aria-hidden="true" />查看
                      </button>
                      <button onClick={() => setDialogState({ mode: 'edit', tag })} disabled={locked} title={locked ? '已有岗位关联该标签，不允许修改' : undefined} className="inline-flex items-center gap-1 rounded px-2 py-1 text-xs text-[#2563EB] hover:bg-blue-50 hover:underline disabled:cursor-not-allowed disabled:text-[#94A3B8] disabled:hover:bg-transparent disabled:hover:no-underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#2563EB]">
                        <Pencil size={13} aria-hidden="true" />编辑
                      </button>
                      <button onClick={() => setDeleteTarget(tag)} disabled={locked} title={locked ? '已有岗位关联该标签，不允许删除' : undefined} className="inline-flex items-center gap-1 rounded px-2 py-1 text-xs text-red-500 hover:bg-red-50 hover:underline disabled:cursor-not-allowed disabled:text-[#94A3B8] disabled:hover:bg-transparent disabled:hover:no-underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-400">
                        <Trash2 size={13} aria-hidden="true" />删除
                      </button>
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <Pagination page={page} pageSize={pageSize} total={total} onChange={setPage} onPageSizeChange={(size) => { setPageSize(size); setPage(1); }} />

      {dialogState && <TagDialog mode={dialogState.mode} tag={dialogState.tag} onClose={() => setDialogState(null)} onSuccess={() => { setDialogState(null); loadTags(); }} />}
      <ConfirmDialog open={!!deleteTarget} title="确认删除标签" description={`确定要删除「${deleteTarget?.tag_name}」吗？`} confirmLabel="删除" onConfirm={handleDelete} onCancel={() => setDeleteTarget(null)} loading={deleting} />
    </AdminLayout>
  );
}
