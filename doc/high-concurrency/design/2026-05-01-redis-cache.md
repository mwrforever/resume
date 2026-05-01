# Redis 缓存架构设计方案

## 1. 背景与约束

| 维度 | 内容 |
| --- | --- |
| 业务场景 | 简历平台：用户端投递、员工端管理、AI 评估、验证码等 |
| 技术栈 | FastAPI + React + MySQL(aiomysql) + Redis(redis.asyncio) |
| 当前状态 | 缓存已完整落地，Service 层缓存 + JSON→ORM 反序列化模式 |
| 性能目标 | 读缓存提升响应速度，验证码防刷防滥用 |
| 一致性要求 | 缓存与数据库一致性：写操作后删除缓存，下次读取被动重建 |
| 核心约束 | 每分钟同 IP 同业务场景只能发送一次；每邮箱同类型 60s 冷却；验证码 5min 有效 |

---

## 2. 缓存结构设计

### 2.1 Key 命名规范（四段式：`业务:实体:操作:标识`）

```
业务前缀:实体:操作:标识
app:user:session:1001
verify:send:user:john@example.com
job:detail:42
dept:list:all
```

### 2.2 已落地 Key 清单

| 业务场景 | Key Pattern | Value | TTL |
| --- | --- | --- | --- |
| 验证码冷却 | `verify:send:{user_type}:{identifier}` | `"1"` | 60s |
| 验证码存储 | `verify:code:{user_type}:{identifier}` | `"123456"` | 5min |
| IP 频率计数 | `verify:count:{ip}` | int count | 60s |
| 用户信息 | `user:{user_id}` | JSON | 5min |
| 用户邮箱 | `user:email:{email}` | JSON | 5min |
| 员工信息 | `employee:{employee_id}` | JSON | 5min |
| 员工邮箱 | `employee:email:{email}` | JSON | 5min |
| 员工工号 | `employee:emp_no:{emp_no}` | JSON | 5min |
| 部门列表 | `dept:list` | JSON | 30min |
| 部门负责人 | `dept:leaders` | JSON | 30min |
| 标签列表 | `tag:list:{tag_type}` | JSON | 30min |
| 岗位详情 | `job:detail:{job_id}` | JSON | 5min |
| 岗位技能 | `job:skills:{job_id}` | JSON | 5min |
| 岗位计数 | `job:count_active` | int | 5min |
| 岗位列表 | `job:list:p{page}:s{size}` | JSON | 2min |
| 评估模板 | `template:{template_id}:detail` | JSON | 10min |
| 评估维度 | `dimension:list` | JSON | 30min |
| 待评估计数 | `eval:pending_count` | int | 2min |
| 平均匹配分 | `eval:avg_score` | float str | 2min |
| 最近活动 | `eval:recent` | JSON | 2min |
| 匹配度分布 | `eval:match_dist:{job_id}` | JSON | 2min |
| 用户简历列表 | `resume:user:{user_id}` | JSON | 5min |
| 简历总数 | `resume:count_all` | int | 5min |
| 投递存在性 | `application:exists:{user_id}:{job_id}` | `"1"` | 5min |

### 2.3 Value 大小控制

- 单条缓存 Value 控制在 **1KB - 100KB** 以内
- 大数据（简历文件列表）**不缓存**，按 ID 直接查询
- 列表类缓存需设置**最大条数限制**，避免无限增长

---

## 3. 缓存策略

### 3.1 缓存层级

```
┌──────────────────────────────────────┐
│           Service Layer             │
│  (JobService / DeptService 等)       │
├──────────────────────────────────────┤
│     CacheService (redis.asyncio)     │  ← 统一入口
├────────────────────────────────────┤
│         Redis (分布式缓存)             │
└──────────────────────────────────────┘
```

### 3.2 读写模式

**读缓存（Cache-Aside）**：
```
1. GET key → 命中 → JSON → ORM 反序列化 → 返回
2. 未命中 → 查 DB → ORM 对象 → JSON 序列化 → 回写 Redis → 返回
```

**写缓存（Delete-On-Write）**：
```
1. 更新 DB
2. 删除缓存（DEL key）
3. 下次读自动重建
```

### 3.3 淘汰策略

- TTL 强制过期，所有缓存必须设置 TTL，禁止永久有效
- TTL 设计原则：数据变更频率越高，TTL 越短

---

## 4. 高可用设计

### 4.1 验证码防刷（穿透防护）

三层防线，层层拦截：

```
┌─────────────────────────────────────────────────────────────┐
│ 第一层：发送冷却（时间窗口互斥）                                     │
│   Key  = verify:send:{user_type}:{identifier}               │
│   流程：                                                       │
│     1. GET verify:send:{user_type}:{identifier}              │
│     2. 存在 → return "发送过于频繁"                              │
│     3. 不存在 → SETEX verify:send:{user_type}:{identifier} 60 │
│     4. 发送验证码，写入 verify:code:{user_type}:{identifier}   │
│   效果：同邮箱同类型 60s 内重复点击无效                              │
├─────────────────────────────────────────────────────────────┤
│ 第二层：消费限制（一次性令牌）                                      │
│   Key  = verify:code:{user_type}:{identifier}                 │
│   流程：                                                       │
│     1. GET verify:code:{user_type}:{identifier}              │
│     2. 不存在 → return "验证码错误"                              │
│     3. 存在且匹配 → DEL key → return "验证成功"                  │
│     4. 存在但不匹配 → return "验证码错误"                         │
│   效果：验证码只能使用一次，防复制攻击                               │
├─────────────────────────────────────────────────────────────┤
│ 第三层：IP 频率限制（计数器）                                      │
│   Key  = verify:count:{ip}                                    │
│   流程：                                                       │
│     1. INCR verify:count:{ip}                                │
│     2. > 5 → return "请求过于频繁，请稍后再试"                      │
│     3. TTL 为 0 → SETEX 60s（首次设置过期时间）                    │
│   效果：同 IP 每分钟最多 5 次发送                                 │
└─────────────────────────────────────────────────────────────┘
```

