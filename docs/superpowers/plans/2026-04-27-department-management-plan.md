# 部门管理模块实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 实现部门管理增删改查、CSV 导入（重复报错终止）、表格/树形视图切换

**Architecture:** 后端在现有 `dept_repo.py`/`dept_service.py`/`depts.py` 基础上修改；前端新建 `depts.ts` API 和 `dept-management.tsx` 页面，参考 `account-management.tsx` 模式

**Tech Stack:** FastAPI + SQLAlchemy + React + Ant Design Tree

---

## 文件映射

| 层级 | 文件 | 动作 |
|------|------|------|
| Backend | `app/schemas/dept.py` | 修改：扩展 DeptItem 含 leader_name/employee_count |
| Backend | `app/services/dept_service.py` | 修改：\_build_item 关联 leader_name；import 去重校验 |
| Backend | `app/repositories/dept_repo.py` | 修改：list_page 需 JOIN employee 表统计人数 |
| Backend | `app/api/v1/employee/depts.py` | 修改：新增 `/tree` 端点 |
| Frontend | `frontend/src/types/employee.ts` | 新增：IDeptItem, IDeptImportResult |
| Frontend | `frontend/src/api/employee/depts.ts` | 新增：CRUD + import + tree API |
| Frontend | `frontend/src/pages/employee/dept-management.tsx` | 新增：表格/树形切换页面 |
| Frontend | `frontend/src/router/index.tsx` | 修改：注册路由 |

---

### Task 1: 后端 Schema 扩展

**Files:**
- Modify: `backend/app/schemas/dept.py`

- [ ] **Step 1: 修改 DeptItem 加入关联字段**

```python
class DeptItem(BaseModel):
    id: int
    parent_id: int = 0
    dept_code: Optional[str] = None
    dept_name: str
    leader_id: Optional[int] = None
    leader_name: Optional[str] = None  # 新增
    employee_count: int = 0  # 新增
    sort_order: int = 0
    status: int = 1
    create_time: Optional[datetime] = None
    update_time: Optional[datetime] = None

    class Config:
        from_attributes = True
```

- [ ] **Step 2: 修改 DeptImportResult 明确 errors 类型**

```python
class DeptImportError(BaseModel):
    line: int
    message: str

class DeptImportResult(BaseModel):
    success_count: int
    fail_count: int
    errors: list[DeptImportError]
```

- [ ] **Step 3: 提交**

```bash
git add backend/app/schemas/dept.py
git commit -m "feat(dept): extend DeptItem with leader_name and employee_count"
```

---

### Task 2: 后端 Repository 修改

**Files:**
- Modify: `backend/app/repositories/dept_repo.py`

- [ ] **Step 1: list_page 改为 JOIN 统计员工人数**

当前 list_page 只查 SysDept，需要改为 JOIN employee 表统计每个部门的员工数。

在 `DeptRepository` 类中添加新方法 `list_page_with_stats`：

```python
async def list_page_with_stats(
    self, skip: int = 0, limit: int = 20, status: int = None, search: str = None
) -> list[dict]:
    from app.models.sys_employee import SysEmployee
    from sqlalchemy import func, or_

    base_query = select(SysDept).where(SysDept.is_deleted == 0)
    if status is not None:
        base_query = base_query.where(SysDept.status == status)
    if search:
        base_query = base_query.where(
            or_(SysDept.dept_name.ilike(f"%{search}%"), SysDept.dept_code.ilike(f"%{search}%"))
        )

    # 获取部门列表
    depts_result = await self.db.execute(
        base_query.order_by(SysDept.sort_order.asc(), SysDept.id.desc()).offset(skip).limit(limit)
    )
    depts = depts_result.scalars().all()

    if not depts:
        return []

    # 批量查询员工人数
    dept_ids = [d.id for d in depts]
    count_query = (
        select(SysEmployee.dept_id, func.count(SysEmployee.id))
        .where(SysEmployee.dept_id.in_(dept_ids), SysEmployee.is_deleted == 0)
        .group_by(SysEmployee.dept_id)
    )
    count_result = await self.db.execute(count_query)
    count_map = dict(count_result.all())

    # 组装结果
    items = []
    for dept in depts:
        items.append({
            "id": dept.id,
            "parent_id": dept.parent_id or 0,
            "dept_code": dept.dept_code,
            "dept_name": dept.dept_name,
            "leader_id": dept.leader_id,
            "sort_order": dept.sort_order,
            "status": dept.status,
            "employee_count": count_map.get(dept.id, 0),
            "create_time": dept.create_time,
            "update_time": dept.update_time,
        })
    return items
```

- [ ] **Step 2: 添加 get_count_children_ids 方法（用于树形结构）**

