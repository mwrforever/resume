# syntax=docker/dockerfile:1.7
# ============================================================================
# 前端镜像：Vite 构建产物 + nginx:latest 提供静态托管 + TLS 反代
# 单容器同时承担「web 静态资源」「/api 反代」「HTTPS 终结」三种职责。
# 站点配置作为 envsubst 模板传入，启动时由 nginx-entrypoint 注入 ${WEB_DOMAIN}。
# 证书 & ACME 挑战目录由 docker-compose 挂卷注入。
# ============================================================================

FROM node:20-alpine AS builder

WORKDIR /build

# 利用层缓存：先装依赖
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund

# 拷源码并打包
COPY . .
RUN npm run build

# ----------------------------------------------------------------------------
FROM nginx:latest AS runtime

# 默认时区
ENV TZ=Asia/Shanghai
RUN apt-get update && apt-get install -y --no-install-recommends tzdata wget && \
    ln -snf /usr/share/zoneinfo/$TZ /etc/localtime && \
    echo $TZ > /etc/timezone && \
    rm -rf /var/lib/apt/lists/*

# 移除官方默认站点，配置由模板生成
RUN rm -f /etc/nginx/conf.d/default.conf
# 模板放到 /etc/nginx/templates/，nginx:latest 自带的入口脚本会用 envsubst 把
# 其中 ${WEB_DOMAIN} 等环境变量替换后输出到 /etc/nginx/conf.d/*.conf
COPY nginx/default.conf.template /etc/nginx/templates/default.conf.template

# 拷构建产物
COPY --from=builder /build/dist /usr/share/nginx/html

EXPOSE 80 443