**空值缓存**：无论发送成功/失败，冷却 Key 均写入，防止穿透。

### 4.2 雪崩防护

| 场景 | 方案 |
| --- | --- |
| 热点 Key 批量过期 | TTL = 基础 TTL + random(0, 30)s |
| Redis 宕机 | 降级策略：cache miss 时直接查 DB，保证可用性 |
| 数据库压力突增 | 缓存预热：服务启动时主动加载热点数据 |

### 4.3 击穿防护

不引入分布式锁，缓存击穿时降级为直接查 DB，保证可用性。

---

## 5. 一致性方案

### 5.1 更新策略

```
写入路径：Service.update() → Repository.update_db() → DEL cache key
读取路径：GET cache → miss → DB → ORM → JSON → SET cache → return
```

### 5.2 异常兜底

- Redis 连接异常：捕获并记录日志，业务降级为直接查 DB（不抛出 500）
- 所有 cache 操作使用 try/except 包裹，不影响主业务流程

---

## 6. 实现文件结构

```
backend/app/infrastructure/
├── cache/
│   ├── __init__.py           # from ..redis_cache import get_cache, CacheService
│   ├── redis_cache.py        # CacheService 类（6个通用方法 + 3个Lua脚本方法）
│   └── redis_constants.py   # 所有 Key/TTL 常量
```

### 6.1 CacheService 通用方法

```python
async def get(self, key: str) -> str | None
async def set(self, key: str, value: str, expire: int)
async def delete(self, key: str)
async def get_json(self, key: str) -> dict | None
async def set_json(self, key: str, value: dict, expire: int)
async def delete_pattern(self, pattern: str)
```

### 6.2 Service 层缓存模式

```python
async def get_user_resumes(self, user_id: int) -> list[Resume]:
    if self.cache:
        cached = await self.cache.get_json(RESUME_BY_USER_KEY.format(user_id=user_id))
        if cached is not None:
            return [Resume(**r) for r in cached]  # JSON → ORM
    resumes = await self.resume_repo.get_by_user(user_id)
    if self.cache and resumes:
        await self.cache.set_json(
            RESUME_BY_USER_KEY.format(user_id=user_id),
            [self._resume_to_dict(r) for r in resumes],
            RESUME_BY_USER_TTL
        )
    return resumes
```

---

## 7. 已接入缓存的模块

| 模块 | 缓存 Key | 操作 |
| --- | --- | --- |
| user | USER_KEY / USER_EMAIL_KEY | 读缓存/写删除 |
| employee | EMPLOYEE_KEY / EMAIL / EMP_NO | 读缓存/写删除 |
| dept | DEPT_LIST_KEY / DEPT_LEADERS_KEY | 读缓存/写删除 |
| tag | TAG_LIST_KEY:{tag_type} | 读缓存/写删除 |
| job | JOB_DETAIL / JOB_SKILLS / JOB_COUNT / JOB_LIST | 读缓存/写删除 + pattern删除 |
| eval_template | TEMPLATE_DETAIL / DIMENSION_LIST | 读缓存/写删除 |
| resume | RESUME_BY_USER / RESUME_COUNT_ALL | 读缓存/写删除 |
| application | APPLICATION_EXISTS_KEY | 写删除 |
| evaluation | EVAL_PENDING / AVG_SCORE / RECENT / MATCH_DIST | 读缓存/写删除 |
| analytics | 复用 evaluation service | 读缓存 |

---

## 8. 监控与运维

### 8.1 关键指标

| 指标 | 监控意义 |
| --- | --- |
| `redis_connections` | 连接池健康度 |
| `cache_hit_rate` | 命中率，低于 60% 需优化 |
| `verify:count:{ip}` 计数器 | IP 频率异常预警 |
| `redis_command_latency` | 命令延迟，超 10ms 预警 |

### 8.2 告警阈值

- 缓存命中率 < 50%
- Redis 命令延迟 > 50ms
- 验证码发送频率异常（同一 IP 1min 内 > 10 次）

---

## 9. 风险评估

| 风险 | 影响 | 缓解措施 |
| --- | --- | --- |
| 同步 Redis 客户端阻塞事件循环 | 所有 async 路由卡死 | 已替换为 redis.asyncio |
| 验证码 Key 命名冲突 | 数据覆盖 | 统一前缀 + 层级分隔 |
| TTL 设置过长 | 数据过期不感知 | 定期审查，统一管控 |
| 缓存雪崩 | DB 被打垮 | TTL 随机偏移 + 降级策略 |
| IP 频率限制绕过 | 攻击者换 IP | 结合业务风控 |
