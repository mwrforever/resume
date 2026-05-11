## 一、项目架构与目录规范（优化）

严格遵循模块化 + 分层架构思想，禁止越层调用。每个业务模块形成逻辑闭环：

```text
endpoint → service → repository → db/redis → schema
```

### 1.0 项目技术栈规范

**后端技术栈：**
- Python 3.12+、FastAPI、Pydantic v2、SQLAlchemy 2.x Async ORM、aiomysql、redis.asyncio、Celery。
- AI/Agent 技术栈必须以 LangGraph 作为 Agent 编排运行时，LangChain/LangChain OpenAI 仅作为模型、Prompt、链路组件能力使用，禁止把 Agent 平台实现为单次 LangChain API 包装。
- LLM 调用必须采用 `model_router → gateway → provider client` 分层：
  - `model_router`：负责模型路由、重试、fallback、协议选择。
  - `gateway`：负责协议适配（如 OpenAI-compatible）、请求构造、响应归一化、token usage 提取。
  - `provider client`：只能封装具体 SDK，不允许承载业务规则。
- Agent Runtime 必须通过 LangGraph graph/node/state 表达可编排流程，Service 层只负责业务状态、权限、持久化和调用 graph，禁止在 Service 中直接拼装复杂 Agent 流程。

**前端技术栈：**
- React 19、TypeScript、Vite、Tailwind CSS、React Router、Zustand、Axios、Lucide React。
- UI 风格必须遵循企业级 HR SaaS 后台：专业蓝色体系、高对比文本、清晰信息层级、扁平化卡片、可观测 Trace 面板、可访问表单控件。
- 前端接口调用必须经过 `src/api/`，业务页面禁止直接调用 axios。

**代码风格规范**
- 输出的代码必须要包含详细的中文代码注释，增加代码可读性，必须检查注释不要乱码
- 核心业务流程必须包含详细的中文日志记录，方便问题排查

### 1.1 后端目录结构（优化后的模块化 schemas）

```text
backend/
├── main.py                      # 启动入口，委托 app/main.py
├── app/
│   ├── main.py                  # FastAPI应用工厂 + 路由注册 + lifespan管理资源
│   │
│   ├── core/                     # 核心配置、日志、安全、异常
│   │   ├── config.py
│   │   ├── logging.py
│   │   ├── security.py
│   │   └── exceptions.py
│   │
│   ├── api/                      # HTTP API层
│   │   ├── deps.py               # 依赖注入
│   │   └── v1/
│   │       ├── router.py
│   │       └── endpoints/        # 按业务模块拆分
│   │           ├── user.py
│   │           ├── employee.py
│   │           ├── resume.py
│   │           ├── job.py
│   │           ├── application.py
│   │           ├── evaluation.py
│   │           ├── eval_template.py
│   │           ├── dept.py
│   │           ├── tag.py
│   │           ├── analytics.py
│   │           └── system.py
│   │
│   ├── models/                   # ORM模型
│   │   ├── user.py
│   │   ├── employee.py
│   │   ├── resume.py
│   │   └── ...
│   │
│   ├── schemas/                  # 按模块拆分，每个业务模块内聚 request/response/dto
│   │   ├── common.py             # 公共响应/分页结构
│   │   ├── agent/
│   │   │   ├── request.py
│   │   │   ├── response.py
│   │   │   └── dto.py
│   │   ├── user/
│   │   │   ├── request.py
│   │   │   ├── response.py
│   │   │   └── dto.py
│   │   └── ...                   # 其他业务模块同理
│   │
│   ├── services/                 # 业务逻辑层
│   │   ├── user_service.py
│   │   ├── employee_service.py
│   │   └── cache_service.py      # Redis缓存封装，真正进行redis缓存
│   │
│   ├── repositories/             # 数据访问层
│   │   ├── user_repository.py
│   │   ├── employee_repository.py
│   │   └── ...
│   │
│   ├── db/                       # MySQL/Redis 初始化
│   │   ├── mysql.py
│   │   └── redis.py
│   │
│   ├── llm/                       # LLM/Agent 调用链
│   │   ├── model_router.py        # 模型路由、fallback、重试
│   │   ├── gateway.py             # 协议网关、响应归一化
│   │   ├── graphs/                # LangGraph Agent 编排
│   │   ├── clients/
│   │   ├── chains/
│   │   ├── prompts/
│   │   ├── memory/
│   │   ├── retrieval/
│   │   ├── embeddings/
│   │   ├── tools/
│   │   ├── guards/
│   │   └── tracing/
│   │
│   ├── workers/                  # Celery异步任务
│   │   ├── celery_app.py
│   │   ├── beat_schedule.py
│   │   └── tasks/
│   │
│   ├── middleware/               # 中间件
│   └── utils/                     # 通用工具
│       ├── cache_utils.py          # 负责缓存的通用工具方法，如构建key，序列化和反序列化等   
│       ├── mail_utils.py
│       ├── storage_utils.py
│       ├── resume_parser.py
│       └── security_utils.py
├── tests/
├── pyproject.toml
└── Dockerfile
```

