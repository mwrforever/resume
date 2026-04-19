# 招聘平台完整设计方案

> 本文档详细描述招聘平台的技术架构、功能模块、API设计、可视化方案。

## 一、项目概述

### 1.1 项目背景

本项目是一个基于 FastAPI + React + MySQL + Redis 的全栈招聘平台，支持用户端和员工端双端登录，提供岗位管理、简历上传投递、AI智能评估等功能。

### 1.2 双端角色定义

| 角色 | 说明 | 权限范围 |
|------|------|---------|
| **用户端（求职者）** | 普通求职者 | 只能查看和管理自己的简历、投递记录、可视化分析报表（仅在评估完成后） |
| **员工端（HR/管理员）** | 公司HR和管理员 | 可管理岗位、查看所有简历、进行AI评估操作 |

### 1.3 技术栈

| 层级 | 技术选择 |
|------|---------|
| 后端框架 | FastAPI + Pydantic v2 |
| 数据库 | MySQL 8.0 + aiomysql |
| 缓存 | Redis + redis.asyncio |
| 任务队列 | Celery + Redis |
| AI框架 | LangChain + LiteLLM |
| 前端框架 | React 18 + Vite |
| 路由 | React Router v6 |
| 状态管理 | Zustand |
| CSS | Tailwind CSS |
| UI组件 | shadcn/ui (蓝灰配色) |
| 图表 | Recharts (饼图+雷达图) |

---

## 二、核心技术方案对比

### 2.1 存储策略模式

| 方案 | 优点 | 缺点 |
|------|------|------|
| **策略模式** | 解耦清晰，新增存储类型不修改现有代码；符合开闭原则；便于单元测试mock | 需要定义抽象接口，前期稍复杂 |
| **条件判断** | 简单直接，代码量少 | 违反开闭原则，新增存储需修改已有代码；条件判断多则难以维护 |

**推荐**: 策略模式

### 2.2 AI评估框架

| 方案 | 优点 | 缺点 |
|------|------|------|
| **LangChain + LiteLLM** | Chain可组合（维度评估链独立）；LiteLLM统一接口，支持切换GPT/Claude/本地模型；重试/降级机制完善 | 学习成本；额外依赖 |
| **直接LLM调用** | 代码简单，无额外依赖 | 自己实现重试/降级；难以切换模型；缺少Chain能力 |

**推荐**: LangChain + LiteLLM

### 2.3 Token策略

| 方案 | 优点 | 缺点 |
|------|------|------|
| **双Token** | Access Token短期（15min）防泄露；Refresh Token长期但可撤销；更安全 | 实现复杂度稍高；登出需清理Redis |
| **单Token** | 简单，实现成本低 | Token泄露风险大；有效期长难以动态失效 |

**推荐**: 双Token

### 2.4 简历解析

| 方案 | 优点 | 缺点 |
|------|------|------|
| **LLM解析** | 能理解上下文，提取更准确；支持复杂简历格式 | 需消耗更多token；解析时间较长 |
| **Python库解析** | 免费、快速 | 对复杂格式支持差；无法提取语义信息 |

**推荐**: LLM解析

---

## 三、项目整体架构

```
resume/
├── backend/
│   ├── app/
│   │   ├── api/              # 路由层（按用户端/员工端分离）
│   │   ├── core/             # 核心配置
│   │   ├── models/           # ORM模型
│   │   ├── schemas/          # Pydantic模型
│   │   ├── services/         # 业务逻辑层
│   │   ├── repositories/     # 数据访问层
│   │   └── utils/
│   │       ├── storage/      # 存储策略
│   │       ├── email/        # 邮件服务
│   │       └── ai/           # AI评估链
│   ├── celery_app/           # Celery配置
│   ├── tests/
│   └── requirements.txt
├── frontend/
│   ├── src/
│   │   ├── api/
│   │   ├── components/
│   │   ├── pages/
│   │   ├── store/
│   │   ├── types/
│   │   └── utils/
│   └── package.json
└── sql/
    └── init.sql
```

---

## 四、数据库表结构调整

### 4.1 简历岗位匹配表 - 优缺点评价

在 `resume_job_match` 表增加字段：

| 字段名 | 类型 | 说明 |
|--------|------|------|
| `advantage_comment` | TEXT | 简历对该岗位的优点评价（AI生成） |
| `disadvantage_comment` | TEXT | 简历对该岗位的缺点评价（AI生成，无缺点时为空字符串，渲染为"这份好像挺符合岗位预期"） |

### 4.2 简历维度评估详情表 - 维度级优缺点

在 `resume_eval_detail` 表增加字段：

| 字段名 | 类型 | 说明 |
|--------|------|------|
| `dimension_advantage` | TEXT | 该维度的优点（AI生成，无优点时为空字符串） |
| `dimension_disadvantage` | TEXT | 该维度的缺点（无缺点时为空字符串） |

### 4.3 AI评估结果生成规则

```json
{
  "final_score": 78.5,
  "final_label": "良好",
  "advantage_comment": "候选人具备扎实的React技术栈实战经验，项目中展示了良好的团队协作能力，在复杂业务场景下能够独立解决问题...",
  "disadvantage_comment": "",
  "dimensions": [
    {
      "dimension_name": "技术能力",
      "score": 85,
      "advantage": "熟练掌握React生态，能够独立完成组件封装和性能优化，对前端工程化有深入理解",
      "disadvantage": "TypeScript类型设计能力有待提升，部分代码存在any类型滥用"
    },
    {
      "dimension_name": "项目经验",
      "score": 80,
      "advantage": "参与过多个完整项目交付，具有中大型项目经验，项目复杂度适中",
      "disadvantage": ""
    }
  ]
}
```

