# Azure VM 배포 가이드 — 계란 후라이 유니버스

이 문서는 **Azure VM 1대(Ubuntu x64) + Node.js + SQLite + Nginx** 구성을 단계별로 설명합니다.
DB 서버를 따로 띄울 필요 없이, SQLite 파일 하나로 운영합니다.

> 이 문서는 기존 AWS EC2 가이드(`DEPLOY.md`)를 **Azure + Ubuntu 22.04 LTS (x64)** 기준으로 옮긴 것입니다.
> 각 단계는 **Azure Portal(웹 화면)** 과 **Azure CLI(`az` 명령)** 를 병기합니다. 둘 중 편한 쪽을 쓰세요.
> 명령은 직접 실행하시고, 에러가 나면 출력을 붙여넣어 주시면 같이 디버깅합니다.

---

## 0. 필요한 것 (요약)

| 항목 | 무엇 | 비고 |
|------|------|------|
| Azure VM | Standard_B1s 이상 (버스터블 B-시리즈) | **Ubuntu Server 22.04 LTS, x64(amd64)** |
| Node.js | 18 이상 (권장 20 LTS) | better-sqlite3 빌드/구동에 필요 |
| 빌드 도구 | build-essential, python3 | better-sqlite3 네이티브 컴파일 대비 |
| DB | **별도 불필요** — SQLite 파일 | `/var/lib/fried-egg/fried-egg.db` |
| 리버스 프록시 | Nginx | 80/443 → 내부 3000 포트로 전달 |
| 프로세스 관리 | PM2 | 재시작/부팅 자동 구동 |
| 도메인·HTTPS | (선택) Azure DNS 또는 외부 등록기관 + certbot | 없어도 공용 IP로 동작 |
| NSG 인바운드 | 22(내 IP만), 80, 443 | **3000은 외부 개방 금지** (Nginx가 프록시) |

> SQLite로 충분한 이유: 이 앱의 쓰기는 "게임 점수 제출/가챠"처럼 짧고, better-sqlite3 + WAL 모드면
> 단일 VM에서 초당 수백~수천 요청도 무리 없습니다. 동시 접속이 폭증하거나 여러 서버로
> 수평 확장이 필요해지면 그때 PostgreSQL로 옮기세요(아래 12번).

> **[확인 불가/주의]** Azure VM 크기·이미지 가격, 무료 평가판 크레딧 적용 여부는 시점·구독·리전마다 다릅니다.
> 본 문서는 명령·절차만 다루며, 비용은 Azure Pricing 페이지에서 직접 확인하세요.

---

## 사전 준비 — Azure CLI (CLI로 진행할 경우)

```bash
# 로컬 또는 Cloud Shell. 설치는 OS별 공식 안내를 따르세요.
az login                                   # 브라우저로 로그인
az account show                            # 현재 구독 확인
az account set --subscription "<구독ID 또는 이름>"   # 여러 개면 지정
```

이 문서의 CLI 예시는 아래 변수를 쓴다고 가정합니다(값은 본인 환경에 맞게):

```bash
RG=fried-egg-rg                # 리소스 그룹
LOC=koreacentral               # 리전 (예: 한국 중부)
VM=fried-egg-vm                # VM 이름
ADMIN=azureuser                # 관리자(SSH) 계정명 — 원하는 이름으로 변경 가능
MYIP=$(curl -s ifconfig.me)    # SSH 허용용 내 공인 IP

az group create -n "$RG" -l "$LOC"
```

> **AWS와 다른 점:** Azure에는 EC2의 `ec2-user` 같은 고정 기본 계정이 없습니다.
> VM을 만들 때 지정한 `--admin-username` 값(여기서는 `azureuser`)이 곧 SSH 계정입니다.

---

## 1. VM 생성

### Portal
1. Portal → **가상 머신(Virtual machines)** → **만들기 → Azure 가상 머신**
2. **리소스 그룹**: 새로 만들기(예: `fried-egg-rg`)
3. **이미지**: **Ubuntu Server 22.04 LTS** — VM 아키텍처는 **x64** 선택
4. **크기**: `Standard_B1s`(테스트면 충분) 이상
5. **인증 형식**: SSH 공개 키 (권장) · **사용자 이름**: `azureuser`(원하는 이름)
6. **인바운드 포트**: 일단 **SSH(22)만** 허용 → NSG 규칙은 5번에서 80/443 추가
7. **검토 + 만들기** → 생성 후 **공용 IP 주소** 확인

