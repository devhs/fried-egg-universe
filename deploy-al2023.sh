#!/usr/bin/env bash
# 계란 후라이 유니버스 - Amazon Linux 2023 원샷 배포 스크립트
#
# 사용법 (EC2에 SSH 접속한 뒤):
#   chmod +x deploy-al2023.sh
#   REPO_URL=https://github.com/<your-id>/fried-egg-universe.git \
#   APP_DOMAIN=egg.example.com \
#   CERTBOT_EMAIL=you@example.com \
#   ./deploy-al2023.sh
#
# APP_DOMAIN / CERTBOT_EMAIL 를 비우면 HTTPS 없이 IP로 HTTP만 구성합니다.
# 재실행하면 git pull + 의존성 갱신 + 무중단 reload 로 재배포됩니다.
set -euo pipefail

REPO_URL="${REPO_URL:-}"
APP_DOMAIN="${APP_DOMAIN:-}"
CERTBOT_EMAIL="${CERTBOT_EMAIL:-}"
APP_DIR="${APP_DIR:-$HOME/fried-egg-universe}"
DB_DIR="/var/lib/fried-egg"
LOG_DIR="/var/log/fried-egg"
PORT="${PORT:-3000}"

say(){ echo -e "\n\033[1;33m▶ $*\033[0m"; }

[ -z "$REPO_URL" ] && { echo "❌ REPO_URL 환경변수가 필요합니다 (예: https://github.com/you/repo.git)"; exit 1; }
if [ -n "$APP_DOMAIN" ] && [ -z "$CERTBOT_EMAIL" ]; then
  echo "❌ APP_DOMAIN 을 쓰려면 CERTBOT_EMAIL 도 필요합니다 (Let's Encrypt 알림용)"; exit 1;
fi

say "1/8 시스템 업데이트 + 필수 패키지"
sudo dnf update -y
curl -fsSL https://rpm.nodesource.com/setup_20.x | sudo bash -
sudo dnf install -y nodejs gcc-c++ make python3 git nginx

say "2/8 코드 가져오기 ($APP_DIR)"
if [ -d "$APP_DIR/.git" ]; then git -C "$APP_DIR" pull; else git clone "$REPO_URL" "$APP_DIR"; fi
cd "$APP_DIR"

say "3/8 의존성 설치 (better-sqlite3 빌드 포함)"
npm install --omit=dev

say "4/8 데이터/로그 디렉터리 준비"
sudo mkdir -p "$DB_DIR" "$LOG_DIR"
sudo chown -R "$USER":"$USER" "$DB_DIR" "$LOG_DIR"

say "5/8 PM2 설치 + 구동 + 부팅 자동등록"
sudo npm install -g pm2
pm2 startOrReload ecosystem.config.cjs
pm2 save
sudo env PATH="$PATH" pm2 startup systemd -u "$USER" --hp "$HOME"

say "6/8 Nginx 리버스 프록시 (80 -> $PORT)"
SERVER_NAME="${APP_DOMAIN:-_}"
sudo tee /etc/nginx/conf.d/fried-egg.conf >/dev/null <<NGINX
server {
    listen 80;
    server_name ${SERVER_NAME};
    client_max_body_size 1m;
    location / {
        proxy_pass http://127.0.0.1:${PORT};
        proxy_http_version 1.1;
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
    }
}
NGINX
sudo nginx -t
sudo systemctl enable --now nginx
sudo systemctl reload nginx

if [ -n "$APP_DOMAIN" ]; then
  say "7/8 HTTPS 발급 (certbot) — 도메인 DNS가 이 서버 IP를 가리켜야 성공합니다"
  sudo dnf install -y certbot python3-certbot-nginx || sudo python3 -m pip install certbot certbot-nginx
  sudo certbot --nginx -d "$APP_DOMAIN" --non-interactive --agree-tos -m "$CERTBOT_EMAIL" --redirect
else
  say "7/8 HTTPS 건너뜀 (APP_DOMAIN 미설정 — IP로 HTTP 접속)"
fi

say "8/8 완료 ✅"
echo "상태 확인:  pm2 status   |   로그:  pm2 logs fried-egg   |   헬스:  curl localhost:${PORT}/api/health"
if [ -n "$APP_DOMAIN" ]; then echo "🌐 접속: https://${APP_DOMAIN}"; else echo "🌐 접속: http://<EC2-퍼블릭IP>"; fi
