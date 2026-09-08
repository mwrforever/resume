#!/usr/bin/env bash
# =============================================================================
# 首次签发 Let's Encrypt 证书。
# 用法：
#   cd /opt/resume/deploy
#   bash scripts/init-cert.sh                # 实际签发
#   STAGING=1 bash scripts/init-cert.sh      # 用 staging 环境试一遍（不计入 LE 限频）
#
# 前置：
#   1. .env.production 里 WEB_DOMAIN / ACME_EMAIL 已填实际值（S3_DOMAIN 选填：启用公网 S3 时需另配通配证书）
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
export $(grep -E '^(WEB_DOMAIN|ACME_EMAIL|S3_DOMAIN)=' "$ENV_FILE" | xargs)

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

# 若配置了 S3_DOMAIN（公网 S3 API，每桶一个子域 <桶名>.s3.<域名>）：
# 该形态需要 *.S3_DOMAIN 通配证书，HTTP-01（standalone/webroot）无法签发通配域名，
# 必须走下面任一路径（详见 md/minio/s3-subdomain-guide.md）：
#   a) 云厂商控制台免费 DV 通配证书（推荐）：下载 nginx 格式后放置到
#      ./letsencrypt/live/$S3_DOMAIN/fullchain.pem 与 privkey.pem（nginx 挂载引用该目录）
#   b) certbot DNS-01：需先为你的 DNS 服务商安装对应 certbot 插件并配置 API 凭证
# 所以这里不再尝试自动签发 S3 证书，只给出放置指引；主域名 WEB_DOMAIN 仍按原流程签发。
if [[ -n "${S3_DOMAIN:-}" ]]; then
  echo "[init-cert] S3_DOMAIN=$S3_DOMAIN 需要通配证书 *.${S3_DOMAIN}（HTTP-01 无法签发通配）"
  echo "[init-cert] 请从云控制台申请免费 DV 通配证书后放置："
  echo "[init-cert]   mkdir -p ./letsencrypt/live/$S3_DOMAIN"
  echo "[init-cert]   cp fullchain.pem ./letsencrypt/live/$S3_DOMAIN/"
  echo "[init-cert]   cp privkey.pem   ./letsencrypt/live/$S3_DOMAIN/"
fi

echo "[init-cert] 启动整套服务："
echo "    docker compose --env-file $ENV_FILE up -d --build"