**渲染规则**：
- `disadvantage_comment` 为空 → 显示"这份好像挺符合岗位预期"
- `dimension_disadvantage` 为空 → 该维度不显示缺点描述

---

## 五、API接口设计（按端分离）

### 5.1 设计原则

- **用户端API**: 统一前缀 `/api/v1/user/*`，严格校验 `user_id`，只能操作自己的数据
- **员工端API**: 统一前缀 `/api/v1/employee/*`，基于RBAC权限，可操作所有数据
- **登录方式**: 通过 `login_type` 字段区分（password/code），不依赖邮箱符号判断

### 5.2 用户端（求职者）API

#### 5.2.1 认证相关 `/api/v1/user/auth`

| 方法 | 路径 | 描述 |
|------|------|------|
| POST | `/api/v1/user/auth/send-code` | 发送验证码 |
| POST | `/api/v1/user/auth/register` | 用户注册 |
| POST | `/api/v1/user/auth/login` | 用户登录 |
| POST | `/api/v1/user/auth/refresh` | 刷新Token |
| POST | `/api/v1/user/auth/logout` | 登出 |

#### 5.2.2 岗位相关 `/api/v1/user/jobs`

| 方法 | 路径 | 描述 |
|------|------|------|
| GET | `/api/v1/user/jobs` | 浏览岗位列表（所有招聘中岗位） |
| GET | `/api/v1/user/jobs/:id` | 查看岗位详情 |

#### 5.2.3 简历相关 `/api/v1/user/resumes`

| 方法 | 路径 | 描述 |
|------|------|------|
| POST | `/api/v1/user/resumes` | 上传附件简历 |
| GET | `/api/v1/user/resumes` | 查看我的简历列表 |
| GET | `/api/v1/user/resumes/:id` | 查看我的简历详情 |
| DELETE | `/api/v1/user/resumes/:id` | 删除我的简历 |

#### 5.2.4 投递相关 `/api/v1/user/applications`

| 方法 | 路径 | 描述 |
|------|------|------|
| POST | `/api/v1/user/applications` | 投递岗位（必须关联附件简历） |
| GET | `/api/v1/user/applications` | 查看我的投递记录列表 |
| GET | `/api/v1/user/applications/:id` | 查看我的投递详情（含评估雷达图） |

#### 5.2.5 我的分析报表 `/api/v1/user/analytics`

| 方法 | 路径 | 描述 |
|------|------|------|
| GET | `/api/v1/user/analytics/match-summary` | 我的投递匹配度汇总（各岗位得分分布） |
| GET | `/api/v1/user/analytics/ability-radar` | 我的能力雷达图（基于所有评估维度的平均得分） |

---

### 5.3 员工端（HR/管理员）API

#### 5.3.1 认证相关 `/api/v1/employee/auth`

| 方法 | 路径 | 描述 |
|------|------|------|
| POST | `/api/v1/employee/auth/send-code` | 发送验证码 |
| POST | `/api/v1/employee/auth/login` | 员工登录 |
| POST | `/api/v1/employee/auth/refresh` | 刷新Token |
| POST | `/api/v1/employee/auth/logout` | 登出 |

#### 5.3.2 岗位管理 `/api/v1/employee/jobs`

| 方法 | 路径 | 描述 |
|------|------|------|
| GET | `/api/v1/employee/jobs` | 岗位列表（本部门/全部岗位） |
| GET | `/api/v1/employee/jobs/:id` | 岗位详情 |
| POST | `/api/v1/employee/jobs` | 创建岗位 |
| PUT | `/api/v1/employee/jobs/:id` | 编辑岗位 |
| DELETE | `/api/v1/employee/jobs/:id` | 删除岗位 |

#### 5.3.3 技能建议 `/api/v1/employee/jobs/skill`

| 方法 | 路径 | 描述 |
|------|------|------|
| POST | `/api/v1/employee/jobs/skill/suggest` | AI生成岗位技能建议（仅返回前端，不落库） |

#### 5.3.4 简历库 `/api/v1/employee/resumes`

| 方法 | 路径 | 描述 |
|------|------|------|
| GET | `/api/v1/employee/resumes` | 全部简历列表（权限控制） |
| GET | `/api/v1/employee/resumes/:id` | 简历详情 |
| GET | `/api/v1/employee/resumes/pending` | 待评估简历列表 |

#### 5.3.5 评估管理 `/api/v1/employee/evaluations`

| 方法 | 路径 | 描述 |
|------|------|------|
| POST | `/api/v1/employee/evaluations/batch` | 批量触发评估（**员工端核心功能**） |
| GET | `/api/v1/employee/evaluations/:match_id` | 评估详情（含雷达图） |
| GET | `/api/v1/employee/evaluations/:match_id/skill-hits` | 技能命中详情 |

#### 5.3.6 投递管理 `/api/v1/employee/applications`

| 方法 | 路径 | 描述 |
|------|------|------|
| GET | `/api/v1/employee/applications` | 全部投递记录列表 |
| GET | `/api/v1/employee/applications/:id` | 投递详情 |
| PUT | `/api/v1/employee/applications/:id/status` | 更新投递状态 |

#### 5.3.7 可视化报表 `/api/v1/employee/analytics`

| 方法 | 路径 | 描述 |
|------|------|------|
| GET | `/api/v1/employee/analytics/job/:job_id/match-distribution` | 某岗位简历匹配度分布（饼图） |
| GET | `/api/v1/employee/analytics/job/:job_id/resume-list` | 某岗位简历列表（按匹配度降序） |