### 1.2 各层级职责

| 层级   | 目录                | 职责            |
| ---- | ----------------- | ------------- |
| 入口   | `main.py`         | 程序启动、容器组装     |
| 配置   | `core/config.py`  | 全局配置、常量       |
| 实体   | `schemas/`        | DTO、请求/响应     |
| 模型   | `models/`         | ORM表映射        |
| 业务   | `services/`       | 业务规则、事务处理     |
| 数据访问 | `repositories/`   | 数据存取          |
| 核心   | `core/`           | 安全、异常、日志      |
| 外部服务 | `llm/`、`workers/` | LLM调用链、异步任务   |
| 工具   | `utils/`          | 通用工具函数（含缓存工具） |

### 1.3 层级依赖规范

* **调用链路**：`endpoint → service → repository → db/redis → schema`
* 上层可调用下层，下层禁止反向调用
* 同层模块禁止直接调用
* 每个业务模块形成闭环，schemas、service、repository、endpoint 对应一致
* Redis/数据库等基础设施通过依赖注入获取，禁止函数内部直接实例化


### 1.4 前端目录结构

```text
frontend/
├── src/
│   ├── api/            # 接口层：统一管理后端请求
│   ├── assets/         # 静态资源
│   ├── components/     # 公共组件
│   ├── hooks/          # 自定义 Hooks
│   ├── pages/          # 页面组件 (对应路由)
│   ├── store/          # 状态管理 (如 Zustand/Redux)
│   ├── types/          # TypeScript 类型定义 (对应后端 Schemas)
│   ├── utils/          # 前端工具函数
│   └── App.tsx
```

---

## 二、编码行为约束

### 2.1 编码先思考
**不主观臆断、不隐瞒疑问、明确利弊权衡**

开始编写代码前：
- 清晰列明所有假设，不确定就主动询问。
- 存在多种理解方式时，全部列出，不私自选定一种。
- 存在更简洁方案时主动说明，必要时提出异议。
- 内容模糊不清就暂停开发，指出疑点并确认需求。

### 2.2 简洁优先
**用最少代码解决问题，不做额外推测性开发**

- 不添加需求以外的功能。
- 一次性使用的代码不做多余抽象封装。
- 不新增未要求的扩展能力、可配置特性。
- 不对逻辑上不可能出现的场景做异常处理。
- 200 行代码能精简为 50 行时，务必重构简化。
- 自问：资深工程师会不会认为这段代码过度复杂？如果会，就简化。

### 2.3 精准改动
**只修改必要内容，只清理自身改动产生的冗余**

修改已有代码时：
- 不擅自优化周边代码、注释、格式排版。
- 不对正常运行、没有故障的代码重构。
- 遵循项目原有编码风格，哪怕你有更好写法。
- 发现无关废弃代码仅提醒说明，不擅自删除。

自身改动产生无用代码时：
- 删除因本次修改而失效的导入、变量、函数。
- 未经要求，不删除项目原本就存在的废弃代码。
- 校验标准：每一行修改内容，都必须对应用户需求。

### 2.4 目标导向执行
**明确验收标准，反复校验直至达标**

