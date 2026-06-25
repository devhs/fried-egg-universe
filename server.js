// 계란 후라이 유니버스 - API 서버 (오케스트라 이벤트 버전 v2)
// (sync marker)
const express = require('express');
const path = require('path');
const fs = require('fs');
const dao = require('./db');
const { EGGS, RARITY_META, drawRandomEgg } = require('./eggs');
const { PARTS, getPart } = require('./parts');
const { validateNick } = require('./validate');
const { rateLimit } = require('./ratelimit');

const app = express();
const PORT = process.env.PORT || 3000;
const DRAW_COST = Number(process.env.DRAW_COST || 50);
const RL_DISABLED = process.env.RATE_LIMIT_DISABLED === '1';

app.set('trust proxy', 1); // Nginx 뒤에서 req.ip 정확히
app.use(express.json({ limit: '16kb' }));

// ---- 보안 헤더(외부 의존성 없이 최소셋) -----------------------------------
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('X-XSS-Protection', '0');
  res.setHeader('Permissions-Policy', 'geolocation=(), microphone=(), camera=()');
  // 자체 호스팅 정적 자원만 사용. 인라인 스타일/이벤트 없음 → 비교적 엄격하게.
  // script는 'self' 엄격(XSS 핵심 방어). style은 동적 색상(인라인 style) 위해 unsafe-inline 허용.
  res.setHeader('Content-Security-Policy',
    "default-src 'self'; img-src 'self' data:; style-src 'self' 'unsafe-inline'; script-src 'self'; base-uri 'self'; form-action 'self'; frame-ancestors 'none'");
  next();
});

// 공유 링크 미리보기(카톡 등): /?u=ID 로 들어오면 그 사람 점수를 OG 메타로 주입
const INDEX_HTML = fs.readFileSync(path.join(__dirname, 'public', 'index.html'), 'utf8');
const escAttr = (s) => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
app.get('/', (req, res) => {
  const uid = String(req.query.u || '').slice(0, 32);
  let title = '계란 후라이 유니버스 🍳';
  let desc = '굽기 타이밍 게임 · 작곡가 후라이 도감 · 파트별 리더보드';
  if (uid) {
    const u = dao.getUser(uid);
    if (u) {
      const p = getPart(u.part);
      title = `${u.nickname} 님, 최고 ${u.best_score.toLocaleString()}점! 🍳`;
      desc = `${p ? p.label : '-'} 파트 · 계란 후라이 유니버스 — 이 점수 이길 수 있어?`;
    }
  }
  // 카톡 등 스크래퍼는 og:image에 절대 URL을 요구 → 요청 호스트 기준으로 절대경로 생성
  const proto = String(req.headers['x-forwarded-proto'] || req.protocol || 'http').split(',')[0];
  const host = req.headers['x-forwarded-host'] || req.get('host') || 'localhost';
  const baseUrl = `${proto}://${host}`;
  const og = [
    '<meta property="og:type" content="website">',
    `<meta property="og:url" content="${escAttr(baseUrl + req.originalUrl)}">`,
    `<meta property="og:title" content="${escAttr(title)}">`,
    `<meta property="og:description" content="${escAttr(desc)}">`,
    `<meta property="og:image" content="${escAttr(baseUrl + '/og.png')}">`,
    '<meta property="og:image:width" content="1200">',
    '<meta property="og:image:height" content="630">',
    '<meta name="twitter:card" content="summary_large_image">',
    '',
  ].join('\n');
  res.type('html').send(INDEX_HTML.replace('</head>', og + '</head>'));
});

app.use(express.static(path.join(__dirname, 'public')));

const clean = (s, max = 16) => String(s ?? '').trim().slice(0, max);