---

### 5.4 用户端 vs 员工端功能对比

| 功能模块 | 用户端 | 员工端 |
|----------|--------|--------|
| 注册/登录 | ✅ | ✅ |
| 浏览岗位 | ✅ | ✅ |
| 上传简历 | ✅ | ❌ |
| 投递岗位 | ✅ | ❌ |
| 查看自己的投递详情 | ✅（需评估完成） | ❌ |
| **AI评估简历** | **❌** | **✅** |
| 查看所有简历 | ❌ | ✅ |
| 查看所有投递 | ❌ | ✅ |
| 匹配度可视化 | ❌（只能看自己的） | ✅（可看所有） |

---

## 六、认证模块设计

### 6.1 登录类型定义

`login_type` 字段用于区分登录方式：

| login_type | 说明 | 适用端 |
|------------|------|--------|
| `password` | 密码登录 | 用户端、员工端 |
| `code` | 验证码登录 | 用户端、员工端 |

### 6.2 用户端登录流程

```
┌─────────────────────────────────────────────────────────────┐
│  登录方式选择: [用户名/邮箱+密码]  [邮箱验证码]                │
└─────────────────────────────────────────────────────────────┘
                           ↓
              ┌────────────────────────────────────┐
              │  POST /api/v1/user/auth/login      │
              │  {                                 │
              │    identifier: "用户名或邮箱",       │
              │    login_type: "password" | "code",│
              │    password?: "xxx",               │
              │    code?: "123456"                 │
              │  }                                 │
              └────────────────────────────────────┘
                           ↓
         ┌────────────────┴────────────────┐
         │  login_type=password → 密码验证  │
         │  login_type=code → 验证码验证     │
         └─────────────────────────────────┘
                           ↓
              ┌────────────────────────┐
              │ 验证成功 → 生成双Token   │
              │ Access (15min) + Refresh (7d) │
              └────────────────────────┘
```

**用户端登录请求示例**：

```json
// 密码登录
{
  "identifier": "zhangsan",
  "login_type": "password",
  "password": "encrypted_password"
}

// 验证码登录
{
  "identifier": "zhangsan@example.com",
  "login_type": "code",
  "code": "123456"
}
```

### 6.3 员工端登录流程

```
┌─────────────────────────────────────────────────────────────┐
│  登录方式选择: [员工号+密码]  [邮箱+密码]  [邮箱验证码]         │
└─────────────────────────────────────────────────────────────┘
                           ↓
              ┌────────────────────────────────────┐
              │  POST /api/v1/employee/auth/login │
              │  {                                 │
              │    identifier: "员工号或邮箱",      │
              │    login_type: "password" | "code",│
              │    password?: "xxx",               │
              │    code?: "123456"                 │
              │  }                                 │
              └────────────────────────────────────┘
                           ↓
         ┌──────────────────────────────────────┐
         │  login_type=password → 密码验证       │
         │    - 先查 sys_employee.emp_no          │
         │    - 未找到则查 sys_employee.email     │
         │  login_type=code → 验证码验证         │
         └───────────────────────────────────────┘
                           ↓
              ┌────────────────────────┐
              │ 验证成功 → 生成双Token   │
              │ 负载: employee_id      │
              │       role_codes       │
              └────────────────────────┘
```

**员工端登录请求示例**：

```json
// 密码登录（员工号）
{
  "identifier": "EMP001",
  "login_type": "password",
  "password": "encrypted_password"
}

// 密码登录（邮箱）
{
  "identifier": "hr@example.com",
  "login_type": "password",
  "password": "encrypted_password"
}

// 验证码登录
{
  "identifier": "hr@example.com",
  "login_type": "code",
  "code": "123456"
}
```

### 6.4 Token策略

- **Access Token**: 15分钟有效期，存储在内存
- **Refresh Token**: 7天有效期，HttpOnly Cookie + Redis存储
- **用户身份隔离**: Token payload 包含 `user_type` (user/employee) 和对应ID

### 6.5 验证码策略

- 6位数字验证码，有效期5分钟
- 存储在 Redis，Key: `verify_code:{email}:{user_type}`
- 同一邮箱60秒内不可重复发送

---

## 七、简历管理设计

### 7.1 存储策略模式

```python
# storage/base.py - 抽象接口
class BaseStorage(ABC):
    @abstractmethod
    async def upload(self, file: UploadFile, path: str) -> str:
        """上传文件，返回访问URL"""
        pass

    @abstractmethod
    async def delete(self, path: str) -> bool:
        """删除文件"""
        pass

# storage/registry.py - 注册机制
class StorageRegistry:
    _strategies: Dict[str, Type[BaseStorage]] = {}

    @classmethod
    def register(cls, name: str, strategy: Type[BaseStorage]):
        cls._strategies[name] = strategy

    @classmethod
    def get(cls, name: str) -> BaseStorage:
        return cls._strategies[name]()
```

配置切换:
```python
STORAGE_TYPE=LOCAL  # 或 OSS, COS
```

### 7.2 简历上传流程

```
用户上传简历
       ↓
┌──────────────────┐
│ 保存到 note/{日期}/
│ {uuid}_{filename} │
└──────────────────┘
       ↓
┌──────────────────┐
│ 状态: 待处理     │
│ 文本存入 raw_text │
└──────────────────┘
```

### 7.3 附件简历与投递关联

