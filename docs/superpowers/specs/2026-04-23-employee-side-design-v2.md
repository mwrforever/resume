# 员工端功能设计文档 v2

> 本文档基于原始设计文档（2026-04-22）重建，去除 RBAC 权限体系，升级前端为后台管理系统风格。作为实现依据。

---

## 零、实现范围与边界约束

> ⚠️ **本节为强制约束，实现时必须遵守。**

### 0.1 本文档仅覆盖员工端

本文档所有设计变更**仅适用于 `/employee/*` 路由及其对应的前端代码**，具体包括：

- `frontend/src/pages/employee/` 下的所有页面
- `frontend/src/components/layout/employee-nav.tsx`、`page-layout.tsx`（将被替换为 `AdminLayout`/`Sidebar`）
- `frontend/src/api/employee/` 下的 API 调用层

### 0.2 用户端（求职者端）严禁改动

以下内容**在本次实现中必须完全不受影响**：

| 范围 | 说明 |
|------|------|
| `/user/*` 路由 | 求职者端所有页面保持现状 |
| `frontend/src/pages/user/` | 所有用户端页面文件禁止修改 |
| `frontend/src/components/layout/user-nav.tsx` | 用户端导航组件禁止修改 |
| `frontend/src/api/user/` | 用户端 API 调用层禁止修改 |
| `frontend/src/store/auth.ts` | 认证状态管理如需改动，须向下兼容，不破坏用户端登录流程 |
| `App.tsx` 中用户端路由配置 | 禁止删除或修改 `/user/*` 路由声明 |
| 后端 `/api/v1/user/*` 接口 | 禁止修改用户端接口逻辑 |

### 0.3 共享代码修改原则

对 `frontend/src/` 下的**共享模块**（如 `lib/utils.ts`、`components/ui/`、`store/auth.ts`）进行修改时：
- 必须向下兼容，不破坏用户端现有调用
- 若需新增内容，优先新建文件而非修改现有文件
- 修改前需确认该文件是否被用户端引用（`grep` 检查）

---

## 一、总体说明

### 1.1 角色定义

本系统员工端采用**单一员工角色**模型，所有完成登录的员工拥有相同的系统访问权限，无需区分 HR 与超级管理员。

### 1.2 访问控制

- **鉴权方式**：JWT Token（登录后颁发，存于 localStorage）
- **接口鉴权**：所有 `/api/v1/employee/*` 接口仅校验 Token 有效性，不做角色/部门级别的数据隔离
- **前端路由守卫**：未登录用户重定向至 `/employee/login`

### 1.3 部门说明

岗位保留部门字段，仅用于**展示与筛选**，不作为数据访问隔离的依据。

---

## 二、页面结构

```
/employee
├── /login                        # 员工登录
├── /dashboard                    # 工作台（数据统计 + 最近动态）
├── /jobs                         # 岗位管理
│   ├── /jobs                     # 岗位列表（Table）
│   ├── /jobs/create              # 创建岗位（+AI生成技能）
│   └── /jobs/:id/edit            # 编辑岗位
├── /resumes                      # 简历库
│   ├── /resumes                  # 全部简历（Tab: 全部/待评估）
│   └── /resumes/:id              # 简历详情
├── /evaluations                  # 评估管理
│   ├── /evaluations              # 评估列表（岗位选择 + 匹配度分布）
│   └── /evaluations/:id          # 评估详情 + 雷达图 + 技能命中
├── /applications                 # 投递管理
│   ├── /applications             # 投递列表（Table）
│   └── /applications/:id         # 投递详情
└── /analytics                    # 可视化报表
    └── /analytics/job/:id        # 岗位匹配度报表
```

---

## 三、整体布局设计

### 3.1 布局架构

员工端整体采用**左侧边栏 + 顶部标题栏**的后台管理系统经典布局。

```
┌──────────────┬────────────────────────────────────────────────┐
│              │  顶部标题栏 AdminHeader（56px, sticky）          │
│  左侧边栏    │  [面包屑导航]                [用户名]  [登出]   │
│  Sidebar     ├────────────────────────────────────────────────┤
│  (240px)     │                                                │
│  ┌────────┐  │   主内容区 Main Content                        │
│  │  Logo  │  │   background: #F5F7FA                         │
│  └────────┘  │                                                │
│  ─────────   │   ┌─────────────────────────────────────────┐  │
│  工作台      │   │  页面标题 + 操作按钮区                    │  │
│  岗位管理    │   ├─────────────────────────────────────────┤  │
│  简历库      │   │                                         │  │
│  评估管理    │   │  内容卡片区（白色背景，rounded-lg）       │  │
│  投递管理    │   │                                         │  │
│  数据报表    │   └─────────────────────────────────────────┘  │
│              │                                                │
│  [折叠按钮]  │                                                │
└──────────────┴────────────────────────────────────────────────┘
```

### 3.2 Sidebar 规格

| 属性 | 值 |
|------|-----|
| 宽度（展开） | `240px` |
| 宽度（折叠） | `64px` |
| 背景色 | `#1E293B`（深蓝灰） |
| 选中项背景 | `#2563EB`（主蓝） |
| 选中项文字 | `#FFFFFF` |
| 非选中文字 | `#94A3B8` |
| Hover 背景 | `rgba(255,255,255,0.08)` |
| 折叠过渡 | `transition: width 200ms ease`（不用 `transition: all`） |

**导航项列表**（按顺序）：

| 图标（Lucide） | 标签 | 路径 |
|---------------|------|------|
| `LayoutDashboard` | 工作台 | `/employee/dashboard` |
| `Briefcase` | 岗位管理 | `/employee/jobs` |
| `FileText` | 简历库 | `/employee/resumes` |
| `ClipboardCheck` | 评估管理 | `/employee/evaluations` |
| `Send` | 投递管理 | `/employee/applications` |
| `BarChart2` | 数据报表 | `/employee/analytics` |

