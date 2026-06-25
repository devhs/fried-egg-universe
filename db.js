// SQLite 데이터 계층
// 드라이버 자동 선택:
//   1) better-sqlite3 (운영 권장, 네이티브 빌드 필요)
//   2) 없으면 Node 22+ 내장 node:sqlite 로 자동 폴백 (빌드도구 불필요 → 로컬 실행 쉬움)
// 두 드라이버 모두 better-sqlite3 와 동일한 동기 API(prepare/get/all/run/exec/pragma/transaction)로 통일한다.
const path = require('path');
const crypto = require('crypto');
const { isValidPart } = require('./parts');

// ---- 드라이버 로더 ---------------------------------------------------------
function loadDriver() {
  // 1순위: better-sqlite3 (require 성공 + 네이티브 바인딩 실제 동작까지 probe로 확인)
  try {
    const Better = require('better-sqlite3');
    const probe = new Better(':memory:'); probe.close(); // 바인딩이 빌드돼 있는지 실검증
    return { name: 'better-sqlite3', open: (p) => new Better(p) };
  } catch (e) {
    if (process.env.DB_DRIVER === 'better-sqlite3') throw e; // 명시 강제 시엔 폴백 금지
    console.warn('[db] better-sqlite3 사용 불가 → node:sqlite로 폴백:', e.message.split('\n')[0]);
  }

  // 2순위: node:sqlite (Node 22.5+). better-sqlite3 API 형태로 감싼다.
  let DatabaseSync;
  try {
    ({ DatabaseSync } = require('node:sqlite'));
  } catch (e) {
    throw new Error(
      'SQLite 드라이버를 찾을 수 없습니다. ' +
      'better-sqlite3 를 설치(npm install)하거나 Node 22.5+ (내장 node:sqlite)를 사용하세요.\n원인: ' + e.message
    );
  }
  class Adapter {
    constructor(p) { this.db = new DatabaseSync(p); }
    pragma(s) { try { this.db.exec('PRAGMA ' + s); } catch (_) {} }
    exec(s) { this.db.exec(s); return this; }
    prepare(sql) {
      const st = this.db.prepare(sql);
      return {
        get: (...a) => st.get(...a),
        all: (...a) => st.all(...a),
        run: (...a) => { const r = st.run(...a); return { changes: r.changes, lastInsertRowid: r.lastInsertRowid }; },
      };
    }
    transaction(fn) {
      const self = this;
      return (...args) => {
        self.db.exec('BEGIN');
        try { const r = fn(...args); self.db.exec('COMMIT'); return r; }
        catch (e) { self.db.exec('ROLLBACK'); throw e; }
      };
    }
  }
  return { name: 'node:sqlite', open: (p) => new Adapter(p) };
}

const driver = loadDriver();
const DRIVER = driver.name;

const DB_PATH = process.env.DB_PATH || path.join(__dirname, 'data', 'fried-egg.db');
require('fs').mkdirSync(path.dirname(DB_PATH), { recursive: true });

const db = driver.open(DB_PATH);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

db.exec(`
CREATE TABLE IF NOT EXISTS users (
  id           TEXT PRIMARY KEY,
  nickname     TEXT NOT NULL,
  part         TEXT NOT NULL DEFAULT '',
  device_id    TEXT UNIQUE NOT NULL,
  best_score   INTEGER NOT NULL DEFAULT 0,
  coins        INTEGER NOT NULL DEFAULT 0,
  games_played INTEGER NOT NULL DEFAULT 0,
  last_daily   TEXT NOT NULL DEFAULT '',
  daily_streak INTEGER NOT NULL DEFAULT 0,
  coll_bonus   INTEGER NOT NULL DEFAULT 0,
  play_date    TEXT NOT NULL DEFAULT '',
  play_count   INTEGER NOT NULL DEFAULT 0,
  created_at   TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at   TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS scores (
  id        INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id   TEXT NOT NULL REFERENCES users(id),
  score     INTEGER NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS collection (
  user_id     TEXT NOT NULL REFERENCES users(id),
  egg_id      TEXT NOT NULL,
  count       INTEGER NOT NULL DEFAULT 1,
  first_at    TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (user_id, egg_id)
);

CREATE INDEX IF NOT EXISTS idx_users_best ON users(best_score DESC);
CREATE INDEX IF NOT EXISTS idx_users_part ON users(part);
CREATE INDEX IF NOT EXISTS idx_scores_user ON scores(user_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_users_nick ON users(lower(nickname));
`);