- 用户可上传多份简历到"附件简历"模块
- 投递时必须从已关联简历中选择一份
- 关联后简历ID写入 `job_application.resume_id`

---

## 八、岗位技能自动生成

### 8.1 生成时机（仅员工端）

**发布岗位时AI生成技能建议**，仅返回前端，不自动落库：

```
HR填写岗位信息
      ↓
┌─────────────────────────────────────┐
│ POST /api/v1/employee/jobs/skill/suggest │
│ { name: "前端工程师", description: "负责公司前端系统开发..." } │
└─────────────────────────────────────┘
      ↓
┌─────────────────────────────────────┐
│ LiteLLM → OpenAI GPT-4           │
│ 生成技能建议列表                   │
│                                    │
│ 返回结构:                          │
│ [                                   │
│   { skill: "React",               │
│     type: 1,  # 1必须 2优先 3普通  │
│     reason: "核心框架，必须掌握" }, │
│   { skill: "TypeScript",           │
│     type: 2,  # 优先               │
│     reason: "提升代码质量" }        │
│ ]                                  │
└─────────────────────────────────────┘
      ↓
┌─────────────────────────────────────┐
│ 异常处理:                          │
│ - LLM超时 → 返回预设技能模板        │
│ - API限流 → 指数退避重试3次        │
│ - 返回失败 → 返回错误，前端提示    │
│   "生成失败，请手动填写"           │
└─────────────────────────────────────┘
      ↓
HR编辑/确认后 → 创建岗位时技能才落库
```

### 8.2 错误兜底机制

- LLM 调用失败 → 返回预设模板技能列表
- 超时 → 返回默认技能 + 标记"需要人工确认"
- 重试3次，指数退避

---

## 九、AI评估流程（仅员工端）

### 9.1 LiteLLM集成设计

```
┌─────────────────────────────────────────────────────────────┐
│                      业务代码                                │
│                      (统一接口)                              │
└─────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────┐
│                      LiteLLM                                │
│   litellm.completion(model="gpt-4", messages=[...])        │
│   litellm.completion(model="claude-3", messages=[...])     │
└─────────────────────────────────────────────────────────────┘
          │               │               │
          ▼               ▼               ▼
     ┌────────┐      ┌────────┐      ┌────────┐
     │ OpenAI │      │ Claude │      │  本地   │
     │  GPT-4 │      │  Opus  │      │ Llama2 │
     └────────┘      └────────┘      └────────┘
```

### 9.2 评估触发（员工端专属）

```
员工勾选简历 → 点击"批量评估" → Celery异步任务
      ↓
┌─────────────────────────────────┐
│ POST /api/v1/employee/evaluations/batch │
│ { resume_ids: [1,2,3],          │
│   job_id: 5 }                  │
└─────────────────────────────────┘
      ↓
┌─────────────────────────────────┐
│ 生成Celery Task               │
│ queue=eval, retry=3           │
└─────────────────────────────────┘
      ↓
┌─────────────────────────────────┐
│ 读取简历 raw_text             │
│ 读取岗位技能列表              │
│ 读取岗位评估维度             │
└─────────────────────────────────┘
      ↓
┌─────────────────────────────────┐
│ 对每个维度调用 LLM Chain      │
│ 生成: 得分 + 优点 + 缺点       │
│ 重试机制: 最多3次            │
│ 指数退避: 2s, 4s, 8s         │
└─────────────────────────────────┘
      ↓
┌─────────────────────────────────┐
│ 技能命中检测                  │
│ 优秀/良好/一般/未达标标签     │
│ 记录命中片段到 hit_context   │
└─────────────────────────────────┘
      ↓
┌─────────────────────────────────┐
│ 汇总计算最终得分             │
│ 生成优缺点评价                │
│ (无缺点则为空字符串)         │
└─────────────────────────────────┘
      ↓
┌─────────────────────────────────┐
│ 存入:                         │
│ resume_job_match              │
│ resume_eval_detail            │
│ resume_skill_hit             │
└─────────────────────────────────┘
```

### 9.3 生产级Prompt设计

#### 9.3.1 技能建议Prompt（岗位发布时）

```
## 任务
你是一个专业的招聘顾问。根据提供的岗位信息，为该岗位生成技能要求列表。

## 输入信息
- 岗位名称: {job_name}
- 岗位描述: {job_description}

## 输出要求
生成8-15个技能要求，分为三个优先级：

### 技能类型定义
- type=1 (必须满足): 胜任该岗位的核心技能，缺失则直接淘汰
- type=2 (优先匹配): 显著提升竞争力的技能，命中则标记为优秀/良好
- type=3 (普通技能): 加分项，命中可提升分数

### 输出格式（严格JSON）
[
  {
    "skill": "技能名称",
    "type": 1|2|3,
    "reason": "该技能对岗位的重要程度说明，10-20字"
  }
]

## 生成规则
1. 技能名称必须具体明确，不得使用模糊描述
2. 必须包含该岗位最核心的1-2个框架/语言
3. 必须包含2-3个通用能力（如协作、沟通）
4. 优先选择市场中该岗位最主流的技术栈
5. reason必须说明该技能在岗位中的实际应用场景

## 异常处理
- 若LLM调用失败或超时，返回预设模板：
  [{"skill": "岗位核心技能", "type": 1, "reason": "核心能力"}]
```

#### 9.3.2 维度评估Prompt

