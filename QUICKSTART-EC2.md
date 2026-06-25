# EC2 빠른 배포 (Amazon Linux 2023 · 도메인 HTTPS · GitHub)

원샷 스크립트 `deploy-al2023.sh` 가 설치·빌드·Nginx·PM2·HTTPS까지 다 합니다.
아래 3단계만 따라오세요. (명령은 본인이 실행, 에러 나면 출력을 붙여넣어 주시면 같이 디버깅)

---

## 사전 준비 (한 번만)
1. **GitHub 빈 저장소** 생성 (예: `fried-egg-universe`).
2. **EC2 보안그룹 인바운드**: `22`(내 IP), `80`(0.0.0.0/0), `443`(0.0.0.0/0). 3000은 열지 않음.
3. **도메인 DNS A 레코드**를 EC2 퍼블릭 IP로 연결 (HTTPS 발급에 필수).
   - 전파 확인: 로컬에서 `nslookup egg.example.com` → EC2 IP가 나오면 OK.

---

## 1단계 — 코드를 GitHub에 올리기 (내 컴퓨터에서)
zip 압축을 푼 `fried-egg-universe` 폴더에서:
```bash
cd fried-egg-universe
git init
git add .
git commit -m "init: 계란 후라이 유니버스"
git branch -M main
git remote add origin https://github.com/<your-id>/fried-egg-universe.git
git push -u origin main
```

## 2단계 — EC2 접속 후 스크립트 실행
```bash
ssh -i your-key.pem ec2-user@<EC2-퍼블릭IP>

# 스크립트만 내려받아 실행 (REPO_URL은 공개 저장소 기준)
curl -fsSLO https://raw.githubusercontent.com/<your-id>/fried-egg-universe/main/deploy-al2023.sh
chmod +x deploy-al2023.sh

REPO_URL=https://github.com/<your-id>/fried-egg-universe.git \
APP_DOMAIN=egg.example.com \
CERTBOT_EMAIL=you@example.com \
./deploy-al2023.sh
```
> 비공개 저장소면 `REPO_URL` 을 SSH 형식(`git@github.com:...`)으로 쓰고 EC2에 deploy key를 등록하거나,
> 그냥 zip을 `scp -i key.pem fried-egg-universe.zip ec2-user@IP:~/` 로 올린 뒤 풀어서 `REPO_URL` 대신 로컬 폴더로 쓰세요.

## 3단계 — 끝. 확인
```bash
pm2 status                 # 프로세스 상태
pm2 logs fried-egg         # 실시간 로그
curl localhost:3000/api/health
```
브라우저에서 `https://egg.example.com` 접속.

---

## 도메인 없이 IP로만 (HTTP)
2단계에서 `APP_DOMAIN`, `CERTBOT_EMAIL` 을 빼고 실행하면 `http://<EC2-IP>` 로 바로 뜹니다.

## 재배포 (코드 수정 후)
로컬에서 `git push` → EC2에서 `./deploy-al2023.sh` 다시 실행 (또는 `cd ~/fried-egg-universe && git pull && npm install --omit=dev && pm2 reload fried-egg`).

## 막히면
스크립트 출력에서 `❌` 또는 빨간 에러가 보이는 부분, 또는 `pm2 logs fried-egg` / `sudo tail -f /var/log/nginx/error.log` 출력을 그대로 붙여넣어 주세요. 원인 짚어드립니다.
