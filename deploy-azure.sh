#!/usr/bin/env bash
# 계란 후라이 유니버스 - Azure VM (Ubuntu 22.04 LTS, x64) 원샷 배포 스크립트
#
# 사용법 (Azure VM에 SSH 접속한 뒤):
#   chmod +x deploy-azure.sh
#
#   # (A) 무료 도메인 DuckDNS + 무료 HTTPS 까지 자동 (권장)
#   REPO_URL=https://github.com/devhs/fried-egg-universe.git \
#   DUCKDNS_DOMAIN=myegg \
#   DUCKDNS_TOKEN=xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx \
#   CERTBOT_EMAIL=you@example.com \
#   ./deploy-azure.sh
#   # → https://myegg.duckdns.org 로 접속
#
#   # (B) 내가 가진 도메인으로
#   REPO_URL=... APP_DOMAIN=egg.example.com CERTBOT_EMAIL=you@example.com ./deploy-azure.sh
#
#   # (C) 도메인 없이 공용 IP HTTP 만
#   REPO_URL=... ./deploy-azure.sh
#
# 재실행하면 git pull + 의존성 갱신 + 무중단 reload 로 재배포됩니다.
#
# 주의: NSG(방화벽) 80/443 개방, 22는 내 IP만 — Azure Portal/CLI에서 따로 설정하세요.
#       (이 스크립트는 VM 내부 설치/구동만 담당. DEPLOY-AZURE.md 2번 참고)
set -euo pipefail

REPO_URL="${REPO_URL:-}"
APP_DOMAIN="${APP_DOMAIN:-}"
CERTBOT_EMAIL="${CERTBOT_EMAIL:-}"
DUCKDNS_DOMAIN="${DUCKDNS_DOMAIN:-}"     # DuckDNS 서브도메인만 (예: myegg → myegg.duckdns.org)
DUCKDNS_TOKEN="${DUCKDNS_TOKEN:-}"       # duckdns.org 로그인 후 상단에 표시되는 token
APP_DIR="${APP_DIR:-$HOME/fried-egg-universe}"
DB_DIR="/var/lib/fried-egg"
LOG_DIR="/var/log/fried-egg"
PORT="${PORT:-3000}"

say(){ echo -e "\n\033[1;33m▶ $*\033[0m"; }

[ -z "$REPO_URL" ] && { echo "❌ REPO_URL 환경변수가 필요합니다 (예: https://github.com/you/repo.git)"; exit 1; }

# DuckDNS 무료 도메인: 서브도메인+토큰이 있으면 도메인을 자동 구성
if [ -n "$DUCKDNS_DOMAIN" ]; then
  [ -z "$DUCKDNS_TOKEN" ] && { echo "❌ DUCKDNS_DOMAIN 을 쓰려면 DUCKDNS_TOKEN 도 필요합니다 (https://www.duckdns.org 로그인 후 발급)"; exit 1; }
  APP_DOMAIN="${DUCKDNS_DOMAIN}.duckdns.org"   # 이후 certbot 이 이 도메인으로 인증서 발급
fi

if [ -n "$APP_DOMAIN" ] && [ -z "$CERTBOT_EMAIL" ]; then
  echo "❌ HTTPS(도메인)를 쓰려면 CERTBOT_EMAIL 도 필요합니다 (Let's Encrypt 만료 알림용)"; exit 1;
fi

say "1/9 시스템 업데이트 + 필수 패키지 (Ubuntu apt)"
export DEBIAN_FRONTEND=noninteractive
sudo apt update && sudo apt -y upgrade
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo bash -
sudo apt install -y nodejs build-essential python3 git nginx curl

say "2/9 코드 가져오기 ($APP_DIR)"
if [ -d "$APP_DIR/.git" ]; then git -C "$APP_DIR" pull; else git clone "$REPO_URL" "$APP_DIR"; fi
cd "$APP_DIR"

say "3/9 의존성 설치 (better-sqlite3 빌드 포함)"
npm install --omit=dev

