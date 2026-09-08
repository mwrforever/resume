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
#   - 主域名证书：certbot 通过 webroot 模式把挑战文件写到 ./certbot-webroot，
#     nginx 在 80 端口的 location /.well-known/acme-challenge/ 直接返回该文件（无 downtime）
#   - S3 通配证书（可选）：DNS-01 签发时用 --cert-name 单独续，沿用签发时的 DNS 插件与凭证
#   - 续期成功后 reload nginx 让新证书生效
#
# S3 通配证书续期的两个前提（见 md/minio/s3-subdomain-guide.md）：
#   - CERTBOT_S3_IMAGE：带 DNS 插件（如 certbot-dns-tencentcloud）的 certbot 镜像
#   - ./certbot-s3.env：DNS 插件 API 凭证（被 .gitignore 的 *.env 忽略，不入库）
# =============================================================================

set -euo pipefail

cd "$(dirname "$0")/.."

ENV_FILE=".env.production"

# 主域名证书：webroot 模式续期（nginx 80 端口兜挑战，无 downtime）
docker run --rm \
  -v "$(pwd)/letsencrypt:/etc/letsencrypt" \
  -v "$(pwd)/certbot-webroot:/var/www/certbot" \
  certbot/certbot:latest renew --webroot -w /var/www/certbot --quiet

# S3 通配证书：走 DNS-01 签发时才有 renewal 配置。
# 注意不能带 --webroot（会把通配证书的续签方式强制成 webroot，通配域名 HTTP-01 签不了，续签必失败），
# 这里单独用 --cert-name 续，certbot 会沿用签发时保存的 DNS 插件与配置。
S3_DOMAIN="$(grep -E '^S3_DOMAIN=' "$ENV_FILE" | head -1 | cut -d= -f2-)"
if [[ -n "${S3_DOMAIN:-}" && -f "./letsencrypt/renewal/$S3_DOMAIN.conf" && -f "./certbot-s3.env" ]]; then
  echo "[renew-cert] 续期 S3 通配证书 $S3_DOMAIN（DNS-01，凭证 ./certbot-s3.env）..."
  docker run --rm \
    -v "$(pwd)/letsencrypt:/etc/letsencrypt" \
    -v "$(pwd)/certbot-webroot:/var/www/certbot" \
    --env-file "$(pwd)/certbot-s3.env" \
    "${CERTBOT_S3_IMAGE:-certbot/certbot:latest}" renew --cert-name "$S3_DOMAIN" --quiet
fi

# 续期成功后 reload nginx 让新证书生效
docker compose --env-file "$ENV_FILE" exec -T frontend nginx -s reload || true
echo "[renew-cert] 完成 $(date -Iseconds)"