```python
async def get_children_recursive(self, parent_id: int) -> list[int]:
    """递归获取所有子部门 ID"""
    result = await self.db.execute(
        select(SysDept.id).where(SysDept.parent_id == parent_id, SysDept.is_deleted == 0)
    )
    child_ids = list(result.scalars().all())
    for cid in child_ids[:]:
        child_ids.extend(await self.get_children_recursive(cid))
    return child_ids
```

- [ ] **Step 3: 提交**

```bash
git add backend/app/repositories/dept_repo.py
git commit -m "feat(dept): add list_page_with_stats and get_children_recursive"
```

---

### Task 3: 后端 Service 修改

**Files:**
- Modify: `backend/app/services/dept_service.py`

- [ ] **Step 1: 修改 list_page 使用 list_page_with_stats**

将 `list_page` 方法中的 `items = [await self._build_item(dept) for dept in depts]` 替换为使用新的 `list_page_with_stats`，并补充 leader_name 查询。

```python
async def list_page(self, page: int, page_size: int, status: int = None, search: str = None) -> dict[str, Any]:
    skip = (page - 1) * page_size
    depts = await self.repo.list_page_with_stats(skip=skip, limit=page_size, status=status, search=search)
    total = await self.repo.get_count(status=status, search=search)

    # 补充 leader_name
    leader_ids = {d["leader_id"] for d in depts if d.get("leader_id")}
    leader_names: dict[int, str] = {}
    if leader_ids:
        from app.repositories.employee_repo import EmployeeRepository
        emp_repo = EmployeeRepository(self.repo.db)
        for emp_id in leader_ids:
            emp = await emp_repo.get_by_id(emp_id)
            if emp:
                leader_names[emp_id] = emp.real_name

    for item in depts:
        item["leader_name"] = leader_names.get(item["leader_id"])

    return {"total": total, "items": depts}
```

- [ ] **Step 2: 修改 import_depts 去重逻辑（重复报错终止）**

当前 import_depts 允许重复导入。按设计需求，发现 dept_code 重复时应报错终止整批导入。

在 `_validate_import_row` 之前，先扫描所有 row 的 dept_code，若有重复直接报错：

```python
async def import_depts(self, content: bytes) -> dict[str, Any]:
    # ... CSV 解析 ...
    # 扫描重复 dept_code
    seen_codes: set[str] = set()
    for row in reader:
        code = (row.get("dept_code") or "").strip()
        if code:
            if code in seen_codes:
                raise ValidationError(f"CSV 中部门编码 {code} 重复出现")
            existing = await self.repo.get_by_code(code)
            if existing:
                raise ValidationError(f"部门编码 {code} 在系统中已存在")
            seen_codes.add(code)
```

- [ ] **Step 3: 添加 tree 方法**

```python
async def get_tree(self) -> list[dict]:
    """获取部门树形结构"""
    depts = await self.repo.list_active()
    # 构建 id->dept 映射
    dept_map = {d.id: d for d in depts}
    # 构建 children
    children_map: dict[int, list[dict]] = {}
    for d in depts:
        children_map.setdefault(d.parent_id or 0, [])

    items = []
    for d in depts:
        item = {
            "id": d.id,
            "key": d.id,
            "title": d.dept_name,
            "dept_code": d.dept_code,
            "parent_id": d.parent_id or 0,
            "leader_id": d.leader_id,
            "status": d.status,
            "sort_order": d.sort_order,
            "children": [],
        }
        children_map.setdefault(d.id, []).append(item)

    # 补充 children 到父节点
    for item in items:
        item["children"] = children_map.get(item["id"], [])

    return children_map.get(0, [])
```

- [ ] **Step 4: 提交**

```bash
git add backend/app/services/dept_service.py
git commit -m "feat(dept): update list_page with stats, fix import duplicate validation, add get_tree"
```

---

### Task 4: 后端 API 路由修改

**Files:**
- Modify: `backend/app/api/v1/employee/depts.py`

- [ ] **Step 1: 添加 /tree 端点**

```python
@router.get("/tree", response_model=ApiResponse)
async def get_dept_tree(
    service: DeptService = Depends(get_service),
    current_user: dict = Depends(get_current_user),
) -> ApiResponse:
    data = await service.get_tree()
    return ApiResponse(data=data)
```

- [ ] **Step 2: 提交**

```bash
git add backend/app/api/v1/employee/depts.py
git commit -m "feat(dept): add /tree endpoint for hierarchical view"
```

---

### Task 5: 前端类型定义

**Files:**
- Modify: `frontend/src/types/employee.ts`

- [ ] **Step 1: 添加部门相关类型**

