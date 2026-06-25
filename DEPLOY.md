# AWS EC2 배포 가이드 — 계란 후라이 유니버스

이 문서는 **EC2 1대 + Node.js + SQLite + Nginx** 구성을 단계별로 설명합니다.
DB 서버를 따로 띄울 필요 없이, SQLite 파일 하나로 운영합니다.

---

## 0. 필요한 것 (요약)

| 항목 | 무엇 | 비고 |
|------|------|------|
| EC2 인스턴스 | t3.micro 이상 (프리티어 t2/t3.micro 가능) | Amazon Linux 2023 또는 Ubuntu 22.04 |
| Node.js | 18 이상 (권장 20 LTS) | better-sqlite3 빌드/구동에 필요 |
| 빌드 도구 | gcc-c++, make, python3 | better-sqlite3 네이티브 컴파일 대비 |
| DB | **별도 불필요** — SQLite 파일 | `/var/lib/fried-egg/fried-egg.db` |
| 리버스 프록시 | Nginx | 80/443 → 내부 3000 포트로 전달 |
| 프로세스 관리 | PM2 | 재시작/부팅 자동 구동 |
| 도메인·HTTPS | (선택) Route53 + certbot | 없어도 IP로 동작 |
| 보안그룹 인바운드 | 22(내 IP만), 80, 443 | **3000은 외부 개방 금지** (Nginx가 프록시) |

> SQLite로 충분한 이유: 이 앱의 쓰기는 "게임 점수 제출/가챠"처럼 짧고, better-sqlite3 + WAL 모드면
> 단일 인스턴스에서 초당 수백~수천 요청도 무리 없습니다. 동시 접속이 폭증하거나 여러 서버로
> 수평 확장이 필요해지면 그때 PostgreSQL로 옮기세요(아래 12번).

---

## 1. EC2 인스턴스 생성

1. EC2 콘솔 → **Launch instance**
2. AMI: **Amazon Linux 2023** (또는 Ubuntu 22.04)
3. 타입: **t3.micro** (테스트는 프리티어로 충분)
4. 키페어: 새로 만들거나 기존 `.pem` 선택 (SSH 접속용)
5. 네트워크 → **보안 그룹** 인바운드 규칙:
   - SSH(22): 소스 = **내 IP**(My IP) — 전체 개방 금지
   - HTTP(80): 0.0.0.0/0
   - HTTPS(443): 0.0.0.0/0
   - ※ 3000 포트는 **추가하지 않음** (외부에 직접 노출 X)
6. 스토리지: 8GB 기본이면 충분 (SQLite는 가벼움)
7. 시작 후 **퍼블릭 IPv4 주소** 확인

접속:
```bash
ssh -i your-key.pem ec2-user@<퍼블릭IP>     # Amazon Linux
# ssh -i your-key.pem ubuntu@<퍼블릭IP>      # Ubuntu
```

---

## 2. Node.js + 빌드 도구 설치

### Amazon Linux 2023
```bash
sudo dnf update -y
# Node 20 LTS
curl -fsSL https://rpm.nodesource.com/setup_20.x | sudo bash -
sudo dnf install -y nodejs gcc-c++ make python3 git
node -v   # v20.x 확인
```

### Ubuntu 22.04
```bash
sudo apt update && sudo apt -y upgrade
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo bash -
sudo apt install -y nodejs build-essential python3 git
node -v
```

> **빌드 도구가 필요한 이유:** better-sqlite3는 보통 미리 빌드된 바이너리를 내려받지만,
> 네트워크/플랫폼 사정으로 실패하면 소스에서 컴파일합니다. 이때 `gcc-c++ / make / python3`가 없으면
> `npm install`이 실패해요. 미리 설치해 두면 안전합니다.

---

## 3. 코드 업로드

방법 A — Git:
```bash
cd ~
git clone <your-repo-url> fried-egg-universe
cd fried-egg-universe
```

방법 B — 로컬에서 scp:
```bash
# 로컬 터미널에서 (node_modules 제외하고 업로드)
scp -i your-key.pem -r ./fried-egg-universe ec2-user@<퍼블릭IP>:~/
```

---

## 4. 의존성 설치 & DB 디렉터리

```bash
cd ~/fried-egg-universe
npm install --omit=dev          # 운영 의존성만
# better-sqlite3 빌드가 끝까지 도는지 확인 (에러 없으면 OK)

# DB / 로그 디렉터리 (PM2 설정의 경로와 일치)
sudo mkdir -p /var/lib/fried-egg /var/log/fried-egg
sudo chown -R $USER:$USER /var/lib/fried-egg /var/log/fried-egg
```

동작 확인(임시):
```bash
PORT=3000 DB_PATH=/var/lib/fried-egg/fried-egg.db node server.js
# 다른 터미널에서: curl localhost:3000/api/health  → {"ok":true,...}
# 확인 후 Ctrl+C
```

---

## 5. PM2로 상시 구동 + 부팅 자동 시작