```
## 任务
你是一个专业的简历评估专家。请根据以下维度对候选人的简历进行评估。

## 输入信息
- 评估维度: {dimension_name}
- 维度权重: {weight}（0-1之间的数值）
- 岗位名称: {job_name}
- 岗位技能要求: {job_skills}

## 简历内容
{resume_text}

## 评分标准
| 分数区间 | 等级 | 说明 |
|----------|------|------|
| 90-100 | 优秀 | 显著超出岗位预期，在该维度有突出表现 |
| 70-89 | 良好 | 符合岗位预期，能够胜任该维度工作 |
| 50-69 | 一般 | 基本符合，但存在明显不足 |
| 0-49 | 未达标 | 明显缺失，无法胜任该维度工作 |

## 输出要求（严格JSON格式，不得添加任何额外内容）
{
  "score": <整数, 0-100>,
  "advantage": "<该维度的具体优点描述，基于简历内容，无优点写'无'，30-100字>",
  "disadvantage": "<该维度的具体缺点描述，基于简历内容与岗位要求的差距，无缺点写''，30-100字>"
}

## 评分原则
1. **基于简历内容**: 优势必须来自简历原文，不得无中生有
2. **对照岗位需求**: 缺点必须明确指出与岗位要求的差距
3. **具体化描述**: 避免"不错"、"还可以"等模糊表述
4. **量化优先**: 优先引用具体数据（项目规模、技术难度等）

## 技能关联评估
- 若简历中明确提到岗位要求的技能，相应维度应获得高分
- 若简历中缺少岗位核心技能，相应维度应扣分
- 技能名称必须精确匹配job_skills中的名称

## 异常处理
- 若简历内容过少无法评估，返回 {"score": 50, "advantage": "简历信息有限", "disadvantage": "简历信息不足，无法全面评估"}
- 若LLM调用失败，返回null触发重试
```

#### 9.3.3 综合评价Prompt

```
## 任务
你是一个专业的招聘顾问。请根据以下信息生成简历对该岗位的综合评价。

## 输入信息
- 岗位名称: {job_name}
- 岗位描述: {job_description}
- 最终匹配得分: {final_score}/100

## 各维度评估结果
{dimensions_json}

## 简历内容摘要
{resume_summary}

## 输出要求（严格JSON格式，不得添加任何额外内容）
{
  "advantage_comment": "<整体优点总结，50-150字，基于所有维度优点提炼，不得无中生有>",
  "disadvantage_comment": "<整体缺点总结，50-150字，基于所有维度缺点提炼，若无明显缺点则精确返回空字符串''>"
}

## 评价生成规则
1. **优点总结**: 从各维度优势中提炼出3-5个核心亮点，优先选择得分最高的维度
2. **缺点总结**: 从各维度不足中提炼主要差距，若各维度均无明显缺点或得分>=70，则精确返回空字符串''
3. **数据一致性**: 综合评价必须与各维度得分一致
4. **具体化**: 优点必须引用简历中的具体经历或技能，缺点必须明确指出与岗位的差距
5. **正向表达**: 缺点以改进建议或提升方向表述，避免直接否定

## 渲染规则
- advantage_comment为空: 显示"该候选人简历信息完整"
- disadvantage_comment为空字符串: 前端显示"这份好像挺符合岗位预期"
```

#### 9.3.4 技能命中检测Prompt

```
## 任务
你是一个专业的技术面试官。请检测简历中是否包含指定技能，并提取命中的上下文片段。

## 输入信息
- 目标技能列表: {skill_list}
- 技能类型: {skill_type}（1=必须 2=优先 3=普通）

## 简历内容
{resume_text}

## 技能命中定义
- 命中: 简历中明确提到该技能的使用、项目经历或掌握程度
- 未命中: 简历中完全没有提及该技能

## 输出要求（严格JSON格式）
{
  "hits": [
    {
      "skill": "技能名称",
      "is_hit": true|false,
      "hit_context": "<命中的原文片段，50-150字，包含技能名称及前后上下文；若未命中则为空字符串''>",
      "match_label": "<type=1时: 命中=必须, 未命中=未达标; type=2时: 命中且高相关=优秀, 命中但低相关=良好, 未命中=未达标; type=3时: 命中=一般, 未命中=''>"
    }
  ]
}

## 提取规则
1. hit_context必须包含技能名称及其在简历中的完整上下文
2. 优先提取包含具体项目描述或成果的片段
3. 若同一技能多次出现，提取最详细的那段
4. 技能名称必须精确匹配skill_list中的名称

## 异常处理
- 若简历过短无法判断，返回is_hit=false, hit_context=''
```

### 9.4 技能命中展示（点击查看片段）

```
┌─────────────────────────────────────┐
│ 技能: React Hooks                  │
│ 类型: 必须满足                       │
│ 命中: ✓ 是                         │
│ 匹配度: 优秀                       │
├─────────────────────────────────────┤
│ 命中片段:                          │
│ "熟练使用React Hooks进行状态管理，  │
│  在项目中封装了多个自定义Hook，      │
│  提升了代码复用性和可维护性..."      │
└─────────────────────────────────────┘
```

---

## 十、前端页面结构

### 10.1 用户端页面（求职者）

```
/user
├── /login                    # 用户登录
├── /register                 # 用户注册(验证码)
├── /jobs                     # 岗位列表
│   └── /jobs/:id            # 岗位详情 + 投递按钮
├── /my-resumes              # 我的附件简历
│   └── /my-resumes/upload   # 上传简历
├── /my-applications          # 我的投递记录
│   └── /my-applications/:id # 投递详情 + 雷达图
└── /profile                  # 个人中心
```

### 10.2 员工端页面（HR/管理员）

