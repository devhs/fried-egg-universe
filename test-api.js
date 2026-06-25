// API 통합 + 단위 테스트 (v2)
// 드라이버: better-sqlite3 미설치/미빌드 환경에서는 db.js가 node:sqlite로 자동 폴백한다.
//          (운영은 better-sqlite3. 동일 SQL을 동일 API로 검증.)
const fs = require('fs');
const DBP = '/tmp/feu-test.db';
for (const f of [DBP, DBP + '-wal', DBP + '-shm']) { try { fs.unlinkSync(f); } catch {} }
process.env.DB_PATH = DBP;
process.env.PORT = '3999';
process.env.RATE_LIMIT_DISABLED = '1'; // 기능 테스트에서는 rate limit 비활성 (limiter는 별도 단위테스트)
process.env.DAILY_PLAY_LIMIT = '5';   // 하루 굽기 제한 테스트용 (운영 기본 10)

const dao = require('./db');
const { createLimiter, rateLimit } = require('./ratelimit');
const { validateNick } = require('./validate');
require('./server');

const BASE = 'http://127.0.0.1:3999';
const j = (p, opt) => fetch(BASE + p, opt).then(r => r.json());
const raw = (p, opt) => fetch(BASE + p, opt);
const post = (b) => ({ method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(b) });

let pass = 0, fail = 0;
function ok(name, cond, extra) { (cond ? pass++ : fail++); console.log((cond ? '✅' : '❌') + ' ' + name + (extra ? '  ' + extra : '')); }

