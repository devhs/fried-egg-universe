# Azure VM 빠른 배포 (Ubuntu 22.04 LTS x64 · 도메인 HTTPS · GitHub)

원샷 스크립트 `deploy-azure.sh` 가 VM 내부의 설치·빌드·Nginx·PM2·HTTPS까지 다 합니다.
VM 생성과 방화벽(NSG)만 먼저 해두면 됩니다. 아래 순서대로 따라오세요.
(명령은 본인이 실행, 에러 나면 출력을 붙여넣어 주시면 같이 디버깅)

---

## 사전 준비 (한 번만)
1. **GitHub 빈 저장소** 생성 (예: `fried-egg-universe`).
2. **Azure VM 생성** + **NSG 인바운드**: `22`(내 IP), `80`(Any), `443`(Any). 3000은 열지 않음.
3. **도메인 DNS A 레코드**를 VM 공용 IP로 연결 (HTTPS 발급에 필수).
   - 전파 확인: 로컬에서 `nslookup egg.example.com` → VM 공용 IP가 나오면 OK.

### VM + 방화벽을 CLI로 한 번에 (선택)
```bash
RG=fried-egg-rg; LOC=koreacentral; VM=fried-egg-vm; ADMIN=azureuser
MYIP=$(curl -s ifconfig.me)

az group create -n "$RG" -l "$LOC"

az vm create -g "$RG" -n "$VM" \
  --image Ubuntu2204 --size Standard_B1s \
  --admin-username "$ADMIN" --generate-ssh-keys --public-ip-sku Standard

# HTTP/HTTPS 개방, SSH는 내 IP만
az vm open-port -g "$RG" -n "$VM" --port 80  --priority 100
az vm open-port -g "$RG" -n "$VM" --port 443 --priority 110
NSG=$(az network nsg list -g "$RG" --query "[0].name" -o tsv)
az network nsg rule create -g "$RG" --nsg-name "$NSG" \
  --name AllowSSH-MyIP --priority 1000 \
  --direction Inbound --access Allow --protocol Tcp \
  --source-address-prefixes "$MYIP" --source-port-ranges '*' --destination-port-ranges 22

# 공용 IP 확인
az vm show -d -g "$RG" -n "$VM" --query publicIps -o tsv
```
> Portal로 만들 경우: 가상 머신 → 만들기 → 이미지 **Ubuntu Server 22.04 LTS(x64)**, 크기 `Standard_B1s`,
> 사용자 이름 `azureuser`, SSH 공개 키. 생성 후 네트워킹에서 80/443 규칙 추가, 22는 내 IP로 제한.

---

## 1단계 — 코드를 GitHub에 올리기 (내 컴퓨터에서)
zip 압축을 푼 `fried-egg-universe` 폴더에서:
```bash
cd fried-egg-universe
git init
git add .
git commit -m "init: 계란 후라이 유니버스"
git branch -M main
git remote add origin https://github.com/devhs/fried-egg-universe.git
git push -u origin main
```

## 2단계 — Azure VM 접속 후 스크립트 실행
```bash
ssh azureuser@<VM-공용IP>

# 스크립트만 내려받아 실행 (REPO_URL은 공개 저장소 기준)
curl -fsSLO https://raw.githubusercontent.com/devhs/fried-egg-universe/main/deploy-azure.sh
chmod +x deploy-azure.sh

REPO_URL=https://github.com/devhs/fried-egg-universe.git \
APP_DOMAIN=egg.example.com \
CERTBOT_EMAIL=you@example.com \
./deploy-azure.sh
```
> 비공개 저장소면 `REPO_URL` 을 SSH 형식(`git@github.com:...`)으로 쓰고 VM에 deploy key를 등록하거나,
> 그냥 zip을 `scp fried-egg-universe.zip azureuser@<공용IP>:~/` 로 올린 뒤 풀어서 `REPO_URL` 대신 로컬 폴더로 쓰세요.

## 3단계 — 끝. 확인
```bash
pm2 status                 # 프로세스 상태
pm2 logs fried-egg         # 실시간 로그
curl localhost:3000/api/health
```
브라우저에서 `https://egg.example.com` 접속.

---

## 도메인 없이 공용 IP로만 (HTTP)
2단계에서 `APP_DOMAIN`, `CERTBOT_EMAIL` 을 빼고 실행하면 `http://<VM-공용IP>` 로 바로 뜹니다.
> 공용 IP가 동적이면 재부팅 시 바뀔 수 있습니다. 고정하려면:
> `PIP=$(az network public-ip list -g "$RG" --query "[0].name" -o tsv); az network public-ip update -g "$RG" -n "$PIP" --allocation-method Static`

## 재배포 (코드 수정 후)
로컬에서 `git push` → VM에서 `./deploy-azure.sh` 다시 실행 (또는 `cd ~/fried-egg-universe && git pull && npm install --omit=dev && pm2 reload fried-egg`).

## 막히면
스크립트 출력에서 `❌` 또는 빨간 에러가 보이는 부분, 또는 `pm2 logs fried-egg` / `sudo tail -f /var/log/nginx/error.log` 출력을 그대로 붙여넣어 주세요. 원인 짚어드립니다.