```
/employee
├── /login                    # 员工登录
├── /dashboard               # 工作台首页
├── /jobs                     # 岗位管理
│   ├── /jobs                # 岗位列表
│   ├── /jobs/create         # 创建岗位(+AI生成技能)
│   └── /jobs/:id/edit       # 编辑岗位
├── /resumes                  # 简历库(权限控制)
│   ├── /resumes             # 全部简历
│   ├── /resumes/:id         # 简历详情
│   └── /resumes/pending     # 待评估简历
├── /evaluations              # 评估管理（AI评估）
│   ├── /evaluations/batch   # 批量评估选择
│   └── /evaluations/:id     # 评估详情 + 雷达图
├── /applications             # 投递管理
│   └── /applications/:id    # 投递详情
└── /profile                  # 个人中心
```

---

## 十一、可视化设计

### 11.1 用户端 - 我的投递详情

#### 11.1.1 评估完成状态

```
┌──────────────────────────────────────────────────────────┐
│ 投递岗位: 前端工程师 - 基础架构组                         │
│ 投递时间: 2024-01-15 10:30                               │
│ 评估状态: ✓ 已评估                                       │
├──────────────────────────────────────────────────────────┤
│                                                          │
│   匹配度得分: 78/100    标签: 良好                       │
│   ████████████████████████░░░░░░░                       │
│                                                          │
├──────────────────────────────────────────────────────────┤
│                                                          │
│   【雷达图 - 多维度得分】                                 │
│                                                          │
│              项目经验 (85)                               │
│                 ▲                                        │
│                /│\                                       │
│         (75)──┼──(80) 技术能力                          │
│              / │ \                                      │
│   (70)───────┼────────(90) 学历背景                      │
│              \ │ /                                      │
│         (65)──┼──(75) 稳定性                             │
│                │                                        │
│              工作经验 (70)                               │
│                                                          │
├──────────────────────────────────────────────────────────┤
│                                                          │
│   【优缺点评价】                                          │
│   优点: 候选人具备扎实的React技术栈实战经验，项目中展示  │
│         了良好的团队协作能力，在复杂业务场景下能够独立    │
│         解决问题，具有良好的代码风格和工程化思维...      │
│   缺点: TypeScript类型设计能力有待提升，部分代码存在     │
│         any类型滥用；缺乏大规模分布式系统经验...         │
│                                                          │
├──────────────────────────────────────────────────────────┤
│                                                          │
│   【技能匹配】                                            │
│   ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌──────────┐ │
│   │React ✓  │ │TypeScript│ │ Node.js │ │ Git     │ │
│   │ 必须/优秀│ │ 优先/良好 │ │ 普通/一般│ │ 普通/达标│ │
│   └──────────┘ └──────────┘ └──────────┘ └──────────┘ │
│                                                          │
│   * 点击技能标签查看简历中对应片段                        │
│                                                          │
├──────────────────────────────────────────────────────────┤
│   【投递状态】  [待查看] → [已评估] → [面试邀请]          │
└──────────────────────────────────────────────────────────┘
```

#### 11.1.2 评估未完成状态

```
┌──────────────────────────────────────────────────────────┐
│ 投递岗位: 前端工程师 - 基础架构组                         │
│ 投递时间: 2024-01-15 10:30                               │
│ 评估状态: ⏳ 评审还在进行中，请耐心等待                   │
├──────────────────────────────────────────────────────────┤
│                                                          │
│   ⚠️ HR正在对您的简历进行评估，请稍后再来查看结果         │
│                                                          │
│   [刷新状态]                                             │
│                                                          │
└──────────────────────────────────────────────────────────┘
```

### 11.2 员工端 - 岗位简历匹配总览

```
┌──────────────────────────────────────────────────────────┐
│ 岗位: 前端工程师                    收到简历: 156 份    │
├──────────────────────────────────────────────────────────┤
│                                                          │
│   【匹配度分布 - 饼图】                                   │
│                                                          │
│         ┌─────────────────────┐                         │
│         │   饼图:              │                         │
│         │   优秀   12%  (18)  │                         │
│         │   良好   35%  (55)  │                         │
│         │   一般   28%  (44)  │                         │
│         │   未达标 25%  (39)  │                         │
│         └─────────────────────┘                         │
│                                                          │
├──────────────────────────────────────────────────────────┤
│  【简历列表】(按匹配度降序)          [批量评估]           │
│  ┌────────────────────────────────────────────────────┐ │
│  │ ⭐ 张三   匹配度: 92 优秀  │ React,TS,Node  │ 查看  │ │
│  ├────────────────────────────────────────────────────┤ │
│  │ ⭐ 李四   匹配度: 85 优秀  │ Vue,JS,Git     │ 查看  │ │
│  ├────────────────────────────────────────────────────┤ │
│  │    王五   匹配度: 78 良好  │ React,微信小程序│ 查看  │ │
│  └────────────────────────────────────────────────────┘ │
└──────────────────────────────────────────────────────────┘
```

### 11.3 员工端 - 评估详情

