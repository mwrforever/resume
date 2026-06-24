# 生产部署 & 运维操作指南（OPERATION.md）

本文档面向运维同学，描述如何在一台 Linux 服务器上用 docker compose 部署「简历筛选平台」，并给出日常运维操作（升级、备份、回滚、排障）。

---

## 一、部署架构

```
            ┌──────────────────────────────┐
   80 / 443 │            Nginx             │  ← 容器：frontend
 (来访入口)  │  - 静态资源（dist）           │
            │  - /api → backend:8000        │
            │  - /preview /files → backend  │
            └──────────────┬───────────────┘
                           │
                ┌──────────┴──────────┐
                │                     │
       ┌────────▼─────────┐    ┌──────▼─────────┐
       │ FastAPI / uvicorn │    │ Celery worker  │
       │ 容器: backend     │    │ 容器: celery   │
       │ Port 8000 (内网)  │    │ 队列: eval,    │
       │                  │    │       agent    │
       └────────┬─────────┘    └──────┬─────────┘
                │                     │
       ┌────────┴─────────┐    ┌──────┴─────────┐
       │      MySQL       │    │     Redis      │
       │   容器: mysql     │    │  容器: redis   │
       │ Volume: mysql_data│    │ Volume: redis_data │
       └──────────────────┘    └────────────────┘
```

**关键约束**

- 基础镜像统一用官方 `latest` 标签（mysql/redis/nginx），跟随上游滚动。**生产固化版本**时把 `docker-compose.yml` 中三处 `:latest` 改成具体 tag（如 `mysql:8.4`、`redis:7.4`、`nginx:1.27`），并写入运维变更记录。
- LangGraph checkpointer 目前是 **InMemorySaver**（见 `backend/app/llm/graphs/workflows/_checkpointer.py`），中断态保存在 backend 进程内存中。
  - 因此 backend 容器 **只能跑 1 个 uvicorn worker**，且不能水平扩多副本。
  - 重启 backend 容器会丢失"未完成 Agent 会话"的 checkpoint，前端再发消息会自动新建上下文。
  - 需要扩容/重启不丢态时，先把 checkpointer 换成 Redis/Postgres 版本，再放开 worker 数。
- Celery worker 队列从 `app.workers.celery_app.ALL_QUEUES` 动态读取，新增任务模块时改 `TASK_QUEUE_ROUTES` 即可，**不用动 compose**。

---

## 二、服务器前置准备

1. **系统**：Linux x86_64（Ubuntu 22.04 / CentOS 8+ 已验证）；至少 4C8G、磁盘 ≥ 60G。
2. **Docker**：`docker >= 24.0`、`docker compose plugin >= 2.20`（`docker compose version` 能跑即可）。
3. **端口**：服务器对外放通 80（或 443，需要自行加 TLS 反代/或在 nginx 里加证书）。
4. **域名（可选）**：把域名 A 记录指向服务器；本指南默认走 IP/80。
5. **代码**：把仓库 clone 到 `/opt/resume`（路径可改，下文以此为例）。

---

## 三、首次部署

### 3.1 拉代码

```bash
sudo mkdir -p /opt && cd /opt
sudo git clone <your-repo-url> resume
cd resume
git checkout master   # 生产固定走 master
```

### 3.2 准备配置

```bash
cd deploy
cp .env.production.example .env.production
vi .env.production       # 把所有 *** CHANGE ME *** 填上
```

**重点字段**（不填会导致启动失败或安全风险）：

| Key | 说明 |
|---|---|
| `SECRET_KEY` | JWT 签名密钥，必须 32 字节以上随机串：`python -c "import secrets; print(secrets.token_urlsafe(32))"` |
| `DB_ROOT_PASSWORD` / `DB_PASSWORD` | MySQL root 密码（仅运维用）与应用账号密码（应用走这个） |
| `REDIS_PASSWORD` | 留空=无密码（依赖网络隔离），生产建议填强密码 |
| `OPENAI_API_KEY` / `OPENAI_API_BASE` / `OPENAI_MODEL` | LLM 供应商凭证；DashScope/DeepSeek 走 OpenAI 兼容协议 |
| `SMTP_*` / `EMAIL_FROM` | 邮件验证码渠道，必填，不然注册/找回密码用不了 |
| `INIT_ADMIN_*` | 首次启动若数据库无管理员则自动创建；登录后请立即修改 |
| `WEB_PORT` | 对外端口，默认 80；如需 443 请挂 TLS 反代或在 nginx 加证书 |