折叠态：仅显示图标，图标需带 `aria-label`（对应菜单标签文字）。展开/折叠按钮：`<button aria-label="折叠菜单">` 位于侧边栏底部。

### 3.3 AdminHeader 规格

| 属性 | 值 |
|------|-----|
| 高度 | `56px` |
| 背景色 | `#FFFFFF` |
| 底部边框 | `1px solid #E2E8F0` |
| 定位 | `sticky top-0 z-40` |

**元素组成（左→右）**：
- **面包屑 Breadcrumb**：根据当前路由自动生成，例如 `工作台` / `岗位管理 > 创建岗位`
- **右侧操作区**：用户名（当前登录员工名）+ 登出按钮（`<button>` 元素，hover 变红）

### 3.4 布局组件定义

```typescript
// AdminLayout：整体框架
interface AdminLayoutProps {
  children: ReactNode;
  title: string;           // 页面标题（显示在内容区顶部）
  subtitle?: string;       // 副标题
  headerAction?: ReactNode; // 内容区顶部右侧操作按钮
}

// Sidebar：左侧导航
// - 从 localStorage 读取折叠状态，刷新保持
// - 当前选中项根据 useLocation().pathname 判断（startsWith 匹配）

// AdminHeader：顶部标题栏
// - breadcrumbs 根据路由映射自动生成
// - 用户名从 useAuthStore 读取

// Breadcrumb：面包屑导航
interface BreadcrumbItem {
  label: string;
  href?: string; // 有 href 则可点击跳转
}
```

---

## 四、页面功能详细设计

### 4.1 员工登录 `/employee/login`

**布局**：左右分栏，左侧品牌区 + 右侧登录表单（移动端：仅显示右侧）。

**页面元素**：

#### 左侧品牌区（桌面端可见）
- 背景色：`#1E293B`
- 居中显示：Logo + 系统名称「招聘管理系统」+ 一句话描述

#### 右侧登录表单
- 标题：「员工登录」
- 登录方式 Tab：「密码登录」/「验证码登录」
- **密码登录**：
  - 账号输入框：`type="text"` `name="username"` `autocomplete="username"` `placeholder="员工号或邮箱…"`（`spellCheck={false}`）
  - 密码输入框：`type="password"` `name="password"` `autocomplete="current-password"` `placeholder="请输入密码…"`
- **验证码登录**：
  - 手机/邮箱输入框 + 「发送验证码」按钮（60s 倒计时，期间禁用）
  - 验证码输入框：`type="text"` `inputmode="numeric"` `autocomplete="one-time-code"`
- 登录按钮：提交期间显示 Spinner，禁止重复提交；`type="submit"`
- 表单错误：内联显示于对应字段下方，同时 `aria-live="polite"` 通知屏幕阅读器

**交互流程**：
1. 用户输入凭据 → 前端格式校验
2. `POST /api/v1/employee/auth/login` 或 `POST /api/v1/employee/auth/verify-code`
3. 成功：存储 Token + 用户名 → 跳转 `/employee/dashboard`
4. 失败：字段下方显示错误原因 + 可操作提示（如「密码错误，请重试或找管理员重置」）

**API 接口**：
| 方法 | 路径 | 描述 |
|------|------|------|
| POST | `/api/v1/employee/auth/login` | 账号密码登录 |
| POST | `/api/v1/employee/auth/send-code` | 发送验证码 |
| POST | `/api/v1/employee/auth/verify-code` | 验证码登录 |
| POST | `/api/v1/employee/auth/logout` | 登出 |
| POST | `/api/v1/employee/auth/refresh` | 刷新 Token |

---

### 4.2 工作台 `/employee/dashboard`

**面包屑**：`工作台`

**页面元素**：

#### 4.2.1 统计卡片（4 个，2×2 Grid，lg 端 4 列）

| 指标 | 图标（Lucide） | 数据来源 | 色调 |
|------|---------------|---------|------|
| 在招岗位数 | `Briefcase` | `job_position.status=1` | 蓝色 |
| 简历总数 | `FileText` | `resume` 表总数 | 紫色 |
| 待评估数 | `Clock` | `resume.status=0` 未匹配数量 | 橙色 |
| 平均匹配率 | `TrendingUp` | `resume_job_match.final_score` 均值 | 绿色 |

卡片样式：白色背景、`rounded-lg`、左侧竖线 accent 色条、数字使用 `font-variant-numeric: tabular-nums`。

#### 4.2.2 最近动态（Timeline 风格）
- 显示最近 10 条动态
- 每条：左侧竖线 + 圆点（按类型着色）+ 右侧描述文字 + 时间（`Intl.DateTimeFormat` 格式化）
- 动态类型色点：投递=蓝、评估完成=绿、上传=紫、岗位发布=橙

#### 4.2.3 快捷操作（2×2 Grid）
| 操作 | 图标 | 跳转路径 |
|------|------|---------|
| 发布岗位 | `Plus` | `/employee/jobs/create` |
| 批量评估 | `ClipboardCheck` | `/employee/evaluations` |
| 简历库 | `FileText` | `/employee/resumes` |
| 岗位管理 | `Briefcase` | `/employee/jobs` |

每个快捷入口为 `<Link>` 元素（非 `<div onClick>`），含 hover 状态（边框 + 背景色变化）。

**API 接口**：
| 方法 | 路径 | 描述 |
|------|------|------|
| GET | `/api/v1/employee/analytics/dashboard` | 获取工作台统计数据 |

---

### 4.3 岗位管理 `/employee/jobs`

**面包屑**：`岗位管理`

#### 4.3.1 岗位列表 `/employee/jobs`

**布局**：顶部工具栏 + Table

**顶部工具栏（左→右）**：
- 岗位名称搜索框（`type="search"` `placeholder="搜索岗位名称…"`）
- 部门筛选下拉（Select，含"全部部门"选项）
- 状态筛选下拉（Select：全部 / 招聘中 / 已下架）
- 「+ 创建岗位」按钮（右侧对齐，主色蓝色，`<Link>` 跳转）