// ---- 마이그레이션: 기존 DB에 없는 컬럼 추가 -------------------------------
(function migrate() {
  try {
    const cols = db.prepare(`PRAGMA table_info(users)`).all().map(c => c.name);
    const add = (name, ddl) => { if (!cols.includes(name)) db.exec(`ALTER TABLE users ADD COLUMN ${ddl}`); };
    add('part',         `part TEXT NOT NULL DEFAULT ''`);
    add('last_daily',   `last_daily TEXT NOT NULL DEFAULT ''`);
    add('daily_streak', `daily_streak INTEGER NOT NULL DEFAULT 0`);
    add('coll_bonus',   `coll_bonus INTEGER NOT NULL DEFAULT 0`);
    add('play_date',    `play_date TEXT NOT NULL DEFAULT ''`);
    add('play_count',   `play_count INTEGER NOT NULL DEFAULT 0`);
  } catch (_) { /* 무시 */ }
})();

const stmt = {
  byDevice:   db.prepare('SELECT * FROM users WHERE device_id = ?'),
  byId:       db.prepare('SELECT * FROM users WHERE id = ?'),
  byNick:     db.prepare('SELECT id FROM users WHERE lower(nickname) = lower(?)'),
  insertUser: db.prepare(`INSERT INTO users (id, nickname, part, device_id) VALUES (?, ?, ?, ?)`),
  addScore:   db.prepare(`INSERT INTO scores (user_id, score) VALUES (?, ?)`),
  bumpUser:   db.prepare(`UPDATE users
                          SET best_score = MAX(best_score, ?), coins = coins + ?,
                              games_played = games_played + 1, updated_at = datetime('now')
                          WHERE id = ?`),
  bumpUserPlays: db.prepare(`UPDATE users
                          SET best_score = MAX(best_score, ?), coins = coins + ?,
                              games_played = games_played + 1,
                              play_date = ?, play_count = ?, updated_at = datetime('now')
                          WHERE id = ?`),
  addCoins:   db.prepare(`UPDATE users SET coins = coins + ?, updated_at = datetime('now') WHERE id = ?`),
  spendCoins: db.prepare(`UPDATE users SET coins = coins - ?, updated_at = datetime('now')
                          WHERE id = ? AND coins >= ?`),
  setDaily:   db.prepare(`UPDATE users SET coins = coins + ?, last_daily = ?, daily_streak = ?,
                          updated_at = datetime('now') WHERE id = ?`),
  setCollBonus: db.prepare(`UPDATE users SET coins = coins + ?, coll_bonus = 1,
                          updated_at = datetime('now') WHERE id = ? AND coll_bonus = 0`),
  upsertColl: db.prepare(`INSERT INTO collection (user_id, egg_id, count) VALUES (?, ?, 1)
                          ON CONFLICT(user_id, egg_id) DO UPDATE SET count = count + 1`),
  getColl:    db.prepare(`SELECT egg_id, count, first_at FROM collection WHERE user_id = ?`),
  collCount:  db.prepare(`SELECT COUNT(*) AS n FROM collection WHERE user_id = ?`),
  lbAll:      db.prepare(`SELECT id, nickname, part, best_score, games_played
                          FROM users WHERE best_score > 0
                          ORDER BY best_score DESC, updated_at ASC LIMIT ?`),
  lbPart:     db.prepare(`SELECT id, nickname, part, best_score, games_played
                          FROM users WHERE best_score > 0 AND part = ?
                          ORDER BY best_score DESC, updated_at ASC LIMIT ?`),
  partAgg:    db.prepare(`SELECT part,
                            COUNT(*)        AS members,
                            SUM(best_score) AS total,
                            MAX(best_score) AS top,
                            AVG(best_score) AS avg
                          FROM users WHERE best_score > 0 AND part <> ''
                          GROUP BY part`),
  rank:       db.prepare(`SELECT COUNT(*) + 1 AS rank FROM users
                          WHERE best_score > (SELECT best_score FROM users WHERE id = ?)`),
  partRank:   db.prepare(`SELECT COUNT(*) + 1 AS rank FROM users u
                          WHERE u.part = (SELECT part FROM users WHERE id = ?)
                            AND u.best_score > (SELECT best_score FROM users WHERE id = ?)`),
};

const newId = () => crypto.randomBytes(9).toString('base64url');

class AppError extends Error { constructor(code, msg) { super(msg); this.code = code; } }

// ---- 이벤트 기준 '오늘' 날짜 (기본 KST, env로 조정) -----------------------
const TZ_OFFSET_MIN = Number(process.env.EVENT_TZ_OFFSET_MIN ?? 540); // KST = UTC+9
function eventDateStr(ts = Date.now()) {
  return new Date(ts + TZ_OFFSET_MIN * 60000).toISOString().slice(0, 10); // YYYY-MM-DD
}