say "4/9 데이터/로그 디렉터리 준비"
sudo mkdir -p "$DB_DIR" "$LOG_DIR"
sudo chown -R "$USER":"$USER" "$DB_DIR" "$LOG_DIR"

# 5/9 DuckDNS 무료 도메인 등록 + 자동 갱신 (DUCKDNS_DOMAIN 설정 시에만)
if [ -n "$DUCKDNS_DOMAIN" ]; then
  say "5/9 DuckDNS 무료 도메인 연결 ($APP_DOMAIN → 이 VM 공용 IP)"
  mkdir -p "$HOME/duckdns"; chmod 700 "$HOME/duckdns"
  # 갱신 스크립트 (ip= 비우면 DuckDNS 가 요청자 IP=이 VM 공용 IP 로 자동 설정)
  cat > "$HOME/duckdns/duck.sh" <<EOF
#!/usr/bin/env bash
curl -fsS "https://www.duckdns.org/update?domains=${DUCKDNS_DOMAIN}&token=${DUCKDNS_TOKEN}&ip=" -o "$HOME/duckdns/duck.log"
EOF
  chmod 700 "$HOME/duckdns/duck.sh"
  # 5분마다 IP 자동 갱신 (공용 IP가 동적이어도 도메인이 따라옴) — 중복 등록 방지
  ( crontab -l 2>/dev/null | grep -v 'duckdns/duck.sh' ; echo "*/5 * * * * $HOME/duckdns/duck.sh >/dev/null 2>&1" ) | crontab -
  # 즉시 1회 등록
  "$HOME/duckdns/duck.sh"
  RESULT="$(cat "$HOME/duckdns/duck.log" 2>/dev/null || true)"
  echo "DuckDNS 응답: ${RESULT:-(없음)}"
  [ "$RESULT" != "OK" ] && { echo "❌ DuckDNS 등록 실패(KO). DUCKDNS_DOMAIN/TOKEN 확인 후 다시 실행하세요."; exit 1; }
  echo "DNS 전파 대기 (15초)…"; sleep 15
else
  say "5/9 DuckDNS 건너뜀 (DUCKDNS_DOMAIN 미설정)"
fi

say "6/9 PM2 설치 + 구동 + 부팅 자동등록"
sudo npm install -g pm2
pm2 startOrReload ecosystem.config.cjs
pm2 save
sudo env PATH="$PATH" pm2 startup systemd -u "$USER" --hp "$HOME"

say "7/9 Nginx 리버스 프록시 (80 -> $PORT)"
SERVER_NAME="${APP_DOMAIN:-_}"
sudo tee /etc/nginx/sites-available/fried-egg.conf >/dev/null <<NGINX
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
# Ubuntu: sites-enabled 심볼릭 링크 + 기본 사이트 비활성화
sudo ln -sf /etc/nginx/sites-available/fried-egg.conf /etc/nginx/sites-enabled/fried-egg.conf
sudo rm -f /etc/nginx/sites-enabled/default
sudo nginx -t
sudo systemctl enable --now nginx
sudo systemctl reload nginx

if [ -n "$APP_DOMAIN" ]; then
  say "8/9 무료 HTTPS 발급 (Let's Encrypt / certbot) — $APP_DOMAIN"
  sudo apt install -y certbot python3-certbot-nginx
  sudo certbot --nginx -d "$APP_DOMAIN" --non-interactive --agree-tos -m "$CERTBOT_EMAIL" --redirect
else
  say "8/9 HTTPS 건너뜀 (도메인 미설정 — 공용 IP로 HTTP 접속)"
fi

say "9/9 완료 ✅"
echo "상태 확인:  pm2 status   |   로그:  pm2 logs fried-egg   |   헬스:  curl localhost:${PORT}/api/health"
if [ -n "$APP_DOMAIN" ]; then echo "🌐 접속: https://${APP_DOMAIN}"; else echo "🌐 접속: http://<VM-공용IP>"; fi
# end of deploy-azure.sh