### 3.3 构建并启动

```bash
cd /opt/resume/deploy
docker compose --env-file .env.production up -d --build
```

第一次构建大约 5~10 分钟（取决于网络）。

### 3.4 验证

```bash
# 1. 容器全部 healthy
docker compose --env-file .env.production ps

# 期望状态：
#   resume_mysql    healthy
#   resume_redis    healthy
#   resume_backend  healthy
#   resume_celery   healthy（首次可能 starting，60s 后变 healthy）
#   resume_frontend healthy

# 2. 接口能通
curl -fsS http://<服务器IP>/api/v1/docs >/dev/null && echo "backend ok"
curl -fsS http://<服务器IP>/healthz && echo

# 3. 浏览器访问 http://<服务器IP>/  用 INIT_ADMIN_EMAIL/PASSWORD 登录
```

### 3.5 上线后立刻做的事

1. 用初始管理员登录 → 改密码 / 建正式管理员 / 禁用 INIT_ADMIN 账号。
2. 在「模型配置」菜单添加至少一个可用 LLM 配置，保存后所有员工可见。
3. （建议）把 `.env.production` 备份到运维保密库，**不要 commit**。

---

## 四、HTTPS（可选）

最省事的方案：在 nginx 层加证书。两条路：

**方案 A：用现有 frontend 容器加证书**

```bash
# 1. 把证书放到宿主机
mkdir -p /opt/resume/deploy/certs
cp fullchain.pem /opt/resume/deploy/certs/
cp privkey.pem   /opt/resume/deploy/certs/

# 2. 修改 frontend/nginx/default.conf 加 listen 443 ssl + ssl_certificate 指令
# 3. 在 docker-compose.yml 的 frontend 服务挂卷：
#      - ./certs:/etc/nginx/certs:ro
#    并把 ports 暴露 443:443
# 4. docker compose up -d --build frontend
```

**方案 B（推荐）**：前面再加一层 Caddy/Traefik/云 LB 处理 TLS，frontend 容器只听 80。简单、自动续期。

---

## 五、日常运维

### 5.1 查看状态

```bash
cd /opt/resume/deploy
docker compose --env-file .env.production ps
docker compose --env-file .env.production logs -f --tail=200 backend
docker compose --env-file .env.production logs -f --tail=200 celery
docker compose --env-file .env.production logs -f --tail=200 frontend
```

### 5.2 升级代码

```bash
cd /opt/resume
git fetch origin
git checkout master && git pull --ff-only

cd deploy
# 重新构建受影响镜像并滚动更新（不停其它服务）
docker compose --env-file .env.production up -d --build backend celery frontend

# 全量重建（包含 mysql/redis 配置变更时）
docker compose --env-file .env.production up -d --build
```

> **DB 迁移说明**：本项目使用 SQLAlchemy ORM 作为唯一来源（`backend/app/db/mysql.py` 启动时 `create_all`），新增表/字段会在 backend 容器启动时自动建立。**改动现有字段类型/索引必须人工 DDL，不会自动 ALTER**。

### 5.3 重启某个服务

```bash
docker compose --env-file .env.production restart backend
docker compose --env-file .env.production restart celery
```

### 5.4 停 / 全停 / 清理

```bash
# 停服务但保留卷
docker compose --env-file .env.production down

# ⚠️ 危险：连同卷一起删（数据全丢）
# docker compose --env-file .env.production down -v
```

### 5.5 进容器排查

```bash
# 后端 Python shell
docker compose --env-file .env.production exec backend python

# Celery 检查队列
docker compose --env-file .env.production exec celery \
  celery -A app.workers.celery_app:celery_app inspect active

# MySQL CLI
docker compose --env-file .env.production exec mysql \
  mysql -uroot -p"$(grep ^DB_ROOT_PASSWORD .env.production | cut -d= -f2-)" resume

# Redis CLI
docker compose --env-file .env.production exec redis redis-cli
```

---

## 六、备份与恢复

### 6.1 MySQL 备份

