# syntax=docker/dockerfile:1.7
# ============================================================================
# 后端镜像：FastAPI + Celery Worker 共用同一镜像，由 docker-compose 的 command 区分进程。
# 基础镜像选 python:3.12-slim：体积小、官方维护，docling/PyPDF2 等依赖在 slim 下需要 build-essential。
# 采用 builder + runtime 两阶段，runtime 不带编译器，体积更小。
# ============================================================================

FROM python:3.12-slim AS builder

# 默认启用国内源（腾讯/清华），境外构建用 --build-arg CN_MIRROR=0 关掉
ARG CN_MIRROR=1

ENV PIP_DISABLE_PIP_VERSION_CHECK=1 \
    PIP_NO_CACHE_DIR=1 \
    PYTHONDONTWRITEBYTECODE=1

# 换腾讯云 debian 源（CN_MIRROR=1 时），加速 apt 装编译期依赖
RUN if [ "$CN_MIRROR" = "1" ]; then \
        sed -i 's|deb.debian.org|mirrors.tencentyun.com|g; s|security.debian.org|mirrors.tencentyun.com|g' /etc/apt/sources.list.d/debian.sources 2>/dev/null || true; \
        sed -i 's|deb.debian.org|mirrors.tencentyun.com|g; s|security.debian.org|mirrors.tencentyun.com|g' /etc/apt/sources.list 2>/dev/null || true; \
    fi

# 编译期依赖：cryptography/bcrypt/aiomysql 等带 C 扩展需要 gcc + 头文件
RUN apt-get update && apt-get install -y --no-install-recommends \
        build-essential \
        libffi-dev \
        libssl-dev \
        pkg-config \
    && rm -rf /var/lib/apt/lists/*

# pip 走清华源（国内可达性最稳）
RUN if [ "$CN_MIRROR" = "1" ]; then \
        pip config set global.index-url https://pypi.tuna.tsinghua.edu.cn/simple && \
        pip config set global.trusted-host pypi.tuna.tsinghua.edu.cn; \
    fi

WORKDIR /build
# 先拷 pyproject 利用层缓存
COPY pyproject.toml ./
COPY app ./app

# 把依赖装到 /install 目录，runtime 阶段拷过去
RUN pip install --prefix=/install .

# ----------------------------------------------------------------------------
FROM python:3.12-slim AS runtime

ARG CN_MIRROR=1

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1 \
    PYTHONPATH=/app \
    TZ=Asia/Shanghai

# runtime 期 apt 也用国内源
RUN if [ "$CN_MIRROR" = "1" ]; then \
        sed -i 's|deb.debian.org|mirrors.tencentyun.com|g; s|security.debian.org|mirrors.tencentyun.com|g' /etc/apt/sources.list.d/debian.sources 2>/dev/null || true; \
        sed -i 's|deb.debian.org|mirrors.tencentyun.com|g; s|security.debian.org|mirrors.tencentyun.com|g' /etc/apt/sources.list 2>/dev/null || true; \
    fi

# runtime 期依赖：libmagic 给 docling 文件类型检测、tini 做 PID 1 处理 SIGTERM
RUN apt-get update && apt-get install -y --no-install-recommends \
        libffi8 \
        libssl3 \
        libxml2 \
        libmagic1 \
        curl \
        tini \
    && rm -rf /var/lib/apt/lists/* \
    && ln -snf /usr/share/zoneinfo/$TZ /etc/localtime \
    && echo $TZ > /etc/timezone

# 拷贝 builder 安装好的 site-packages
COPY --from=builder /install /usr/local

# 非 root 用户运行
RUN groupadd -r app && useradd -r -g app -d /app -s /sbin/nologin app

WORKDIR /app
COPY --chown=app:app app ./app
COPY --chown=app:app pyproject.toml ./

# 简历附件落盘目录 + LangGraph checkpoint 落盘目录（compose 会挂卷）
RUN mkdir -p /app/note /app/data && chown -R app:app /app/note /app/data

USER app

EXPOSE 8000

# tini 处理信号转发，避免 Celery/uvicorn worker 退出僵尸进程
ENTRYPOINT ["/usr/bin/tini", "--"]

# 默认跑 uvicorn；compose 里 celery 服务 override 这一行
# 注意：LangGraph checkpointer 当前用 InMemorySaver（见 _checkpointer.py），
# 多 worker 会让 Agent 中断状态分散在不同进程，必须单 worker。
# 需要水平扩展时先把 checkpointer 换成 Redis/Postgres 版本。
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000", "--workers", "1", "--proxy-headers", "--forwarded-allow-ips=*"]