> 筛选条件同步到 URL query params（`?department=&status=&search=`），支持刷新保持状态。

**Table 列定义**：

| 列名 | 字段 | 说明 |
|------|------|------|
| 岗位名称 | `name` | 可点击，跳转编辑页 |
| 部门 | `department` | 文字展示 |
| 状态 | `status` | Badge：招聘中=绿色、已下架=灰色 |
| 收到简历数 | `resume_count` | 数字，`tabular-nums` |
| 发布时间 | `create_time` | `Intl.DateTimeFormat` 格式化 |
| 操作 | — | 编辑（`<Link>` 按钮）/ 删除（`<button>`） |

**删除交互**：点击删除按钮 → 弹出 **Dialog 确认框**（`shadcn/ui Dialog`，非 `window.confirm`），确认后调用删除接口，成功后刷新列表，显示 Toast 成功提示。

**加载态**：Table 骨架屏（行高占位），非空白页。

**空状态**：居中插图 + 「还没有岗位，去创建一个」文字 + 「创建岗位」`<Link>` 按钮。

**API 接口**：
| 方法 | 路径 | 描述 |
|------|------|------|
| GET | `/api/v1/employee/jobs` | 岗位列表（支持 `?status=&department=&search=`） |
| DELETE | `/api/v1/employee/jobs/:id` | 删除岗位 |

#### 4.3.2 创建岗位 `/employee/jobs/create`

**面包屑**：`岗位管理 > 创建岗位`

**布局**：两列表单（左侧主信息 + 右侧技能区），移动端单列。

**左侧主信息卡片**：
- 岗位名称（必填，`type="text"` `name="job_name"` `autocomplete="off"`）
- 岗位描述（Textarea，可选）
- 部门选择（Select 下拉，含「无部门」选项）

**右侧技能卡片**：
- 卡片标题：「岗位技能要求」+ 「AI 生成建议」按钮
- **AI 技能建议区块**：
  - 点击按钮：禁用按钮，显示 `Loader2`（`animate-spin`）Spinner + 「正在生成建议…」文字
  - 返回结果后：展示建议列表，每条可一键添加或忽略
  - 错误时：行内提示「生成失败，请重试」+ 重试按钮（错误消息含操作指引）
- **技能列表**（可增删）：
  - 表格样式：技能名称 / 类型 Select（必须满足/优先匹配/普通技能）/ 删除按钮
  - 每条技能删除按钮需 `aria-label="删除技能 {skill_name}"`
  - 底部「添加技能」按钮（`+` 图标）

**底部操作栏**：保存草稿（secondary）/ 发布岗位（primary）按钮，提交中禁用 + Spinner，离开有未保存修改时弹出确认（`beforeunload` 或路由守卫）。

**API 接口**：
| 方法 | 路径 | 描述 |
|------|------|------|
| POST | `/api/v1/employee/jobs` | 创建岗位 |
| POST | `/api/v1/employee/jobs/skill/suggest` | AI 生成技能建议 |

#### 4.3.3 编辑岗位 `/employee/jobs/:id/edit`

**面包屑**：`岗位管理 > 编辑岗位`

- 与创建岗位表单相同，字段预填充
- 额外显示（只读信息卡片）：收到简历数、创建时间
- 状态切换：招聘中 ↔ 已下架（Toggle 按钮）

**API 接口**：
| 方法 | 路径 | 描述 |
|------|------|------|
| GET | `/api/v1/employee/jobs/:id` | 获取岗位详情 |
| PUT | `/api/v1/employee/jobs/:id` | 更新岗位 |

---

### 4.4 简历库 `/employee/resumes`

**面包屑**：`简历库`

#### 4.4.1 简历列表主页 `/employee/resumes`

**布局**：顶部 Tab + 工具栏 + Table

**Tab 切换**（URL query param `?tab=all|pending`）：
- 「全部简历」：`/employee/resumes?tab=all`（默认）
- 「待评估」：`/employee/resumes?tab=pending`（仅 `status=0` 未匹配简历）

**工具栏**：
- 处理状态筛选（Select：全部 / 待处理 / 评估完成 / 处理失败）—— 仅「全部简历」Tab 显示
- 上传时间范围选择（DateRangePicker，可选）

**Table 列定义**：

| 列名 | 字段 | 说明 |
|------|------|------|
| 文件名 | `file_name` | 可点击跳转简历详情页 |
| 上传者 | `user_id` | 显示用户 ID（或姓名，视后端数据） |
| 处理状态 | `status` | Badge：待处理=灰、评估完成=绿、处理失败=红 |
| 上传时间 | `upload_time` | `Intl.DateTimeFormat` |
| 操作 | — | 「查看详情」`<Link>` 按钮 |

**空状态**：Tab 独立空状态文案（「暂无简历」/ 「暂无待评估简历」）。

**API 接口**：
| 方法 | 路径 | 描述 |
|------|------|------|
| GET | `/api/v1/employee/resumes` | 全部简历列表（支持 `?status=&start=&end=`） |
| GET | `/api/v1/employee/resumes/pending` | 待评估简历列表 |

#### 4.4.2 简历详情 `/employee/resumes/:id`

**面包屑**：`简历库 > 简历详情`

**布局**：左侧信息面板（约 30%）+ 右侧预览区（约 70%）。

**左侧信息面板**：
- 基本信息卡片：文件名、上传时间、处理状态 Badge
- 关联投递记录列表（简洁展示：岗位名 + 投递状态 + 时间）
- 评估结果摘要（如有）：匹配度分数 + 标签，点击跳转评估详情

**右侧预览区**（`ResumePreviewDialog` 组件嵌入，非 Dialog 模式）：
- PDF：pdf.js 渲染
- Word：提取文本展示（`<pre>` 带 `break-words`）
- 图片：`<img>` 带 `alt` 和 `width`/`height`
- 不支持格式：提示「暂不支持该格式预览，请下载查看」+ 下载按钮

