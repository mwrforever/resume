# 部门管理模块设计

## 1. 概述

部门管理模块提供部门的增删改查及 CSV 数据导入功能，前端参考员工管理模块设计。

## 2. 后端设计

### 2.1 数据模型

**SysDept 表字段：**
- `id`: 主键
- `parent_id`: 上级部门 ID（顶层为 NULL）
- `dept_code`: 部门编码（唯一索引）
- `dept_name`: 部门名称
- `leader_id`: 负责人员工 ID（可为空）
- `sort_order`: 排序号
- `status`: 状态（1=启用，0=禁用）
- `is_deleted`: 软删除标记
- `create_time` / `update_time`: 时间戳

### 2.2 API 端点

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/api/v1/employee/depts` | 分页列表（含负责人姓名、员工人数） |
| GET | `/api/v1/employee/depts/{id}` | 获取单个部门 |
| POST | `/api/v1/employee/depts` | 新增部门 |
| PUT | `/api/v1/employee/depts/{id}` | 更新部门 |
| DELETE | `/api/v1/employee/depts/{id}` | 删除部门 |
| POST | `/api/v1/employee/depts/import` | CSV 导入（重复报错终止） |
| GET | `/api/v1/employee/depts/tree` | 部门树形结构（树形结构页面用） |

### 2.3 CSV 导入规则

- 导入格式：`dept_code,dept_name,parent_code,leader_name,sort_order,status`
- `dept_code` 重复时报错终止，整批导入失败
- `parent_code` 引用不存在时，报错并列出失败行

### 2.4 文件结构

```
backend/app/
├── api/v1/employee/depts.py        # API 路由
├── services/dept_service.py       # 业务逻辑
├── repositories/dept_repo.py       # 数据访问
├── schemas/dept.py                 # Pydantic 模型
└── models/sys_dept.py              # 已存在
```

## 3. 前端设计

### 3.1 页面：部门管理 (`/employee/dept-management`)

**表格列：**
| 列名 | 说明 |
|------|------|
| 部门编码 | dept_code |
| 部门名称 | dept_name |
| 上级部门 | 关联查询上级部门名称 |
| 负责人 | 关联查询 leader_id 对应员工姓名 |
| 员工人数 | COUNT(employee.dept_id) |
| 状态 | 启用/禁用标签 |
| 操作 | 编辑、删除按钮 |

**功能：**
- 搜索：按部门名称、部门编码筛选
- 状态筛选：全部/启用/禁用
- 新增按钮 → 弹窗表单
- 导入按钮 → 展开导入面板

### 3.2 页面：部门树形结构 (`/employee/dept-tree`)

- 左侧/上方展示可折叠树形
- 右侧/下方显示选中部门的详细信息

### 3.3 文件结构

```
frontend/src/
├── api/employee/depts.ts          # API 调用
├── pages/employee/dept-management.tsx
├── pages/employee/dept-tree.tsx
└── types/employee.ts              # 扩展 IDeptItem
```

## 4. 响应数据结构

**列表分页响应：**
```json
{
  "code": 200,
  "message": "success",
  "data": {
    "total": 100,
    "items": [
      {
        "id": 1,
        "dept_code": "D001",
        "dept_name": "研发部",
        "parent_id": null,
        "parent_name": null,
        "leader_id": 5,
        "leader_name": "张三",
        "employee_count": 10,
        "sort_order": 1,
        "status": 1,
        "create_time": "2024-01-01T00:00:00Z",
        "update_time": "2024-01-01T00:00:00Z"
      }
    ]
  }
}
```

**导入响应：**
```json
{
  "code": 200,
  "message": "success",
  "data": {
    "success_count": 50,
    "fail_count": 2,
    "errors": [
      { "line": 5, "message": "部门编码 D005 已存在" },
      { "line": 12, "message": "上级部门编码 D999 不存在" }
    ]
  }
}
```
