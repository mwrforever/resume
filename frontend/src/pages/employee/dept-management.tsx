import { ChangeEvent, FormEvent, useCallback, useEffect, useRef, useState } from 'react';
import { AdminLayout } from '@/components/layout/admin-layout';
import { ConfirmDialog } from '@/components/common/confirm-dialog';
import { Pagination } from '@/components/common/pagination';
import { deptApi } from '@/api/employee/depts';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useDebounce } from '@/hooks/use-debounce';
import type { IDeptItem, IDeptImportResult, IDeptTreeItem } from '@/types/employee';
import { Info, Loader2, Pencil, Plus, Trash2, Upload, X, ChevronRight, ChevronDown, View, List } from 'lucide-react';

type DialogMode = 'create' | 'edit';
type ViewMode = 'table' | 'tree';

const DEFAULT_PAGE_SIZE = 10;

function getResponseData<T>(res: unknown, fallback: T): T {
  const wrapper = res as { data?: T | { data?: T } };
  const data = wrapper?.data;
  if (data && typeof data === 'object' && 'data' in data) return (data as { data?: T }).data ?? fallback;
  return (data as T) ?? fallback;
}

function getErrorMessage(err: unknown, fallback: string): string {
  const error = err as { response?: { data?: { message?: string; detail?: string } } };
  return error.response?.data?.message || error.response?.data?.detail || fallback;
}

function StatusBadge({ status }: { status: number }) {
  return status === 1
    ? <Badge className="bg-green-100 text-green-700 border-green-200">启用</Badge>
    : <Badge className="bg-[#F1F5F9] text-[#64748B] border-[#E2E8F0]">禁用</Badge>;
}

interface DeptDialogProps {
  mode: DialogMode;
  item: IDeptItem | null;
  parentId?: number | null;
  deptList: IDeptItem[];
  onClose: () => void;
  onSuccess: () => void;
}