// ---- rate limiters ---------------------------------------------------------
const rl = (limit, windowMs, message) => rateLimit({ limit, windowMs, message, disabled: RL_DISABLED });
const limScore    = rl(40, 60_000, '점수 제출이 너무 잦아요. 잠시 후 다시 시도해주세요.');
const limDraw     = rl(60, 60_000, '뽑기가 너무 잦아요. 잠시 후 다시 시도해주세요.');
const limRegister = rl(20, 60_000, '요청이 너무 잦아요. 잠시 후 다시 시도해주세요.');
const limDaily    = rl(20, 60_000, '요청이 너무 잦아요. 잠시 후 다시 시도해주세요.');

// ---- 라우트 ----------------------------------------------------------------
app.get('/api/health', (req, res) =>
  res.json({ ok: true, time: new Date().toISOString(), driver: dao.DRIVER }));

app.get('/api/eggs', (req, res) =>
  res.json({
    eggs: EGGS, rarity: RARITY_META, parts: PARTS, drawCost: DRAW_COST,
    dailyBase: dao.DAILY_BASE, collBonus: dao.COLL_BONUS,
  }));

app.post('/api/register', limRegister, (req, res, next) => {
  try {
    const deviceId = clean(req.body.deviceId, 64);
    const part = clean(req.body.part, 8);
    if (!deviceId) return res.status(400).json({ error: 'deviceId 필요' });
    const nv = validateNick(req.body.nickname);
    if (!nv.ok) return res.status(400).json({ error: nv.error, code: nv.code });
    const user = dao.registerOrLogin({ deviceId, nickname: nv.value, part });
    res.json(fullUser(user));
  } catch (e) {
    if (e.code === 'NICK_TAKEN') return res.status(409).json({ error: e.message, code: e.code });
    if (e.code === 'BAD_PART')   return res.status(400).json({ error: e.message, code: e.code });
    next(e);
  }
});

app.get('/api/me/:id', (req, res) => {
  const user = dao.getUser(clean(req.params.id, 32));
  if (!user) return res.status(404).json({ error: '유저 없음' });
  res.json(fullUser(user));
});

app.get('/api/u/:id', (req, res) => {
  const u = dao.getUser(clean(req.params.id, 32));
  if (!u) return res.status(404).json({ error: '유저 없음' });
  const p = getPart(u.part);
  res.json({
    id: u.id, nickname: u.nickname,
    part: u.part, partLabel: p ? p.label : '', partEmoji: p ? p.emoji : '',
    bestScore: u.best_score, rank: dao.getRank(u.id),
    collected: dao.getCollectionCount(u.id), totalEggs: EGGS.length,
  });
});

app.post('/api/score', limScore, (req, res, next) => {
  try {
    const userId = clean(req.body.userId, 32);
    const score = Math.max(0, Math.min(1_000_000, Math.floor(Number(req.body.score) || 0)));
    const user = dao.getUser(userId);
    if (!user) return res.status(404).json({ error: '유저 없음' });
    const r = dao.submitScore(userId, score);
    if (r.limited)
      return res.status(429).json({
        error: `오늘 굽기 횟수를 다 썼어요 (${r.limit}/${r.limit}) — 내일 다시 와요!`,
        code: 'DAILY_LIMIT', limit: r.limit, remaining: 0, nextDate: r.nextDate,
      });
    res.json({
      user: publicUser(r.user), coinsEarned: r.coinsEarned, rank: r.rank,
      partRank: dao.getPartRank(userId), remaining: r.remaining, limit: r.limit,
    });
  } catch (e) { next(e); }
});

app.get('/api/leaderboard', (req, res) => {
  const limit = Math.max(1, Math.min(100, Number(req.query.limit) || 30));
  const part = req.query.part && getPart(req.query.part) ? req.query.part : null;
  res.json({ part, leaderboard: dao.getLeaderboard(limit, part) });
});

