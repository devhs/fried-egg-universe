/* ===== 계란 후라이 유니버스 v2 — 클라이언트 ===== */
const $ = (s) => document.querySelector(s);
const api = (p, opt) => fetch('/api' + p, opt).then(r => r.json());
const postJSON = (body) => ({ method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
const escapeHtml = (s) => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

let STATE = {
  user: null, eggs: [], rarity: {}, parts: [], partsById: {}, drawCost: 50,
  dailyBase: 30, collBonus: 500, today: '', collection: {}, lbFilter: null, lbMode: 'solo',
};
let selectedPart = null;

function deviceId() {
  let id = localStorage.getItem('feu_device');
  if (!id) { id = 'd_' + Math.random().toString(36).slice(2) + Date.now().toString(36); localStorage.setItem('feu_device', id); }
  return id;
}

async function boot() {
  const cat = await api('/eggs');
  STATE.eggs = cat.eggs; STATE.rarity = cat.rarity; STATE.parts = cat.parts;
  STATE.drawCost = cat.drawCost; STATE.dailyBase = cat.dailyBase; STATE.collBonus = cat.collBonus;
  STATE.parts.forEach(p => STATE.partsById[p.id] = p);
  $('#drawCost').textContent = cat.drawCost;
  renderPartPicker(); renderPartFilter(); renderRarityLegend();

  const challengerId = new URLSearchParams(location.search).get('u');
  const savedId = localStorage.getItem('feu_uid');
  if (savedId) {
    const data = await api('/me/' + savedId);
    if (!data.error) { applyUser(data); closeOnboard(); }
    else openOnboard();
  } else {
    openOnboard();
  }
  renderAtlas(); loadLeaderboard();
  if (challengerId && challengerId !== localStorage.getItem('feu_uid')) showChallenge(challengerId);
}

function applyUser(data) {
  if (!data || data.error) return;
  STATE.user = data.user;
  if (data.today) STATE.today = data.today;
  STATE.collection = {};
  (data.collection || []).forEach(c => STATE.collection[c.egg_id] = c.count);
  localStorage.setItem('feu_uid', data.user.id);
  localStorage.setItem('feu_nick', data.user.nickname);
  syncHeader(data.rank);
  renderDaily();
  renderPlaysLeft();
}

function renderPlaysLeft() {
  if (!STATE.user) return;
  const n = STATE.user.playsLeft, lim = STATE.user.playLimit || 10;
  const el = $('#playsLeftNum'), li = $('#playsLimitNum'), row = $('#playsLeftRow');
  if (n == null) return;
  if (el) el.textContent = n;
  if (li) li.textContent = lim;
  if (row) row.classList.toggle('empty', n <= 0);
}

function syncHeader(rank, animateCoins) {
  if (!STATE.user) return;
  const u = STATE.user;
  $('#hNick').textContent = u.nickname;
  const tag = $('#hPart');
  if (u.partLabel) { tag.style.display = ''; tag.textContent = u.partEmoji + ' ' + u.partLabel; tag.style.background = u.partColor; $('#hAvatar').textContent = u.partEmoji || '🍳'; }
  const rk = rank != null ? rank : null;
  $('#hMeta').textContent = `최고 ${u.bestScore.toLocaleString()}` + (rk ? ` · ${rk}위` : '');
  setCoins(u.coins, animateCoins);
}

let _coinShown = 0;
function setCoins(target, animate) {
  const el = $('#hCoins');
  if (!animate) { _coinShown = target; el.textContent = target.toLocaleString(); return; }
  $('#coinPill').classList.remove('bump'); void $('#coinPill').offsetWidth; $('#coinPill').classList.add('bump');
  const from = _coinShown, diff = target - from, dur = 650, t0 = performance.now();
  function step(t) {
    const k = Math.min(1, (t - t0) / dur), e = 1 - Math.pow(1 - k, 3);
    el.textContent = Math.round(from + diff * e).toLocaleString();
    if (k < 1) requestAnimationFrame(step); else { _coinShown = target; }
  }
  requestAnimationFrame(step);
}

/* ---- 온보딩 ---- */
function openOnboard() { $('#onboard').classList.add('show'); }
function closeOnboard() { $('#onboard').classList.remove('show'); }
function renderPartPicker() {
  $('#partPick').innerHTML = STATE.parts.map(p =>
    `<button data-id="${p.id}">${p.emoji} ${p.label}</button>`).join('');
  $('#partPick').querySelectorAll('button').forEach(b => b.onclick = () => {
    selectedPart = b.dataset.id;
    $('#partPick').querySelectorAll('button').forEach(x => {
      const on = x.dataset.id === selectedPart;
      x.classList.toggle('sel', on);
      x.style.background = on ? STATE.partsById[x.dataset.id].color : '#fff';
    });
  });
}
$('#startBtn').onclick = async () => {
  const nick = $('#nickInput').value.trim();
  const err = $('#onboardErr');
  if (!nick) { err.textContent = '닉네임을 입력해주세요'; return; }
  if (!selectedPart) { err.textContent = '악기 파트를 선택해주세요'; return; }
  const data = await api('/register', postJSON({ deviceId: deviceId(), nickname: nick, part: selectedPart }));
  if (data.error) { err.textContent = data.error; return; }
  applyUser(data); renderAtlas(); loadLeaderboard(); closeOnboard();
  confettiBurst({ count: 60 });
};

/* ---- 일일 출석 ---- */
function renderDaily() {
  const card = $('#dailyCard'), sub = $('#dailySub'), cta = $('#dailyCta');
  if (!STATE.user) { card.style.display = 'none'; return; }
  card.style.display = '';
  const claimedToday = STATE.user.lastDaily && STATE.user.lastDaily === STATE.today;
  if (claimedToday) {
    card.classList.add('claimed');
    sub.textContent = `${STATE.user.dailyStreak}일 연속 출석 중 · 내일 또 받으세요`;
    cta.textContent = '완료';
  } else {
    card.classList.remove('claimed');
    sub.textContent = '오늘의 코인을 받으세요';
    cta.textContent = '받기';
  }
}
$('#dailyCard').onclick = async () => {
  if (!STATE.user) { openOnboard(); return; }
  if (STATE.user.lastDaily === STATE.today) { toast('오늘은 이미 받았어요 🎁'); return; }
  const r = await api('/daily', postJSON({ userId: STATE.user.id }));
  if (r.error) { toast(r.error); if (r.code === 'ALREADY') { STATE.user.lastDaily = STATE.today; renderDaily(); } return; }
  STATE.user = r.user; renderDaily(); syncHeader(null, true);
  confettiBurst({ count: 40 });
  toast(`출석 보상 +${r.amount} 🪙 (${r.streak}일 연속)`);
};

/* ---- 도전장 ---- */
async function showChallenge(id) {
  const c = await api('/u/' + id);
  if (c.error) return;
  const col = (STATE.partsById[c.part] || {}).color || '#999';
  $('#challengeBody').innerHTML =
    `<p style="font-size:17px"><b>${escapeHtml(c.nickname)}</b> 님 <span class="part-tag" style="background:${col}">${c.partEmoji} ${c.partLabel}</span></p>
     <p class="score-big" style="margin:4px 0"><b>${c.bestScore.toLocaleString()}</b> 점! 🔥</p>
     <p class="tiny muted">현재 ${c.rank}위 · 도감 ${c.collected}/${c.totalEggs}종 수집<br>이 점수를 이길 수 있나요?</p>`;
  $('#challenge').classList.add('show');
  history.replaceState(null, '', location.pathname);
}
$('#acceptBtn').onclick = () => {
  $('#challenge').classList.remove('show');
  if (!STATE.user) openOnboard(); else switchPage('play');
};

/* ---- 탭 전환 ---- */
document.querySelectorAll('.tabbar button').forEach((b, i) => b.onclick = () => switchPage(b.dataset.page, i));
function switchPage(page, idx) {
  document.querySelectorAll('.tabbar button').forEach((x, i) => {
    const on = x.dataset.page === page; x.classList.toggle('active', on);
    if (on && idx == null) idx = i;
  });
  document.querySelectorAll('.page').forEach(x => x.classList.toggle('active', x.id === 'page-' + page));
  moveTabInd(idx);
  if (page === 'rank') loadLeaderboard();
  if (page === 'atlas') renderAtlas();
}
function moveTabInd(idx) {
  if (idx == null) return;
  const ind = $('#tabInd'); if (!ind) return;
  ind.style.width = (100 / 4) + '%';
  ind.style.transform = `translateX(${idx * 100}%)`;
}

/* ===== 게임 엔진 ===== */
const cvs = $('#pan'), ctx = cvs.getContext('2d');
const DPR = Math.min(2, window.devicePixelRatio || 1);
cvs.width = 300 * DPR; cvs.height = 300 * DPR; ctx.scale(DPR, DPR);

const G = { running: false, raf: 0, pos: 0, dir: 1, speed: 0.9, zoneCenter: 50, zoneHalf: 18,
  lives: 3, combo: 0, score: 0, round: 0, doneness: 30, goalName: '' };
const GOALS = ['🇰🇷 한국식', '🇯🇵 메다마야키', '🇺🇸 Sunny-side', '🇪🇸 Huevo frito', '🇨🇳 허바오단'];

function newRound() {
  G.round++;
  G.speed = 0.9 + G.round * 0.13;
  G.zoneHalf = Math.max(7, 18 - G.round * 0.9);
  G.zoneCenter = 18 + Math.random() * 64;
  G.pos = Math.random() * 100; G.dir = Math.random() < .5 ? 1 : -1;
  G.goalName = GOALS[Math.floor(Math.random() * GOALS.length)];
  $('#goalLabel').textContent = G.goalName;
  layoutZone();
}
function layoutZone() {
  const z = $('#zone');
  z.style.left = (G.zoneCenter - G.zoneHalf) + '%';
  z.style.width = (G.zoneHalf * 2) + '%';
}
function startGame() {
  Object.assign(G, { running: true, lives: 3, combo: 0, score: 0, round: 0, doneness: 30 });
  updHud(); newRound(); cancelAnimationFrame(G.raf); loop();
}
function loop() {
  G.pos += G.dir * G.speed;
  if (G.pos >= 100) { G.pos = 100; G.dir = -1; }
  if (G.pos <= 0) { G.pos = 0; G.dir = 1; }
  $('#marker').style.left = G.pos + '%';
  drawPan();
  if (G.running) G.raf = requestAnimationFrame(loop);
}
function tap() {
  if (!STATE.user) { openOnboard(); return; }
  if (!G.running) {
    if ((STATE.user.playsLeft != null) && STATE.user.playsLeft <= 0) {
      toast(`오늘 굽기 ${STATE.user.playLimit || 10}판을 다 썼어요 🍳 내일 다시 와요!`);
      return;
    }
    startGame(); return;
  }
  const dist = Math.abs(G.pos - G.zoneCenter);
  if (dist <= G.zoneHalf) {
    const acc = 1 - dist / G.zoneHalf;
    const base = 50 + Math.round(acc * 100);
    G.combo++;
    G.score += base * Math.max(1, G.combo);
    G.doneness = Math.min(80, 40 + acc * 30);
    flash(acc > 0.8 ? 'PERFECT!' : 'GOOD!', acc > 0.8 ? '#1f9d61' : '#fb8500');
    buzz(15); updHud(); newRound();
  } else {
    G.combo = 0; G.lives--;
    G.doneness = G.pos > G.zoneCenter ? 95 : 8;
    flash(G.pos > G.zoneCenter ? '탔어요 🔥' : '설익음 🥚', '#dd4332');
    buzz([40, 30, 40]); updHud();
    if (G.lives <= 0) { endGame(); return; }
    newRound();
  }
}
function updHud() { $('#lives').textContent = G.lives; $('#combo').textContent = G.combo; $('#curScore').textContent = G.score.toLocaleString(); }
function flash(txt, color) { const f = $('#flash'); f.textContent = txt; f.style.color = color; f.classList.remove('show'); void f.offsetWidth; f.classList.add('show'); }
function buzz(p) { if (navigator.vibrate) navigator.vibrate(p); }

async function endGame() {
  G.running = false; cancelAnimationFrame(G.raf);
  const res = await api('/score', postJSON({ userId: STATE.user.id, score: G.score }));
  if (res.code === 'DAILY_LIMIT') {
    if (STATE.user) STATE.user.playsLeft = 0;
    renderPlaysLeft();
    $('#goEmoji').textContent = '🌙';
    $('#goTitle').textContent = '오늘은 여기까지!';
    $('#goScore').textContent = G.score.toLocaleString();
    $('#goReward').textContent = res.error;
    $('#goRank').textContent = '내일 다시 도전할 수 있어요.';
    $('#gameover').classList.add('show');
    return;
  }
  if (!res.error) {
    const newRecord = G.score >= res.user.bestScore;
    STATE.user = res.user; syncHeader(res.rank, true);
    if (res.remaining != null) STATE.user.playsLeft = res.remaining;
    renderPlaysLeft();
    $('#goEmoji').textContent = '🍳';
    $('#goScore').textContent = G.score.toLocaleString();
    const left = (res.remaining != null) ? `  ·  오늘 남은 굽기 ${res.remaining}판` : '';
    $('#goReward').textContent = '+' + res.coinsEarned + ' 🪙  (보유 ' + res.user.coins.toLocaleString() + ')' + left;
    const pl = res.user.partLabel ? ` · ${res.user.partLabel} ${res.partRank}위` : '';
    $('#goRank').textContent = '전체 ' + res.rank + '위' + pl + ' · 최고점 ' + res.user.bestScore.toLocaleString();
    $('#goTitle').textContent = newRecord ? '🎉 신기록!' : '게임 종료!';
    if (newRecord && G.score > 0) confettiBurst({ count: 70 });
  }
  $('#gameover').classList.add('show');
}
$('#retryBtn').onclick = () => { $('#gameover').classList.remove('show'); startGame(); };
$('#toAtlasBtn').onclick = () => { $('#gameover').classList.remove('show'); switchPage('atlas'); };
$('#cookBtn').onclick = tap;
cvs.addEventListener('pointerdown', (e) => { e.preventDefault(); tap(); });

function drawPan() {
  const d = G.doneness, t = Date.now() / 600;
  ctx.clearRect(0, 0, 300, 300);
  ctx.fillStyle = '#2a2723'; ctx.beginPath(); ctx.arc(150, 150, 145, 0, 7); ctx.fill();
  ctx.fillStyle = '#3a352f'; ctx.beginPath(); ctx.arc(150, 150, 133, 0, 7); ctx.fill();
  // 팬 안쪽 광택
  const pg = ctx.createRadialGradient(110, 105, 10, 150, 150, 140);
  pg.addColorStop(0, 'rgba(255,255,255,.10)'); pg.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = pg; ctx.beginPath(); ctx.arc(150, 150, 133, 0, 7); ctx.fill();
  const brown = d > 80 ? Math.min(45, d - 80) : 0;
  ctx.fillStyle = `rgb(${255 - brown},${253 - brown * 1.6},${247 - brown * 3})`;
  ctx.beginPath();
  for (let a = 0; a <= 6.3; a += 0.22) {
    const r = 96 + Math.sin(a * 3 + t) * 7 + Math.cos(a * 2) * 5;
    const x = 150 + Math.cos(a) * r, y = 150 + Math.sin(a) * r;
    a === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
  }
  ctx.closePath(); ctx.fill();
  if (d > 82) { ctx.strokeStyle = 'rgba(180,110,40,.55)'; ctx.lineWidth = 5; ctx.stroke(); }
  const yr = 48 - d * 0.14, cooked = Math.min(1, d / 85);
  const yc = `rgb(${255 - cooked * 40},${183 - cooked * 55},${3 + cooked * 70})`;
  const g = ctx.createRadialGradient(135, 135, 5, 150, 150, yr);
  g.addColorStop(0, d < 60 ? '#ffe08a' : yc); g.addColorStop(1, yc);
  ctx.fillStyle = g; ctx.beginPath(); ctx.arc(150, 150, yr, 0, 7); ctx.fill();
  if (d < 55) { ctx.fillStyle = 'rgba(255,255,255,.55)'; ctx.beginPath(); ctx.arc(137, 137, yr * 0.25, 0, 7); ctx.fill(); }
}
drawPan();

/* ---- 도감 ---- */
function renderRarityLegend() {
  const el = $('#rarityLegend'); if (!el) return;
  el.innerHTML = Object.entries(STATE.rarity).map(([k, m]) =>
    `<span style="background:${m.color}">${'★'.repeat(m.stars || 1)} ${m.label}</span>`).join('');
}
function renderAtlas() {
  const grid = $('#atlasGrid'); if (!grid) return;
  const owned = STATE.collection || {};
  const have = Object.keys(owned).length, total = STATE.eggs.length;
  $('#collCount').textContent = `${have} / ${total} 수집`;
  const bar = $('#collBar'); if (bar) bar.style.width = (total ? (have / total * 100) : 0) + '%';
  grid.innerHTML = STATE.eggs.map(e => {
    const cnt = owned[e.id], rm = STATE.rarity[e.rarity] || {};
    if (!cnt) return `<div class="egg-tile locked ${e.rarity}"><div class="art"><img src="${e.img}" alt="" loading="lazy"><span class="qmark">?</span></div><div class="en">???</div><span class="rar" style="background:${rm.color}">${'★'.repeat(rm.stars || 1)}</span></div>`;
    return `<div class="egg-tile owned ${e.rarity}">${cnt > 1 ? `<div class="cnt">x${cnt}</div>` : ''}
      <div class="art"><img src="${e.img}" alt="${escapeHtml(e.name)}" loading="lazy"></div>
      <div class="co">${escapeHtml(e.sub || e.group || '')}</div><div class="en">${escapeHtml(e.name)}</div>
      <div class="dz">${escapeHtml(e.desc)}</div><span class="rar" style="background:${rm.color}">${'★'.repeat(rm.stars || 1)} ${rm.label || ''}</span></div>`;
  }).join('');
}
$('#drawBtn').onclick = async () => {
  if (!STATE.user) { openOnboard(); return; }
  if (STATE.user.coins < STATE.drawCost) {
    $('#drawResult').innerHTML = `<div class="draw-card"><b>코인이 부족해요 🪙</b><p class="tiny muted">굽기 게임으로 코인을 모아보세요!<br>(필요 ${STATE.drawCost} · 보유 ${STATE.user.coins})</p></div>`;
    return;
  }
  const res = await api('/draw', postJSON({ userId: STATE.user.id }));
  if (res.error) { $('#drawResult').innerHTML = `<div class="draw-card"><b>${res.error}</b></div>`; return; }
  STATE.user = res.user; STATE.collection = {};
  res.collection.forEach(c => STATE.collection[c.egg_id] = c.count);
  syncHeader(null, true);
  const e = res.egg, rm = STATE.rarity[e.rarity] || {}, isNew = STATE.collection[e.id] === 1, leg = e.rarity === 'legendary';
  $('#drawResult').innerHTML = `<div class="draw-card ${leg ? 'legendary' : ''}"><div class="draw-art"><img src="${e.img}" alt="${escapeHtml(e.name)}"></div>
    <div><span class="rar" style="background:${rm.color}">${'★'.repeat(rm.stars || 1)} ${rm.label || ''}</span>${isNew ? '<span class="newbadge">NEW</span>' : ''}</div>
    <div class="en" style="font-size:16px;margin-top:6px">${escapeHtml(e.name)}</div>
    <div class="co">${escapeHtml(e.sub || '')}</div>
    <div class="dz tiny muted" style="margin-top:6px">${escapeHtml(e.desc)}</div></div>`;
  buzz(leg ? [60, 40, 120] : 25);
  if (leg) confettiBurst({ count: 90, gold: true });
  renderAtlas();
  if (res.collectionBonus) {
    setTimeout(() => {
      confettiBurst({ count: 120, gold: true });
      toast(`🏆 도감 100% 완성! 보너스 +${res.collectionBonus.amount} 🪙`);
      syncHeader(null, true);
    }, 600);
  }
};

/* ---- 리더보드 (개인 / 섹션) ---- */
$('#rankSeg').querySelectorAll('button').forEach(b => b.onclick = () => {
  STATE.lbMode = b.dataset.mode;
  $('#rankSeg').querySelectorAll('button').forEach(x => x.classList.toggle('on', x === b));
  $('#soloWrap').style.display = STATE.lbMode === 'solo' ? '' : 'none';
  $('#sectionWrap').style.display = STATE.lbMode === 'section' ? '' : 'none';
  loadLeaderboard();
});
function renderPartFilter() {
  const el = $('#partFilter');
  const chips = [{ id: null, label: '전체' }].concat(STATE.parts.map(p => ({ id: p.id, label: p.emoji + p.label })));
  el.innerHTML = chips.map(c =>
    `<button data-id="${c.id ?? ''}" class="${(STATE.lbFilter || '') === (c.id || '') ? 'on' : ''}">${c.label}</button>`).join('');
  el.querySelectorAll('button').forEach(b => b.onclick = () => {
    STATE.lbFilter = b.dataset.id || null;
    renderPartFilter(); loadLeaderboard();
  });
}
async function loadLeaderboard() {
  if (STATE.lbMode === 'section') return loadSection();
  const q = '/leaderboard?limit=50' + (STATE.lbFilter ? '&part=' + STATE.lbFilter : '');
  const { leaderboard } = await api(q);
  const myId = STATE.user && STATE.user.id;
  $('#rankList').innerHTML = (leaderboard || []).map((u, i) => {
    const medal = i === 0 ? '🥇' : i === 1 ? '🥈' : i === 2 ? '🥉' : (i + 1);
    const p = STATE.partsById[u.part];
    const tag = p ? `<span class="part-tag pt" style="background:${p.color}">${p.emoji}${p.label}</span>` : '';
    return `<li class="${u.id === myId ? 'me-row' : ''}"><span class="rk ${i < 3 ? 'top' : ''}">${medal}</span>
      <span class="nm"><span class="nmtxt">${escapeHtml(u.nickname)}</span>${tag}</span><span class="sc">${u.best_score.toLocaleString()}</span></li>`;
  }).join('') || '<li class="tiny muted">아직 기록이 없어요. 첫 주자가 되어보세요!</li>';
}
async function loadSection() {
  const { standings } = await api('/parts/leaderboard');
  const list = (standings || []).filter(s => s.members > 0);
  const myPart = STATE.user && STATE.user.part;
  const mySec = myPart === 'co' ? 'pe' : myPart; // 지휘자는 타악기 섹션
  const max = Math.max(1, ...list.map(s => s.avg));
  const el = $('#sectionList');
  if (!list.length) { el.innerHTML = '<p class="tiny muted center">아직 점수를 낸 파트가 없어요.</p>'; return; }
  el.innerHTML = list.map((s, i) => {
    const medal = i === 0 ? '🥇' : i === 1 ? '🥈' : i === 2 ? '🥉' : (i + 1);
    return `<div class="sec-row ${s.part === mySec ? 'mine' : ''}">
      <div class="sec-fill" style="width:${(s.avg / max * 100).toFixed(1)}%;background:${s.color}"></div>
      <div class="sec-top">
        <span class="sec-rank ${i < 3 ? 'top' : ''}">${medal}</span>
        <span class="sec-name">${s.emoji} ${s.label}<small>${s.members}명</small></span>
        <span class="sec-total">${s.avg.toLocaleString()}</span>
      </div>
      <div class="sec-sub">상위 ${s.top5n}명 평균 · 최고 ${s.top.toLocaleString()}</div>
    </div>`;
  }).join('');
}
$('#refreshRank').onclick = loadLeaderboard;

/* ---- 공유 ---- */
async function shareScore() {
  if (!STATE.user) { openOnboard(); return; }
  const u = STATE.user;
  const url = location.origin + '/?u=' + u.id;
  const text = `🍳 ${u.nickname} 님, 최고 ${u.bestScore.toLocaleString()}점! 🔥 (${u.partLabel || '-'} 파트)\n계란 후라이 유니버스 — 나 이길 수 있어? 👇\n${url}`;
  const ok = await copyText(text);
  toast(ok ? '복사 완료! 카톡에 붙여넣기 하세요 📋' : '복사 실패… 링크를 길게 눌러 복사하세요');
}
function copyText(t) {
  if (navigator.clipboard && window.isSecureContext) {
    return navigator.clipboard.writeText(t).then(() => true).catch(() => legacyCopy(t));
  }
  return Promise.resolve(legacyCopy(t));
}
function legacyCopy(t) {
  try {
    const ta = document.createElement('textarea');
    ta.value = t; ta.setAttribute('readonly', '');
    ta.style.position = 'fixed'; ta.style.top = '-1000px'; ta.style.opacity = '0';
    document.body.appendChild(ta); ta.focus(); ta.select();
    ta.setSelectionRange(0, t.length);
    const ok = document.execCommand('copy');
    document.body.removeChild(ta);
    return ok;
  } catch { return false; }
}
$('#shareBtn').onclick = shareScore;
if ($('#shareBtn2')) $('#shareBtn2').onclick = shareScore;

/* ---- 토스트 ---- */
function toast(msg) {
  let t = $('#toast');
  if (!t) { t = document.createElement('div'); t.id = 'toast'; document.body.appendChild(t); }
  t.textContent = msg; t.className = 'show';
  clearTimeout(toast._t); toast._t = setTimeout(() => t.className = '', 2400);
}

/* ---- 컨페티 ---- */
const confCanvas = $('#confetti'), cctx = confCanvas.getContext('2d');
function sizeConf() { confCanvas.width = innerWidth; confCanvas.height = innerHeight; }
addEventListener('resize', sizeConf); sizeConf();
let confParts = [], confRaf = 0;
function confettiBurst({ count = 60, gold = false } = {}) {
  sizeConf();
  const colors = gold ? ['#e7a52b', '#ffd166', '#fff0c2', '#fb8500'] : ['#f0651f', '#ffb703', '#1f9d61', '#2f8fd6', '#9b51e0'];
  const cx = innerWidth / 2, cy = innerHeight * 0.36;
  for (let i = 0; i < count; i++) {
    const ang = Math.random() * Math.PI * 2, sp = 4 + Math.random() * 7;
    confParts.push({ x: cx, y: cy, vx: Math.cos(ang) * sp, vy: Math.sin(ang) * sp - 4,
      g: 0.18 + Math.random() * 0.12, s: 5 + Math.random() * 6, rot: Math.random() * 6.28,
      vr: (Math.random() - .5) * 0.4, c: colors[i % colors.length], life: 1 });
  }
  confCanvas.style.display = 'block';
  if (!confRaf) confRaf = requestAnimationFrame(confTick);
}
function confTick() {
  cctx.clearRect(0, 0, confCanvas.width, confCanvas.height);
  confParts = confParts.filter(p => p.life > 0 && p.y < confCanvas.height + 40);
  for (const p of confParts) {
    p.vy += p.g; p.x += p.vx; p.y += p.vy; p.rot += p.vr; p.life -= 0.006;
    cctx.save(); cctx.translate(p.x, p.y); cctx.rotate(p.rot); cctx.globalAlpha = Math.max(0, p.life);
    cctx.fillStyle = p.c; cctx.fillRect(-p.s / 2, -p.s / 2, p.s, p.s * 0.6); cctx.restore();
  }
  if (confParts.length) confRaf = requestAnimationFrame(confTick);
  else { confRaf = 0; confCanvas.style.display = 'none'; }
}

moveTabInd(0);
boot();