```
┌──────────────────────────────────────────────────────────┐
│ 候选人: 张三                              [开始评估]     │
│ 简历: 前端工程师_张三.pdf                                  │
├──────────────────────────────────────────────────────────┤
│                                                          │
│   【评估操作】                                            │
│   ☑ 简历1  ☑ 简历2  ☑ 简历3     [批量评估] [单简历评估] │
│                                                          │
├──────────────────────────────────────────────────────────┤
│                                                          │
│   匹配度得分: 92/100    标签: ⭐优秀                       │
│   ████████████████████████████████████████░░░░░          │
│                                                          │
├──────────────────────────────────────────────────────────┤
│                                                          │
│   【雷达图 - 多维度得分】                                 │
│   (同11.1.1节)                                          │
│                                                          │
├──────────────────────────────────────────────────────────┤
│                                                          │
│   【优缺点评价】                                          │
│   优点: 候选人具备扎实的React技术栈实战经验...           │
│   缺点: 无明显缺点，这份好像挺符合岗位预期               │
│   (注：当disadvantage为空字符串时显示"这份好像挺符合岗位预期")│
│                                                          │
├──────────────────────────────────────────────────────────┤
│                                                          │
│   【技能命中详情】                                        │
│   ┌────────────────────────────────────────────────────┐ │
│   │ 技能        │ 类型     │ 命中 │ 匹配度  │ 片段     │ │
│   ├────────────────────────────────────────────────────┤ │
│   │ React       │ 必须满足 │ ✓   │ 优秀    │ 点击查看  │ │
│   │ TypeScript  │ 优先匹配 │ ✓   │ 良好    │ 点击查看  │ │
│   │ Node.js    │ 普通技能 │ ✗   │ —      │ —       │ │
│   └────────────────────────────────────────────────────┘ │
│                                                          │
│   * 点击技能查看完整命中片段弹窗                          │
│                                                          │
└──────────────────────────────────────────────────────────┘
```

### 11.4 配色方案

| 用途 | 色值 |
|------|------|
| 主色(蓝色) | #2563EB |
| 辅助色(灰) | #64748B |
| 背景色 | #F8FAFC |
| 卡片背景 | #FFFFFF |
| 成功色 | #10B981 |
| 警告色 | #F59E0B |
| 危险色 | #EF4444 |
| 文字主色 | #1E293B |
| 文字次色 | #64748B |

---

## 十二、后端完整目录

```
backend/
├── app/
│   ├── __init__.py
│   ├── main.py                 # FastAPI入口
│   ├── api/
│   │   ├── __init__.py
│   │   ├── deps.py            # 依赖注入(获取当前用户/员工)
│   │   ├── user/              # 用户端API
│   │   │   ├── __init__.py
│   │   │   ├── auth.py        # 认证
│   │   │   ├── jobs.py        # 岗位浏览
│   │   │   ├── resumes.py     # 我的简历
│   │   │   ├── applications.py # 投递
│   │   │   └── analytics.py   # 我的报表
│   │   └── employee/          # 员工端API
│   │       ├── __init__.py
│   │       ├── auth.py        # 认证
│   │       ├── jobs.py        # 岗位管理
│   │       ├── resumes.py     # 简历库
│   │       ├── evaluations.py  # AI评估
│   │       ├── applications.py # 投递管理
│   │       └── analytics.py    # 可视化报表
│   ├── core/
│   │   ├── __init__.py
│   │   ├── config.py          # 配置类
│   │   ├── security.py        # JWT/密码工具
│   │   ├── middleware.py      # 中间件
│   │   └── exceptions.py      # 业务异常
│   ├── models/
│   │   ├── __init__.py
│   │   ├── sys_user.py
│   │   ├── sys_employee.py
│   │   ├── job_position.py
│   │   ├── resume.py
│   │   └── ...
│   ├── schemas/
│   │   ├── __init__.py
│   │   ├── auth.py
│   │   ├── job.py
│   │   ├── resume.py
│   │   ├── evaluation.py     # 评估相关(含优缺点)
│   │   └── ...
│   ├── services/
│   │   ├── __init__.py
│   │   ├── auth_service.py
│   │   ├── job_service.py
│   │   ├── resume_service.py
│   │   ├── application_service.py
│   │   └── eval_service.py    # AI评估服务
│   ├── repositories/
│   │   ├── __init__.py
│   │   ├── user_repo.py
│   │   ├── job_repo.py
│   │   ├── resume_repo.py
│   │   └── ...
│   └── utils/
│       ├── __init__.py
│       ├── storage/
│       │   ├── __init__.py
│       │   ├── base.py
│       │   ├── local.py
│       │   └── registry.py
│       ├── email/
│       │   └── sender.py
│       └── ai/
│           ├── __init__.py
│           ├── client.py      # LiteLLM统一调用
│           ├── chains.py     # 评估Chain
│           └── prompts.py    # Prompt模板
├── celery_app/
│   ├── __init__.py
│   ├── celery.py
│   └── tasks/
│       ├── __init__.py
│       ├── eval_task.py      # 评估任务
│       └── resume_task.py    # 简历解析任务
├── tests/
│   ├── __init__.py
│   ├── api/
│   │   ├── user/             # 用户端API测试
│   │   └── employee/         # 员工端API测试
│   ├── services/
│   └── conftest.py
├── requirements.txt
└── .env.example
```

---

## 十三、前端完整目录