**API 接口**：
| 方法 | 路径 | 描述 |
|------|------|------|
| GET | `/api/v1/employee/resumes/:id` | 简历详情 |
| GET | `/api/v1/employee/resumes/:id/file` | 获取简历文件流（PDF/图片）或文本（Word） |

---

### 4.5 评估管理 `/employee/evaluations`

#### 4.5.1 评估列表 `/employee/evaluations`

**面包屑**：`评估管理`

**页面布局**：左侧岗位选择面板（280px）+ 中间简历列表 + 右侧操作面板（240px）

##### 左侧：岗位选择面板
- 标题「选择岗位」
- 下拉搜索 Select（`combobox` 模式，支持键入过滤）
- 选中后显示岗位基本信息卡片：名称、部门、状态 Badge

##### 中间：简历列表 + 匹配度分布

**匹配度分布饼图**（`Recharts PieChart`）：
- 数据：优秀 / 良好 / 一般 / 未达标 四类数量及占比
- 颜色：优秀=`#10B981`、良好=`#2563EB`、一般=`#F59E0B`、未达标=`#EF4444`
- 图例在右侧，每项显示数量 + 百分比（`tabular-nums`）

**简历 Table**（按匹配度降序）：

| 列名 | 说明 |
|------|------|
| 简历文件名 | 可点击预览（`ResumePreviewDialog`） |
| 匹配度 | 数字 + Progress bar，`tabular-nums` |
| 标签 | `MatchBadge`（优秀/良好/一般/未达标）|
| 关键技能命中 | 技能名称 tag 列表（最多显示3个） |
| 评估状态 | pending=「待评估」/ processing=「评估中（Spinner）」/ completed=标签 / failed=「失败，可重试」|
| 操作 | 查看详情 `<Link>` |

checkbox 全选 / 单选（用于批量评估）。

##### 右侧：批量评估面板
- 已选简历计数（`N 份简历已选`，`tabular-nums`）
- 目标岗位确认（显示当前选中岗位名）
- 「开始评估」`<button>`（主色，已选 0 时禁用）
- 提交后：立即显示 Toast「评估任务已提交，请稍后查看」，按钮恢复

**评估状态标签说明**：
| `evaluation_status` | 显示 | 样式 |
|---------------------|------|------|
| `pending` | 待评估 | 灰色 Badge |
| `processing` | 评估中 | 蓝色 Badge + `Loader2` Spinner |
| `completed` | 匹配度标签 | `MatchBadge` |
| `failed` | 评估失败，可重试 | 红色 Badge + 重试 `<button>` |

**API 接口**：
| 方法 | 路径 | 描述 |
|------|------|------|
| GET | `/api/v1/employee/jobs` | 获取岗位列表（用于选择） |
| GET | `/api/v1/employee/analytics/job/:job_id/match-distribution` | 匹配度分布（饼图数据） |
| GET | `/api/v1/employee/analytics/job/:job_id/resume-list` | 简历列表（按匹配度降序） |
| POST | `/api/v1/employee/evaluations/batch` | 批量触发评估（Celery 异步） |

#### 4.5.2 评估详情 `/employee/evaluations/:match_id`

**面包屑**：`评估管理 > 评估详情`

**布局**：上方基本信息 + 下方两列（左：雷达图 + 优缺点；右：技能命中 Table）

##### 基本信息卡片（顶部）
- 简历文件名（点击打开 `ResumePreviewDialog`）
- 评估时间（`Intl.DateTimeFormat`）
- 匹配度分数（大号数字 + `tabular-nums`）+ `MatchBadge`
- 匹配度 Progress bar

##### 左列：雷达图 + 优缺点
- `EvaluationRadarChart`（`Recharts RadarChart`）
  - 各维度：技术能力、项目经验、学历背景、稳定性、工作经验等
  - 每个维度显示：名称、得分、优缺点（悬停 Tooltip 展示）
  - 失败维度（`is_completed=false`）：灰色显示 + 「评估异常」提示
- **优点评价**：`AdvantageComment` 组件，绿色图标
- **缺点评价**：`DisadvantageComment` 组件；`disadvantage_comment` 为空时显示「这份好像挺符合岗位预期 🎉」

##### 右列：技能命中详情 Table
| 列名 | 说明 |
|------|------|
| 技能名称 | — |
| 类型 | 必须满足 / 优先匹配 / 普通技能 |
| 命中 | ✓（绿色）/ ✗（灰色）|
| 匹配度 | 优秀/良好/一般/未达标（仅命中时显示） |
| 命中片段 | 「查看片段」`<button>` → Dialog 展示原文 |

命中片段 Dialog：`shadcn/ui Dialog`，显示高亮原文段落。

**API 接口**：
| 方法 | 路径 | 描述 |
|------|------|------|
| GET | `/api/v1/employee/evaluations/:match_id` | 评估详情 |
| GET | `/api/v1/employee/evaluations/:match_id/skill-hits` | 技能命中详情 |

#### 4.5.3 Celery 异步评估设计

**任务流程**：
```
员工提交批量评估请求
        ↓
┌─────────────────────────────────────┐
│ POST /api/v1/employee/evaluations/batch │
│ { resume_ids: [1,2,3], job_id: 5 }  │
└─────────────────────────────────────┘
        ↓
┌─────────────────────────────────────┐
│ 立即返回：{ code: 200, message:     │
│ "评估任务已提交，请稍后查看" }      │
└─────────────────────────────────────┘
        ↓
┌─────────────────────────────────────┐
│ Celery Task: eval_batch_task        │
│ - queue: eval                       │
│ - retry: 3次                        │
│ - retry_backoff: 指数退避 (2s,4s,8s)│
└─────────────────────────────────────┘
        ↓
对每份简历执行评估：
┌─────────────────────────────────────┐
│ 1. 读取简历 raw_text               │
│ 2. 读取岗位技能列表                 │
│ 3. 读取岗位评估维度                 │
│ 4. 对每个维度调用 LLM Chain        │
│ 5. 技能命中检测                    │
│ 6. 汇总计算最终得分                │
│ 7. 存入数据库                      │
└─────────────────────────────────────┘
```