function DeptDialog({ mode, item, parentId, deptList, onClose, onSuccess }: DeptDialogProps) {
  const [form, setForm] = useState({
    dept_code: item?.dept_code ?? '',
    dept_name: item?.dept_name ?? '',
    parent_id: item?.parent_id ?? parentId ?? 0,
    leader_id: item?.leader_id ?? 0,
    sort_order: item?.sort_order ?? 0,
    status: String(item?.status ?? 1),
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault();
    setSaving(true);
    setError('');
    try {
      const payload = {
        dept_code: form.dept_code,
        dept_name: form.dept_name,
        parent_id: form.parent_id,
        leader_id: form.leader_id || undefined,
        sort_order: form.sort_order,
        status: Number(form.status),
      };
      if (mode === 'create') {
        await deptApi.createDept(payload);
      } else if (item) {
        await deptApi.updateDept(item.id, payload);
      }
      onSuccess();
    } catch (err) {
      setError(getErrorMessage(err, '保存失败，请重试'));
      setSaving(false);
    }
  };

  const canSubmit = form.dept_code.trim() && form.dept_name.trim();

  return (
    <Dialog open onOpenChange={onClose} containerClassName="max-w-xl">
      <DialogContent>
        <div className="mb-4 flex items-center justify-between">
          <DialogTitle className="mb-0">{mode === 'create' ? '新增' : '编辑'}部门</DialogTitle>
          <button onClick={onClose} aria-label="关闭" className="text-[#94A3B8] hover:text-[#1E293B] focus-visible:outline-none">
            <X size={18} />
          </button>
        </div>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <Label>部门编码 <span className="text-red-500">*</span></Label>
              <Input value={form.dept_code} onChange={e => setForm({ ...form, dept_code: e.target.value })} placeholder="如: DEPT001" required />
            </div>
            <div className="space-y-1.5">
              <Label>部门名称 <span className="text-red-500">*</span></Label>
              <Input value={form.dept_name} onChange={e => setForm({ ...form, dept_name: e.target.value })} placeholder="如: 技术部" required />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <Label>上级部门</Label>
              <Select value={String(form.parent_id)} onValueChange={(v) => setForm({ ...form, parent_id: Number(v) })}>
                <SelectTrigger>{deptList.find(d => d.id === form.parent_id)?.dept_name ?? '无'}</SelectTrigger>
                <SelectContent>
                  <SelectItem value="0">无</SelectItem>
                  {deptList.filter(d => d.id !== item?.id).map(d => (
                    <SelectItem key={d.id} value={String(d.id)}>{d.dept_name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>排序</Label>
              <Input type="number" value={form.sort_order} onChange={e => setForm({ ...form, sort_order: Number(e.target.value) })} />
            </div>
          </div>
          <div className="space-y-1.5">
            <Label>状态</Label>
            <Select value={form.status} onValueChange={(v) => setForm({ ...form, status: v })}>
              <SelectTrigger>{form.status === '1' ? '启用' : '禁用'}</SelectTrigger>
              <SelectContent>
                <SelectItem value="1">启用</SelectItem>
                <SelectItem value="0">禁用</SelectItem>
              </SelectContent>
            </Select>
          </div>
          {error && <p className="text-sm text-red-500">{error}</p>}
          <div className="flex justify-end gap-2 pt-1">
            <Button type="button" variant="outline" onClick={onClose} disabled={saving}>关闭</Button>
            <Button type="submit" disabled={saving || !canSubmit} className="bg-[#2563EB] hover:bg-[#1D4ED8] text-white">
              {saving ? <><Loader2 size={14} className="mr-1.5 animate-spin" />保存中…</> : '保存'}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

interface ImportPanelProps {
  onImported: () => void;
}

function ImportPanel({ onImported }: ImportPanelProps) {
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [importing, setImporting] = useState(false);
  const [result, setResult] = useState<IDeptImportResult | null>(null);
  const [error, setError] = useState('');

  const handleFileChange = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    setImporting(true);
    setError('');
    setResult(null);
    try {
      const res = await deptApi.importDepts(file);
      setResult(getResponseData<IDeptImportResult>(res, { success_count: 0, fail_count: 0, errors: [] }));
      onImported();
    } catch (err) {
      setError(getErrorMessage(err, '导入失败，请检查文件内容'));
    } finally {
      setImporting(false);
      event.target.value = '';
    }
  };

  return (
    <div className="mb-4 rounded-lg border border-[#E2E8F0] bg-white p-4">
      <div className="flex flex-wrap items-center gap-3">
        <input ref={fileInputRef} type="file" accept=".csv,text/csv" className="hidden" onChange={handleFileChange} />
        <Button onClick={() => fileInputRef.current?.click()} disabled={importing} className="bg-[#2563EB] hover:bg-[#1D4ED8] text-white">
          {importing ? <><Loader2 size={14} className="mr-1.5 animate-spin" />导入中…</> : <><Upload size={15} className="mr-1.5" />导入部门</>}
        </Button>
        <div className="group relative inline-flex items-center gap-1.5 rounded-full border border-blue-100 bg-blue-50 px-3 py-1.5 text-sm text-blue-700">
          <Info size={14} />
          导入说明
          <div className="pointer-events-none absolute left-0 top-full z-20 mt-2 hidden w-[360px] rounded-lg border border-[#E2E8F0] bg-white p-3 text-sm text-[#334155] shadow-lg group-hover:block">
            <p className="font-medium text-[#1E293B]">部门批量导入仅支持 CSV 文件</p>
            <p className="mt-1">必填列：dept_code、dept_name、parent_id、sort_order、status。</p>
            <p className="mt-1">parent_id 为 0 表示顶级部门，其他为上级部门 ID。</p>
            <p className="mt-1">status 只能填写 1（启用）或 0（禁用）。</p>
            <p className="mt-1">CSV 表头：dept_code,dept_name,parent_id,leader_id,sort_order,status。</p>
          </div>
        </div>
      </div>
      {error && <p className="mt-3 text-sm text-red-600">{error}</p>}
      {result && (
        <div className="mt-3 rounded-md bg-white p-3 text-sm text-[#334155]">
          <p>导入成功：{result.success_count} 条，失败：{result.fail_count} 条</p>
          {result.errors.length > 0 && <div className="mt-2 max-h-28 overflow-auto text-red-600">{result.errors.map(item => <p key={`${item.line}-${item.message}`}>第 {item.line} 行：{item.message}</p>)}</div>}
        </div>
      )}
    </div>
  );
}

interface TreeNodeProps {
  node: IDeptTreeItem;
  level: number;
  selectedParentId: number | null;
  onAddChild: (parentId: number) => void;
  onEdit: (item: IDeptItem) => void;
  onDelete: (item: IDeptItem) => void;
}

function TreeNode({ node, level, selectedParentId, onAddChild, onEdit, onDelete }: TreeNodeProps) {
  const [expanded, setExpanded] = useState(true);
  const hasChildren = node.children && node.children.length > 0;

  return (
    <div className="select-none">
      <div
        className="flex items-center gap-2 rounded px-2 py-1.5 hover:bg-[#F8FAFC] group"
        style={{ paddingLeft: `${level * 20 + 8}px` }}
      >
        <button
          onClick={() => setExpanded(!expanded)}
          className="flex-shrink-0 text-[#94A3B8] hover:text-[#64748B]"
        >
          {hasChildren ? (expanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />) : <span className="w-3.5 h-3.5" />}
        </button>
        <span className="font-medium text-[#1E293B]">{node.dept_name}</span>
        {node.leader_name && <span className="text-xs text-[#94A3B8]">{node.leader_name}</span>}
        <span className="text-xs text-[#94A3B8]">{node.employee_count}人</span>
        <StatusBadge status={node.status} />
        <div className="ml-auto hidden items-center gap-1 group-hover:flex">
          <button
            onClick={() => onAddChild(node.id)}
            className="inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-xs text-[#2563EB] hover:bg-blue-50"
          >
            <Plus size={12} />添加子部门
          </button>
          <button
            onClick={() => onEdit(node)}
            className="inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-xs text-[#2563EB] hover:bg-blue-50"
          >
            <Pencil size={12} />编辑
          </button>
          <button
            onClick={() => onDelete(node)}
            className="inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-xs text-red-500 hover:bg-red-50"
          >
            <Trash2 size={12} />删除
          </button>
        </div>
      </div>
      {hasChildren && expanded && (
        <div>
          {node.children?.map(child => (
            <TreeNode
              key={child.id}
              node={child}
              level={level + 1}
              selectedParentId={selectedParentId}
              onAddChild={onAddChild}
              onEdit={onEdit}
              onDelete={onDelete}
            />
          ))}
        </div>
      )}
    </div>
  );
}

interface DeptTreeViewProps {
  treeData: IDeptTreeItem[];
  selectedParentId: number | null;
  onAddChild: (parentId: number) => void;
  onEdit: (item: IDeptItem) => void;
  onDelete: (item: IDeptItem) => void;
}

function DeptTreeView({ treeData, selectedParentId, onAddChild, onEdit, onDelete }: DeptTreeViewProps) {
  const rootNodes = treeData.filter(n => n.parent_id === 0);

  return (
    <div className="rounded-lg border border-[#E2E8F0] bg-white">
      {treeData.length === 0 ? (
        <div className="px-4 py-16 text-center text-[#94A3B8]">暂无数据</div>
      ) : (
        rootNodes.map(node => (
          <TreeNode
            key={node.id}
            node={node}
            level={0}
            selectedParentId={selectedParentId}
            onAddChild={onAddChild}
            onEdit={onEdit}
            onDelete={onDelete}
          />
        ))
      )}
    </div>
  );
}

export default function DeptManagement() {
  const [depts, setDepts] = useState<IDeptItem[]>([]);
  const [deptTree, setDeptTree] = useState<IDeptTreeItem[]>([]);
  const [deptList, setDeptList] = useState<IDeptItem[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(DEFAULT_PAGE_SIZE);
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState('');
  const [loading, setLoading] = useState(true);
  const [viewMode, setViewMode] = useState<ViewMode>('table');
  const [dialogState, setDialogState] = useState<{ mode: DialogMode; item: IDeptItem | null; parentId?: number | null } | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<IDeptItem | null>(null);
  const [deleting, setDeleting] = useState(false);
  const debouncedSearch = useDebounce(search, 350);

  const loadTableData = useCallback(async () => {
    setLoading(true);
    try {
      const params: Record<string, string | number> = { page, page_size: pageSize };
      if (debouncedSearch) params.search = debouncedSearch;
      if (status) params.status = Number(status);
      const res = await deptApi.listDepts(params);
      const data = getResponseData<{ total: number; items: IDeptItem[] }>(res, { total: 0, items: [] });
      setDepts(data.items ?? []);
      setTotal(data.total ?? 0);
    } finally {
      setLoading(false);
    }
  }, [debouncedSearch, page, pageSize, status]);

  const loadTreeData = useCallback(async () => {
    try {
      const res = await deptApi.getDeptTree();
      const data = getResponseData<IDeptTreeItem[]>(res, []);
      setDeptTree(data);
    } catch (err) {
      console.error('Failed to load tree data', err);
    }
  }, []);

  const loadDeptList = useCallback(async () => {
    try {
      const res = await deptApi.listDepts();
      const data = getResponseData<IDeptItem[]>(res, []);
      setDeptList(data);
    } catch (err) {
      console.error('Failed to load dept list', err);
    }
  }, []);

  useEffect(() => {
    if (viewMode === 'table') {
      loadTableData();
    } else {
      loadTreeData();
    }
    loadDeptList();
  }, [viewMode, loadTableData, loadTreeData]);

  useEffect(() => { setPage(1); }, [debouncedSearch, status]);

  const handleDelete = async () => {
    if (!deleteTarget) return;
    setDeleting(true);
    try {
      await deptApi.deleteDept(deleteTarget.id);
      setDeleteTarget(null);
      if (viewMode === 'table') {
        await loadTableData();
      } else {
        await loadTreeData();
      }
      await loadDeptList();
    } catch (err) {
      console.error('Failed to delete dept', err);
      alert('删除失败，请重试');
    } finally {
      setDeleting(false);
    }
  };

  const handleAddChild = (parentId: number) => {
    setDialogState({ mode: 'create', item: null, parentId });
  };

  const handleEdit = (item: IDeptItem) => {
    setDialogState({ mode: 'edit', item });
  };

  const handleDeleteClick = (item: IDeptItem) => {
    setDeleteTarget(item);
  };

  return (
    <AdminLayout
      breadcrumbs={[{ label: '部门管理' }]}
      title="部门管理"
      headerAction={
        <div className="flex items-center gap-3">
          <div className="flex rounded-lg border border-[#E2E8F0] bg-white p-0.5">
            <button
              onClick={() => setViewMode('table')}
              className={`inline-flex items-center gap-1.5 rounded px-3 py-1.5 text-sm font-medium transition-colors ${viewMode === 'table' ? 'bg-[#2563EB] text-white' : 'text-[#64748B] hover:text-[#1E293B]'}`}
            >
              <List size={14} />表格视图
            </button>
            <button
              onClick={() => setViewMode('tree')}
              className={`inline-flex items-center gap-1.5 rounded px-3 py-1.5 text-sm font-medium transition-colors ${viewMode === 'tree' ? 'bg-[#2563EB] text-white' : 'text-[#64748B] hover:text-[#1E293B]'}`}
            >
              <View size={14} />树形视图
            </button>
          </div>
          <Button onClick={() => setDialogState({ mode: 'create', item: null })} className="bg-[#2563EB] hover:bg-[#1D4ED8] text-white">
            <Plus size={16} className="mr-1.5" />新增部门
          </Button>
        </div>
      }
    >
      {viewMode === 'table' ? (
        <>
          <div className="mb-4 flex flex-wrap items-center gap-3">
            <Input value={search} onChange={e => setSearch(e.target.value)} placeholder="搜索部门名称/编码…" className="w-64 bg-white" />
            <Select value={status} onValueChange={setStatus}>
              <SelectTrigger className="w-32 bg-white"><SelectValue placeholder="全部状态" /></SelectTrigger>
              <SelectContent><SelectItem value="">全部状态</SelectItem><SelectItem value="1">启用</SelectItem><SelectItem value="0">禁用</SelectItem></SelectContent>
            </Select>
          </div>

          <ImportPanel onImported={loadTableData} />

          <div className="overflow-hidden rounded-lg border border-[#E2E8F0] bg-white">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-[#E2E8F0] bg-[#F8FAFC]">
                  <th className="px-4 py-3 text-left font-medium text-[#64748B]">部门编码</th>
                  <th className="px-4 py-3 text-left font-medium text-[#64748B]">部门名称</th>
                  <th className="px-4 py-3 text-left font-medium text-[#64748B]">上级部门</th>
                  <th className="px-4 py-3 text-left font-medium text-[#64748B]">负责人</th>
                  <th className="px-4 py-3 text-left font-medium text-[#64748B]">员工人数</th>
                  <th className="px-4 py-3 text-left font-medium text-[#64748B]">状态</th>
                  <th className="px-4 py-3 text-right font-medium text-[#64748B]">操作</th>
                </tr>
              </thead>
              <tbody>
                {loading ? [...Array(4)].map((_, i) => (
                  <tr key={i} className="border-b border-[#F1F5F9]">
                    <td colSpan={7} className="px-4 py-3"><div className="h-4 animate-pulse rounded bg-[#F1F5F9]" /></td>
                  </tr>
                )) : depts.length === 0 ? (
                  <tr><td colSpan={7} className="px-4 py-16 text-center text-[#94A3B8]">暂无数据</td></tr>
                ) : depts.map(item => (
                  <tr key={item.id} className="border-b border-[#F1F5F9] transition-colors hover:bg-[#F8FAFC]">
                    <td className="px-4 py-3 text-[#64748B]">{item.dept_code || '-'}</td>
                    <td className="px-4 py-3 font-medium text-[#1E293B]">{item.dept_name}</td>
                    <td className="px-4 py-3 text-[#64748B]">{deptList.find(d => d.id === item.parent_id)?.dept_name || (item.parent_id === 0 ? '-' : '-')}</td>
                    <td className="px-4 py-3 text-[#64748B]">{item.leader_name || '-'}</td>
                    <td className="px-4 py-3 text-[#64748B]">{item.employee_count}</td>
                    <td className="px-4 py-3"><StatusBadge status={item.status} /></td>
                    <td className="px-4 py-3">
                      <div className="flex items-center justify-end gap-2">
                        <button onClick={() => handleEdit(item)} className="inline-flex items-center gap-1 rounded px-2 py-1 text-xs text-[#2563EB] hover:bg-blue-50 hover:underline">
                          <Pencil size={13} />编辑
                        </button>
                        <button onClick={() => handleDeleteClick(item)} className="inline-flex items-center gap-1 rounded px-2 py-1 text-xs text-red-500 hover:bg-red-50 hover:underline">
                          <Trash2 size={13} />删除
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <Pagination page={page} pageSize={pageSize} total={total} onChange={setPage} onPageSizeChange={(size) => { setPageSize(size); setPage(1); }} />
        </>
      ) : (
        <>
          <div className="mb-4">
            <div className="flex items-center gap-2 text-sm text-[#64748B] mb-3 px-1">
              <span className="font-medium text-[#1E293B]">操作提示：</span>点击节点可展开/折叠子部门，悬停显示操作按钮
            </div>
            <DeptTreeView
              treeData={deptTree}
              selectedParentId={dialogState?.parentId ?? null}
              onAddChild={handleAddChild}
              onEdit={handleEdit}
              onDelete={handleDeleteClick}
            />
          </div>
        </>
      )}

      {dialogState && (
        <DeptDialog
          mode={dialogState.mode}
          item={dialogState.item}
          parentId={dialogState.parentId}
          deptList={deptList}
          onClose={() => setDialogState(null)}
          onSuccess={() => {
            setDialogState(null);
            loadTableData();
            loadTreeData();
            loadDeptList();
          }}
        />
      )}
      <ConfirmDialog
        open={!!deleteTarget}
        title="确认删除部门"
        description={`确定要删除「${deleteTarget?.dept_name}」吗？`}
        confirmLabel="删除"
        onConfirm={handleDelete}
        onCancel={() => setDeleteTarget(null)}
        loading={deleting}
      />
    </AdminLayout>
  );
}