### CLI
```bash
az vm create \
  --resource-group "$RG" \
  --name "$VM" \
  --image Ubuntu2204 \
  --size Standard_B1s \
  --admin-username "$ADMIN" \
  --generate-ssh-keys \
  --public-ip-sku Standard

# 공용 IP 확인
az vm show -d -g "$RG" -n "$VM" --query publicIps -o tsv
```
> `--image Ubuntu2204` 는 Ubuntu 22.04 LTS(x64 gen2)의 별칭입니다.
> 정확한 이미지를 고정하려면 URN을 직접 지정할 수도 있습니다:
> `--image Canonical:0001-com-ubuntu-server-jammy:22_04-lts:latest`

접속:
```bash
ssh azureuser@<공용IP>
# 위에서 --admin-username 을 다르게 지정했다면 그 이름으로
```

---

## 2. NSG 인바운드 규칙 (방화벽)

AWS의 보안 그룹에 해당하는 것이 Azure의 **네트워크 보안 그룹(NSG)** 입니다.
SSH는 내 IP만, HTTP/HTTPS는 전체 허용, **3000은 열지 않습니다**.

### Portal
VM → **네트워킹** → **인바운드 포트 규칙 추가**로 다음을 만듭니다.
- SSH(22): 소스 = **내 IP 주소**(IP Addresses에 내 IP) — 전체 개방 금지
- HTTP(80): 소스 = Any
- HTTPS(443): 소스 = Any
- ※ 3000 포트 규칙은 **추가하지 않음**

### CLI
가장 간단한 방법은 `az vm open-port`(VM의 NSG에 규칙을 추가):
```bash
# HTTP / HTTPS 개방
az vm open-port -g "$RG" -n "$VM" --port 80  --priority 100
az vm open-port -g "$RG" -n "$VM" --port 443 --priority 110
```

SSH(22)는 내 IP로 제한하려면 NSG 규칙을 직접 만드는 편이 정확합니다.
(VM 생성 시 보통 `<VM이름>NSG` 라는 NSG가 함께 생성됩니다. 이름은 아래로 확인)
```bash
# VM에 연결된 NSG 이름 확인
NSG=$(az network nsg list -g "$RG" --query "[0].name" -o tsv)

# SSH는 내 IP만 허용
az network nsg rule create \
  --resource-group "$RG" --nsg-name "$NSG" \
  --name AllowSSH-MyIP --priority 1000 \
  --direction Inbound --access Allow --protocol Tcp \
  --source-address-prefixes "$MYIP" \
  --source-port-ranges '*' \
  --destination-port-ranges 22
```
> **3000 포트는 어떤 규칙에서도 열지 마세요.** 외부는 Nginx(80/443)만 거치고, 앱은 내부 3000에서만 받습니다.

---

## 3. Node.js + 빌드 도구 설치 (Ubuntu)

VM에 SSH로 접속한 뒤:
```bash
sudo apt update && sudo apt -y upgrade
# Node 20 LTS (NodeSource deb 저장소)
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo bash -
sudo apt install -y nodejs build-essential python3 git
node -v   # v20.x 확인
```

> **빌드 도구가 필요한 이유:** better-sqlite3는 보통 미리 빌드된 바이너리를 내려받지만,
> 네트워크/플랫폼 사정으로 실패하면 소스에서 컴파일합니다. 이때 `build-essential`(gcc/g++/make)과
> `python3`가 없으면 `npm install`이 실패해요. 미리 설치해 두면 안전합니다.
> (Ubuntu에서는 Amazon Linux의 `gcc-c++` 대신 `build-essential` 패키지를 씁니다.)

---

## 4. 코드 업로드

방법 A — Git:
```bash
cd ~
git clone https://github.com/devhs/fried-egg-universe.git fried-egg-universe
cd fried-egg-universe
```

방법 B — 로컬에서 scp:
```bash
# 로컬 터미널에서 (node_modules 제외하고 업로드)
scp -r ./fried-egg-universe azureuser@<공용IP>:~/
```

---

## 5. 의존성 설치 & DB 디렉터리

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

## 6. PM2로 상시 구동 + 부팅 자동 시작

```bash
sudo npm install -g pm2
cd ~/fried-egg-universe
pm2 start ecosystem.config.cjs       # 경로/포트는 이 파일에서 관리
pm2 save                             # 현재 프로세스 목록 저장
pm2 startup                          # 출력되는 sudo 명령을 복사해 한 번 실행 → 부팅 시 자동 구동
pm2 logs fried-egg                   # 로그 확인
```

---

## 7. Nginx 리버스 프록시 (80 → 3000)

### 설치
```bash
sudo apt install -y nginx
```

### 설정
Ubuntu 패키지 Nginx는 `sites-available` / `sites-enabled` 구조를 씁니다.
`/etc/nginx/sites-available/fried-egg.conf` 생성:
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

활성화 + 적용:
```bash
# 심볼릭 링크로 활성화
sudo ln -s /etc/nginx/sites-available/fried-egg.conf /etc/nginx/sites-enabled/
# 기본 사이트가 80을 잡고 있으면 충돌하니 비활성화
sudo rm -f /etc/nginx/sites-enabled/default

sudo nginx -t                    # 문법 검사
sudo systemctl enable --now nginx
sudo systemctl reload nginx
```
이제 브라우저에서 **http://<공용IP>** 로 접속됩니다.