**重试机制**：
- 最大重试次数：3 次
- 指数退避：2s → 4s → 8s
- 重试条件：LLM 调用超时、API 限流、临时网络错误
- 不重试：参数错误、数据不存在、内容格式错误

**兜底方案（重试全部失败后）**：
- 评估结果标记为 `status=failed`
- 记录失败原因到 `resume_job_match.error_message`
- 前端显示「评估失败，可重试」按钮（含原因 Tooltip）
- 员工可手动触发重试

**异常处理**：
| 异常情况 | 处理方式 |
|---------|---------|
| LLM 超时 | 重试 3 次，指数退避 |
| API 限流 | 等待队列，指数退避 |
| 简历内容为空 | 标记失败，记录原因 |
| 岗位信息不存在 | 标记失败，记录原因 |
| 网络错误 | 重试 3 次后标记失败 |

#### 4.5.4 附件简历预览功能

**预览支持格式**：PDF（`.pdf`）/ Word（`.docx`）/ 图片（`.png`、`.jpg`、`.jpeg`、`.gif`、`.bmp`）

**预览实现方案**：

| 格式 | 预览方案 |
|------|---------|
| PDF | pdf.js 渲染，跨浏览器支持 |
| Word | 后端 python-docx 提取文本，前端 `<pre>` 展示 |
| 图片 | `<img alt="" width height>` 直接渲染 |
| 不支持 | 提示下载 |

**预览组件** `ResumePreviewDialog`：
```typescript
interface ResumePreviewDialogProps {
  resumeId: number;
  fileName: string;
  fileType: 'pdf' | 'docx' | 'image' | 'unknown';
  open: boolean;
  onClose: () => void;
}
```

**预览 API**：
| 方法 | 路径 | 描述 |
|------|------|------|
| GET | `/api/v1/employee/resumes/:id/file` | 获取简历文件流（PDF/图片）或提取文本（Word） |

#### 4.5.5 LLM Agent 评估链设计

**技术选型**：LangChain + LiteLLM

**评估链架构**：

```
┌─────────────────────────────────────────────────────────────────┐
│                     Resume Evaluation Agent                      │
│                                                                   │
│  ┌─────────────┐    ┌─────────────┐    ┌─────────────────────┐  │
│  │ Resume      │───▶│ Skill       │───▶│ Dimension           │  │
│  │ Parser      │    │ Matcher     │    │ Evaluator           │  │
│  │ (文本提取)   │    │ (技能命中)   │    │ (多维度评估)         │  │
│  └─────────────┘    └─────────────┘    └─────────────────────┘  │
│                                                │                │
│                                                ▼                │
│                                      ┌─────────────────────┐    │
│                                      │ Score Aggregator    │    │
│                                      │ (得分汇总+标签)      │    │
│                                      └─────────────────────┘    │
│                                                │                │
│                                                ▼                │
│                                      ┌─────────────────────┐    │
│                                      │ Comment Generator   │    │
│                                      │ (优缺点评价生成)     │    │
│                                      └─────────────────────┘    │
└─────────────────────────────────────────────────────────────────┘
```

**Agent 详细设计**：

**1. Resume Parser（简历解析）**
```python
class ResumeParserAgent:
    def parse(self, raw_text: str) -> ResumeStructuredData:
        """
        输出结构:
        {
            "personal_info": {"name": "", "email": ""},
            "education": [{"school": "", "degree": "", "major": ""}],
            "work_experience": [{"company": "", "position": "", "duration": "", "description": ""}],
            "skills": ["React", "TypeScript", "..."],
            "projects": [{"name": "", "role": "", "description": ""}]
        }
        """
```

**2. Skill Matcher（技能匹配）**
```python
class SkillMatcherAgent:
    def match(self, resume_data: ResumeStructuredData, job_skills: list[JobSkill]) -> list[SkillHit]:
        """对每个岗位技能检测是否在简历中命中"""
```

**3. Dimension Evaluator（维度评估）**
```python
class DimensionEvaluatorAgent:
    async def evaluate(self, resume_data: ResumeStructuredData, dimension: JobEvalDimension) -> DimensionScore:
        """
        输出: DimensionScore
        {
            "dimension_name": "技术能力",
            "score": 85,
            "advantage": "熟练掌握React生态...",
            "disadvantage": "TypeScript类型设计能力有待提升...",
            "is_completed": true,
            "error_message": null
        }
        """

    async def evaluate_batch(self, resume_data, dimensions):
        """并行评估所有维度（asyncio.gather）"""
        tasks = [self.evaluate(resume_data, dim) for dim in dimensions]
        return await asyncio.gather(*tasks, return_exceptions=True)
```

**4. Score Aggregator（得分汇总）**
```python
class ScoreAggregatorAgent:
    def aggregate(self, dimension_scores: list[DimensionScore], weights: list[float]) -> FinalScore:
        """
        final_score = Σ(dimension_score * weight)
        final_label: 90-100=优秀, 70-89=良好, 50-69=一般, 0-49=未达标
        """
```

**5. Comment Generator（评价生成）**
```python
class CommentGeneratorAgent:
    def generate(self, resume_data, dimension_scores) -> CommentResult:
        """
        {
            "advantage_comment": "候选人具备扎实的React技术栈实战经验...",
            "disadvantage_comment": ""  // 无明显缺点时为空字符串
        }
        """
```

