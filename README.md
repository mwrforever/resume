# Resume Platform

企业级招聘管理平台：候选人提交简历、企业员工管理岗位与投递、AI Agent 提供「面试题生成」与「简历评估」两类智能服务。

---

## 一、技术栈

| 层 | 关键依赖 |
|---|---|
| 后端 | Python 3.12、FastAPI、Pydantic v2、SQLAlchemy 2.x Async、aiomysql、redis.asyncio、LangGraph、LangChain、Celery |
| 前端 | React 19、TypeScript、Vite、Tailwind、React Router、Zustand、Axios、Lucide |
| 基础设施 | MySQL 8、Redis 7+ |

## 二、模块关系

```
                ┌────────────────────────────────────────┐
                │           Frontend (React/Vite)        │
                └───────────────┬────────────────────────┘
                                │ Axios + SSE
                                ▼
                ┌────────────────────────────────────────┐
                │      FastAPI (app/api/v1/endpoints)    │
                │   user · employee · resume · job ·     │
                │   evaluation · agent · eval_template   │
                └─────┬──────────────────────────┬───────┘
                      │ Service                  │ Service
                      ▼                          ▼
            ┌───────────────────┐      ┌──────────────────────┐
            │  业务 Service 层   │      │ LLM/Agent 编排       │
            │ user/employee/... │      │ services/agent_*     │
            │ resume_evaluation │◄────►│ llm/graphs (LangGraph│
            │ interview_questions│      │   workflows)         │
            └────────┬──────────┘      └─────────┬────────────┘
                     │                            │
                     ▼                            ▼
            ┌───────────────────┐      ┌──────────────────────┐
            │  Repository 层    │      │  LLM Gateway/Router  │
            │ (SQLAlchemy 2.x)  │      │ (OpenAI 兼容协议)     │
            └────────┬──────────┘      └─────────┬────────────┘
                     │                            │
                     ▼                            ▼
              ┌──────────┐                ┌──────────────┐
              │  MySQL   │                │  LLM Provider│
              │  Redis   │                │ (Qwen/DS/...)│
              └──────────┘                └──────────────┘
                     ▲
                     │
            ┌────────┴─────────┐
            │  Celery Worker   │  ← Redis (broker/backend)
            │ eval / agent 队列 │
            └──────────────────┘
```

**核心调用链** `endpoint → service → repository → db/redis`，禁止越层；Agent 编排单独走 `service → llm/graphs (LangGraph) → llm/gateway → provider client`。

### Agent 工作流（LangGraph）

```
面试题生成 (interview_questions)：
  load_resume → suggest_dimensions → 【维度选择 interrupt】
    → build_question_plan → 【计划审批 interrupt】
    → fanout_generate_questions (每维度并行 LLM)
    → reduce_questions → finalize_question_set → END

简历评估 (resume_evaluation)：
  load_resume → analyze_resume_profile → load_job_candidates
    → 【岗位选择 interrupt】 → validate_job → deep_evaluation → END
```

中断后用户可：(1) 继续交互完成、(2) 发新消息**续接同上下文**（保留 state）、(3) 关闭会话。

### Celery 任务模块

| 模块 | 队列 | 用途 |
|---|---|---|
| `app.workers.tasks.eval_task` | `eval` | 简历批量评估（应用提交后异步打分） |
| `app.workers.tasks.agent_task` | `agent` | Agent 会话标题精化等轻任务 |

新增任务时只需在 `app/workers/celery_app.py` 的 `TASK_QUEUE_ROUTES` 加一行映射，启动脚本会自动消费新队列。

## 三、目录结构

```
resume/
├── backend/
│   ├── app/
│   │   ├── main.py                  # FastAPI 工厂 + lifespan
│   │   ├── core/                    # config / logging / security / exceptions
│   │   ├── api/v1/endpoints/        # HTTP 路由（按业务模块）
│   │   ├── models/                  # SQLAlchemy ORM
│   │   ├── schemas/                 # Pydantic DTO/请求/响应
│   │   ├── services/                # 业务逻辑层
│   │   ├── repositories/            # 数据访问层
│   │   ├── llm/
│   │   │   ├── gateway.py           # OpenAI 协议网关
│   │   │   ├── model_router.py      # 模型路由 + fallback
│   │   │   └── graphs/workflows/    # LangGraph 编排
│   │   ├── workers/
│   │   │   ├── celery_app.py        # Celery 配置 + 队列映射
│   │   │   └── tasks/               # eval_task / agent_task
│   │   └── utils/
│   ├── tests/
│   └── pyproject.toml
├── frontend/
│   └── src/
│       ├── api/                     # 统一接口层
│       ├── pages/                   # 路由页面
│       ├── components/              # 公共组件
│       ├── store/                   # Zustand
│       └── types/
└── scripts/
    └── start-dev.ps1                # 本地一键启动脚本
```