> 참고: `/etc/nginx/conf.d/*.conf` 에 두는 방식도 Ubuntu에서 동작합니다(기본 `nginx.conf`가 둘 다 include).
> 위의 `sites-available` 방식이 Ubuntu 관례입니다.

---

## 8. 무료 도메인(DuckDNS) + 무료 HTTPS(Let's Encrypt)

도메인을 사거나 외부 DNS를 만질 필요 없이, **DuckDNS 무료 서브도메인**(`yourname.duckdns.org`)을
VM 공용 IP에 연결하고 **certbot으로 무료 SSL**을 발급합니다.

> 왜 DuckDNS인가: `duckdns.org`는 Public Suffix List에 등재돼 서브도메인별로 Let's Encrypt rate limit이
> 독립 적용되므로 인증서 발급이 안정적입니다. 반면 Azure 기본 FQDN(`*.cloudapp.azure.com`)은
> 전체 Azure 고객과 공유하는 낮은 rate limit이라 발급이 거부될 수 있습니다(아래 대안 참고). **[강한 근거]**

### 8-1. DuckDNS 가입 + 서브도메인 만들기 (1분)
1. https://www.duckdns.org 접속 → Google/GitHub 등으로 로그인
2. 원하는 서브도메인 입력 → **add domain** (예: `myegg` → `myegg.duckdns.org`)
3. 화면 상단의 **token** 값을 복사 (UUID 형태)

### 8-2. 도메인을 VM 공용 IP에 연결 + 자동 갱신
원샷 스크립트(`deploy-azure.sh`)에 `DUCKDNS_DOMAIN`/`DUCKDNS_TOKEN`을 넘기면 이 단계가 자동입니다(9-A 아래).
수동으로 하려면 VM에서:
```bash
DUCKDNS_DOMAIN=myegg     # 서브도메인만
DUCKDNS_TOKEN=xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx

mkdir -p ~/duckdns && chmod 700 ~/duckdns
cat > ~/duckdns/duck.sh <<EOF
#!/usr/bin/env bash
curl -fsS "https://www.duckdns.org/update?domains=${DUCKDNS_DOMAIN}&token=${DUCKDNS_TOKEN}&ip=" -o ~/duckdns/duck.log
EOF
chmod 700 ~/duckdns/duck.sh
~/duckdns/duck.sh && cat ~/duckdns/duck.log   # 응답이 "OK" 면 성공 (ip= 비우면 요청자=이 VM IP로 등록)

# 공용 IP가 바뀌어도 도메인이 따라오도록 5분마다 자동 갱신
( crontab -l 2>/dev/null | grep -v 'duckdns/duck.sh'; echo "*/5 * * * * ~/duckdns/duck.sh >/dev/null 2>&1" ) | crontab -
```

### 8-3. 무료 HTTPS 발급 (certbot)
A 레코드가 전파된 뒤(보통 수십 초):
```bash
sudo apt install -y certbot python3-certbot-nginx
sudo certbot --nginx -d myegg.duckdns.org --agree-tos -m you@example.com --redirect
```
certbot이 Nginx 설정을 자동으로 443 + HTTP→HTTPS 리다이렉트로 갱신하고, 90일 인증서 자동 갱신도 설정합니다.
이제 **https://myegg.duckdns.org** 로 접속됩니다.

> **NSG 확인:** 80/443 인바운드가 열려 있어야 certbot HTTP-01 검증과 접속이 됩니다(2번 참고).

### (대안) 내 도메인 또는 Azure 기본 FQDN
- **내 도메인이 있으면:** 등록기관에서 A 레코드를 VM 공용 IP로 지정 → `certbot --nginx -d yourdomain.com`.
  공용 IP가 동적이면 정적으로 전환 권장:
  ```bash
  PIP=$(az network public-ip list -g "$RG" --query "[0].name" -o tsv)
  az network public-ip update -g "$RG" -n "$PIP" --allocation-method Static
  ```
- **Azure 기본 FQDN(가입 불필요):** `az network public-ip update -g "$RG" -n "$PIP" --dns-name myegg`
  → `myegg.<리전>.cloudapp.azure.com`. DNS는 즉시 되지만 **Let's Encrypt 발급은 공유 rate limit으로 거부될 수 있음**.
  안정적인 인증서가 필요하면 DuckDNS 방식을 권장합니다. **[강한 근거]**

---

## 9. 백업 (중요)

SQLite는 **파일 하나**라 백업이 단순하지만, WAL 모드에서는 `.db`만 복사하면 안 됩니다.
온라인 백업 명령을 쓰세요:

