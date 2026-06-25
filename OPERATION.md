# 生产部署 & 运维操作指南（OPERATION.md）

本文档面向运维同学，描述如何在一台 Linux 服务器上用 docker compose 部署「简历筛选平台」，并给出日常运维操作（升级、备份、回滚、排障）。

---

## 一、部署架构

```
              ┌──────────────────────────────────┐
   80 / 443   │            Caddy                 │  ← 容器：caddy
 (来访入口)    │  - TLS 终结（LE 自动签发/续期）   │
              │  - HTTP→HTTPS 跳转 + HSTS         │
              │  - 反代到 frontend:80             │
              └────────────────┬─────────────────┘
                               │ docker 内网
              ┌────────────────▼─────────────────┐
              │            Nginx                 │  ← 容器：frontend
              │  - 静态资源（dist）               │
              │  - /api → backend:8000            │
              └────────────────┬─────────────────┘
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

- 基础镜像统一用官方 `latest` 标签（mysql/redis/nginx/caddy），跟随上游滚动。**生产固化版本**时把 `docker-compose.yml` 中四处 `:latest` 改成具体 tag（如 `mysql:8.4`、`redis:7.4`、`nginx:1.27`、`caddy:2.8`），并写入运维变更记录。
- **TLS 终结由 Caddy 完成**：Let's Encrypt 自动申请 + 自动续期（默认证书剩 30 天时续）。`caddy_data` 卷里存账号私钥和证书，**千万不要清空**，否则会反复触发 LE 速率限制。
- LangGraph checkpointer 使用 **AsyncSqliteSaver** 落盘到 `langgraph_data` 卷（容器内 `/app/data/langgraph_checkpoints.sqlite`）。容器重启 / 升级后 Agent 中断态可继续 resume。
  - backend 容器仍只跑 **1 个 uvicorn worker**：SQLite 多进程并发写会上锁。
  - 不能水平扩多副本：单文件 SQLite 不支持多容器并发写。
  - 需要多实例时换 PostgresSaver / RedisSaver，并放开 worker 数。
- Celery worker 队列从 `app.workers.celery_app.ALL_QUEUES` 动态读取，新增任务模块时改 `TASK_QUEUE_ROUTES` 即可，**不用动 compose**。

---

## 二、服务器前置准备

1. **系统**：Linux x86_64（Ubuntu 22.04 / CentOS 8+ 已验证）；至少 4C8G、磁盘 ≥ 60G。
2. **Docker**：`docker >= 24.0`、`docker compose plugin >= 2.20`（`docker compose version` 能跑即可）。
3. **域名**：必填。把域名 A 记录指向服务器公网 IP，**等 DNS 全球生效**（`dig +short <域名>` 能返回该 IP）后再启动，否则 Caddy 申请证书会失败。
4. **端口**：服务器安全组 / 防火墙放通 **80（ACME 挑战必走）** 和 **443**。
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
#   resume_caddy    healthy（首次签证可能 starting，30~60s 后变 healthy）

# 2. 证书签发（首次启动后看一次 caddy 日志，确认证书已签出）
docker compose --env-file .env.production logs caddy | grep -iE "certificate|obtain"
# 期望看到类似：certificate obtained successfully

# 3. HTTPS 接口能通
curl -fsS https://<WEB_DOMAIN>/api/v1/docs >/dev/null && echo "backend ok"
curl -fsS https://<WEB_DOMAIN>/healthz && echo

# 4. HTTP → HTTPS 自动跳转
curl -sI http://<WEB_DOMAIN>/ | grep -iE "^(HTTP|location)"
# 期望：301 + Location: https://...

# 5. 浏览器访问 https://<WEB_DOMAIN>/  用 INIT_ADMIN_EMAIL/PASSWORD 登录
```

### 3.5 上线后立刻做的事

1. 用初始管理员登录 → 改密码 / 建正式管理员 / 禁用 INIT_ADMIN 账号。
2. 在「模型配置」菜单添加至少一个可用 LLM 配置，保存后所有员工可见。
3. （建议）把 `.env.production` 备份到运维保密库，**不要 commit**。

---

## 四、TLS / HTTPS

本方案用 **Caddy** 做 TLS 终结，零运维：自动从 Let's Encrypt 申请证书，每 30 天剩余有效期自动续期，HTTP→HTTPS 跳转 + HSTS 默认开启。