把任务转化为可验证目标：
- "增加校验逻辑" → "编写异常入参测试用例，并调试通过"
- "修复漏洞" → "编写复现漏洞的测试用例，调试至用例通过"
- "重构模块 X" → "保证重构前后所有测试均正常通过"

多步骤任务请简要列出流程：
```
[执行步骤] → 校验项：[检查内容]
[执行步骤] → 校验项：[检查内容]
[执行步骤] → 校验项：[检查内容]
```
清晰严格的验收标准，可自主迭代完成；模糊标准（"能用就行"）需要反复沟通确认。

---

## 三、后端开发规范

### 3.1 命名规约
- 文件/目录：全小写，单词间用下划线 `_` 分隔（如 `user_service.py`）。
- 类名：大驼峰。
- 函数/变量：蛇形命名法（snake_case）。严禁使用拼音，禁止使用单字母（循环计数器除外）。
- 常量：全大写，下划线分隔（如 `MAX_RETRY_COUNT`）。

### 3.2 分层职责（严禁越权）
- **Router 层**：禁止包含任何业务逻辑。只做参数校验（依赖 Pydantic）、调用 Service、返回统一格式。
- **Service 层**：负责业务规则。可以调用多个 Repository，处理事务边界。
- **Repository 层**：只与数据库/缓存打交道。不关心业务含义，只做数据存取。

### 3.3 类型约束
- **入参强类型**：所有请求参数必须通过 Pydantic BaseModel 定义与校验，禁止使用裸参数。
- **出参强类型**：所有响应结果必须通过 Pydantic BaseModel 序列化输出。
- **中间态强类型**：业务处理过程中的中间数据结构，必须定义独立的 Pydantic 类或 DTO，禁止直接使用 `dict` 传递。
- **导入精确**：import 时必须精确到具体类，禁止通配导入（`from module import *`）。

### 3.4 异常处理规约
- 禁止捕获基础异常：严禁使用 `except Exception as e` 吞掉异常。
- 自定义业务异常：定义 `BizError(BaseException)`，携带 `code` 和 `message`。
- 全局拦截：在 `core/exceptions.py` 中注册 FastAPI 异常处理器，统一返回错误格式，业务代码中禁止手动拼装错误响应的 dict。

### 3.5 异步与依赖注入

**合理使用 async：**
- 涉及网络 I/O 的操作（MySQL 查询、Redis 读写、外部 HTTP 请求）必须使用 `async def`，并搭配异步驱动（如 aiomysql、redis.asyncio）。
- 纯 CPU 密集型操作（如复杂图像处理、大文件加密）禁止使用 `async def`，应使用普通 `def`（FastAPI 自动放入线程池执行），或显式使用 `asyncio.to_thread`，严禁阻塞事件循环。

**强制依赖注入 (DI)：**
- 数据库会话（db session）、Redis 客户端连接、当前登录用户信息等，必须通过 FastAPI 的 `Depends` 机制获取。
- Service 层的依赖也应通过 DI 传递，严禁在函数内部直接实例化连接（如 `Session()` 或 `Redis()`）。

### 3.6 模块实例化规范
基于职责特征显式决策实例化策略，禁止无脑全部单例或全部多例：

| 模块类型 | 实例化策略 | 原因 |
| --- | --- | --- |
| 基础设施（数据库连接池、Redis 客户端、HTTP 会话、配置加载器） | **单例** | 资源昂贵，全局共享，避免连接泄漏 |
| 业务服务层（各 Service、工具类） | **单例** | 无状态纯逻辑，复用实例减少开销 |
| 有状态上下文（单次请求上下文、临时文件句柄） | **多例** | 携带请求级状态，共享会导致数据串扰 |
| ORM Session | **多例（每次操作新建）** | 线程安全，避免跨请求脏读 |

---

## 四、前端开发规范

### 4.1 命名规约
- 组件文件：大驼峰。
- 普通文件/目录：全小写，中划线 `-` 分隔（如 `user-profile.ts`）。
- 变量/函数：小驼峰。
- 常量：全大写，下划线分隔。
- 类型/接口：大驼峰，且必须以 `I` 或 `T` 开头（如 `IUserVO`、`TResponse`），禁止与后端模型同名混淆。