**并行评估异常处理**：
```python
async def evaluate_batch(self, resume_data, dimensions):
    tasks = [self.evaluate(resume_data, dim) for dim in dimensions]
    results = await asyncio.gather(*tasks, return_exceptions=True)

    dimension_scores = []
    for i, result in enumerate(results):
        if isinstance(result, Exception):
            dimension_scores.append(DimensionScore(
                dimension_name=dimensions[i].dimension_name,
                score=50,
                advantage="",
                disadvantage="",
                is_completed=False,
                error_message=str(result)
            ))
        else:
            dimension_scores.append(result)

    return dimension_scores
```

**容错机制**：
| 环节 | 失败处理 |
|------|---------|
| 简历解析 | 返回空结构，标记需要人工审核 |
| 技能匹配 | 部分技能失败不影响其他，失败技能标记为 `is_hit=false` |
| 维度评估 | 单维度失败不影响其他，失败维度 `is_completed=false`，不参与权重计算 |
| 评价生成 | 失败时返回「候选人简历信息完整」等通用评价 |

**LiteLLM 配置**：
```python
litellm_settings = {
    "model": "gpt-4-turbo-preview",
    "fallback_model": "gpt-3.5-turbo",
    "max_retries": 3,
    "timeout": 60,
}
```

**Prompt 目录结构**：
```
backend/app/utils/ai/prompts/
├── skill_match_prompt.txt
├── dimension_eval_prompt.txt
├── comment_gen_prompt.txt
└── skill_suggest_prompt.txt
```

---

### 4.6 投递管理 `/employee/applications`

**面包屑**：`投递管理`

#### 4.6.1 投递列表 `/employee/applications`

**布局**：顶部工具栏 + Table

**工具栏**：
- 岗位筛选 Select（含「全部岗位」）
- 状态筛选 Select：全部 / 待处理 / 已查看 / 面试中 / 已拒绝 / 已录用

> 筛选条件同步到 URL query params（`?job_id=&status=`）

**Table 列定义**：

| 列名 | 字段 | 说明 |
|------|------|------|
| 求职者 | `user_id` | 姓名或 ID |
| 投递岗位 | `job_name` | 文字 |
| 简历文件名 | `resume_file_name` | 可点击预览 |
| 投递时间 | `apply_time` | `Intl.DateTimeFormat` |
| 状态 | `status` | `ApplicationStatusBadge`（色值见下） |
| 操作 | — | 「查看详情」`<Link>` + 状态更新 `<button>`（Popover 选择器） |

**状态 Badge 色值**：
| 状态 | 色值 |
|------|------|
| 待处理 | 灰色 |
| 已查看 | 蓝色 |
| 面试中 | 橙色 |
| 已拒绝 | 红色 |
| 已录用 | 绿色 |

**状态更新交互**：点击状态列的 `<button>` → 弹出 Popover（`Radix UI Popover`，非 `<div onClick>`），选择新状态后调用接口更新，成功后 Toast 提示「状态已更新」。

**状态流转规则**：`待处理 → 已查看 → 面试中 / 已拒绝 / 已录用`

**API 接口**：
| 方法 | 路径 | 描述 |
|------|------|------|
| GET | `/api/v1/employee/applications` | 投递列表（支持 `?job_id=&status=`） |
| PUT | `/api/v1/employee/applications/:id/status` | 更新投递状态 |

#### 4.6.2 投递详情 `/employee/applications/:id`

**面包屑**：`投递管理 > 投递详情`

**布局**：上方基本信息 + 下方两列（左：评估结果；右：简历预览）

**基本信息卡片**：
- 求职者信息（姓名/ID）
- 投递岗位（可点击跳转岗位编辑页）
- 简历文件名（可点击预览）
- 投递时间
- 当前状态 Badge + 更新状态 `<button>`（右对齐，弹 Dialog 选择）

**评估结果（如已评估）**：
- 匹配度分数 + `MatchBadge`
- 点击「查看评估详情」跳转评估详情页

**API 接口**：
| 方法 | 路径 | 描述 |
|------|------|------|
| GET | `/api/v1/employee/applications/:id` | 投递详情 |

---

### 4.7 可视化报表 `/employee/analytics`

**面包屑**：`数据报表`

#### 4.7.1 岗位匹配度报表 `/employee/analytics/job/:id`

**面包屑**：`数据报表 > 岗位报表`

**布局**：顶部岗位信息卡片 + 下方两列（左：匹配度分布饼图；右：简历 Table）

**岗位信息卡片**：名称、部门、收到简历数（`tabular-nums`）

**匹配度分布饼图**：复用 `MatchPieChart` 组件（同评估管理页）

**简历 Table**（按匹配度降序）：文件名 / 匹配度 / 标签 / 关键技能 / 「查看评估详情」`<Link>`

**API 接口**：
| 方法 | 路径 | 描述 |
|------|------|------|
| GET | `/api/v1/employee/analytics/job/:job_id/match-distribution` | 匹配度分布 |
| GET | `/api/v1/employee/analytics/job/:job_id/resume-list` | 简历列表 |

---

## 五、组件清单

### 5.1 布局组件（全部新增/替换）

| 组件 | 说明 | 状态 |
|------|------|------|
| `AdminLayout` | 整体框架：Sidebar + AdminHeader + 内容区 | **替换** `PageLayout` |
| `Sidebar` | 左侧固定导航，带图标 + 标签 + 折叠态 | **替换** `EmployeeNav` |
| `AdminHeader` | 顶部 56px 标题栏：面包屑 + 用户名 + 登出 | 新增 |
| `Breadcrumb` | 根据路由映射自动生成面包屑 | 新增 |

### 5.2 业务组件

