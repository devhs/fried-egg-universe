# 🍳 계란 후라이 유니버스 (오케스트라 이벤트판) — v2

굽기 타이밍 게임 → 코인 → 세계 후라이 도감 수집 → 파트별 리더보드 + **섹션 대항전** 경쟁.
**Node.js + Express + SQLite** 풀스택, EC2 1대로 배포. 모바일 우선.

## 기능
- 🔥 **굽기 타이밍 게임** — 좌우로 움직이는 마커를 초록 구간에서 탭. 정확도·콤보로 점수, 라운드마다 빨라지고 구간이 좁아짐. 진동·컨페티 피드백.
- 🎻 **악기 파트** — 가입 시 9개 파트 중 선택. 리더보드 파트 태그 + **파트별 순위 필터**.
- 🎨 **수집형 도감(가챠)** — 점수→코인→뽑기로 **21종 수집(악기 파트 9 + 작곡가 12)**. 각 항목은 **귀엽고 플랫한 SVG 일러스트**(바이올린 후라이, 베토벤 후라이 등). 희귀도 4단계, 추첨은 **서버에서**. 도감 진척 바·전설 글로우·**100% 수집 1회성 보너스**.
- 🏆 **리더보드** — 개인전(전체/파트별) + 🆚 **섹션 대항전**. 인원수 차이를 줄이려 **상위 5명 평균** 기준, **지휘자는 타악기에 합산**(8개 섹션).
- 🎁 **일일 출석 보상** — 하루 1회 코인, 연속 출석 시 보너스 증가(최대 7일).
- ⏱ **하루 굽기 제한** — 1인 하루 **10판**(환경변수 조정). 다 쓰면 "내일 다시" 안내, 남은 횟수 표시.
- 📤 **점수 공유** — Web Share API(→카카오톡 선택) + 링크 복사. 공유 링크는 **카톡 미리보기에 "○○ 님, 최고 N점!"**(서버 OG 메타) + 브랜드 이미지(og.png)로 뜨고, 열면 **도전장** 화면.
- 🔒 **닉네임 규칙** — 기기당 1개 **고정·변경 불가**, 행사 전체 **중복 금지**(대소문자 무시), **욕설·제어문자 필터**.
- 🛡 **운영 안정성** — 점수/뽑기 **rate limit**, 보안 헤더(CSP 등), `/api/*` JSON 404, 중앙 에러 핸들러.

## 로컬 실행 — 빌드도구 없이

> **권장: Node.js 22.5 이상.** 이러면 빌드도구(Visual Studio Build Tools 등) **없이 바로 실행**됩니다.
> DB 드라이버를 자동 선택하기 때문입니다 — `better-sqlite3`가 설치/빌드돼 있으면 그걸 쓰고,
> 없으면 Node 내장 `node:sqlite`로 **자동 폴백**합니다. (`better-sqlite3`는 *optional* 의존성)

```bash
npm install      # express 설치. better-sqlite3는 optional → 빌드 실패해도 설치는 계속됨
npm start        # http://localhost:3000
```

- Node 버전 확인: `node -v` (22.5.0 이상이면 무빌드 경로 사용 가능)
- 어떤 드라이버로 떴는지 확인: 콘솔 로그 `(driver: ...)` 또는 `GET /api/health` 의 `driver` 필드
- `better-sqlite3`를 강제하려면: `DB_DRIVER=better-sqlite3 npm start` (없으면 에러)

## 구조
```
├── server.js     Express API + 정적 서빙 + 보안헤더 + rate limit
├── db.js         SQLite 계층 (드라이버 자동선택: better-sqlite3 ↔ node:sqlite)
├── ratelimit.js  인메모리 고정창 rate limiter (+ 단위테스트 대상)
├── validate.js   닉네임 검증/정규화 (제어문자·욕설 블록리스트)
├── eggs.js       도감 카탈로그(21: 악기9+작곡가12) + 가챠 추첨
├── parts.js      악기 파트 카탈로그(9)
├── public/       index.html · styles.css · app.js (모바일 UI + 게임 엔진 + 컨페티)
├── public/eggs/  도감 일러스트 21종 (SVG, 정적 서빙 /eggs/<id>.svg)
├── test-api.js   통합+단위 테스트(70개)
├── ecosystem.config.cjs  PM2
└── DEPLOY.md     EC2 배포 가이드
```

## API
| 메서드 | 경로 | 설명 |
|--------|------|------|
| GET  | `/api/health` | 헬스체크(+`driver`) |
| GET  | `/api/eggs` | 에그·파트 카탈로그 + 가챠비용 + 일일/도감 보너스액 |
| POST | `/api/register` | `{deviceId,nickname,part}` → 가입/로그인 (409 NICK_TAKEN / 400 BAD_PART·NICK_BANNED·NICK_LONG·NICK_CHARS) |
| GET  | `/api/me/:id` | 내 상태(유저·도감·전체/파트랭크·today) |
| GET  | `/api/u/:id` | 공유용 공개 카드 |
| POST | `/api/score` | `{userId,score}` → best·코인·랭크 + `remaining`(남은 굽기). 초과 시 **429 DAILY_LIMIT** |
| GET  | `/api/leaderboard?part=vc&limit=50` | 개인 랭킹(전체/파트별) |
| GET  | `/api/parts/leaderboard` | 🆚 섹션 대항전(상위 5명 평균 `avg`·최고 `top`·인원 `members`·`top5n`). 지휘자→타악기 합산, 8섹션 |
| POST | `/api/daily` | `{userId}` → 일일 출석 보상(409 ALREADY) |
| POST | `/api/draw` | `{userId}` → 코인 차감 후 랜덤 에그 + 100%보너스 체크 |

코인 = `floor(score/10)`(최소 1). 가챠 1회 = `DRAW_COST`(기본 50).
환경변수: `DRAW_COST`, `DAILY_BASE`(기본 30), `COLL_BONUS`(기본 500), `DAILY_PLAY_LIMIT`(기본 10), `EVENT_TZ_OFFSET_MIN`(기본 540=KST), `RATE_LIMIT_DISABLED`, `DB_DRIVER`, `BANNED_WORDS`.

## DB 스키마 (SQLite)
- `users(id, nickname, part, device_id UNIQUE, best_score, coins, games_played, last_daily, daily_streak, coll_bonus, ...)` + `UNIQUE INDEX lower(nickname)`
- `scores(id, user_id, score, created_at)`
- `collection(user_id, egg_id, count, first_at)` (PK: user_id+egg_id)

기존 v1 DB도 자동 마이그레이션됩니다(`last_daily`/`daily_streak`/`coll_bonus` 컬럼 추가).

## 테스트
```bash
npm test           # = node test-api.js  (통합+단위 70개)
```
> 검증 환경에서 better-sqlite3 네이티브 바이너리를 받을 수 없을 때, `db.js`는 동일 API의
> `node:sqlite`로 폴백해 **동일 SQL**을 실행합니다. **운영은 better-sqlite3 권장.**
> ⚠️ 단, 운영 경로(better-sqlite3 실제 빌드)에서의 실행은 이 환경에서 검증하지 못했습니다(드라이버 폴백 경로만 검증).

## 카카오톡 리치 공유(선택)
현재는 Web Share API + 링크 복사(키 불필요). 섬네일 카드가 필요하면 Kakao JS SDK(JS키)를 `index.html`에 추가하세요.

## 출처
- 흰자 62–65°C / 노른자 65–70°C 응고: [American Egg Board — Coagulation/Thickening](https://www.incredibleegg.org/professionals/manufacturers/real-egg-functionality/coagulation-thickening/)
