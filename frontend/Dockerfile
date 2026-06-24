# syntax=docker/dockerfile:1.7
# ============================================================================
# 前端镜像：Vite 构建产物 + nginx:alpine 提供静态托管 & 后端反代
# 单容器同时承担「web 静态资源」「/api 反代」「/preview /files 反代」三种职责。
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

# 覆盖默认站点
RUN rm -f /etc/nginx/conf.d/default.conf
COPY nginx/default.conf /etc/nginx/conf.d/default.conf

# 拷构建产物
COPY --from=builder /build/dist /usr/share/nginx/html

EXPOSE 80

# nginx:alpine 自带 entrypoint，会处理 envsubst 模板与启动
