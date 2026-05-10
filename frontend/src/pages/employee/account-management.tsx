import { ChangeEvent, FormEvent, useCallback, useEffect, useRef, useState } from 'react';
import { AdminLayout } from '@/components/layout/admin-layout';
import { ConfirmDialog } from '@/components/common/confirm-dialog';
import { Pagination } from '@/components/common/pagination';
import { deptApi } from '@/api/employee/depts';
import { employeeAccountManagementApi } from '@/api/employee/account-management';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useDebounce } from '@/hooks/use-debounce';
import type { IDeptItem, IEmployeeImportResult, IManagedEmployee, IManagedUser } from '@/types/employee';
import { Info, Loader2, Pencil, Plus, RefreshCw, RotateCcw, Trash2, Upload, X } from 'lucide-react';

type ActiveTab = 'users' | 'employees';
type DialogMode = 'create' | 'edit';
type AccountItem = IManagedUser | IManagedEmployee;

const DEFAULT_PAGE_SIZE = 10;
const REFRESH_THROTTLE_MS = 1500;

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

function getStatusName(tab: ActiveTab, status: number | string): string {
  const value = String(status);
  if (tab === 'employees') return value === '1' ? '在职' : '离职';
  return value === '1' ? '正常' : '禁用';
}

function StatusBadge({ tab, status }: { tab: ActiveTab; status: number }) {
  return status === 1
    ? <Badge className="bg-green-100 text-green-700 border-green-200">{getStatusName(tab, status)}</Badge>
    : <Badge className="bg-[#F1F5F9] text-[#64748B] border-[#E2E8F0]">{getStatusName(tab, status)}</Badge>;
}

interface AccountDialogProps {
  tab: ActiveTab;
  mode: DialogMode;
  item: AccountItem | null;
  deptList: IDeptItem[];
  onClose: () => void;
  onSuccess: () => void;
}