// 섹션 대항전: 파트별 합산/평균/최고/인원
app.get('/api/parts/leaderboard', (req, res) => {
  const rows = dao.getPartStandings();
  const byId = Object.fromEntries(rows.map(r => [r.part, r]));
  const sections = PARTS.filter(p => p.id !== 'co'); // 지휘자는 타악기(pe)로 합산
  const standings = sections.map(p => {
    const r = byId[p.id] || { members: 0, top: 0, avg: 0, top5n: 0 };
    return {
      part: p.id, label: p.id === 'pe' ? '타악기·지휘' : p.label,
      emoji: p.emoji, color: p.color, family: p.family,
      members: r.members, top: r.top, avg: r.avg, top5n: r.top5n,
    };
  }).sort((a, b) => b.avg - a.avg);
  res.json({ standings, metric: 'top5avg' });
});

// 일일 출석 보상
app.post('/api/daily', limDaily, (req, res, next) => {
  try {
    const userId = clean(req.body.userId, 32);
    if (!dao.getUser(userId)) return res.status(404).json({ error: '유저 없음' });
    const r = dao.claimDaily(userId);
    if (!r.ok && r.code === 'ALREADY')
      return res.status(409).json({ error: '오늘은 이미 받았어요', code: 'ALREADY', streak: r.streak, nextDate: r.nextDate });
    if (!r.ok) return res.status(400).json({ error: '보상 지급 실패', code: r.code });
    res.json({ amount: r.amount, streak: r.streak, user: publicUser(r.user) });
  } catch (e) { next(e); }
});

app.post('/api/draw', limDraw, (req, res, next) => {
  try {
    const userId = clean(req.body.userId, 32);
    const user = dao.getUser(userId);
    if (!user) return res.status(404).json({ error: '유저 없음' });
    if (user.coins < DRAW_COST)
      return res.status(400).json({ error: '코인이 부족해요', code: 'NO_COINS', need: DRAW_COST, have: user.coins });
    const egg = drawRandomEgg();
    const updated = dao.drawEgg(userId, DRAW_COST, egg);
    if (!updated) return res.status(400).json({ error: '코인이 부족해요', code: 'NO_COINS' });
    // 100% 수집 보너스 체크(도달 순간 1회)
    const bonus = dao.grantCollectionBonus(userId, EGGS.length);
    const finalUser = bonus ? bonus.user : updated;
    res.json({
      egg,
      user: publicUser(finalUser),
      collection: dao.getCollection(userId),
      collectionBonus: bonus ? { amount: bonus.amount } : null,
    });
  } catch (e) { next(e); }
});

// ---- 직렬화 헬퍼 -----------------------------------------------------------
function publicUser(u) {
  const p = getPart(u.part);
  return {
    id: u.id, nickname: u.nickname, part: u.part,
    partLabel: p ? p.label : '', partEmoji: p ? p.emoji : '', partColor: p ? p.color : '#999',
    bestScore: u.best_score, coins: u.coins, gamesPlayed: u.games_played,
    dailyStreak: u.daily_streak, lastDaily: u.last_daily, collBonus: !!u.coll_bonus,
    playsLeft: dao.playsLeft(u), playLimit: dao.DAILY_PLAY_LIMIT,
  };
}
function fullUser(u) {
  return {
    user: publicUser(u),
    collection: dao.getCollection(u.id),
    rank: dao.getRank(u.id),
    partRank: dao.getPartRank(u.id),
    today: dao.eventDateStr(),
  };
}

// ---- 404 / 에러 핸들러 -----------------------------------------------------
app.all('/api/*', (req, res) => res.status(404).json({ error: 'API 경로 없음', code: 'NOT_FOUND' }));
app.get('*', (req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));
app.use((err, req, res, next) => {
  console.error('[ERR]', err);
  if (res.headersSent) return next(err);
  res.status(500).json({ error: '서버 오류', code: 'INTERNAL' });
});

const server = app.listen(PORT, () =>
  console.log(`🍳 Fried Egg Universe listening on :${PORT}  (driver: ${dao.DRIVER}, DB: ${dao.DB_PATH})`));

module.exports = { app, server };
