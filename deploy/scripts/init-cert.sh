#!/usr/bin/env bash
# =============================================================================
# 首次签发 Let's Encrypt 证书。
# 用法：
#   cd /opt/resume/deploy
#   bash scripts/init-cert.sh                # 实际签发
#   STAGING=1 bash scripts/init-cert.sh      # 用 staging 环境试一遍（不计入 LE 限频）
#
# 前置：
#   1. .env.production 里 WEB_DOMAIN / ACME_EMAIL 已填实际值
#   2. 域名 DNS A 记录已指向本机公网 IP（dig +short $WEB_DOMAIN 能查到）
#   3. 服务器 80 端口已对公网放通
#   4. frontend 容器还未启动（80 端口必须给 certbot 让出来）
#      已启动也没关系，脚本会临时停掉再起来
# =============================================================================

set -euo pipefail

cd "$(dirname "$0")/.."   # 切到 deploy/ 目录

ENV_FILE=".env.production"
if [[ ! -f "$ENV_FILE" ]]; then
  echo "[init-cert] 找不到 $ENV_FILE，请先复制 .env.production.example 并填值" >&2
  exit 1
fi

# shellcheck disable=SC2046
export $(grep -E '^(WEB_DOMAIN|ACME_EMAIL)=' "$ENV_FILE" | xargs)

: "${WEB_DOMAIN:?WEB_DOMAIN 未配置}"
: "${ACME_EMAIL:?ACME_EMAIL 未配置}"

echo "[init-cert] 域名: $WEB_DOMAIN  邮箱: $ACME_EMAIL"

mkdir -p ./letsencrypt ./certbot-webroot

# 临时停掉 frontend，让 certbot --standalone 占 80
echo "[init-cert] 临时停 frontend（如已启动）..."
docker compose --env-file "$ENV_FILE" stop frontend 2>/dev/null || true

STAGING_ARG=""
if [[ "${STAGING:-0}" == "1" ]]; then
  echo "[init-cert] 使用 staging 环境（仅测试，不签发受信任证书）"
  STAGING_ARG="--staging"
fi

# 用官方 certbot 镜像签证，--standalone 自起一个临时 80 端口 webserver
docker run --rm \
  -p 80:80 \
  -v "$(pwd)/letsencrypt:/etc/letsencrypt" \
  -v "$(pwd)/certbot-webroot:/var/www/certbot" \
  certbot/certbot:latest certonly \
    --standalone \
    --non-interactive \
    --agree-tos \
    --email "$ACME_EMAIL" \
    -d "$WEB_DOMAIN" \
    $STAGING_ARG

echo "[init-cert] 证书已签发：./letsencrypt/live/$WEB_DOMAIN/"
echo "[init-cert] 启动整套服务："
echo "    docker compose --env-file $ENV_FILE up -d --build"