```typescript
export interface IDeptItem {
  id: number;
  parent_id: number;
  dept_code?: string;
  dept_name: string;
  leader_id?: number;
  leader_name?: string;
  employee_count: number;
  sort_order: number;
  status: number;
  create_time?: string;
  update_time?: string;
}

export interface IDeptImportResult {
  success_count: number;
  fail_count: number;
  errors: Array<{ line: number; message: string }>;
}

export interface IDeptTreeItem extends IDeptItem {
  key: number;
  title: string;
  children: IDeptTreeItem[];
}
```

- [ ] **Step 2: 提交**

```bash
git add frontend/src/types/employee.ts
git commit -m "feat(dept): add IDeptItem, IDeptImportResult, IDeptTreeItem types"
```

---

### Task 6: 前端 API 模块

**Files:**
- Create: `frontend/src/api/employee/depts.ts`

- [ ] **Step 1: 编写 API 调用**

```typescript
import client from '@/api/client';
import type { IDeptItem, IDeptImportResult } from '@/types/employee';

export interface DeptListParams {
  page?: number;
  page_size?: number;
  status?: number;
  search?: string;
}

export type DeptPayload = Omit<IDeptItem, 'id' | 'create_time' | 'update_time' | 'leader_name' | 'employee_count'>;

export const deptApi = {
  listDepts: (params?: DeptListParams) =>
    client.get('/employee/depts', { params }),

  getDept: (id: number) =>
    client.get(`/employee/depts/${id}`) as Promise<{ code: number; data: IDeptItem }>,

  createDept: (data: DeptPayload) =>
    client.post('/employee/depts', data) as Promise<{ code: number; data: IDeptItem }>,

  updateDept: (id: number, data: Partial<DeptPayload>) =>
    client.put(`/employee/depts/${id}`, data) as Promise<{ code: number; data: IDeptItem }>,

  deleteDept: (id: number) =>
    client.delete(`/employee/depts/${id}`),

  importDepts: (file: File) => {
    const formData = new FormData();
    formData.append('file', file);
    return client.post('/employee/depts/import', formData) as Promise<{ code: number; data: IDeptImportResult }>;
  },

  getDeptTree: () =>
    client.get('/employee/depts/tree') as Promise<{ code: number; data: IDeptTreeItem[] }>,
};
```

- [ ] **Step 2: 提交**

```bash
git add frontend/src/api/employee/depts.ts
git commit -m "feat(dept): add dept API module"
```

---

### Task 7: 前端部门管理页面

**Files:**
- Create: `frontend/src/pages/employee/dept-management.tsx`

- [ ] **Step 1: 表格视图实现**

参考 account-management.tsx 结构，实现：
- AdminLayout + 面包屑 + 头部新增按钮
- 搜索框 + 状态筛选
- 表格展示：部门编码、部门名称、上级部门（根据 parent_id 查表显示）、负责人、员工人数、状态、操作按钮
- 分页组件
- 新增/编辑弹窗表单（含上级部门下拉选择）
- 删除确认弹窗

- [ ] **Step 2: 树形视图实现**

- 视图切换按钮（表格/树形）
- 使用 Ant Design Tree 组件展示树形
- 树节点：显示部门名称、负责人、员工人数、状态
- 节点操作按钮：添加子部门、编辑、删除
- 新增子部门时自动带入 parent_id

- [ ] **Step 3: 导入面板**

同 account-management.tsx 的 ImportPanel，包含 CSV 格式说明

- [ ] **Step 4: 提交**

```bash
git add frontend/src/pages/employee/dept-management.tsx
git commit -m "feat(dept): add dept-management page with table/tree toggle"
```

---

### Task 8: 前端路由注册

**Files:**
- Modify: `frontend/src/router/index.tsx`（或对应路由配置文件）

- [ ] **Step 1: 注册页面路由**

```typescript
{
  path: '/employee/dept-management',
  element: <DeptManagement />,
}
```

- [ ] **Step 2: 提交**

```bash
git add frontend/src/router/index.tsx
git commit -m "feat(dept): register dept-management route"
```

---

## 实施检查清单

| # | 任务 | 状态 |
|---|------|------|
| 1 | 后端 Schema 扩展 |  |
| 2 | 后端 Repository 修改 |  |
| 3 | 后端 Service 修改 |  |
| 4 | 后端 API /tree 端点 |  |
| 5 | 前端类型定义 |  |
| 6 | 前端 API 模块 |  |
| 7 | 前端部门管理页面 |  |
| 8 | 前端路由注册 |  |

---

## 实施后验证

1. 启动后端服务，手动测试各 API 端点
2. 启动前端服务，访问 /employee/dept-management
3. 测试新增/编辑/删除部门
4. 测试 CSV 导入（重复 dept_code 场景）
5. 测试表格视图和树形视图切换
6. 测试树形视图下添加子部门
