# CLAUDE.md — 프로젝트 컨텍스트 (Claude Code 자동 로드용)

> 다른 PC에서 이 저장소를 clone 한 뒤 Claude Code를 열면 이 파일을 읽고 맥락을 이어받습니다.
> 대화 흐름 요약은 `HANDOFF.md` 참고.

## 무엇인가
"계란 후라이 유니버스" — 오케스트라 이벤트용 모바일 웹 게임/이벤트 서비스.
굽기 타이밍 게임 → 코인 → 세계 후라이 도감(가챠) 수집 → 파트별 리더보드 경쟁 + 점수 링크 공유.

## 스택 & 핵심 결정 (사용자와 확정한 사항)
- 백엔드: **Node.js + Express**, DB는 **SQLite(better-sqlite3, WAL)**. EC2 1대로 운영(별도 DB서버 없음).
- 유저 식별: **닉네임 + 기기 자동 ID(localStorage `feu_device`)**. 비밀번호 없음.
- 닉네임 규칙: **기기당 1개로 고정·변경 불가** + **행사 전체 중복 금지(대소문자 무시)**.
- 악기 파트 9종 선택: 1바이올린/2바이올린/비올라/첼로/베이스/목관/금관/타악기/지휘자
  → 리더보드 파트 태그 + **파트별 순위 필터**. (※ 섹션 대항전 합산은 아직 미구현 — 후보 기능)
- 공유: **Web Share API + 링크 복사**(카톡 선택 가능). 리치 카드(섬네일)는 Kakao JS SDK 필요 — 미적용.
- 배포 타깃: **AWS EC2 (Amazon Linux 2023)** + 도메인 + 무료 HTTPS(certbot), 코드 전달은 GitHub clone.

## 파일 구조
```
server.js              Express API + 정적 서빙 + 보안헤더 + rate limit (포트 3000)
db.js                  SQLite 계층. 드라이버 자동선택(better-sqlite3 ↔ node:sqlite 폴백) + 마이그레이션
ratelimit.js           인메모리 고정창 rate limiter (now 주입 가능, 단위테스트 대상)  ★v2
validate.js            닉네임 검증/정규화(제어문자 제거·욕설 블록리스트)              ★v2
eggs.js                도감 카탈로그(21종: 악기9+작곡가12, SVG 일러스트 img 경로) + 가챠 추첨
public/eggs/*.svg      도감 일러스트 21종(귀엽고 플랫). 정적 서빙 /eggs/<id>.svg          ★v2.1
parts.js               악기 파트 카탈로그(9종)
public/index.html      모바일 UI (탭바 + 온보딩·도전장·게임오버 + 일일카드·섹션토글·컨페티)
public/styles.css      프리미엄 모바일 스타일(글래스/글로우/세그먼트/진척바)          ★v2 리디자인
public/app.js          게임 엔진 + API 클라이언트 + 공유/파트필터 + 일일/섹션/컨페티/카운트업
test-api.js            통합+단위 테스트 58개                                          ★v2
ecosystem.config.cjs   PM2 설정 (DB_PATH=/var/lib/fried-egg/fried-egg.db)
deploy-al2023.sh       EC2 원샷 배포 스크립트
QUICKSTART-EC2.md      배포 3단계 가이드
DEPLOY.md              상세 배포 가이드(백업·확장 포함)
```

## v2 핵심 변경 (이번 세션)
- **로컬 실행 무빌드화**: db.js 드라이버 자동선택 + `better-sqlite3`를 optionalDependencies로 이동.
  Node 22.5+면 빌드도구 없이 `npm install && npm start` 동작(node:sqlite 폴백). `/api/health`의 `driver`로 확인.
- **보안·안정성**: 보안 헤더(CSP/X-Frame 등), score/draw/register/daily rate limit, `/api/*` JSON 404, 중앙 에러 핸들러, 닉네임 검증 강화.
- **신규 기능**: 섹션 대항전(`/api/parts/leaderboard`), 일일 출석(`/api/daily`, 연속 보너스), 도감 100% 1회성 보너스(`/api/draw` 응답 `collectionBonus`).
- **UI**: 프리미엄 리디자인 + 컨페티/숫자 카운트업/희귀도 글로우/탭 인디케이터.

## 실행 / 테스트 / 배포
```bash
npm install            # better-sqlite3 네이티브 빌드(빌드도구 필요할 수 있음: gcc-c++ make python3)
npm start              # http://localhost:3000
node test-api.js       # 통합 테스트 33개
# 배포: QUICKSTART-EC2.md 참고 → deploy-al2023.sh 한 줄 실행
```

## API 요약
- `GET /api/health` · `GET /api/eggs`(에그+파트+가챠비용)
- `POST /api/register {deviceId,nickname,part}` → 가입/로그인 (409 NICK_TAKEN / 400 BAD_PART)
- `GET /api/me/:id` · `GET /api/u/:id`(공유 카드)
- `POST /api/score {userId,score}` → best·코인·전체/파트 랭크
- `GET /api/leaderboard?part=&limit=` · `POST /api/draw {userId}`

## 데이터 모델 (SQLite)
- `users(id, nickname, part, device_id UNIQUE, best_score, coins, games_played, ...)` + `UNIQUE INDEX lower(nickname)`
- `scores(id, user_id, score, created_at)`
- `collection(user_id, egg_id, count, first_at)` (PK user_id+egg_id)

## 튜닝 포인트 (기본값)
- 코인 적립 = `floor(score/10)` 최소 1 → `db.js submitScore`
- 가챠 1회 = `DRAW_COST` 기본 50 → 환경변수 / `server.js`
- 도감 희귀도·가중치 → `eggs.js`
- 게임 난이도(속도/구간) → `public/app.js` `newRound()`

## 상태
- 기능 완성, 통합+단위 테스트 **58/58 통과** (node:sqlite 폴백 경로로 실서버 기동해 검증).
- 클린 설치(`npm install`, better-sqlite3 optional) → node:sqlite 기동까지 실제 확인.
- ⚠️ **미검증**: (1) better-sqlite3 실제 빌드/운영 경로 실행, (2) EC2 실배포, (3) 브라우저 실제 렌더링(UI 비주얼).
  → db.js 폴백·정적 서빙·API는 검증됨. 운영 드라이버/배포/픽셀단 렌더는 사용자 환경에서 확인 필요.

## 다음에 할 수 있는 것 (남은 후보)
- Kakao JS SDK 리치 공유 카드 (앱 JS키 필요)
- 관리자용 리셋/신고 처리 화면, 욕설 블록리스트 확장(현재는 보수적 기본셋, 전수 아님)
- 점수 서버검증(현재 클라 점수 신뢰 + 상한 클램프만 — 이벤트용으론 충분하나 부정 방지엔 한계)
- 분산 배포 시 rate limit/일일보상을 Redis 등 공유 저장소로 (현재 단일 인스턴스 전제)