```
frontend/
├── src/
│   ├── api/
│   │   ├── client.ts          # Axios封装
│   │   ├── user/
│   │   │   ├── auth.ts
│   │   │   ├── jobs.ts
│   │   │   ├── resumes.ts
│   │   │   ├── applications.ts
│   │   │   └── analytics.ts
│   │   └── employee/
│   │       ├── auth.ts
│   │       ├── jobs.ts
│   │       ├── resumes.ts
│   │       ├── evaluations.ts
│   │       ├── applications.ts
│   │       └── analytics.ts
│   ├── components/
│   │   ├── ui/               # shadcn/ui组件
│   │   │   ├── button.tsx
│   │   │   ├── card.tsx
│   │   │   ├── dialog.tsx
│   │   │   ├── radar-chart.tsx
│   │   │   └── pie-chart.tsx
│   │   ├── layout/
│   │   │   ├── user-header.tsx
│   │   │   ├── employee-header.tsx
│   │   │   └── sidebar.tsx
│   │   └── common/
│   │       ├── skill-tag.tsx      # 可点击查看片段
│   │       ├── match-badge.tsx
│   │       ├── advantage-comment.tsx
│   │       ├── disadvantage-comment.tsx
│   │       └── eval-pending.tsx   # 评估未完成提示
│   ├── pages/
│   │   ├── user/              # 用户端页面
│   │   │   ├── login.tsx
│   │   │   ├── register.tsx
│   │   │   ├── jobs.tsx
│   │   │   ├── job-detail.tsx
│   │   │   ├── my-resumes.tsx
│   │   │   ├── my-applications.tsx
│   │   │   └── application-detail.tsx  # 含雷达图+优缺点+状态判断
│   │   └── employee/          # 员工端页面
│   │       ├── login.tsx
│   │       ├── dashboard.tsx
│   │       ├── jobs.tsx
│   │       ├── job-create.tsx    # 含AI生成技能
│   │       ├── resumes.tsx
│   │       ├── resume-detail.tsx
│   │       ├── evaluations.tsx
│   │       ├── eval-batch.tsx    # 批量评估
│   │       ├── eval-detail.tsx   # 评估详情+雷达图
│   │       ├── applications.tsx
│   │       └── application-detail.tsx
│   ├── store/
│   │   ├── auth.ts
│   │   └── app.ts
│   ├── hooks/
│   │   ├── use-auth.ts
│   │   └── use-toast.ts
│   ├── lib/
│   │   └── utils.ts
│   ├── types/
│   │   ├── auth.ts
│   │   ├── job.ts
│   │   ├── resume.ts
│   │   ├── evaluation.ts     # 含优缺点字段
│   │   └── application.ts
│   ├── App.tsx
│   ├── main.tsx
│   └── index.css
├── package.json
├── tailwind.config.js
├── vite.config.ts
└── tsconfig.json
```

---

## 十四、环境配置示例

```env
# .env.dev

# ==================== 应用配置 ====================
APP_NAME=Resume Platform
DEBUG=true
SECRET_KEY=your-secret-key-change-in-production
ACCESS_TOKEN_EXPIRE_MINUTES=15
REFRESH_TOKEN_EXPIRE_DAYS=7

# ==================== 数据库配置 ====================
DB_HOST=localhost
DB_PORT=3306
DB_USER=root
DB_PASSWORD=your-db-password
DB_NAME=resume_platform

# ==================== Redis配置 ====================
REDIS_HOST=localhost
REDIS_PORT=6379
REDIS_DB=0

# ==================== LiteLLM配置 ====================
# AI模型提供商: openai / anthropic / azure / ollama / local
LITELLM_PROVIDER=openai
OPENAI_API_KEY=sk-your-api-key
OPENAI_API_BASE=https://api.openai.com/v1
OPENAI_MODEL=gpt-4-turbo-preview
FALLBACK_MODEL=gpt-3.5-turbo

# ==================== 存储配置 ====================
# 存储类型: LOCAL / OSS / COS
STORAGE_TYPE=LOCAL
# 本地存储路径
LOCAL_STORAGE_PATH=./note
# 阿里云OSS配置(可选)
OSS_ACCESS_KEY_ID=your-access-key
OSS_ACCESS_KEY_SECRET=your-secret-key
OSS_BUCKET_NAME=your-bucket
OSS_ENDPOINT=oss-cn-hangzhou.aliyuncs.com

# ==================== 邮件配置 ====================
SMTP_HOST=smtp.example.com
SMTP_PORT=587
SMTP_USER=your-email@example.com
SMTP_PASSWORD=your-email-password
EMAIL_FROM=noreply@example.com

# ==================== Celery配置 ====================
CELERY_BROKER_URL=redis://localhost:6379/1
CELERY_RESULT_BACKEND=redis://localhost:6379/2
```

---

## 十五、设计方案总结

| 模块 | 采用方案 | 理由 |
|------|---------|------|
| 存储 | 策略模式 + Registry | 开闭原则，新增存储类型不修改代码 |
| AI框架 | LangChain + LiteLLM | 统一接口切换模型，内置重试/降级 |
| Token | 双Token (Access 15min + Refresh 7d) | 安全 |
| 简历解析 | LLM解析 | 准确提取语义 |
| 评估触发 | 手动+批量+Celery异步（仅员工端） | 可控 + 不阻塞用户 |
| API分离 | 用户端 `/user/*` vs 员工端 `/employee/*` | 权限清晰隔离 |
| 登录方式 | login_type字段区分（password/code） | 明确可靠，不依赖邮箱格式判断 |
| 用户端能力 | 只能看自己的简历、投递、可视化（需评估完成） | 数据隔离 |
| 员工端能力 | 可管理岗位、AI评估、所有简历 | 全功能 |
| 优缺点评价 | advantage/disadvantage字段，支持空字符串 | 无缺点显示"挺符合岗位预期" |
| 用户端可视化 | 评估完成才有数据，否则显示"评审还在进行中" | 数据一致性保证 |
| 提示词工程 | 结构化、明确规则、量化标准、异常处理 | 生产级标准 |
| 前端路由 | React Router v6 | 标准方案 |
| 状态管理 | Zustand | 轻量简洁 |
| 图表 | Recharts | React友好 |
| UI | Tailwind + shadcn/ui | 简约风格 |