```bash
sudo npm install -g pm2
cd ~/fried-egg-universe
pm2 start ecosystem.config.cjs       # 경로/포트는 이 파일에서 관리
pm2 save                             # 현재 프로세스 목록 저장
pm2 startup                          # 출력되는 sudo 명령을 복사해 한 번 실행 → 부팅 시 자동 구동
pm2 logs fried-egg                   # 로그 확인
```

---

## 6. Nginx 리버스 프록시 (80 → 3000)

### 설치
```bash
# Amazon Linux 2023
sudo dnf install -y nginx
# Ubuntu
# sudo apt install -y nginx
```

### 설정
`/etc/nginx/conf.d/fried-egg.conf` 생성:
```nginx
server {
    listen 80;
    server_name _;                 # 도메인 있으면 도메인으로 교체

    client_max_body_size 1m;

    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
```
> Ubuntu라면 `/etc/nginx/sites-available/`에 두고 `sites-enabled`로 심볼릭 링크하는 방식도 가능합니다.

적용:
```bash
sudo nginx -t            # 문법 검사
sudo systemctl enable --now nginx
sudo systemctl reload nginx
```
이제 브라우저에서 **http://<퍼블릭IP>** 로 접속됩니다.

---

## 7. (선택) 도메인 + HTTPS

1. 도메인의 A 레코드를 EC2 퍼블릭 IP로 연결 (Route53 또는 가비아 등)
2. certbot으로 무료 SSL:
```bash
# Amazon Linux 2023
sudo dnf install -y certbot python3-certbot-nginx
# Ubuntu
# sudo apt install -y certbot python3-certbot-nginx

sudo certbot --nginx -d yourdomain.com
```
certbot이 Nginx 설정을 자동으로 443 + 리다이렉트로 갱신해 줍니다. 자동 갱신은 기본 설정됩니다.

---

## 8. 백업 (중요)

SQLite는 **파일 하나**라 백업이 단순하지만, WAL 모드에서는 `.db`만 복사하면 안 됩니다.
온라인 백업 명령을 쓰세요:

```bash
sudo dnf install -y sqlite   # sqlite3 CLI (Ubuntu: sudo apt install -y sqlite3)

# 안전한 핫 백업 (서비스 중단 없이)
sqlite3 /var/lib/fried-egg/fried-egg.db ".backup '/var/lib/fried-egg/backup-$(date +%F).db'"
```

매일 자동 백업(cron 예시):
```bash
crontab -e
# 매일 새벽 4시
0 4 * * * sqlite3 /var/lib/fried-egg/fried-egg.db ".backup '/var/lib/fried-egg/backup-$(date +\%F).db'" && find /var/lib/fried-egg -name 'backup-*.db' -mtime +14 -delete
```
> 더 안전하게 하려면 백업 파일을 S3로 올리세요: `aws s3 cp backup-*.db s3://your-bucket/`

---

## 9. 업데이트 배포

```bash
cd ~/fried-egg-universe
git pull                 # 또는 새 파일 scp
npm install --omit=dev   # 의존성 변경 시
pm2 restart fried-egg
```

---

## 10. 상태 점검 / 트러블슈팅

```bash
pm2 status               # 프로세스 상태
pm2 logs fried-egg --lines 100
curl localhost:3000/api/health
sudo systemctl status nginx
sudo tail -f /var/log/nginx/error.log
```

- **502 Bad Gateway**: 앱이 죽었거나 포트 불일치. `pm2 logs`, 포트(3000) 확인.
- **npm install에서 better-sqlite3 실패**: 2번의 빌드 도구(gcc-c++, make, python3) 설치 여부 확인.
- **DB 권한 오류**: `/var/lib/fried-egg` 소유자/권한 확인.
- **사이트 접속 안 됨**: 보안그룹 80/443 인바운드, Nginx 구동 여부 확인.

---

## 11. 보안 체크리스트

- [ ] SSH(22)는 내 IP만 허용
- [ ] 3000 포트는 보안그룹에서 미개방 (Nginx만 외부 노출)
- [ ] HTTPS 적용(certbot)
- [ ] OS 패키지 정기 업데이트 (`dnf update` / `apt upgrade`)
- [ ] DB 자동 백업 + S3 보관
- [ ] (선택) Nginx에 rate limit 추가로 가챠/점수 API 남용 방지

---

## 12. 언제 PostgreSQL로 옮기나

SQLite로 충분하지만, 아래 상황이면 이전을 고려하세요.

- 앱 서버를 **2대 이상**으로 늘려 같은 DB를 공유해야 할 때 (SQLite는 파일 1개라 수평 확장 부적합)
- 쓰기 동시성이 매우 높아 WAL로도 잠금 경합이 보일 때
- 매니지드 백업/복제(RDS)가 필요할 때

이전 시: `users / scores / collection` 3개 테이블 스키마는 그대로 옮기면 되고,
`db.js`의 쿼리를 `pg`(node-postgres)로 교체하면 됩니다. 데이터는
`sqlite3 .dump` → 약간의 문법 수정 → psql import 순으로 마이그레이션합니다.