### 4.1 工作机制

1. 启动时 Caddy 根据 `WEB_DOMAIN` 向 Let's Encrypt 发起 ACME HTTP-01 挑战（占用 80 端口）
2. LE 回访 `http://<WEB_DOMAIN>/.well-known/acme-challenge/...` 验证域名归属
3. 通过后签发证书并存到 `caddy_data` 卷
4. 之后所有 443 流量由 Caddy 解密，反代到内网 `frontend:80`
5. 证书到期前 30 天自动续期，无需任何操作

### 4.2 启用条件 checklist

- [ ] `.env.production` 中 `WEB_DOMAIN` 填了真实域名（不是 IP！LE 不签发 IP 证书）
- [ ] `ACME_EMAIL` 填了能收信的邮箱
- [ ] 域名 DNS A 记录已指向服务器公网 IP，且 `dig +short <WEB_DOMAIN>` 能返回
- [ ] 服务器 80 和 443 端口对公网开放（云厂商安全组 + 系统防火墙）
- [ ] 服务器时间正确（NTP 同步）—— 时间漂移会导致证书校验失败

### 4.3 证书相关运维

```bash
# 看证书状态 & 续期日志
docker compose --env-file .env.production logs --tail=200 caddy | grep -iE "cert|renew"

# 进 caddy 容器查看证书文件
docker compose --env-file .env.production exec caddy \
  ls -la /data/caddy/certificates/acme-v02.api.letsencrypt.org-directory/

# 强制重载 Caddyfile（改完配置不停容器）
docker compose --env-file .env.production exec caddy caddy reload --config /etc/caddy/Caddyfile

# 手动触发续期（一般不用，Caddy 会自动做）
docker compose --env-file .env.production exec caddy \
  caddy reload --force --config /etc/caddy/Caddyfile
```

### 4.4 故障排查

| 现象 | 排查 |
|---|---|
| Caddy 启动卡 `obtaining certificate` | 80 端口没放通 / DNS 没生效 / WEB_DOMAIN 指向不是本机 |
| `too many failed authorizations` | 触发 LE 速率限制（每周 50 次失败上限）。修域名 / 防火墙后，等 1 小时再试，或临时切到 staging（见 Caddyfile 注释里的 `acme_ca`）|
| 证书有效但浏览器 ERR_CERT | `caddy_data` 卷被清过了，重启会触发 LE 速率限制；恢复备份或等限制窗口 |
| HSTS 锁死想回 HTTP 调试 | 浏览器 `chrome://net-internals/#hsts` 删条目；生产环境 HSTS 一旦下发不可撤回，重新换域名 |

### 4.5 替换方案

如果你前置已有 SLB / Cloudflare 做 TLS：

1. 注释掉 `docker-compose.yml` 中的整个 `caddy` 服务
2. 把 `frontend` 服务的 `expose: ["80"]` 改回 `ports: ["80:80"]`
3. 在 SLB / CDN 上指向服务器 80

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

### 6.3 LangGraph checkpoint 备份（`langgraph_data` 卷）

Agent 中断态保存在 sqlite 文件里。需要做点对点备份时（如升级回滚前）：

```bash
docker run --rm -v resume-platform_langgraph_data:/data -v /opt/backup/langgraph:/backup alpine \
  cp /data/langgraph_checkpoints.sqlite /backup/checkpoints-$(date +%F-%H%M).sqlite
```

> 该文件可丢失（最坏情况：用户的未完成 Agent 会话需要重发一次消息），不强制纳入每日备份。

### 6.4 恢复

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

先停应用 → 恢复 6.4 的最近备份 → 再启应用。

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
| Agent 中断后续接报 `received no input` | 极少见，通常 `langgraph_data` 卷损坏 / 被人为清空。重新发新消息会自动新建上下文 |
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
- [ ] `WEB_DOMAIN` / `ACME_EMAIL` 已填，且 DNS 已解析、80/443 可达
- [ ] 首次启动后已确认证书签发成功（看 caddy 日志）
- [ ] `caddy_data` 卷已纳入备份策略（避免删卷触发 LE 速率限制）
- [ ] 已加 mysql 定时备份 crontab
- [ ] `.env.production` 不在 git 里（默认已被 `.gitignore` 忽略）