```bash
sudo apt install -y sqlite3      # sqlite3 CLI

# 안전한 핫 백업 (서비스 중단 없이)
sqlite3 /var/lib/fried-egg/fried-egg.db ".backup '/var/lib/fried-egg/backup-$(date +%F).db'"
```

매일 자동 백업(cron 예시):
```bash
crontab -e
# 매일 새벽 4시
0 4 * * * sqlite3 /var/lib/fried-egg/fried-egg.db ".backup '/var/lib/fried-egg/backup-$(date +\%F).db'" && find /var/lib/fried-egg -name 'backup-*.db' -mtime +14 -delete
```

> 더 안전하게 하려면 백업 파일을 **Azure Blob Storage** 로 올리세요(AWS S3 대체).
> ```bash
> # 한 번만: 스토리지 계정 + 컨테이너 준비
> az storage account create -g "$RG" -n friedeggbackup<고유> -l "$LOC" --sku Standard_LRS
> az storage container create --account-name friedeggbackup<고유> -n backups --auth-mode login
>
> # 업로드
> az storage blob upload \
>   --account-name friedeggbackup<고유> \
>   --container-name backups \
>   --file /var/lib/fried-egg/backup-$(date +%F).db \
>   --name backup-$(date +%F).db \
>   --auth-mode login
> ```
> 스토리지 계정 이름은 전역에서 유니크해야 하고 소문자+숫자만 됩니다.

---

## 10. 업데이트 배포

```bash
cd ~/fried-egg-universe
git pull                 # 또는 새 파일 scp
npm install --omit=dev   # 의존성 변경 시
pm2 restart fried-egg
```

---

## 11. 상태 점검 / 트러블슈팅

```bash
pm2 status               # 프로세스 상태
pm2 logs fried-egg --lines 100
curl localhost:3000/api/health
sudo systemctl status nginx
sudo tail -f /var/log/nginx/error.log
```

- **502 Bad Gateway**: 앱이 죽었거나 포트 불일치. `pm2 logs`, 포트(3000) 확인.
- **npm install에서 better-sqlite3 실패**: 3번의 빌드 도구(build-essential, python3) 설치 여부 확인.
- **DB 권한 오류**: `/var/lib/fried-egg` 소유자/권한 확인.
- **사이트 접속 안 됨**: NSG의 80/443 인바운드 규칙, Nginx 구동 여부 확인.
- **SSH 접속 안 됨**: NSG의 22 규칙 소스 IP가 현재 내 공인 IP와 맞는지 확인(IP가 바뀌면 갱신 필요).

---

## 12. 보안 체크리스트

- [ ] SSH(22)는 내 IP만 허용 (NSG 규칙)
- [ ] 3000 포트는 NSG에서 미개방 (Nginx만 외부 노출)
- [ ] 무료 도메인(DuckDNS) 연결 + HTTPS 적용(certbot)
- [ ] OS 패키지 정기 업데이트 (`sudo apt update && sudo apt upgrade`)
- [ ] DB 자동 백업 + Azure Blob Storage 보관
- [ ] (선택) Nginx에 rate limit 추가로 가챠/점수 API 남용 방지

---

## 13. 언제 PostgreSQL로 옮기나

SQLite로 충분하지만, 아래 상황이면 이전을 고려하세요.

- 앱 서버를 **2대 이상**으로 늘려 같은 DB를 공유해야 할 때 (SQLite는 파일 1개라 수평 확장 부적합)
- 쓰기 동시성이 매우 높아 WAL로도 잠금 경합이 보일 때
- 매니지드 백업/복제(Azure Database for PostgreSQL)가 필요할 때

이전 시: `users / scores / collection` 3개 테이블 스키마는 그대로 옮기면 되고,
`db.js`의 쿼리를 `pg`(node-postgres)로 교체하면 됩니다. 데이터는
`sqlite3 .dump` → 약간의 문법 수정 → psql import 순으로 마이그레이션합니다.

---

## 부록 — AWS → Azure 용어 대응표

| AWS (원본) | Azure (이 문서) |
|------|------|
| EC2 인스턴스 | 가상 머신(VM) |
| AMI (Amazon Linux 2023) | 이미지 (Ubuntu 22.04 LTS, x64) |
| 보안 그룹(Security Group) | 네트워크 보안 그룹(NSG) |
| 기본 계정 `ec2-user` | 생성 시 지정한 `azureuser` |
| 퍼블릭 IPv4 | 공용 IP 주소 |
| 패키지 관리 `dnf` | `apt` |
| 빌드 패키지 `gcc-c++` | `build-essential` |
| S3 (백업 저장) | Azure Blob Storage |
| Route 53 (DNS) | Azure DNS / 외부 등록기관 |
| `t3.micro` | `Standard_B1s` (버스터블) |