### 4.2 组件设计规约
- 单一职责：一个组件只做一件事，超过 200 行必须考虑拆分。
- Props 定义：必须使用 TypeScript interface 定义，禁止直接使用 `any`。
- 状态提升：仅当多个子组件需要共享状态时，才提升至父组件，避免不必要的全局状态泛滥。

### 4.3 副作用与请求规约
- 禁止在组件内直接调用 axios：所有接口调用必须封装在 `src/api/` 目录下。
- 请求/响应类型：前端 `types/` 中定义的接口响应结构，必须与后端 `schemas/` 严格一一对应。
- 慎用 `useEffect`：能通过事件触发解决的，不要用 `useEffect` 轮询或监听。

---

## 五、数据库与缓存规约

### 5.1 MySQL 规约
- 字段选择：表示金额必须用 `Decimal`，禁止用 `Float`/`Double`；表示状态必须用 `Tinyint`；字符串长度固定用 `Char`，可变用 `Varchar`。
- 禁止行为：严禁在数据库层面做复杂运算；严禁使用 `SELECT *`，必须明确指定字段。
- 索引规范：业务上具有唯一特性的字段，即使是组合字段，也必须建成唯一索引。禁止为表中的每一列都建立索引。
- 事务管理：在 Service 层控制事务范围，事务内禁止调用外部 RPC/HTTP 请求，避免长事务。

### 5.2 Redis 规约
- 键值设计：Key 必须带有业务前缀，使用冒号分隔（如 `app:user:session:1001`）。
- 过期时间：所有 set 操作必须设置过期时间 (TTL)，禁止存在永久有效的业务缓存。
- 防缓存穿透：对于缓存空值的情况，也必须设置较短的 TTL。
- 大 Key 禁止：禁止将 List/Hash/Set 用于无限增长的数据（如大列表），必须设置上限或分页处理。
- 缓存模式：读取 → 先查缓存，未命中查 DB，查到后回写缓存。写入 → 更新 DB 后直接删除对应缓存，让下次读取时被动重建，避免复杂的双写一致性逻辑。

---

## 六、API 契约规范

前后端对接的唯一切入点，必须遵循以下格式：

### 6.1 路径规约
- 使用小写字母 + 中划线 `-`。
- 路径中表示资源的名词用复数（如 `/api/v1/users` 而不是 `/api/v1/user`）。

### 6.2 统一响应结构
后端必须返回如下标准结构（通过 FastAPI `response_model` 统一）：
```json
{
  "code": 200,
  "message": "success",
  "data": {}
}
```
- `code`：业务状态码，200 为成功，其他为具体业务错误。
- `message`：提示信息。
- `data`：具体数据，无数据时为 `null`。

前端 `src/api/` 层在拦截器中统一处理 `code !== 200` 的弹窗或重定向，业务组件中只拿 `data`。

### 6.3 分页规范
请求参数统一为：`page`（页码，从 1 开始）、`page_size`（每页数量）。
响应 `data` 统一为：
```json
{
  "total": 100,
  "items": []
}
```

---

## 七、安全约束

### 7.1 敏感信息保护
- 密码、Token、密钥等必须通过环境变量注入，代码中禁止出现任何硬编码密钥。
- Pydantic 模型中对应字段使用 `SecretStr`。

### 7.2 输入校验
- Pydantic 负责结构校验（类型、必填、范围）。
- 业务层必须进行语义校验（如路径遍历防护），禁止只依赖单一校验层。

### 7.3 外部调用安全
所有对外部服务的 HTTP 请求必须：
- 设置合理的超时时间（connect + read timeout）。
- 限制最大响应体大小，防止 OOM。
- 对响应数据进行白名单校验，不信任任何外部返回结构。

### 7.4 日志规范
- 日志级别合理分级（DEBUG / INFO / WARNING / ERROR）。
- 禁止在日志中输出密码、Token 等敏感信息。

---

**规范生效判断**：代码差异中无效改动减少、因设计过度复杂导致的返工减少、先提问确认再开发，而非出错后补救。严格遵守分层不越界、命名不随性、异常不吞没、资源不乱用的底线。

---