```bash
cd /opt/resume/deploy
mkdir -p /opt/backup/mysql
docker compose --env-file .env.production exec -T mysql \
  sh -c 'exec mysqldump -uroot -p"$MYSQL_ROOT_PASSWORD" --single-transaction --routines --triggers resume' \
  | gzip > /opt/backup/mysql/resume-$(date +%F-%H%M).sql.gz
```

建议挂到 crontab，每日凌晨一次：

```cron
0 3 * * * cd /opt/resume/deploy && docker compose --env-file .env.production exec -T mysql sh -c 'exec mysqldump -uroot -p"$MYSQL_ROOT_PASSWORD" --single-transaction --routines --triggers resume' | gzip > /opt/backup/mysql/resume-$(date +\%F).sql.gz && find /opt/backup/mysql -mtime +14 -delete
```

### 6.2 简历文件备份（`resume_storage` 卷）

```bash
docker run --rm -v resume-platform_resume_storage:/data -v /opt/backup/files:/backup alpine \
  tar czf /backup/storage-$(date +%F).tar.gz -C /data .
```

> 卷名前缀是 compose 项目名（`name: resume-platform`），可通过 `docker volume ls` 确认实际名字。

### 6.3 恢复

```bash
# MySQL
gunzip -c /opt/backup/mysql/resume-YYYY-MM-DD.sql.gz | \
  docker compose --env-file .env.production exec -T mysql \
  sh -c 'exec mysql -uroot -p"$MYSQL_ROOT_PASSWORD" resume'

# 文件
docker run --rm -v resume-platform_resume_storage:/data -v /opt/backup/files:/backup alpine \
  sh -c 'cd /data && tar xzf /backup/storage-YYYY-MM-DD.tar.gz'
```

---

## 七、回滚

### 7.1 应用回滚

```bash
cd /opt/resume
git log --oneline -10                # 找到上一个稳定 commit
git checkout <commit-sha>
cd deploy
docker compose --env-file .env.production up -d --build backend celery frontend
```

### 7.2 数据回滚

先停应用 → 恢复 6.3 的最近备份 → 再启应用。

---

## 八、监控与日志

- **日志**：默认到 stdout，`docker compose logs` 可看。建议接入 Promtail/Filebeat → Loki/ES。
- **健康检查**：compose 自带 healthcheck，可对接 Prometheus blackbox exporter。
- **常用入口**：
  - 前端：`http://<server>/`
  - FastAPI docs：`http://<server>/api/v1/docs`（生产建议加内网/Basic Auth 限制）

---

## 九、排障速查表

| 现象 | 排查点 |
|---|---|
| 前端 502 / 接口超时 | `docker compose ps`：backend 是否 healthy；`logs backend` 看异常 |
| Agent 中断后续接报 `received no input` | backend 容器重启过 → 内存 checkpoint 丢失，重新发新消息会自动新建上下文（已知限制） |
| Celery 任务 PENDING 不动 | `logs celery` 看是否消费到队列；进 redis-cli `LLEN eval` / `LLEN agent` 看积压 |
| 上传简历 413 | nginx `client_max_body_size` 调大（已默认 50m，再大改 `frontend/nginx/default.conf`） |
| 启动报 `Field required` | `.env.production` 缺字段，对照 `.env.production.example` 补全 |
| MySQL 容器频繁重启 | 卷权限/磁盘空间问题：`docker compose logs mysql`；首次启动慢正常，等 healthcheck |
| 改了 DDL 但表没变 | ORM `create_all` **不会自动 ALTER**，需手工迁移 SQL 进容器执行 |
| LLM 401/限流 | 模型配置后台覆盖了 `.env`；在「模型配置」里改 API Key/Base URL，立即生效 |

---

## 十、安全清单（上线前过一遍）

- [ ] `SECRET_KEY` 32+ 字节随机
- [ ] `DB_ROOT_PASSWORD` / `DB_PASSWORD` / `REDIS_PASSWORD` 全部强密码
- [ ] `INIT_ADMIN_PASSWORD` 上线后立刻改
- [ ] `docker-compose.yml` 中 mysql / redis 的 `ports` 行已注释或限定 `127.0.0.1`
- [ ] 服务器安全组只放 80/443，不放 3306/6379/8000
- [ ] 已配置 HTTPS（方案 A 或 B）
- [ ] 已加 mysql 定时备份 crontab
- [ ] `.env.production` 不在 git 里（默认已被 `.gitignore` 忽略）