function AccountDialog({ tab, mode, item, deptList, onClose, onSuccess }: AccountDialogProps) {
  const user = tab === 'users' ? item as IManagedUser | null : null;
  const employee = tab === 'employees' ? item as IManagedEmployee | null : null;
  const [userForm, setUserForm] = useState({
    email: user?.email ?? '',
    real_name: user?.real_name ?? '',
    password: '',
    status: String(user?.status ?? 1),
  });
  const [employeeForm, setEmployeeForm] = useState({
    emp_no: employee?.emp_no ?? '',
    real_name: employee?.real_name ?? '',
    email: employee?.email ?? '',
    phone: employee?.phone ?? '',
    dept_id: employee?.dept_id ?? 0,
    password: '',
    status: String(employee?.status ?? 1),
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault();
    setSaving(true);
    setError('');
    try {
      if (tab === 'users') {
        const payload: { email: string; real_name: string; password?: string; status: number } = { ...userForm, status: Number(userForm.status) };
        if (mode === 'edit' && !payload.password) payload.password = undefined;
        if (mode === 'create') await employeeAccountManagementApi.createUser(payload);
        else if (user) await employeeAccountManagementApi.updateUser(user.id, payload);
      } else {
        const payload: { emp_no: string; real_name: string; email: string; phone: string; dept_id: number; password?: string; status: number } = { ...employeeForm, status: Number(employeeForm.status) };
        if (mode === 'edit' && !payload.password) payload.password = undefined;
        if (mode === 'create') await employeeAccountManagementApi.createEmployee(payload);
        else if (employee) await employeeAccountManagementApi.updateEmployee(employee.id, payload);
      }
      onSuccess();
    } catch (err) {
      setError(getErrorMessage(err, '保存失败，请重试'));
      setSaving(false);
    }
  };

  const isUser = tab === 'users';
  const canSubmit = isUser
    ? userForm.email.trim() && userForm.real_name.trim() && (mode === 'edit' || userForm.password.trim())
    : employeeForm.emp_no.trim() && employeeForm.real_name.trim() && employeeForm.email.trim() && (mode === 'edit' || employeeForm.password.trim());

  return (
    <Dialog open onOpenChange={onClose} containerClassName="max-w-xl">
      <DialogContent>
        <div className="mb-4 flex items-center justify-between">
          <DialogTitle className="mb-0">{mode === 'create' ? '新增' : '编辑'}{isUser ? '用户' : '员工'}</DialogTitle>
          <button onClick={onClose} aria-label="关闭" className="text-[#94A3B8] hover:text-[#1E293B] focus-visible:outline-none">
            <X size={18} />
          </button>
        </div>
        <form onSubmit={handleSubmit} className="space-y-4">
          {isUser ? (
            <>
              <div className="space-y-1.5"><Label>邮箱 <span className="text-red-500">*</span></Label><Input type="email" value={userForm.email} onChange={e => setUserForm({ ...userForm, email: e.target.value })} required /></div>
              <div className="space-y-1.5"><Label>真实姓名 <span className="text-red-500">*</span></Label><Input value={userForm.real_name} onChange={e => setUserForm({ ...userForm, real_name: e.target.value })} required /></div>
              <div className="space-y-1.5"><Label>密码 {mode === 'create' && <span className="text-red-500">*</span>}</Label><Input type="password" value={userForm.password} onChange={e => setUserForm({ ...userForm, password: e.target.value })} placeholder={mode === 'edit' ? '不填写则不修改密码' : ''} required={mode === 'create'} /></div>
            </>
          ) : (
            <>
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <div className="space-y-1.5"><Label>员工工号 <span className="text-red-500">*</span></Label><Input value={employeeForm.emp_no} onChange={e => setEmployeeForm({ ...employeeForm, emp_no: e.target.value })} required /></div>
                <div className="space-y-1.5"><Label>真实姓名 <span className="text-red-500">*</span></Label><Input value={employeeForm.real_name} onChange={e => setEmployeeForm({ ...employeeForm, real_name: e.target.value })} required /></div>
              </div>
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <div className="space-y-1.5"><Label>邮箱 <span className="text-red-500">*</span></Label><Input type="email" value={employeeForm.email} onChange={e => setEmployeeForm({ ...employeeForm, email: e.target.value })} required /></div>
                <div className="space-y-1.5"><Label>手机号</Label><Input value={employeeForm.phone} onChange={e => setEmployeeForm({ ...employeeForm, phone: e.target.value })} /></div>
              </div>
              <div className="space-y-1.5">
                <Label>所属部门</Label>
                <Select value={String(employeeForm.dept_id)} onValueChange={(value) => setEmployeeForm({ ...employeeForm, dept_id: Number(value) })}>
                  <SelectTrigger>{deptList.find(dept => dept.id === employeeForm.dept_id)?.dept_name ?? '未分配'}</SelectTrigger>
                  <SelectContent>
                    <SelectItem value="0">未分配</SelectItem>
                    {deptList.map(dept => (
                      <SelectItem key={dept.id} value={String(dept.id)}>{dept.dept_name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5"><Label>密码 {mode === 'create' && <span className="text-red-500">*</span>}</Label><Input type="password" value={employeeForm.password} onChange={e => setEmployeeForm({ ...employeeForm, password: e.target.value })} placeholder={mode === 'edit' ? '不填写则不修改密码' : ''} required={mode === 'create'} /></div>
            </>
          )}
          <div className="space-y-1.5">
            <Label>状态</Label>
            <Select value={isUser ? userForm.status : employeeForm.status} onValueChange={(value) => isUser ? setUserForm({ ...userForm, status: value }) : setEmployeeForm({ ...employeeForm, status: value })}>
              <SelectTrigger>{getStatusName(tab, isUser ? userForm.status : employeeForm.status)}</SelectTrigger>
              <SelectContent>
                <SelectItem value="1">{getStatusName(tab, 1)}</SelectItem>
                <SelectItem value="0">{getStatusName(tab, 0)}</SelectItem>
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
  const [result, setResult] = useState<IEmployeeImportResult | null>(null);
  const [error, setError] = useState('');

  const handleFileChange = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    setImporting(true);
    setError('');
    setResult(null);
    try {
      const res = await employeeAccountManagementApi.importEmployees(file);
      setResult(getResponseData<IEmployeeImportResult>(res, { success_count: 0, fail_count: 0, errors: [] }));
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
          {importing ? <><Loader2 size={14} className="mr-1.5 animate-spin" />导入中…</> : <><Upload size={15} className="mr-1.5" />导入员工</>}
        </Button>
        <div className="group relative inline-flex items-center gap-1.5 rounded-full border border-blue-100 bg-blue-50 px-3 py-1.5 text-sm text-blue-700">
          <Info size={14} />
          导入说明
          <div className="pointer-events-none absolute left-0 top-full z-20 mt-2 hidden w-[360px] rounded-lg border border-[#E2E8F0] bg-white p-3 text-sm text-[#334155] shadow-lg group-hover:block">
            <p className="font-medium text-[#1E293B]">员工批量导入仅支持 CSV 文件</p>
            <p className="mt-1">必填列：emp_no、real_name、email、password。</p>
            <p className="mt-1">可选列：phone、status。status 只能填写 1 或 0，未填写默认正常。</p>
            <p className="mt-1">CSV 表头只能包含：emp_no, real_name, email, phone, password, status。</p>
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

interface EmployeeDeptAssignDialogProps {
  employee: IManagedEmployee;
  deptList: IDeptItem[];
  onClose: () => void;
  onSuccess: () => void;
}

function EmployeeDeptAssignDialog({ employee, deptList, onClose, onSuccess }: EmployeeDeptAssignDialogProps) {
  const initialDeptIds = employee.depts?.map(item => item.dept_id) ?? (employee.dept_id ? [employee.dept_id] : []);
  const [selectedDeptIds, setSelectedDeptIds] = useState<number[]>(initialDeptIds);
  const [primaryDeptId, setPrimaryDeptId] = useState(employee.depts?.find(item => item.is_primary === 1)?.dept_id ?? employee.dept_id ?? 0);
  const [saving, setSaving] = useState(false);

  const handleToggleDept = (deptId: number) => {
    setSelectedDeptIds(prev => {
      if (prev.includes(deptId)) {
        const next = prev.filter(item => item !== deptId);
        if (primaryDeptId === deptId) setPrimaryDeptId(next[0] ?? 0);
        return next;
      }
      if (!primaryDeptId) setPrimaryDeptId(deptId);
      return [...prev, deptId];
    });
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      await employeeAccountManagementApi.updateEmployee(employee.id, {
        dept_ids: selectedDeptIds,
        primary_dept_id: selectedDeptIds.length ? primaryDeptId : undefined,
      });
      onSuccess();
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open onOpenChange={onClose} containerClassName="max-w-xl">
      <DialogContent>
        <div className="mb-4 flex items-center justify-between">
          <DialogTitle className="mb-0">分配部门</DialogTitle>
          <button onClick={onClose} aria-label="关闭" className="text-[#94A3B8] hover:text-[#1E293B] focus-visible:outline-none">
            <X size={18} />
          </button>
        </div>
        <div className="mb-3 text-sm text-[#64748B]">员工：{employee.real_name}</div>
        <div className="max-h-80 overflow-auto rounded-lg border border-[#E2E8F0]">
          {deptList.length === 0 ? (
            <div className="px-4 py-10 text-center text-sm text-[#94A3B8]">暂无可选部门</div>
          ) : deptList.map(dept => {
            const checked = selectedDeptIds.includes(dept.id);
            return (
              <div key={dept.id} className="flex items-center gap-3 border-b border-[#F1F5F9] px-4 py-3 text-sm hover:bg-[#F8FAFC] last:border-b-0">
                <input type="checkbox" checked={checked} onChange={() => handleToggleDept(dept.id)} />
                <span className="flex-1 font-medium text-[#1E293B]">{dept.dept_name}</span>
                <label className={`inline-flex items-center gap-1.5 text-xs ${checked ? 'text-[#2563EB]' : 'text-[#CBD5E1]'}`}>
                  <input type="radio" checked={primaryDeptId === dept.id} disabled={!checked} onChange={() => setPrimaryDeptId(dept.id)} />
                  主部门
                </label>
              </div>
            );
          })}
        </div>
        <div className="mt-4 flex justify-end gap-2">
          <Button type="button" variant="outline" onClick={onClose} disabled={saving}>关闭</Button>
          <Button type="button" onClick={handleSave} disabled={saving || (selectedDeptIds.length > 0 && !primaryDeptId)} className="bg-[#2563EB] hover:bg-[#1D4ED8] text-white">
            {saving ? <><Loader2 size={14} className="mr-1.5 animate-spin" />保存中…</> : '保存'}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

interface EmployeeAccountManagementProps {
  tab?: ActiveTab;
}

export default function EmployeeAccountManagement({ tab = 'users' }: EmployeeAccountManagementProps) {
  const activeTab = tab;
  const [users, setUsers] = useState<IManagedUser[]>([]);
  const [employees, setEmployees] = useState<IManagedEmployee[]>([]);
  const [deptList, setDeptList] = useState<IDeptItem[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(DEFAULT_PAGE_SIZE);
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState('');
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const lastRefreshAtRef = useRef(0);
  const [dialogState, setDialogState] = useState<{ mode: DialogMode; item: AccountItem | null } | null>(null);
  const [deptTarget, setDeptTarget] = useState<IManagedEmployee | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<AccountItem | null>(null);
  const [deleting, setDeleting] = useState(false);
  const debouncedSearch = useDebounce(search, 350);

  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      const params: Record<string, string | number> = { page, page_size: pageSize };
      if (debouncedSearch) params.search = debouncedSearch;
      if (status) params.status = Number(status);
      if (activeTab === 'users') {
        const res = await employeeAccountManagementApi.listUsers(params);
        const data = getResponseData<{ total: number; items: IManagedUser[] }>(res, { total: 0, items: [] });
        setUsers(data.items ?? []);
        setTotal(data.total ?? 0);
      } else {
        const res = await employeeAccountManagementApi.listEmployees(params);
        const data = getResponseData<{ total: number; items: IManagedEmployee[] }>(res, { total: 0, items: [] });
        setEmployees(data.items ?? []);
        setTotal(data.total ?? 0);
      }
    } finally {
      setLoading(false);
    }
  }, [activeTab, debouncedSearch, page, pageSize, status]);

  const loadDeptList = useCallback(async () => {
    try {
      const res = await deptApi.listDepts();
      const data = getResponseData<IDeptItem[]>(res, []);
      setDeptList(data);
    } catch (err) {
      console.error('Failed to load dept list', err);
    }
  }, []);

  useEffect(() => { loadData(); }, [loadData]);
  useEffect(() => { if (activeTab === 'employees') loadDeptList(); }, [activeTab, loadDeptList]);
  useEffect(() => { setPage(1); }, [activeTab, debouncedSearch, status]);

  const handleDelete = async () => {
    if (!deleteTarget) return;
    setDeleting(true);
    try {
      if (activeTab === 'users') await employeeAccountManagementApi.deleteUser(deleteTarget.id);
      else await employeeAccountManagementApi.deleteEmployee(deleteTarget.id);
      setDeleteTarget(null);
      await loadData();
    } finally {
      setDeleting(false);
    }
  };

  const items = activeTab === 'users' ? users : employees;
  const pageTitle = activeTab === 'users' ? '用户管理' : '员工管理';

  const handleRefresh = async () => {
    const now = Date.now();
    if (refreshing || now - lastRefreshAtRef.current < REFRESH_THROTTLE_MS) return;
    lastRefreshAtRef.current = now;
    setRefreshing(true);
    try {
      await loadData();
    } finally {
      setRefreshing(false);
    }
  };

  const handleResetFilters = () => {
    setSearch('');
    setStatus('');
    setPage(1);
  };

  const hasActiveFilters = search || status;

  return (
    <AdminLayout
      breadcrumbs={[{ label: pageTitle }]}
      title={pageTitle}
      headerAction={
        <div className="flex items-center gap-3">
          <Button variant="outline" onClick={handleRefresh} disabled={refreshing || loading} className="bg-white">
            <RefreshCw size={16} className={`mr-1.5 ${refreshing ? 'animate-spin' : ''}`} />刷新
          </Button>
          <Button onClick={() => setDialogState({ mode: 'create', item: null })} className="bg-[#2563EB] hover:bg-[#1D4ED8] text-white"><Plus size={16} className="mr-1.5" />新增{activeTab === 'users' ? '用户' : '员工'}</Button>
        </div>
      }
    >
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <Input value={search} onChange={e => setSearch(e.target.value)} placeholder="搜索邮箱、姓名、工号…" className="w-64 bg-white" />
        <Select value={status} onValueChange={setStatus}>
          <SelectTrigger className="w-32 bg-white"><SelectValue placeholder="全部状态" /></SelectTrigger>
          <SelectContent><SelectItem value="">全部状态</SelectItem><SelectItem value="1">正常</SelectItem><SelectItem value="0">禁用</SelectItem></SelectContent>
        </Select>
        <Button variant="outline" onClick={handleResetFilters} disabled={!hasActiveFilters} className="bg-white text-[#64748B]">
          <RotateCcw size={14} className="mr-1" />重置
        </Button>
      </div>

      {activeTab === 'employees' && <ImportPanel onImported={loadData} />}

      <div className="overflow-hidden rounded-lg border border-[#E2E8F0] bg-white">
        <table className="w-full text-sm">
          <thead><tr className="border-b border-[#E2E8F0] bg-[#F8FAFC]">
            {activeTab === 'employees' && <th className="px-4 py-3 text-left font-medium text-[#64748B]">工号</th>}
            <th className="px-4 py-3 text-left font-medium text-[#64748B]">姓名</th><th className="px-4 py-3 text-left font-medium text-[#64748B]">邮箱</th>
            {activeTab === 'employees' && <th className="px-4 py-3 text-left font-medium text-[#64748B]">手机号</th>}
            {activeTab === 'employees' && <th className="px-4 py-3 text-left font-medium text-[#64748B]">部门</th>}
            <th className="px-4 py-3 text-left font-medium text-[#64748B]">状态</th><th className="px-4 py-3 text-left font-medium text-[#64748B]">创建时间</th><th className="px-4 py-3 text-right font-medium text-[#64748B]">操作</th>
          </tr></thead>
          <tbody>
            {loading ? [...Array(4)].map((_, i) => <tr key={i} className="border-b border-[#F1F5F9]"><td colSpan={activeTab === 'users' ? 5 : 8} className="px-4 py-3"><div className="h-4 animate-pulse rounded bg-[#F1F5F9]" /></td></tr>)
              : items.length === 0 ? <tr><td colSpan={activeTab === 'users' ? 5 : 8} className="px-4 py-16 text-center text-[#94A3B8]">暂无数据</td></tr>
              : items.map(item => {
                const employee = item as IManagedEmployee;
                return <tr key={item.id} className="border-b border-[#F1F5F9] transition-colors hover:bg-[#F8FAFC]">
                  {activeTab === 'employees' && <td className="px-4 py-3 text-[#64748B]">{employee.emp_no || '-'}</td>}
                  <td className="px-4 py-3 font-medium text-[#1E293B]">{item.real_name}</td><td className="px-4 py-3 text-[#64748B]">{item.email || '-'}</td>
                  {activeTab === 'employees' && <td className="px-4 py-3 text-[#64748B]">{employee.phone || '-'}</td>}
                  {activeTab === 'employees' && <td className="px-4 py-3 text-[#64748B]">{employee.dept_name || '-'}</td>}
                  <td className="px-4 py-3"><StatusBadge tab={activeTab} status={item.status} /></td><td className="px-4 py-3 text-[#64748B]">{item.create_time ? item.create_time.slice(0, 10) : '-'}</td>
                  <td className="px-4 py-3"><div className="flex items-center justify-end gap-2"><button onClick={() => setDialogState({ mode: 'edit', item })} className="inline-flex items-center gap-1 rounded px-2 py-1 text-xs text-[#2563EB] hover:bg-blue-50 hover:underline"><Pencil size={13} />编辑</button>{activeTab === 'employees' && <button onClick={() => setDeptTarget(employee)} className="inline-flex items-center gap-1 rounded px-2 py-1 text-xs text-[#2563EB] hover:bg-blue-50 hover:underline">分配部门</button>}<button onClick={() => setDeleteTarget(item)} className="inline-flex items-center gap-1 rounded px-2 py-1 text-xs text-red-500 hover:bg-red-50 hover:underline"><Trash2 size={13} />删除</button></div></td>
                </tr>;
              })}
          </tbody>
        </table>
      </div>

      <Pagination page={page} pageSize={pageSize} total={total} onChange={setPage} onPageSizeChange={(size) => { setPageSize(size); setPage(1); }} />
      {dialogState && <AccountDialog tab={activeTab} mode={dialogState.mode} item={dialogState.item} deptList={deptList} onClose={() => setDialogState(null)} onSuccess={() => { setDialogState(null); loadData(); }} />}
      {deptTarget && <EmployeeDeptAssignDialog employee={deptTarget} deptList={deptList} onClose={() => setDeptTarget(null)} onSuccess={() => { setDeptTarget(null); loadData(); }} />}
      <ConfirmDialog open={!!deleteTarget} title="确认删除账号" description={`确定要删除「${deleteTarget?.real_name}」吗？`} confirmLabel="删除" onConfirm={handleDelete} onCancel={() => setDeleteTarget(null)} loading={deleting} />
    </AdminLayout>
  );
}