## 四、本地启动

### 1. 前置条件
- Python 3.12+
- Node.js 20+
- MySQL 8（用户/库可访问）
- Redis 7+

### 2. 准备环境变量

```powershell
cp backend/.env.example backend/.env
# 按提示填 DB / Redis / LLM API Key / SMTP
```

字段说明见 `backend/.env.example` 注释。`SECRET_KEY` 必须自行生成：
```powershell
python -c "import secrets; print(secrets.token_urlsafe(32))"
```

### 3. 安装依赖

```powershell
# 后端
cd backend
python -m venv .venv
.\.venv\Scripts\Activate.ps1
pip install -e .

# 前端
cd ..\frontend
npm install
```

### 4. 一键启动（Windows / PowerShell）

```powershell
.\scripts\start-dev.ps1
```

会在三个新 PowerShell 窗口分别启动：
- `[BACKEND]` uvicorn :8000
- `[CELERY]` worker（自动读取 `celery_app.ALL_QUEUES`，消费全部声明的队列）
- `[FRONTEND]` vite dev server :5173

参数：
```powershell
.\scripts\start-dev.ps1 -BackendPort 8001   # 改后端端口
.\scripts\start-dev.ps1 -NoFrontend          # 只起后端 + Celery
.\scripts\start-dev.ps1 -NoCelery            # 只起后端 + 前端
```

关闭对应窗口或 Ctrl+C 即可停止单个服务，互不影响。

### 5. 验证服务就绪

- 后端：http://localhost:8000/docs
- 前端：http://localhost:5173
- Celery：观察窗口出现 `celery@... ready.`

## 五、标准使用示例 — 从登录到生成面试题

> 演示完整流程：登录企业员工账号 → 上传简历 → 让 AI 出面试题。

### 步骤 1：注册并登录企业员工
1. 浏览器打开 http://localhost:5173/employee/register
2. 邮箱注册时会收到验证码（确保 `.env` SMTP 配置正确）
3. 登录后进入 `/employee/dashboard`

### 步骤 2：管理员配置模型（首次）
1. 用管理员账号登录（首次部署时由 `db/mysql.py` 自动把已知邮箱回填为 admin；也可手动 `UPDATE sys_employee SET is_admin=1 WHERE email=...`）
2. 进入「模型配置」菜单 → 新增配置
3. 填必填项：配置名、模型名、Base URL、API Key；高级参数默认折叠走推荐值
4. 保存后所有员工立即可见可用

### 步骤 3：建岗位（评估场景需要）
- 进入「岗位管理」 → 新增 → 选评估模板（决定评估维度）

### 步骤 4：用 Agent 工作台
1. 顶部点「Agent 工作台」打开沉浸式界面
2. 新建会话 → 选模型
3. 输入框附件区上传一份 PDF 简历
4. 发送：`帮我针对这份简历准备一组面试题，重点考察后端工程能力`
5. 工作流自动跑：
   - 加载简历
   - AI 提议维度 → **维度选择卡**弹出 → 勾选你认可的维度（或驳回让 AI 重推）
   - 生成出题计划 → **审批卡**弹出 → 通过 / 编辑 / 驳回
   - 并行为每个维度出题 → 汇总成题集卡
6. 中途若想换思路：直接发新消息（如「更聚焦算法工程」），会**自动续接**当前工作流，把新意图作为反馈重推

### 步骤 5：发起简历评估
1. 在「评估管理」选某条投递 → 提交批量评估
2. Celery 异步执行 → 通过 SSE/轮询拿评估报告
3. 或在 Agent 工作台开新会话，发：`评估这份简历`，按提示选岗位 → 得到结构化评估报告（含画像、技能维度评分、面试建议、综合评语）

## 六、常见问题

| 现象 | 排查 |
|---|---|
| 后端启动报 `Field required` | `.env` 缺字段，对照 `.env.example` 补全 |
| Celery 启动后任务一直 PENDING | 检查 broker_url 的 Redis 是否能连通；脚本启动窗口里看是否成功消费 `eval,agent` 队列 |
| Agent 输出被截断 / 缺维度 | 模型配置里把 `max_tokens` 调高（默认 8192，结构化题量大时建议 8192-16384） |
| LangGraph 提示 `received no input` | 服务重启后 InMemorySaver 丢 checkpoint，新发消息即可，旧 thread 会自动隔离 |
| 前端 401 | Access token 默认 15 分钟过期，Axios 拦截器会自动 refresh；若仍失败请重新登录 |

## 七、开发约定

详见 [`CLAUDE.md`](./CLAUDE.md)：分层规范、命名、异常、依赖注入、缓存策略、API 契约。
