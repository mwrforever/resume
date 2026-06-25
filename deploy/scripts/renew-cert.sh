#!/usr/bin/env bash
# =============================================================================
# Let's Encrypt 证书续期。
# 用法：
#   bash scripts/renew-cert.sh
#
# 推荐用 crontab 每天 03:30 跑一次（certbot 内部判断不到 30 天不会真续）：
#   30 3 * * * cd /opt/resume/deploy && bash scripts/renew-cert.sh >> /var/log/resume-renew.log 2>&1
#
# 原理：
#   - certbot 通过 webroot 模式把挑战文件写到 ./certbot-webroot
#   - nginx 在 80 端口的 location /.well-known/acme-challenge/ 直接返回该文件
#   - 续期成功后 reload nginx 让新证书生效（无 downtime）
# =============================================================================

set -euo pipefail

cd "$(dirname "$0")/.."

ENV_FILE=".env.production"

docker run --rm \
  -v "$(pwd)/letsencrypt:/etc/letsencrypt" \
  -v "$(pwd)/certbot-webroot:/var/www/certbot" \
  certbot/certbot:latest renew --webroot -w /var/www/certbot --quiet

# 续期成功后 reload nginx 让新证书生效
docker compose --env-file "$ENV_FILE" exec -T frontend nginx -s reload || true
echo "[renew-cert] 完成 $(date -Iseconds)"