| 组件 | 说明 |
|------|------|
| `EvaluationRadarChart` | 多维度雷达图（`Recharts RadarChart`） |
| `MatchBadge` | 匹配度标签（优秀/良好/一般/未达标），带对应色值 |
| `MatchPieChart` | 匹配度分布饼图（`Recharts PieChart`） |
| `SkillHitTable` | 技能命中详情 Table |
| `AdvantageComment` | 优点展示组件 |
| `DisadvantageComment` | 缺点展示组件（处理空字符串情况） |
| `ApplicationStatusBadge` | 投递状态 Badge（含色值） |
| `ApplicationStatusPopover` | 投递状态更新 Popover（`Radix UI Popover`） |
| `JobSelector` | 岗位选择器（支持搜索过滤） |
| `ResumePreviewDialog` | 简历预览弹窗（PDF/图片/Word 文本） |
| `ConfirmDialog` | 通用二次确认 Dialog（替换 `window.confirm`） |
| `SkillTagList` | 技能 tag 列表（截断超出部分，显示 +N） |

### 5.3 UI 基础组件（shadcn/ui）

`Button`、`Card`、`Input`、`Label`、`Textarea`、`Select`、`Dialog`、`Table`、`Badge`、`Progress`、`Tabs`、`Popover`、`Toast`、`Tooltip`

---

## 六、API 契约

### 6.1 认证 `/api/v1/employee/auth`

| 方法 | 路径 | 描述 |
|------|------|------|
| POST | `/api/v1/employee/auth/send-code` | 发送验证码 |
| POST | `/api/v1/employee/auth/login` | 账号密码登录 |
| POST | `/api/v1/employee/auth/verify-code` | 验证码登录 |
| POST | `/api/v1/employee/auth/refresh` | 刷新 Token |
| POST | `/api/v1/employee/auth/logout` | 登出 |

### 6.2 岗位管理 `/api/v1/employee/jobs`

| 方法 | 路径 | 描述 |
|------|------|------|
| GET | `/api/v1/employee/jobs` | 岗位列表（`?status=&department=&search=`） |
| GET | `/api/v1/employee/jobs/:id` | 岗位详情 |
| POST | `/api/v1/employee/jobs` | 创建岗位 |
| PUT | `/api/v1/employee/jobs/:id` | 编辑岗位 |
| DELETE | `/api/v1/employee/jobs/:id` | 删除岗位 |

### 6.3 技能建议 `/api/v1/employee/jobs/skill`

| 方法 | 路径 | 描述 |
|------|------|------|
| POST | `/api/v1/employee/jobs/skill/suggest` | AI 生成技能建议 |

### 6.4 简历库 `/api/v1/employee/resumes`

| 方法 | 路径 | 描述 |
|------|------|------|
| GET | `/api/v1/employee/resumes` | 全部简历列表（`?status=&start=&end=`） |
| GET | `/api/v1/employee/resumes/:id` | 简历详情 |
| GET | `/api/v1/employee/resumes/:id/file` | 获取简历文件流或文本 |
| GET | `/api/v1/employee/resumes/pending` | 待评估简历列表 |

### 6.5 评估管理 `/api/v1/employee/evaluations`

| 方法 | 路径 | 描述 |
|------|------|------|
| POST | `/api/v1/employee/evaluations/batch` | 批量触发评估 |
| GET | `/api/v1/employee/evaluations/:match_id` | 评估详情 |
| GET | `/api/v1/employee/evaluations/:match_id/skill-hits` | 技能命中详情 |

### 6.6 投递管理 `/api/v1/employee/applications`

| 方法 | 路径 | 描述 |
|------|------|------|
| GET | `/api/v1/employee/applications` | 全部投递记录列表（`?job_id=&status=`） |
| GET | `/api/v1/employee/applications/:id` | 投递详情 |
| PUT | `/api/v1/employee/applications/:id/status` | 更新投递状态 |

### 6.7 可视化报表 `/api/v1/employee/analytics`

| 方法 | 路径 | 描述 |
|------|------|------|
| GET | `/api/v1/employee/analytics/dashboard` | 工作台统计 |
| GET | `/api/v1/employee/analytics/job/:job_id/match-distribution` | 岗位匹配度分布 |
| GET | `/api/v1/employee/analytics/job/:job_id/resume-list` | 岗位简历列表 |

---

## 七、数据模型

### 7.1 EmployeeDashboardStats（工作台统计）

```typescript
interface EmployeeDashboardStats {
  job_count: number;
  resume_count: number;
  pending_eval_count: number;
  avg_match_score: number;
  recent_activities: Activity[];
}

interface Activity {
  id: number;
  type: 'resume_upload' | 'application' | 'evaluation' | 'job_create';
  text: string;
  time: string;
}
```

### 7.2 MatchDistribution（匹配度分布）

```typescript
interface MatchDistribution {
  excellent: { count: number; percentage: number };
  good:      { count: number; percentage: number };
  average:   { count: number; percentage: number };
  fail:      { count: number; percentage: number };
}
```

### 7.3 ResumeWithEvaluation（简历评估状态）

```typescript
interface ResumeWithEvaluation {
  resume_id: number;
  file_name: string;
  evaluation_status: 'pending' | 'processing' | 'completed' | 'failed';
  final_score?: number;
  final_label?: string;
  error_message?: string;
}
```

### 7.4 EvaluationDetail（评估详情）

```typescript
interface EvaluationDetail {
  match_id: number;
  final_score: number;
  final_label: '优秀' | '良好' | '一般' | '未达标';
  advantage_comment: string;
  disadvantage_comment: string;
  dimensions: DimensionScore[];
  skill_hits: SkillHit[];
}

interface DimensionScore {
  dimension_name: string;
  score: number;
  advantage: string;
  disadvantage: string;
  is_completed: boolean;
  error_message?: string;
}

interface SkillHit {
  skill_id: number;
  skill_name: string;
  skill_type: 1 | 2 | 3;
  is_hit: boolean;
  hit_context: string;
  match_label?: string;
}
```

---

## 八、配色方案