async function run() {
  await new Promise(r => setTimeout(r, 400));

  // ---- 단위: rate limiter (결정론적, now 주입) ----
  let clock = 1000;
  const lim = createLimiter({ limit: 3, windowMs: 1000, now: () => clock });
  ok('rl 1~3 허용', lim.check('k').ok && lim.check('k').ok && lim.check('k').ok);
  ok('rl 4번째 차단', lim.check('k').ok === false);
  ok('rl retryAfter 제공', lim.check('k').retryAfterSec > 0);
  clock += 1001;
  ok('rl 창 리셋 후 허용', lim.check('k').ok === true);
  // 미들웨어 429 경로
  const mw = rateLimit({ limit: 1, windowMs: 1000 });
  const mkRes = () => ({ code: 200, headers: {}, setHeader(k, v) { this.headers[k] = v; }, status(c) { this.code = c; return this; }, json(o) { this.body = o; return this; } });
  let r1 = mkRes(); mw({ ip: 'x' }, r1, () => { r1.code = 'next'; });
  ok('rl mw 1회 통과', r1.code === 'next');
  let r2 = mkRes(); mw({ ip: 'x' }, r2, () => { r2.code = 'next'; });
  ok('rl mw 2회 429', r2.code === 429 && r2.body.code === 'RATE_LIMITED');

  // ---- 단위: 닉네임 검증 ----
  ok('nick 욕설 차단', validateNick('fuck').ok === false);
  ok('nick 제어문자 제거', validateNick('a​b').value === 'ab');
  ok('nick 12자 초과 거부', validateNick('1234567890123').ok === false);
  ok('nick 정상 통과', validateNick(' 계란 왕 ').value === '계란 왕');

  // ---- 통합: health / 카탈로그 ----
  let h = await j('/api/health'); ok('health', h.ok === true, 'driver=' + h.driver);
  let cat = await j('/api/eggs');
  ok('eggs 카탈로그(21)', Array.isArray(cat.eggs) && cat.eggs.length === 21, `len=${cat.eggs?.length}`);
  ok('parts 카탈로그(9)', Array.isArray(cat.parts) && cat.parts.length === 9);
  ok('drawCost/dailyBase/collBonus 노출', cat.drawCost === 50 && cat.dailyBase > 0 && cat.collBonus > 0);

  // ---- 가입/로그인/닉네임 규칙 ----
  let A = await j('/api/register', post({ deviceId: 'devA', nickname: '계란왕', part: 'vc' }));
  ok('A 가입(+파트)', A.user && A.user.nickname === '계란왕' && A.user.part === 'vc');
  ok('partLabel/Color 노출', A.user.partLabel === '첼로' && !!A.user.partColor);
  ok('today 필드 노출', typeof A.today === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(A.today));
  const aid = A.user.id;

  let A2 = await j('/api/register', post({ deviceId: 'devA', nickname: '계란황제', part: 'br' }));
  ok('동일 device=같은 ID', A2.user.id === aid);
  ok('닉네임 변경 차단(고정)', A2.user.nickname === '계란왕');
  ok('파트 변경 차단(고정)', A2.user.part === 'vc');

  let dupNick = await j('/api/register', post({ deviceId: 'devX', nickname: '계란왕', part: 'va' }));
  ok('닉네임 중복 거부', dupNick.code === 'NICK_TAKEN');
  let dupCase = await j('/api/register', post({ deviceId: 'devY', nickname: '계란왕', part: 'va' }));
  ok('대소문자 무시 중복 거부', dupCase.code === 'NICK_TAKEN');
  let badPart = await j('/api/register', post({ deviceId: 'devZ', nickname: '엉뚱이', part: 'xx' }));
  ok('잘못된 파트 거부', badPart.code === 'BAD_PART');
  let banned = await j('/api/register', post({ deviceId: 'devB1', nickname: 'shit', part: 'vc' }));
  ok('욕설 닉 API 거부', banned.code === 'NICK_BANNED', banned.error);

  // ---- 점수/코인/랭크 ----
  let s1 = await j('/api/score', post({ userId: aid, score: 1234 }));
  ok('점수 제출 best 갱신', s1.user.bestScore === 1234);
  ok('코인 적립(=floor/10)', s1.coinsEarned === 123 && s1.user.coins === 123);
  ok('rank=1', s1.rank === 1);
  let s2 = await j('/api/score', post({ userId: aid, score: 100 }));
  ok('낮은 점수는 best 유지', s2.user.bestScore === 1234);
  ok('코인은 계속 누적', s2.user.coins === 133);

  // ---- 리더보드(개인/파트) ----
  let B = await j('/api/register', post({ deviceId: 'devB', nickname: '후라이러', part: 'vc' }));
  await j('/api/score', post({ userId: B.user.id, score: 5000 }));
  let lb = await j('/api/leaderboard');
  ok('개인 리더보드 정렬(B 1위)', lb.leaderboard[0].nickname === '후라이러' && lb.leaderboard[0].best_score === 5000);
  ok('리더보드 행에 part 포함', lb.leaderboard[0].part === 'vc');
  let rankA = await j('/api/me/' + aid);
  ok('A 랭크=2', rankA.rank === 2);
  ok('me 응답에 daily/coll 필드', 'dailyStreak' in rankA.user && 'collBonus' in rankA.user);
  let lbVc = await j('/api/leaderboard?part=vc');
  ok('파트 필터(vc) 2명', lbVc.leaderboard.length === 2 && lbVc.part === 'vc');
  let C2 = await j('/api/register', post({ deviceId: 'devW', nickname: '금관왕', part: 'br' }));
  await j('/api/score', post({ userId: C2.user.id, score: 300 }));
  let lbBr = await j('/api/leaderboard?part=br');
  ok('파트 필터(br) 1명', lbBr.leaderboard.length === 1 && lbBr.leaderboard[0].nickname === '금관왕');

  // ---- 섹션 대항전 ----
  let psec = await j('/api/parts/leaderboard');
  ok('섹션 standings 8파트(지휘자 제외)', Array.isArray(psec.standings) && psec.standings.length === 8, `n=${psec.standings?.length}`);
  ok('섹션 평균 내림차순', psec.standings.every((s, i, a) => i === 0 || a[i - 1].avg >= s.avg));
  ok('섹션에 지휘자(co) 없음', !psec.standings.some(s => s.part === 'co'));
  const vc = psec.standings.find(s => s.part === 'vc');
  ok('vc 상위5평균=3117, 2명', vc.avg === 3117 && vc.members === 2, `avg=${vc.avg},m=${vc.members}`);
  ok('vc 섹션 top=5000', vc.top === 5000, `top=${vc.top}`);

  // ---- 공유 카드 ----
  let card = await j('/api/u/' + B.user.id);
  ok('공유 카드 점수/파트', card.bestScore === 5000 && card.partLabel === '첼로');
  ok('공유 카드 도감 카운트', typeof card.collected === 'number' && card.totalEggs === 21);
  let cardNF = await j('/api/u/없는유저');
  ok('없는 유저 카드 404', cardNF.error === '유저 없음');

  // ---- 일일 출석 ----
  let d1 = await j('/api/daily', post({ userId: aid }));
  ok('출석 1회차 지급', d1.amount === dao.DAILY_BASE && d1.streak === 1, `amount=${d1.amount}`);
  ok('출석 코인 반영', d1.user.coins === 133 + dao.DAILY_BASE);
  let d2 = await raw('/api/daily', post({ userId: aid }));
  let d2b = await d2.json();
  ok('출석 2회차 409 ALREADY', d2.status === 409 && d2b.code === 'ALREADY');
  let dNF = await raw('/api/daily', post({ userId: 'nope' }));
  ok('출석 없는 유저 404', dNF.status === 404);

  // ---- 가챠 ----
  let beforeCoins = (await j('/api/me/' + aid)).user.coins;
  let dr = await j('/api/draw', post({ userId: aid }));
  ok('가챠 성공(에그 획득)', dr.egg && dr.egg.id, dr.egg && dr.egg.name);
  ok('가챠 코인 차감(-50)', dr.user.coins === beforeCoins - 50);
  ok('수집함에 추가', dr.collection.some(c => c.egg_id === dr.egg.id));
  let C = await j('/api/register', post({ deviceId: 'devC', nickname: '무일푼', part: 'pe' }));
  let dc = await raw('/api/draw', post({ userId: C.user.id }));
  let dcb = await dc.json();
  ok('코인 부족 시 draw 400/NO_COINS', dc.status === 400 && dcb.code === 'NO_COINS');

  // ---- 도감 100% 보너스 (dao 직접: 12종 모두 수집 후 1회성 지급) ----
  let Z = await j('/api/register', post({ deviceId: 'devZc', nickname: '콜렉터', part: 'co' }));
  const zid = Z.user.id;
  for (const e of cat.eggs) dao.db.prepare('INSERT OR IGNORE INTO collection (user_id, egg_id) VALUES (?, ?)').run(zid, e.id);
  let bonus1 = dao.grantCollectionBonus(zid, cat.eggs.length);
  ok('도감 100% 보너스 지급', bonus1 && bonus1.amount === dao.COLL_BONUS, `amount=${bonus1 && bonus1.amount}`);
  let bonus2 = dao.grantCollectionBonus(zid, cat.eggs.length);
  ok('도감 보너스 1회성(재지급 없음)', bonus2 === null);

  // ---- 방어/에러 ----
  // 공유 OG 메타 (카톡 미리보기): /?u=ID 에 닉/점수 주입
  let ogr = await raw('/?u=' + B.user.id); let ogt = await ogr.text();
  ok('공유 OG에 닉/점수 주입', ogt.includes('og:title') && ogt.includes('후라이러'));
  ok('공유 OG 절대경로 이미지', /og:image" content="http[^"]+\/og\.png"/.test(ogt));

  // 하루 굽기 횟수 제한 (테스트 limit=5)
  let LP = await j('/api/register', post({ deviceId: 'devLP', nickname: '횟수왕', part: 'pe' }));
  const lpid = LP.user.id;
  ok('초기 playsLeft=5', LP.user.playsLeft === 5, `pl=${LP.user.playsLeft}`);
  let rem;
  for (let i = 1; i <= 5; i++) { const r = await j('/api/score', post({ userId: lpid, score: 100 })); rem = r.remaining; }
  ok('5판 후 remaining=0', rem === 0, `rem=${rem}`);
  let over = await raw('/api/score', post({ userId: lpid, score: 100 })); let overb = await over.json();
  ok('6판째 429 DAILY_LIMIT', over.status === 429 && overb.code === 'DAILY_LIMIT', overb.code);
  let meLP = await j('/api/me/' + lpid);
  ok('me playsLeft=0', meLP.user.playsLeft === 0);

  // 섹션 상위5평균 + 지휘자→타악기 병합 정밀 검증 (미사용 파트 ww 사용)
  const wwScores = [600, 500, 400, 300, 200, 100];
  for (let i = 0; i < wwScores.length; i++) {
    const u = await j('/api/register', post({ deviceId: 'wwsec' + i, nickname: '목관테스트' + i, part: 'ww' }));
    await j('/api/score', post({ userId: u.user.id, score: wwScores[i] }));
  }
  const condU = await j('/api/register', post({ deviceId: 'condsec', nickname: '마에스트로', part: 'co' }));
  await j('/api/score', post({ userId: condU.user.id, score: 9000 }));
  let sec2 = await j('/api/parts/leaderboard');
  ok('섹션 8개(지휘자 폴드인)', sec2.standings.length === 8, `n=${sec2.standings.length}`);
  const wwS = sec2.standings.find(s => s.part === 'ww');
  ok('ww 상위5평균=400, 6명', wwS.avg === 400 && wwS.members === 6, `avg=${wwS.avg},m=${wwS.members}`);
  ok('ww top5n=5 (6번째 제외)', wwS.top5n === 5, `n=${wwS.top5n}`);
  const peS = sec2.standings.find(s => s.part === 'pe');
  ok('지휘자(9000)가 타악기에 합산', peS.top === 9000, `peTop=${peS.top}`);
  ok('타악기 라벨에 지휘 표기', peS.label.includes('지휘'), peS.label);

  let nf = await j('/api/score', post({ userId: 'nope', score: 10 }));
  ok('없는 유저 score 404', nf.error === '유저 없음');
  let big = await j('/api/score', post({ userId: aid, score: 9e12 }));
  ok('점수 상한 클램프', big.user.bestScore <= 1000000);
  let r404 = await raw('/api/zzz-unknown');
  let r404b = await r404.json();
  ok('알 수 없는 API 404 JSON', r404.status === 404 && r404b.code === 'NOT_FOUND');

  // ---- 보안 헤더 ----
  let hres = await raw('/api/health');
  ok('CSP 헤더', /default-src 'self'/.test(hres.headers.get('content-security-policy') || ''));
  ok('X-Frame-Options DENY', hres.headers.get('x-frame-options') === 'DENY');
  ok('X-Content-Type nosniff', hres.headers.get('x-content-type-options') === 'nosniff');

  console.log(`\n결과: ${pass} 통과 / ${fail} 실패`);
  process.exit(fail ? 1 : 0);
}
run().catch(e => { console.error('테스트 오류', e); process.exit(1); });