function registerOrLogin({ deviceId, nickname, part }) {
  const existing = stmt.byDevice.get(deviceId);
  if (existing) return existing;
  if (!isValidPart(part)) throw new AppError('BAD_PART', '올바른 악기 파트를 선택하세요');
  if (stmt.byNick.get(nickname)) throw new AppError('NICK_TAKEN', '이미 사용 중인 닉네임이에요');
  const id = newId();
  try {
    stmt.insertUser.run(id, nickname, part, deviceId);
  } catch (e) {
    if (String(e.message).includes('UNIQUE')) throw new AppError('NICK_TAKEN', '이미 사용 중인 닉네임이에요');
    throw e;
  }
  return stmt.byId.get(id);
}

function getUser(id) { return stmt.byId.get(id); }

// 하루 굽기 횟수 제한 (기본 10회/일, 이벤트 KST 기준)
const DAILY_PLAY_LIMIT = Number(process.env.DAILY_PLAY_LIMIT || 10);
function playsUsed(u) {
  const today = eventDateStr();
  return (u.play_date === today) ? u.play_count : 0;
}
function playsLeft(u) {
  return Math.max(0, DAILY_PLAY_LIMIT - playsUsed(u));
}

const submitScore = db.transaction((userId, score) => {
  const u = stmt.byId.get(userId);
  const today = eventDateStr();
  const used = (u.play_date === today) ? u.play_count : 0;
  if (used >= DAILY_PLAY_LIMIT) {
    return { limited: true, limit: DAILY_PLAY_LIMIT, remaining: 0,
             nextDate: eventDateStr(Date.now() + 86400000) };
  }
  const nextCount = used + 1;
  const coins = Math.max(1, Math.floor(score / 10));
  stmt.addScore.run(userId, score);
  stmt.bumpUserPlays.run(score, coins, today, nextCount, userId);
  return {
    user: stmt.byId.get(userId), coinsEarned: coins, rank: stmt.rank.get(userId).rank,
    limit: DAILY_PLAY_LIMIT, remaining: DAILY_PLAY_LIMIT - nextCount,
  };
});

// 일일 출석 보상: 같은 날 1회. 어제 받았으면 streak+1(최대 7배 보너스 캡).
const DAILY_BASE = Number(process.env.DAILY_BASE || 30);
const claimDaily = db.transaction((userId) => {
  const u = stmt.byId.get(userId);
  if (!u) return { ok: false, code: 'NO_USER' };
  const today = eventDateStr();
  if (u.last_daily === today) {
    return { ok: false, code: 'ALREADY', streak: u.daily_streak, nextDate: eventDateStr(Date.now() + 86400000) };
  }
  const yesterday = eventDateStr(Date.now() - 86400000);
  const streak = (u.last_daily === yesterday) ? Math.min(7, u.daily_streak + 1) : 1;
  const amount = DAILY_BASE + (streak - 1) * 10; // 1일차 30 → 7일차 90
  stmt.setDaily.run(amount, today, streak, userId);
  return { ok: true, amount, streak, user: stmt.byId.get(userId) };
});

// 도감 100% 수집 1회성 보너스. totalEggs 도달 + 미지급 시 지급.
const COLL_BONUS = Number(process.env.COLL_BONUS || 500);
function grantCollectionBonus(userId, totalEggs) {
  const u = stmt.byId.get(userId);
  if (!u || u.coll_bonus) return null;
  const have = stmt.collCount.get(userId).n;
  if (have < totalEggs) return null;
  const r = stmt.setCollBonus.run(COLL_BONUS, userId);
  if (r.changes === 0) return null;
  return { amount: COLL_BONUS, user: stmt.byId.get(userId) };
}

function getLeaderboard(limit = 20, part = null) {
  return part ? stmt.lbPart.all(part, limit) : stmt.lbAll.all(limit);
}
function getPartStandings() {
  return stmt.partAgg.all().map(r => ({
    part: r.part, members: r.members, total: r.total,
    top: r.top, avg: Math.round(r.avg),
  }));
}
function getRank(userId) { return stmt.rank.get(userId).rank; }
function getPartRank(userId) { return stmt.partRank.get(userId, userId).rank; }
function getCollection(userId) { return stmt.getColl.all(userId); }
function getCollectionCount(userId) { return stmt.collCount.get(userId).n; }

const drawEgg = db.transaction((userId, cost, egg) => {
  const ok = stmt.spendCoins.run(cost, userId, cost);
  if (ok.changes === 0) return null;
  stmt.upsertColl.run(userId, egg.id);
  return stmt.byId.get(userId);
});

module.exports = {
  db, DB_PATH, DRIVER, AppError, eventDateStr,
  DAILY_BASE, COLL_BONUS, DAILY_PLAY_LIMIT, playsLeft, playsUsed,
  registerOrLogin, getUser, submitScore,
  claimDaily, grantCollectionBonus,
  getLeaderboard, getPartStandings, getRank, getPartRank,
  getCollection, getCollectionCount, drawEgg,
};