| 用途 | 色值 |
|------|------|
| 侧边栏背景 | `#1E293B` |
| 侧边栏选中项 | `#2563EB` |
| 侧边栏选中文字 | `#FFFFFF` |
| 侧边栏非选中文字 | `#94A3B8` |
| 侧边栏 Hover 背景 | `rgba(255,255,255,0.08)` |
| 页面背景 | `#F5F7FA` |
| 卡片/内容区背景 | `#FFFFFF` |
| 主色（按钮、链接） | `#2563EB` |
| 辅助色（次要文字） | `#64748B` |
| 成功色（优秀/已录用） | `#10B981` |
| 警告色（一般/面试中） | `#F59E0B` |
| 危险色（未达标/已拒绝） | `#EF4444` |
| 信息色（已查看） | `#2563EB` |
| 文字主色 | `#1E293B` |
| 文字次色 | `#64748B` |
| 边框色 | `#E2E8F0` |

---

## 九、Web Interface Guidelines 合规清单

实现时需严格遵循以下规则：

### 可访问性 & 语义
- [ ] Icon-only 按钮（侧边栏折叠、操作图标）均有 `aria-label`
- [ ] 装饰性图标加 `aria-hidden="true"`
- [ ] `<button>` 用于动作，`<Link>`/`<a>` 用于导航，不使用 `<div onClick>`
- [ ] 表单控件均有 `<label>` 或 `aria-label`，`htmlFor` 关联
- [ ] 异步更新（Toast、表单验证）使用 `aria-live="polite"`
- [ ] 标题层级 `<h1>`–`<h3>` 按顺序，不跳级
- [ ] `<img>` 提供 `alt`、`width`、`height`

### 焦点与交互
- [ ] 所有交互元素有 `focus-visible:ring-*` 焦点样式，不裸写 `outline-none`
- [ ] 破坏性操作（删除岗位）使用 Dialog 确认，非 `window.confirm`
- [ ] 按钮 Hover 状态提供明确视觉反馈

### 表单
- [ ] 登录表单 `autocomplete` 正确：`username`、`current-password`、`one-time-code`
- [ ] 搜索框 `type="search"`，数字输入 `type="number"` + `inputmode`
- [ ] 提交按钮发请求期间显示 Spinner，禁止重复提交
- [ ] 表单错误内联显示，聚焦至第一个错误字段

### 动画 & 性能
- [ ] 遵循 `prefers-reduced-motion`：动画加条件 `motion-safe:`
- [ ] 侧边栏折叠动画仅使用 `transition: width`，不用 `transition: all`
- [ ] Spinner 使用 `animate-spin`，不用 JS 计时器模拟

### 数字 & 日期
- [ ] 所有日期时间使用 `Intl.DateTimeFormat`，不硬编码格式
- [ ] 统计数字、匹配度分数列设置 `font-variant-numeric: tabular-nums`（Tailwind: `tabular-nums`）

### URL 状态
- [ ] 筛选条件（状态、部门、搜索词）同步到 URL query params
- [ ] Tab 切换（简历库全部/待评估）通过 query param 区分，支持深链接

### 内容处理
- [ ] 长文件名使用 `truncate` 截断，flex 子元素加 `min-w-0`
- [ ] 所有列表处理空状态，提供有意义的空状态文案 + 引导操作

---

## 十、实现优先级

| 优先级 | 模块 | 说明 |
|--------|------|------|
| P0 | `AdminLayout`（Sidebar + AdminHeader） | 所有页面依赖此布局 |
| P0 | 岗位管理（CRUD + Table + Dialog 删除确认） | 基础功能 |
| P0 | 简历库 + 预览 | 评估依赖简历数据 |
| P0 | 评估管理（Celery 异步 + 评估详情） | 核心功能 |
| P1 | 投递管理（Table + Popover 状态更新） | 业务闭环 |
| P1 | 工作台（统计卡片 + Timeline + 快捷入口） | 数据统计 |
| P2 | 可视化报表 | 复用评估数据 |
| P2 | 登录页重设计（左右分栏） | 体验优化 |

---

## 十一、实现说明

### 11.1 Celery 任务队列配置

**Broker**：Redis（`redis://localhost:6379/1`）
**Backend**：Redis（`redis://localhost:6379/2`）
**Queue**：`eval`（评估队列）

### 11.2 任务注册

```python
@celery_app.task(
    bind=True,
    max_retries=3,
    default_retry_delay=2,
    autoretry_for=(LLMTimeoutError, RateLimitError, NetworkError),
    retry_backoff=2,
    retry_backoff_max=10,
)
def eval_batch_task(self, resume_ids: list, job_id: int):
    pass
```

### 11.3 兜底方案实现

```python
try:
    result = await evaluate_resume(resume_id, job_id)
except Exception as exc:
    if self.request.retries >= self.max_retries:
        await mark_evaluation_failed(resume_id, job_id, str(exc))
        raise Ignore()
    raise self.retry(exc=exc)
```

### 11.4 简历文件预览实现

**Word 文档提取**：
```python
from docx import Document

def extract_text_from_docx(file_path: str) -> str:
    doc = Document(file_path)
    return "\n".join([p.text for p in doc.paragraphs])
```

**文件类型检测**：
```python
import mimetypes

def get_file_type(file_path: str) -> str:
    mime_type, _ = mimetypes.guess_type(file_path)
    if mime_type:
        if 'pdf' in mime_type:   return 'pdf'
        if 'word' in mime_type or 'document' in mime_type: return 'docx'
        if 'image' in mime_type: return 'image'
    return 'unknown'
```

**预览 API 响应**：
```python
@router.get("/{resume_id}/file")
async def get_resume_file(resume_id: int, ...):
    resume = await get_resume(resume_id)
    file_type = get_file_type(resume.file_path)

    if file_type == 'docx':
        text = extract_text_from_docx(resume.file_path)
        return {"file_type": "docx", "content": text}
    else:
        return FileResponse(resume.file_path, media_type=get_mime_type(resume.file_path))
```

---

## 十二、待确认事项

1. **简历预览文件路径**：本地存储路径如何映射到可访问的 URL？后端返回文件流还是前端直接请求 CDN/静态地址？
